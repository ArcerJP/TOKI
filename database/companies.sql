-- Apply AFTER schema.sql. Preserves all existing boards. No private data is included.
-- Configure Google Auth and bootstrap the first company before publishing the new UI.
begin;
alter table public.toki_boards drop constraint if exists toki_boards_id_check;
create table if not exists toki_private.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  code text not null unique default upper(replace(gen_random_uuid()::text,'-','')),
  board_id text not null unique references public.toki_boards(id),
  created_at timestamptz not null default now()
);
create table if not exists toki_private.company_members (
  company_id uuid not null references toki_private.companies(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check(role in ('admin','member')),
  status text not null default 'pending' check(status in ('pending','active','blocked')),
  created_at timestamptz not null default now(),
  primary key(company_id,user_id)
);
create table if not exists toki_private.company_invites (
  company_id uuid not null references toki_private.companies(id),
  email text not null check(email=lower(btrim(email))),
  role text not null default 'member' check(role in ('admin','member')),
  expires_at timestamptz not null default now()+interval '7 days',
  primary key(company_id,email)
);
alter table toki_private.companies enable row level security;
alter table toki_private.company_members enable row level security;
alter table toki_private.company_invites enable row level security;
revoke all on toki_private.companies,toki_private.company_members,toki_private.company_invites from public,anon,authenticated;
-- One fixed counter row per company. Invited users and existing memberships
-- never consume the public application quota.
create table if not exists toki_private.company_join_limits (
  company_id uuid primary key references toki_private.companies(id),
  window_started_at timestamptz not null,
  window_attempts integer not null check(window_attempts between 1 and 31),
  day_started_at timestamptz not null,
  day_attempts integer not null check(day_attempts between 1 and 201)
);
-- Install the compatible RPC first. The rollout enables the stricter schedule
-- contract once the UI is deployed. Reapplying this file preserves that state.
alter table toki_private.companies add column if not exists scoped_schedule boolean not null default false;
alter table toki_private.companies add column if not exists invitation_v2 boolean not null default false;
alter table toki_private.company_members add column if not exists person_id uuid;
alter table toki_private.company_members add column if not exists visible_groups text[] not null default '{}';
alter table toki_private.company_members add column if not exists request_name text;
alter table toki_private.company_invites add column if not exists display_name text;
create table if not exists toki_private.company_guests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references toki_private.companies(id),
  display_name text not null,
  visible_groups text[] not null,
  visible_people uuid[] not null,
  person_id uuid,
  invite_hash bytea unique,
  invite_claimant_hash bytea,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique(company_id,person_id)
);
create index if not exists company_guests_company_idx on toki_private.company_guests(company_id);
alter table toki_private.company_guests enable row level security;
revoke all on toki_private.company_guests from public,anon,authenticated;
create table if not exists toki_private.company_guest_sessions (
  token_hash bytea primary key,
  guest_id uuid not null references toki_private.company_guests(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists company_guest_sessions_guest_idx on toki_private.company_guest_sessions(guest_id);
alter table toki_private.company_guest_sessions enable row level security;
revoke all on toki_private.company_guest_sessions from public,anon,authenticated;
create unique index if not exists company_member_person_unique
  on toki_private.company_members(company_id,person_id) where person_id is not null;
alter table toki_private.company_join_limits enable row level security;
revoke all on toki_private.company_join_limits from public,anon,authenticated;

create table if not exists toki_private.company_pin_key (
  singleton boolean primary key default true check(singleton),
  secret text not null
);
insert into toki_private.company_pin_key(secret) values(gen_random_uuid()::text || gen_random_uuid()::text)
  on conflict do nothing;
create table if not exists toki_private.company_pin_invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references toki_private.companies(id),
  pin_hash bytea not null,
  display_name text,
  visible_groups text[] not null,
  created_at timestamptz not null default now(),
  disabled_at timestamptz,
  unique(company_id,pin_hash)
);
create table if not exists toki_private.company_pin_failures (
  company_id uuid primary key references toki_private.companies(id),
  started_at timestamptz not null,
  failures integer not null check(failures between 1 and 20)
);
alter table toki_private.company_pin_key enable row level security;
alter table toki_private.company_pin_invites enable row level security;
alter table toki_private.company_pin_failures enable row level security;
revoke all on toki_private.company_pin_key,toki_private.company_pin_invites,toki_private.company_pin_failures from public,anon,authenticated;

create or replace function toki_private.company_pin_hash(org uuid, pin text)
returns bytea language sql stable set search_path='' as $$
  select sha256(convert_to(secret || org::text || pin,'UTF8')) from toki_private.company_pin_key
$$;
revoke all on function toki_private.company_pin_hash(uuid,text) from public,anon,authenticated;

create table if not exists toki_private.company_application_mail (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references toki_private.companies(id),
  requester uuid not null references auth.users(id) on delete cascade,
  administrator uuid not null references auth.users(id) on delete cascade,
  requested_at timestamptz not null,
  next_attempt_at timestamptz not null default now(),
  lease_id uuid,
  attempts integer not null default 0,
  unique(company_id,requester,administrator,requested_at)
);
alter table toki_private.company_application_mail enable row level security;
revoke all on toki_private.company_application_mail from public,anon,authenticated;

-- Used only by the project owner in the SQL Editor. Does not copy or change the board.
create or replace function toki_private.bootstrap_company(p_board text,p_name text,p_email text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c toki_private.companies%rowtype;
begin
  if p_email is null or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'INVALID'; end if;
  insert into toki_private.companies(name,board_id) values(btrim(p_name),p_board)
    on conflict(board_id) do nothing;
  select * into c from toki_private.companies where board_id=p_board;
  if not exists(select 1 from toki_private.company_members where company_id=c.id and role='admin' and status='active') then
    insert into toki_private.company_invites(company_id,email,role,expires_at)
      values(c.id,lower(btrim(p_email)),'admin',now()+interval '30 days')
      on conflict(company_id,email) do update set role='admin',expires_at=excluded.expires_at;
  end if;
  return jsonb_build_object('id',c.id,'name',c.name,'code',c.code);
end;
$$;
revoke all on function toki_private.bootstrap_company(text,text,text) from public,anon,authenticated;

create or replace function toki_private.with_schedule_rows(board jsonb)
returns jsonb language sql volatile set search_path='' as $$
  select case when board ? 'rows' then board else jsonb_set(board,'{rows}',
    coalesce((select jsonb_agg(jsonb_build_object('id',gen_random_uuid(),'kind','person') order by n)
              from jsonb_array_elements(board->'people') with ordinality as p(name,n)),'[]')) end
$$;

create or replace function toki_private.schedule_row_index(board jsonb,row_id uuid)
returns integer language sql immutable set search_path='' as $$
  select (n-1)::integer from jsonb_array_elements(board->'rows') with ordinality as r(row,n)
    where row->>'id'=row_id::text
$$;

create or replace function toki_private.append_schedule_row(board jsonb, row_id uuid, name text, kind text)
returns jsonb language sql immutable set search_path='' as $$
  select board || jsonb_build_object(
    'people',(board->'people') || jsonb_build_array(name),
    'rows',(board->'rows') || jsonb_build_array(jsonb_build_object('id',row_id,'kind',kind)))
$$;

create or replace function toki_private.remove_schedule_row(board jsonb, row_index integer)
returns jsonb language sql immutable set search_path='' as $$
  select board || jsonb_build_object(
    'people',(board->'people') - row_index,
    'rows',(board->'rows') - row_index,
    'events',coalesce((select jsonb_agg(jsonb_set(e,'{person}',to_jsonb(p - (p > row_index)::integer)) order by n)
      from jsonb_array_elements(board->'events') with ordinality as entry(e,n)
      cross join lateral (select (e->>'person')::integer as p) person
      where p<>row_index),'[]'),
    'groups',coalesce((select jsonb_agg(jsonb_set(g,'{members}',remaining.members) order by n)
      from jsonb_array_elements(board->'groups') with ordinality as entry(g,n)
      cross join lateral (select coalesce(jsonb_agg(p - (p > row_index)::integer order by i),'[]') as members
        from jsonb_array_elements_text(g->'members') with ordinality as person(value,i)
        cross join lateral (select value::integer as p) position where p<>row_index) remaining),'[]'),
    'meetings',coalesce((select jsonb_agg(jsonb_set(m,'{members}',remaining.members) order by n)
      from jsonb_array_elements(board->'meetings') with ordinality as entry(m,n)
      cross join lateral (select coalesce(jsonb_agg(p - (p > row_index)::integer order by i),'[]') as members
        from jsonb_array_elements_text(m->'members') with ordinality as person(value,i)
        cross join lateral (select value::integer as p) position where p<>row_index) remaining
      where remaining.members<>'[]'),'[]'))
$$;

create or replace function toki_private.checked_schedule_name(value text)
returns text language plpgsql immutable set search_path='' as $$
declare name text:=toki_private.normalize_name(value);
begin
  if name is null or toki_private.js_length(name) not between 1 and 40
    or not toki_private.supported_name(name) or name ~ U&'[\0001-\001f\007f-\009f]'
    then raise exception 'NAME_INVALID'; end if;
  return name;
end;
$$;

-- Active invitation names reserve a future row without adding it to the board
-- before the invited account signs in.
create or replace function toki_private.check_schedule_invitations(org uuid, board jsonb, new_name text, skip_email text)
returns void language plpgsql stable set search_path='' as $$
declare reserved_count integer; reserved_collision boolean;
begin
  with reserved as (
    select i.display_name from toki_private.company_invites i where i.company_id=org and i.display_name is not null
      and i.expires_at>now() and i.email is distinct from skip_email
    union all
    select i.display_name from toki_private.company_pin_invites i where i.company_id=org and i.disabled_at is null
    union all
    select g.display_name from toki_private.company_guests g where g.company_id=org and g.person_id is null and g.invite_hash is not null
  )
  select count(*),coalesce(bool_or(toki_private.name_key(i.display_name)=toki_private.name_key(new_name)
      or exists(select 1 from jsonb_array_elements_text(board->'people') p(name)
        where toki_private.name_key(name)=toki_private.name_key(i.display_name))),false)
    into reserved_count,reserved_collision from reserved i;
  if reserved_collision then raise exception 'NAME_TAKEN'; end if;
  if new_name is not null and exists(select 1 from jsonb_array_elements_text(board->'people') p(name)
    where toki_private.name_key(name)=toki_private.name_key(new_name)) then raise exception 'NAME_TAKEN'; end if;
  if jsonb_array_length(board->'people') + (new_name is not null)::integer + reserved_count>100 then raise exception 'LIMIT'; end if;
end;
$$;

create or replace function toki_private.checked_visible_groups(board jsonb, choices jsonb)
returns text[] language plpgsql immutable set search_path='' as $$
declare groups text[];
begin
  if jsonb_typeof(choices) is distinct from 'array' or jsonb_array_length(choices)>50 then raise exception 'INVALID'; end if;
  if exists(select 1 from jsonb_array_elements(choices) x where jsonb_typeof(x)<>'string') then raise exception 'INVALID'; end if;
  groups:=array(select distinct jsonb_array_elements_text(choices));
  if exists(select 1 from unnest(groups) id where not exists(
    select 1 from jsonb_array_elements(board->'groups') g where g->>'id'=id)) then raise exception 'INVALID'; end if;
  return groups;
end;
$$;

create or replace function toki_private.issue_company_pins(org uuid, board jsonb, batch jsonb)
returns jsonb language plpgsql volatile set search_path='' as $$
declare entry jsonb; name text; groups text[]; pin text; entropy bigint; inserted uuid; result jsonb:='[]';
begin
  if jsonb_typeof(batch) is distinct from 'array' or jsonb_array_length(batch) not between 1 and 30 then raise exception 'INVALID'; end if;
  if (select count(*) from toki_private.company_pin_invites where company_id=org and disabled_at is null)+jsonb_array_length(batch)>100
    then raise exception 'LIMIT'; end if;
  for entry in select value from jsonb_array_elements(batch) loop
    if jsonb_typeof(entry) is distinct from 'object' or entry-array['name','groups']<>'{}'
      or jsonb_typeof(entry->'name') is distinct from 'string' then raise exception 'INVALID'; end if;
    name:=toki_private.checked_schedule_name(entry->>'name');
    groups:=toki_private.checked_visible_groups(board,entry->'groups');
    perform toki_private.check_schedule_invitations(org,board,name,null);
    inserted:=null;
    for attempt in 1..100 loop
      entropy:=('x'||left(gen_random_uuid()::text,8))::bit(32)::bigint;
      if entropy>=4294000000 then continue; end if;
      pin:=lpad((entropy%1000000)::text,6,'0');
      insert into toki_private.company_pin_invites(company_id,pin_hash,display_name,visible_groups)
        values(org,toki_private.company_pin_hash(org,pin),name,groups)
        on conflict(company_id,pin_hash) do nothing returning id into inserted;
      exit when inserted is not null;
    end loop;
    if inserted is null then raise exception 'LIMIT'; end if;
    result:=result||jsonb_build_array(jsonb_build_object('name',name,'password',pin));
  end loop;
  return jsonb_build_object('invitations',result);
end;
$$;
revoke all on function toki_private.checked_visible_groups(jsonb,jsonb),toki_private.issue_company_pins(uuid,jsonb,jsonb) from public,anon,authenticated;

create or replace function toki_private.project_schedule(board jsonb, own_row uuid, allowed_groups text[], allowed_people uuid[])
returns jsonb language sql immutable set search_path='' as $$
  with allowed as (
    select g,n from jsonb_array_elements(board->'groups') with ordinality as items(g,n)
    where g->>'id'=any(allowed_groups)
  ), visible as (
    select r,(n-1)::integer as original,(row_number() over (order by n)-1)::integer as projected
    from jsonb_array_elements(board->'rows') with ordinality as items(r,n)
    where r->>'id'=own_row::text or (r->>'kind'='person' and (r->>'id')::uuid=any(allowed_people))
      or exists(select 1 from allowed where g->'members' @> jsonb_build_array(items.n-1))
  )
  select jsonb_build_object(
    'schemaVersion',4,
    'people',coalesce((select jsonb_agg(board->'people'->original order by projected) from visible),'[]'),
    'rows',coalesce((select jsonb_agg(r order by projected) from visible),'[]'),
    'events',coalesce((select jsonb_agg(jsonb_set(e,'{person}',to_jsonb(projected)) order by n)
      from jsonb_array_elements(board->'events') with ordinality as items(e,n)
      join visible on original=(e->>'person')::integer),'[]'),
    'groups',coalesce((select jsonb_agg(jsonb_set(g,'{members}',members) order by n)
      from allowed cross join lateral (select coalesce(jsonb_agg(projected order by i),'[]') members
      from jsonb_array_elements_text(g->'members') with ordinality as items(p,i)
      join visible on original=p::integer) mapped),'[]'),
    'meetings',coalesce((select jsonb_agg(jsonb_set(m,'{members}',members) order by n)
      from jsonb_array_elements(board->'meetings') with ordinality as items(m,n)
      cross join lateral (select coalesce(jsonb_agg(projected order by i),'[]') members
      from jsonb_array_elements_text(m->'members') with ordinality as participants(p,i)
      join visible on original=p::integer) mapped
      where exists(select 1 from allowed where g->>'id'=m->>'group') and members<>'[]'),'[]'))
$$;

create or replace function toki_private.project_schedule(board jsonb, own_row uuid, allowed_groups text[])
returns jsonb language sql immutable set search_path='' as $$
  select toki_private.project_schedule(board,own_row,allowed_groups,'{}'::uuid[])
$$;

create or replace function toki_private.merge_schedule_events(board jsonb, projected jsonb, submitted jsonb, own_row uuid, edit_places boolean)
returns jsonb language plpgsql immutable set search_path='' as $$
declare protected jsonb; submitted_protected jsonb; changes jsonb;
begin
  if (submitted - 'events') is distinct from (projected - 'events')
    or jsonb_typeof(submitted->'events') is distinct from 'array'
    or jsonb_array_length(submitted->'events')>2000 then raise exception 'DENIED'; end if;
  if exists(select 1 from jsonb_array_elements(submitted->'events') e
    where jsonb_typeof(e->'person') is distinct from 'number'
      or coalesce(e->>'person','') !~ '^[0-9]{1,3}$'
      or projected->'rows'->((e->>'person')::integer) is null) then raise exception 'INVALID'; end if;

  select coalesce(jsonb_agg(e order by e->>'id'),'[]') into protected
    from jsonb_array_elements(projected->'events') e
    cross join lateral (select projected->'rows'->((e->>'person')::integer) r) metadata
    where (not edit_places or r->>'kind'='person') and r->>'id' is distinct from own_row::text;
  select coalesce(jsonb_agg(e order by e->>'id'),'[]') into submitted_protected
    from jsonb_array_elements(submitted->'events') e
    cross join lateral (select projected->'rows'->((e->>'person')::integer) r) metadata
    where (not edit_places or r->>'kind'='person') and r->>'id' is distinct from own_row::text;
  if submitted_protected is distinct from protected then raise exception 'DENIED'; end if;

  select coalesce(jsonb_agg(jsonb_set(e,'{person}',to_jsonb(toki_private.schedule_row_index(board,(r->>'id')::uuid)))),'[]') into changes
    from jsonb_array_elements(submitted->'events') e
    cross join lateral (select projected->'rows'->((e->>'person')::integer) r) metadata
    where (edit_places and r->>'kind'='place') or r->>'id'=own_row::text;
  if exists(select 1 from jsonb_array_elements(changes) e cross join jsonb_array_elements(board->'meetings') m
    where e->>'date'=m->>'date' and m->'members' @> jsonb_build_array(e->'person')
      and (e->>'start')::integer<(m->>'end')::integer and (e->>'end')::integer>(m->>'start')::integer) then
    raise exception 'SCHEDULE_BUSY';
  end if;
  return jsonb_set(board,'{events}',(
    select coalesce(jsonb_agg(e order by n),'[]') from jsonb_array_elements(board->'events') with ordinality as entry(e,n)
    cross join lateral (select board->'rows'->((e->>'person')::integer) r) metadata
    where r->>'id' is distinct from own_row::text and (not edit_places or r->>'kind'<>'place' or not exists(
      select 1 from jsonb_array_elements(projected->'rows') p where p=r))
    ) || changes);
end;
$$;

create or replace function toki_private.merge_schedule_events(board jsonb, projected jsonb, submitted jsonb, own_row uuid)
returns jsonb language sql immutable set search_path='' as $$
  select toki_private.merge_schedule_events(board,projected,submitted,own_row,true)
$$;

create or replace function toki_private.schedule_response(org uuid, board jsonb, revision bigint, role text, own_row uuid, allowed_groups text[])
returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object('companyId',org,'version',revision,
    'payload',case when role='admin' then board else toki_private.project_schedule(board,own_row,allowed_groups) end,
    'access',jsonb_build_object('role',role,'personId',own_row))
$$;

revoke all on function toki_private.with_schedule_rows(jsonb),
  toki_private.schedule_row_index(jsonb,uuid), toki_private.append_schedule_row(jsonb,uuid,text,text),
  toki_private.remove_schedule_row(jsonb,integer), toki_private.checked_schedule_name(text),
  toki_private.check_schedule_invitations(uuid,jsonb,text,text),
  toki_private.project_schedule(jsonb,uuid,text[]), toki_private.merge_schedule_events(jsonb,jsonb,jsonb,uuid),
  toki_private.project_schedule(jsonb,uuid,text[],uuid[]), toki_private.merge_schedule_events(jsonb,jsonb,jsonb,uuid,boolean),
  toki_private.schedule_response(uuid,jsonb,bigint,text,uuid,text[])
  from public,anon,authenticated;

-- All data access goes through this function. Identity and membership are checked
-- on EVERY call, including writes and administrative actions. No client-supplied owner IDs.
create or replace function toki_private.company_action(
  p_action text,p_company uuid default null,p_code text default null,p_name text default null,
  p_member uuid default null,p_email text default null,p_role text default null,
  p_payload jsonb default null,p_version bigint default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  uid uuid:=auth.uid(); mail text; c toki_private.companies%rowtype;
  m toki_private.company_members%rowtype; b public.toki_boards%rowtype; result jsonb;
  target toki_private.company_members%rowtype; invited record;
  projected jsonb; next_board jsonb; display_name text; new_row uuid; row_index integer;
  row_kind text; groups_to_show text[];
  invitation toki_private.company_pin_invites%rowtype; applied_at timestamptz;
begin
  if uid is null or not exists(select 1 from auth.identities i where i.user_id=uid and i.provider='google')
    or not exists(select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]'::jsonb)) a where a->>'method'='oauth')
    or not exists(select 1 from auth.sessions s where s.id=(auth.jwt()->>'session_id')::uuid and s.user_id=uid)
    then raise exception 'AUTH'; end if;
  select lower(email) into mail from auth.users where id=uid and email_confirmed_at is not null;
  if mail is null then raise exception 'AUTH'; end if;
  if p_action='list' then
    -- Serialize invitation claims with administrator revocations and membership limits.
    for invited in select cc.id,cc.board_id,cc.scoped_schedule from toki_private.companies cc where exists(
      select 1 from toki_private.company_invites i where i.company_id=cc.id and i.email=mail and i.expires_at>now())
      order by cc.id for update loop
      select * into target from toki_private.company_members where company_id=invited.id and user_id=uid;
      if target.status in ('active','blocked') then continue; end if;
      -- Pending/blocked rows cannot occupy the reserved active-member capacity.
      -- A full unrelated company must not prevent listing existing memberships.
      if (select count(*) from toki_private.company_members where company_id=invited.id and status='active')>=500 then continue; end if;
      new_row:=null;
      select i.display_name into display_name from toki_private.company_invites i
        where i.company_id=invited.id and i.email=mail and i.expires_at>now();
      if invited.scoped_schedule and display_name is not null then
        select * into b from public.toki_boards where id=invited.board_id for update;
        next_board:=toki_private.with_schedule_rows(b.payload);
        perform toki_private.check_schedule_invitations(invited.id,next_board,display_name,mail);
        new_row:=gen_random_uuid();
        update public.toki_boards set payload=toki_private.append_schedule_row(next_board,new_row,display_name,'person')
          where id=b.id;
      end if;
      insert into toki_private.company_members(company_id,user_id,role,status,person_id)
        select company_id,uid,role,'active',new_row from toki_private.company_invites where company_id=invited.id and email=mail and expires_at>now()
        on conflict(company_id,user_id) do update set role=excluded.role,status='active',person_id=excluded.person_id
          where company_members.status='pending';
    end loop;
    delete from toki_private.company_invites i where email=mail and exists(
      select 1 from toki_private.company_members cm where cm.company_id=i.company_id and cm.user_id=uid and cm.status='active');
    select coalesce(jsonb_agg(jsonb_build_object('id',cc.id,'name',cc.name,'code',cc.code,'role',cm.role,'status',cm.status)
      || case when cc.scoped_schedule then jsonb_build_object('scopedSchedule',true) else '{}' end
      order by cc.created_at),'[]') into result
      from toki_private.company_members cm join toki_private.companies cc on cc.id=cm.company_id where cm.user_id=uid
        and (cm.status<>'pending' or cm.created_at>now()-interval '7 days');
    return result;
  elsif p_action='create' then
    -- Company administrators are not platform operators. No public creation route.
    raise exception 'DENIED';
  elsif p_action in ('join','apply','accept_invite') then
    if p_code is null or btrim(p_code) !~ '^[a-fA-F0-9]{32}$' then raise exception 'COMPANY'; end if;
    select * into c from toki_private.companies where code=upper(btrim(p_code)) for update;
    if c.id is null then raise exception 'COMPANY'; end if;
    if p_action='join' and c.invitation_v2 then raise exception 'UPDATE_REQUIRED'; end if;
    if p_action='apply' then display_name:=toki_private.checked_schedule_name(p_name); end if;
    perform 1 from auth.users where id=uid for update;
    select * into m from toki_private.company_members where company_id=c.id and user_id=uid;
    if p_action='accept_invite' then
      if not c.scoped_schedule then raise exception 'UPDATE_REQUIRED'; end if;
      if m.status='blocked' then raise exception 'DENIED'; end if;
      if m.status='active' then return jsonb_build_object('id',c.id); end if;
      if jsonb_typeof(p_payload) is distinct from 'string' or (p_payload#>>'{}') !~ '^[0-9]{6}$' then raise exception 'INVITE_INVALID'; end if;
      select * into invitation from toki_private.company_pin_invites
        where company_id=c.id and pin_hash=toki_private.company_pin_hash(c.id,p_payload#>>'{}') and disabled_at is null;
      if invitation.id is null then raise exception 'INVITE_INVALID'; end if;
      if (select count(*) from toki_private.company_members where company_id=c.id and status='active')>=500 then raise exception 'LIMIT'; end if;
      select * into b from public.toki_boards where id=c.board_id for update;
      next_board:=toki_private.with_schedule_rows(b.payload);
      update toki_private.company_pin_invites set disabled_at=now(),display_name=null,visible_groups='{}' where id=invitation.id;
      perform toki_private.check_schedule_invitations(c.id,next_board,invitation.display_name,mail);
      groups_to_show:=array(select id from unnest(invitation.visible_groups) id where exists(
        select 1 from jsonb_array_elements(next_board->'groups') g where g->>'id'=id));
      new_row:=gen_random_uuid();
      update public.toki_boards set payload=toki_private.append_schedule_row(next_board,new_row,invitation.display_name,'person') where id=b.id;
      insert into toki_private.company_members(company_id,user_id,role,status,person_id,visible_groups)
        values(c.id,uid,'member','active',new_row,groups_to_show)
        on conflict(company_id,user_id) do update
          set role='member',status='active',person_id=excluded.person_id,visible_groups=excluded.visible_groups,request_name=null;
      delete from toki_private.company_invites where company_id=c.id and email=mail;
      return jsonb_build_object('id',c.id);
    end if;
    delete from toki_private.company_members where company_id=c.id and status='pending' and created_at<=now()-interval '7 days';
    if exists(select 1 from toki_private.company_members where company_id=c.id and user_id=uid) then return jsonb_build_object('id',c.id); end if;
    -- list claims verified-email invitations; they bypass application saturation.
    if exists(select 1 from toki_private.company_invites where company_id=c.id and email=mail and expires_at>now()) then return jsonb_build_object('id',c.id); end if;
    if (select count(*) from toki_private.company_members where user_id=uid and status='pending' and created_at>now()-interval '7 days')>=5
      and not exists(select 1 from toki_private.company_members where company_id=c.id and user_id=uid) then raise exception 'LIMIT'; end if;
    if (select count(*) from toki_private.company_members where company_id=c.id and status='pending')>=50 then raise exception 'JOIN_LIMIT'; end if;
    if (select count(*) from toki_private.company_members where company_id=c.id and status='active')>=500 then raise exception 'LIMIT'; end if;
    insert into toki_private.company_members(company_id,user_id,request_name)
      values(c.id,uid,display_name) returning created_at into applied_at;
    if p_action='apply' then
      insert into toki_private.company_application_mail(company_id,requester,administrator,requested_at)
        select c.id,uid,cm.user_id,applied_at
        from toki_private.company_members cm where cm.company_id=c.id and cm.role='admin' and cm.status='active';
    end if;
    return jsonb_build_object('id',c.id);
  end if;
  -- One company lock serializes membership revocation with board writes and admin changes.
  -- Reject outsiders before taking a company lock, then recheck after acquiring it.
  if not exists(select 1 from toki_private.company_members where company_id=p_company and user_id=uid and status='active') then raise exception 'DENIED'; end if;
  select * into c from toki_private.companies where id=p_company for update;
  select * into m from toki_private.company_members where company_id=p_company and user_id=uid;
  if c.id is null or m.status is distinct from 'active' then raise exception 'DENIED'; end if;
  if c.scoped_schedule and p_action in ('read','save','invite','invite_batch','approve','assign_person','set_group_access','remove_row','add_place','detach_place') then
    select * into b from public.toki_boards where id=c.board_id for update;
    if not (b.payload ? 'rows') then
      update public.toki_boards set payload=toki_private.with_schedule_rows(b.payload) where id=b.id returning * into b;
    end if;
  end if;
  if p_action in ('read','save') then
    if not c.scoped_schedule then select * into b from public.toki_boards where id=c.board_id for update; end if;
    if p_action='save' then
      if p_version is distinct from b.version then raise exception 'CONFLICT'; end if;
      if p_payload->'schemaVersion' is distinct from '4'::jsonb then raise exception 'INVALID'; end if;
      next_board:=p_payload;
      if c.scoped_schedule then
        if not (p_payload ? 'rows') then raise exception 'UPDATE_REQUIRED'; end if;
        if m.role='admin' then
          if (select jsonb_agg(r order by r->>'id') from jsonb_array_elements(p_payload->'rows') r) is distinct from
            (select jsonb_agg(r order by r->>'id') from jsonb_array_elements(b.payload->'rows') r)
            then raise exception 'DENIED';
          end if;
          perform toki_private.check_schedule_invitations(c.id,next_board,null,null);
        else
          projected:=toki_private.project_schedule(b.payload,m.person_id,m.visible_groups);
          next_board:=toki_private.merge_schedule_events(b.payload,projected,p_payload,m.person_id);
        end if;
      end if;
      update public.toki_boards set payload=next_board where id=c.board_id returning * into b;
      if c.scoped_schedule and m.role='admin' then
        update toki_private.company_members cm set visible_groups=array(
          select id from unnest(cm.visible_groups) id
          where exists(select 1 from jsonb_array_elements(b.payload->'groups') g where g->>'id'=id))
          where cm.company_id=c.id and exists(select 1 from unnest(cm.visible_groups) id
            where not exists(select 1 from jsonb_array_elements(b.payload->'groups') g where g->>'id'=id));
        update toki_private.company_pin_invites i set visible_groups=array(
          select id from unnest(i.visible_groups) id
          where exists(select 1 from jsonb_array_elements(b.payload->'groups') g where g->>'id'=id))
          where i.company_id=c.id and i.disabled_at is null and exists(select 1 from unnest(i.visible_groups) id
            where not exists(select 1 from jsonb_array_elements(b.payload->'groups') g where g->>'id'=id));
        update toki_private.company_guests x set visible_groups=array(
          select id from unnest(x.visible_groups) id
          where exists(select 1 from jsonb_array_elements(b.payload->'groups') g where g->>'id'=id))
          where x.company_id=c.id and exists(select 1 from unnest(x.visible_groups) id
            where not exists(select 1 from jsonb_array_elements(b.payload->'groups') g where g->>'id'=id));
      end if;
    end if;
    if c.scoped_schedule then
      return toki_private.schedule_response(c.id,b.payload,b.version,m.role,m.person_id,m.visible_groups);
    end if;
    return jsonb_build_object('companyId',c.id,'payload',b.payload,'version',b.version);
  end if;
  if p_action in ('add_place','remove_row','detach_place') then
    if not c.scoped_schedule then raise exception 'UPDATE_REQUIRED'; end if;
    if p_version is distinct from b.version then raise exception 'CONFLICT'; end if;
    if p_action='add_place' then
      display_name:=toki_private.checked_schedule_name(p_name);
      perform toki_private.check_schedule_invitations(c.id,b.payload,display_name,null);
      if p_payload is null or jsonb_typeof(p_payload) is distinct from 'object'
        or p_payload - 'groups'<>'{}' or jsonb_typeof(p_payload->'groups') is distinct from 'array'
        or jsonb_array_length(p_payload->'groups')>50 then raise exception 'INVALID'; end if;
      groups_to_show:=array(select distinct jsonb_array_elements_text(p_payload->'groups'));
      if exists(select 1 from unnest(groups_to_show) id where not exists(
        select 1 from jsonb_array_elements(b.payload->'groups') g where g->>'id'=id)) then raise exception 'INVALID'; end if;
      if m.role<>'admin' and (cardinality(groups_to_show)=0 or not (groups_to_show <@ m.visible_groups))
        then raise exception 'DENIED'; end if;
      new_row:=gen_random_uuid();
      row_index:=jsonb_array_length(b.payload->'people');
      next_board:=toki_private.append_schedule_row(b.payload,new_row,display_name,'place');
      next_board:=jsonb_set(next_board,'{groups}',coalesce((select jsonb_agg(case when g->>'id'=any(groups_to_show)
        then jsonb_set(g,'{members}',(g->'members') || to_jsonb(row_index)) else g end order by n)
        from jsonb_array_elements(next_board->'groups') with ordinality as group_entry(g,n)),'[]'));
    elsif p_action='detach_place' then
      row_index:=toki_private.schedule_row_index(b.payload,p_member);
      if row_index is null or b.payload->'rows'->row_index->>'kind'<>'place'
        or jsonb_typeof(p_payload) is distinct from 'string' then raise exception 'INVALID'; end if;
      display_name:=p_payload#>>'{}';
      if m.role<>'admin' and not(display_name=any(m.visible_groups)) then raise exception 'DENIED'; end if;
      if not exists(select 1 from jsonb_array_elements(b.payload->'groups') g
        where g->>'id'=display_name and g->'members' @> jsonb_build_array(row_index)) then raise exception 'INVALID'; end if;
      next_board:=jsonb_set(b.payload,'{groups}',(select jsonb_agg(case when g->>'id'=display_name then
        jsonb_set(g,'{members}',(select coalesce(jsonb_agg(value order by i),'[]')
          from jsonb_array_elements(g->'members') with ordinality as row_entry(value,i)
          where value<>to_jsonb(row_index))) else g end order by n)
        from jsonb_array_elements(b.payload->'groups') with ordinality as group_entry(g,n)));
    else
      row_index:=toki_private.schedule_row_index(b.payload,p_member);
      if row_index is null then raise exception 'INVALID'; end if;
      row_kind:=b.payload->'rows'->row_index->>'kind';
      if m.role<>'admin' then
        if row_kind<>'place' or not exists(select 1 from jsonb_array_elements(b.payload->'groups') g
            where g->>'id'=any(m.visible_groups) and g->'members' @> jsonb_build_array(row_index))
          or exists(select 1 from jsonb_array_elements(b.payload->'groups') g
            where not (g->>'id'=any(m.visible_groups)) and g->'members' @> jsonb_build_array(row_index))
          or exists(select 1 from jsonb_array_elements(b.payload->'meetings') meeting
            where not (meeting->>'group'=any(m.visible_groups)) and meeting->'members' @> jsonb_build_array(row_index))
          then raise exception 'DENIED'; end if;
      end if;
      select * into target from toki_private.company_members where company_id=c.id and person_id=p_member;
      if target.user_id is not null then
        if target.role='admin' and target.status='active' and
          (select count(*) from toki_private.company_members where company_id=c.id and role='admin' and status='active')<=1
          then raise exception 'LAST_ADMIN'; end if;
        delete from toki_private.company_invites where company_id=c.id and email=(select lower(email) from auth.users where id=target.user_id);
        delete from toki_private.company_members where company_id=c.id and user_id=target.user_id;
      end if;
      delete from toki_private.company_guests where company_id=c.id and person_id=p_member;
      update toki_private.company_guests set visible_people=array_remove(visible_people,p_member)
        where company_id=c.id and p_member=any(visible_people);
      next_board:=toki_private.remove_schedule_row(b.payload,row_index);
    end if;
    update public.toki_boards set payload=next_board where id=b.id returning * into b;
    if target.user_id=uid then return jsonb_build_object('left',true); end if;
    return jsonb_build_object('id',new_row,'board',
      toki_private.schedule_response(c.id,b.payload,b.version,m.role,m.person_id,m.visible_groups));
  end if;
  if m.role<>'admin' then raise exception 'DENIED'; end if;
  if p_action='members' then
    delete from toki_private.company_members where company_id=c.id and status='pending' and created_at<=now()-interval '7 days';
    select payload into next_board from public.toki_boards where id=c.board_id;
    select coalesce(jsonb_agg(jsonb_build_object('id',cm.user_id,'email',u.email,'name',
      coalesce(next_board->'people'->>toki_private.schedule_row_index(next_board,cm.person_id),left(coalesce(u.raw_user_meta_data->>'full_name',u.email),80)),
      'role',cm.role,'status',cm.status) || case when cm.request_name is not null
        then jsonb_build_object('requestName',cm.request_name) else '{}' end || case when c.scoped_schedule
        then jsonb_build_object('personId',cm.person_id,'groupIds',cm.visible_groups) else '{}' end
      order by cm.created_at),'[]') into result
      from toki_private.company_members cm join auth.users u on u.id=cm.user_id where cm.company_id=c.id;
    return jsonb_build_object('members',result,'invites',coalesce((select jsonb_agg(jsonb_build_object('email',email,'role',role,'expiresAt',expires_at)
      || case when c.scoped_schedule then jsonb_build_object('displayName',i.display_name) else '{}' end
      ) from toki_private.company_invites i where i.company_id=c.id),'[]'),
      'pinInvites',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'name',i.display_name,'groupIds',i.visible_groups)
        order by i.created_at,i.id) from toki_private.company_pin_invites i where i.company_id=c.id and i.disabled_at is null),'[]'))
      || case when c.scoped_schedule then jsonb_build_object('groups',coalesce((select jsonb_agg(g - 'members' order by n)
        from jsonb_array_elements(next_board->'groups') with ordinality as entry(g,n)),'[]')) else '{}' end;
  elsif p_action='invite' then
    if c.invitation_v2 then raise exception 'UPDATE_REQUIRED'; end if;
    if p_email is null or length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'INVALID'; end if;
    if (select count(*) from toki_private.company_invites where company_id=c.id)>=100
      and not exists(select 1 from toki_private.company_invites where company_id=c.id and email=lower(btrim(p_email))) then raise exception 'LIMIT'; end if;
    -- Invites never confer administrator privileges. Promotion requires a separate action.
    if c.scoped_schedule then
      display_name:=toki_private.checked_schedule_name(p_name);
      if exists(select 1 from toki_private.company_members cm join auth.users u on u.id=cm.user_id
        where cm.company_id=c.id and lower(u.email)=lower(btrim(p_email)) and cm.status in ('active','blocked'))
        then raise exception 'MEMBER_EXISTS'; end if;
      perform toki_private.check_schedule_invitations(c.id,b.payload,display_name,lower(btrim(p_email)));
    end if;
    insert into toki_private.company_invites(company_id,email,display_name) values(c.id,lower(btrim(p_email)),display_name)
      on conflict(company_id,email) do update set role='member',expires_at=now()+interval '7 days',display_name=excluded.display_name;
  elsif p_action='cancel_invite' then
    delete from toki_private.company_invites where company_id=c.id and email=lower(btrim(p_email));
  elsif p_action='invite_batch' then
    if not c.scoped_schedule then raise exception 'UPDATE_REQUIRED'; end if;
    return toki_private.issue_company_pins(c.id,b.payload,p_payload);
  elsif p_action='cancel_pin_invite' then
    update toki_private.company_pin_invites set disabled_at=now(),display_name=null,visible_groups='{}'
      where company_id=c.id and id=p_member and disabled_at is null;
    if not found then raise exception 'INVALID'; end if;
  elsif p_action='remove_member' then
    select * into target from toki_private.company_members where company_id=c.id and user_id=p_member;
    if target.user_id is null or target.user_id=uid then raise exception 'INVALID'; end if;
    if target.status<>'blocked' then raise exception 'MEMBER_NOT_STOPPED'; end if;
    -- Remove outstanding invitations so list cannot silently re-enrol them.
    delete from toki_private.company_invites where company_id=c.id and email=(select lower(email) from auth.users where id=p_member);
    delete from toki_private.company_members where company_id=c.id and user_id=p_member;
  elsif p_action='transfer_admin' then
    -- The company lock and transaction make the handoff all-or-nothing.
    -- Never accept an email or a caller-supplied previous administrator ID.
    select * into target from toki_private.company_members where company_id=c.id and user_id=p_member;
    if target.user_id is null or target.user_id=uid or target.status<>'active'
      or not exists(select 1 from auth.users u where u.id=target.user_id and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now()))
      or not exists(select 1 from auth.identities i where i.user_id=target.user_id and i.provider='google') then raise exception 'INVALID'; end if;
    update toki_private.company_members set role=case when user_id=target.user_id then 'admin' else 'member' end
      where company_id=c.id and user_id in (uid,target.user_id);
    if c.scoped_schedule then update public.toki_boards set payload=payload where id=c.board_id; end if;
    return jsonb_build_object('role','member');
  elsif p_action in ('approve','block','role','assign_person','set_group_access') then
    select * into target from toki_private.company_members where company_id=c.id and user_id=p_member;
    if target.user_id is null then raise exception 'INVALID'; end if;
    if p_action='approve' and target.status<>'active' then
      if target.status='pending' and target.created_at<=now()-interval '7 days' then raise exception 'REQUEST_EXPIRED'; end if;
      if (select count(*) from toki_private.company_members where company_id=c.id and status='active')>=500 then raise exception 'LIMIT'; end if;
    end if;
    if (p_action='block' or p_action='role' and p_role='member') and target.role='admin' and target.status='active'
      and (select count(*) from toki_private.company_members where company_id=c.id and role='admin' and status='active')<=1 then raise exception 'LAST_ADMIN'; end if;
    if p_action='assign_person' or (c.scoped_schedule and p_action='approve' and target.person_id is null) then
      if not c.scoped_schedule or target.person_id is not null or
        (p_action='assign_person' and target.status<>'active') then raise exception 'INVALID'; end if;
      display_name:=toki_private.checked_schedule_name(p_name);
      if p_payload is not null and (p_action<>'approve' or target.status<>'pending') then raise exception 'INVALID'; end if;
      groups_to_show:=case when p_payload is null then target.visible_groups else toki_private.checked_visible_groups(b.payload,p_payload) end;
      select lower(email) into mail from auth.users where id=target.user_id;
      perform toki_private.check_schedule_invitations(c.id,b.payload,display_name,mail);
      new_row:=gen_random_uuid();
      update public.toki_boards set payload=toki_private.append_schedule_row(b.payload,new_row,display_name,'person') where id=b.id;
      update toki_private.company_members set status='active',person_id=new_row,visible_groups=groups_to_show,request_name=null
        where company_id=c.id and user_id=p_member;
      delete from toki_private.company_invites where company_id=c.id and email=mail;
    elsif p_action='set_group_access' then
      if not c.scoped_schedule or target.status<>'active' or target.role<>'member'
        or p_payload is null or jsonb_typeof(p_payload) is distinct from 'array'
        or jsonb_array_length(p_payload)>50 then raise exception 'INVALID'; end if;
      groups_to_show:=toki_private.checked_visible_groups(b.payload,p_payload);
      update toki_private.company_members set visible_groups=groups_to_show where company_id=c.id and user_id=p_member;
      update public.toki_boards set payload=payload where id=c.board_id;
    elsif p_action='role' then
      if p_role is null or p_role not in ('admin','member') or target.status<>'active' then raise exception 'INVALID'; end if;
      update toki_private.company_members set role=p_role where company_id=c.id and user_id=p_member;
      if c.scoped_schedule then update public.toki_boards set payload=payload where id=c.board_id; end if;
    else
      update toki_private.company_members set status=case when p_action='approve' then 'active' else 'blocked' end,request_name=null where company_id=c.id and user_id=p_member;
      if p_action='block' then delete from toki_private.company_invites where company_id=c.id and email=(select lower(email) from auth.users where id=p_member); end if;
    end if;
  else raise exception 'INVALID'; end if;
  return '{}'::jsonb;
end;
$$;
revoke all on function toki_private.company_action(text,uuid,text,text,uuid,text,text,jsonb,bigint) from public,anon,authenticated;

-- Only the database operator can provision a company. The invited administrator
-- must still prove ownership of the email using Google sign-in.
create or replace function toki_private.provision_company(p_name text,p_email text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare board_id text:=gen_random_uuid()::text;
begin
  if p_name is null or length(btrim(p_name)) not between 1 and 80 or p_name ~ '[[:cntrl:]]'
    or p_email is null or length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'INVALID'; end if;
  insert into public.toki_boards(id,payload) values(board_id,'{"schemaVersion":4,"people":[],"groups":[],"events":[],"meetings":[]}');
  return toki_private.bootstrap_company(board_id,p_name,p_email);
end;
$$;
revoke all on function toki_private.provision_company(text,text) from public,anon,authenticated;

-- Four fixed rows per account, never one row per supplied company/code/IP.
create table if not exists toki_private.request_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null check(bucket in ('read','write','admin','join')),
  started_at timestamptz not null,
  attempts integer not null check(attempts between 1 and 121),
  primary key(user_id,bucket)
);
alter table toki_private.request_limits enable row level security;
revoke all on toki_private.request_limits from public,anon,authenticated;
create index if not exists company_members_user_idx on toki_private.company_members(user_id,status);
create index if not exists company_invites_email_idx on toki_private.company_invites(email,expires_at);

-- Keep the public signature stable for installed PWAs. Error bodies have the
-- standard PostgREST shape and an HTTP status. Do NOT raise after incrementing:
-- raising would roll back the counter and allow unlimited failed attempts.
create or replace function public.toki_company(
  p_action text,p_company uuid default null,p_code text default null,p_name text default null,
  p_member uuid default null,p_email text default null,p_role text default null,
  p_payload jsonb default null,p_version bigint default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); bucket_name text; maximum integer; used integer; failure text; result jsonb;
  joining uuid; window_used integer; day_used integer;
begin
  if uid is null or not exists(select 1 from auth.users u where u.id=uid and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now()))
    or not exists(select 1 from auth.identities i where i.user_id=uid and i.provider='google')
    or not exists(select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]'::jsonb)) a where a->>'method'='oauth')
    or not exists(select 1 from auth.sessions s where s.id=(auth.jwt()->>'session_id')::uuid and s.user_id=uid and (s.not_after is null or s.not_after>now())) then
    perform set_config('response.status','401',true);
    return jsonb_build_object('message','AUTH','code','TOKI_AUTH');
  end if;
  bucket_name:=case when p_action in ('read','list') then 'read' when p_action in ('save','add_place','remove_row','detach_place') then 'write' when p_action in ('join','apply','accept_invite','create') then 'join' else 'admin' end;
  maximum:=case bucket_name when 'read' then 120 when 'write' then 60 when 'join' then 5 else 30 end;
  insert into toki_private.request_limits as r(user_id,bucket,started_at,attempts) values(uid,bucket_name,clock_timestamp(),1)
    on conflict(user_id,bucket) do update set
      attempts=case when r.started_at<=clock_timestamp()-interval '1 minute' then 1 else least(r.attempts+1,121) end,
      started_at=case when r.started_at<=clock_timestamp()-interval '1 minute' then clock_timestamp() else r.started_at end
    returning attempts into used;
  if used>maximum then
    perform set_config('response.status','429',true);
    perform set_config('response.headers','[{"Retry-After":"60"},{"Cache-Control":"no-store"}]',true);
    return jsonb_build_object('message','RATE_LIMIT','code','TOKI_RATE_LIMIT');
  end if;
  -- Count new public applications outside the action's rollback boundary.
  -- The company lock also prevents simultaneous claims exceeding capacity.
  if p_action in ('join','apply','accept_invite') and length(p_code)<=64 and btrim(p_code) ~ '^[a-fA-F0-9]{32}$' then
    select id into joining from toki_private.companies where code=upper(btrim(p_code)) for update;
    if p_action='accept_invite' then
      if exists(select 1 from toki_private.company_pin_failures where company_id=joining and started_at>clock_timestamp()-interval '1 day' and failures>=20) then
        perform set_config('response.status','429',true);
        perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
        return jsonb_build_object('message','INVITE_LIMIT','code','TOKI_INVITE_LIMIT');
      end if;
    elsif joining is not null
      and not exists(select 1 from toki_private.company_members where company_id=joining and user_id=uid and (status<>'pending' or created_at>now()-interval '7 days'))
      and not exists(select 1 from toki_private.company_invites where company_id=joining and email=(select lower(email) from auth.users where id=uid) and expires_at>now()) then
      insert into toki_private.company_join_limits as r(company_id,window_started_at,window_attempts,day_started_at,day_attempts)
        values(joining,clock_timestamp(),1,clock_timestamp(),1)
        on conflict(company_id) do update set
          window_attempts=case when r.window_started_at<=clock_timestamp()-interval '10 minutes' then 1 else least(r.window_attempts+1,31) end,
          window_started_at=case when r.window_started_at<=clock_timestamp()-interval '10 minutes' then clock_timestamp() else r.window_started_at end,
          day_attempts=case when r.day_started_at<=clock_timestamp()-interval '1 day' then 1 else least(r.day_attempts+1,201) end,
          day_started_at=case when r.day_started_at<=clock_timestamp()-interval '1 day' then clock_timestamp() else r.day_started_at end
        returning window_attempts,day_attempts into window_used,day_used;
      if window_used>30 or day_used>200 then
        perform set_config('response.status','429',true);
        perform set_config('response.headers','[{"Retry-After":"600"},{"Cache-Control":"no-store"}]',true);
        return jsonb_build_object('message','JOIN_LIMIT','code','TOKI_JOIN_LIMIT');
      end if;
    end if;
  end if;
  -- Subtransaction rolls back failed mutations without losing the attempt count.
  begin
    if p_action is null or p_action not in ('read','save','list','join','apply','accept_invite','create','members','invite','invite_batch','cancel_invite','cancel_pin_invite','approve','block','role','transfer_admin','remove_member','assign_person','set_group_access','add_place','remove_row','detach_place')
      or length(p_code)>64 or length(p_name)>80 or length(p_email)>254 or length(p_role)>10
      or (p_payload is not null and (p_action not in ('save','set_group_access','add_place','detach_place','invite_batch','accept_invite','approve')
        or octet_length(p_payload::text)>case when p_action='save' then 2097152 else 65536 end)) then raise exception 'INVALID'; end if;
    result:=toki_private.company_action(p_action,p_company,p_code,p_name,p_member,p_email,p_role,p_payload,p_version);
  exception when others then
    failure:=case when SQLERRM in ('AUTH','DENIED','COMPANY','CONFLICT','LAST_ADMIN','LIMIT','JOIN_LIMIT','REQUEST_EXPIRED',
      'MEMBER_NOT_STOPPED','UPDATE_REQUIRED','NAME_INVALID','NAME_TAKEN','MEMBER_EXISTS','SCHEDULE_BUSY','INVITE_INVALID') then SQLERRM else 'INVALID' end;
    if p_action='accept_invite' and failure='INVITE_INVALID' and joining is not null then
      insert into toki_private.company_pin_failures as f values(joining,clock_timestamp(),1)
        on conflict(company_id) do update set
          failures=case when f.started_at<=clock_timestamp()-interval '1 day' then 1 else least(f.failures+1,20) end,
          started_at=case when f.started_at<=clock_timestamp()-interval '1 day' then clock_timestamp() else f.started_at end;
    end if;
    if p_action='save' and failure in ('NAME_INVALID','NAME_TAKEN') then failure:='INVALID'; end if;
    perform set_config('response.status',case failure when 'AUTH' then '401' when 'DENIED' then '403' when 'CONFLICT' then '409' else '400' end,true);
    result:=jsonb_build_object('message',failure,'code','TOKI_'||failure);
  end;
  perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
  return result;
end;
$$;
revoke all on function public.toki_company(text,uuid,text,text,uuid,text,text,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.toki_company(text,uuid,text,text,uuid,text,text,jsonb,bigint) to authenticated;
-- Close both the exposed legacy wrapper and its definer implementation.
revoke all on function public.toki_share(text,text,uuid,text,jsonb,bigint) from public,anon,authenticated;
revoke all on function toki_private.share_action(text,text,uuid,text,jsonb,bigint) from public,anon,authenticated;
revoke all on public.toki_boards from public,anon,authenticated;
revoke all on schema toki_private from public,anon,authenticated;
alter default privileges in schema public revoke execute on functions from public,anon,authenticated;
alter default privileges in schema toki_private revoke execute on functions from public,anon,authenticated;
alter default privileges in schema public revoke all on tables from public,anon,authenticated;
alter default privileges in schema toki_private revoke all on tables from public,anon,authenticated;
do $$ begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke all on function public.rls_auto_enable() from public,anon,authenticated;
  end if;
end $$;
notify pgrst,'reload schema';
commit;
