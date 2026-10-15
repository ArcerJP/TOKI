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
alter table toki_private.company_join_limits enable row level security;
revoke all on toki_private.company_join_limits from public,anon,authenticated;

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
begin
  if uid is null or not exists(select 1 from auth.identities i where i.user_id=uid and i.provider='google')
    or not exists(select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]'::jsonb)) a where a->>'method'='oauth')
    or not exists(select 1 from auth.sessions s where s.id=(auth.jwt()->>'session_id')::uuid and s.user_id=uid)
    then raise exception 'AUTH'; end if;
  select lower(email) into mail from auth.users where id=uid and email_confirmed_at is not null;
  if mail is null then raise exception 'AUTH'; end if;
  if p_action='list' then
    -- Serialize invitation claims with administrator revocations and membership limits.
    for invited in select cc.id from toki_private.companies cc where exists(
      select 1 from toki_private.company_invites i where i.company_id=cc.id and i.email=mail and i.expires_at>now())
      order by cc.id for update loop
      select * into target from toki_private.company_members where company_id=invited.id and user_id=uid;
      if target.status in ('active','blocked') then continue; end if;
      -- Pending/blocked rows cannot occupy the reserved active-member capacity.
      -- A full unrelated company must not prevent listing existing memberships.
      if (select count(*) from toki_private.company_members where company_id=invited.id and status='active')>=500 then continue; end if;
      insert into toki_private.company_members(company_id,user_id,role,status)
        select company_id,uid,role,'active' from toki_private.company_invites where company_id=invited.id and email=mail and expires_at>now()
        on conflict(company_id,user_id) do update set role=excluded.role,status='active'
          where company_members.status='pending';
    end loop;
    delete from toki_private.company_invites i where email=mail and exists(
      select 1 from toki_private.company_members cm where cm.company_id=i.company_id and cm.user_id=uid and cm.status='active');
    select coalesce(jsonb_agg(jsonb_build_object('id',cc.id,'name',cc.name,'code',cc.code,'role',cm.role,'status',cm.status) order by cc.created_at),'[]') into result
      from toki_private.company_members cm join toki_private.companies cc on cc.id=cm.company_id where cm.user_id=uid
        and (cm.status<>'pending' or cm.created_at>now()-interval '7 days');
    return result;
  elsif p_action='create' then
    -- Company administrators are not platform operators. No public creation route.
    raise exception 'DENIED';
  elsif p_action='join' then
    if p_code is null or btrim(p_code) !~ '^[a-fA-F0-9]{32}$' then raise exception 'COMPANY'; end if;
    select * into c from toki_private.companies where code=upper(btrim(p_code)) for update;
    if c.id is null then raise exception 'COMPANY'; end if;
    perform 1 from auth.users where id=uid for update;
    delete from toki_private.company_members where company_id=c.id and status='pending' and created_at<=now()-interval '7 days';
    if exists(select 1 from toki_private.company_members where company_id=c.id and user_id=uid) then return jsonb_build_object('id',c.id); end if;
    -- list claims verified-email invitations; they bypass application saturation.
    if exists(select 1 from toki_private.company_invites where company_id=c.id and email=mail and expires_at>now()) then return jsonb_build_object('id',c.id); end if;
    if (select count(*) from toki_private.company_members where user_id=uid and status='pending' and created_at>now()-interval '7 days')>=5
      and not exists(select 1 from toki_private.company_members where company_id=c.id and user_id=uid) then raise exception 'LIMIT'; end if;
    if (select count(*) from toki_private.company_members where company_id=c.id and status='pending')>=50 then raise exception 'JOIN_LIMIT'; end if;
    if (select count(*) from toki_private.company_members where company_id=c.id and status='active')>=500 then raise exception 'LIMIT'; end if;
    insert into toki_private.company_members(company_id,user_id) values(c.id,uid) on conflict do nothing;
    return jsonb_build_object('id',c.id);
  end if;
  -- One company lock serializes membership revocation with board writes and admin changes.
  -- Reject outsiders before taking a company lock, then recheck after acquiring it.
  if not exists(select 1 from toki_private.company_members where company_id=p_company and user_id=uid and status='active') then raise exception 'DENIED'; end if;
  select * into c from toki_private.companies where id=p_company for update;
  select * into m from toki_private.company_members where company_id=p_company and user_id=uid;
  if c.id is null or m.status is distinct from 'active' then raise exception 'DENIED'; end if;
  if p_action in ('read','save') then
    select * into b from public.toki_boards where id=c.board_id for update;
    if p_action='save' then
      if p_version is distinct from b.version then raise exception 'CONFLICT'; end if;
      if p_payload->'schemaVersion' is distinct from '4'::jsonb then raise exception 'INVALID'; end if;
      update public.toki_boards set payload=p_payload where id=c.board_id returning * into b;
    end if;
    return jsonb_build_object('companyId',c.id,'payload',b.payload,'version',b.version);
  end if;
  if m.role<>'admin' then raise exception 'DENIED'; end if;
  if p_action='members' then
    delete from toki_private.company_members where company_id=c.id and status='pending' and created_at<=now()-interval '7 days';
    select coalesce(jsonb_agg(jsonb_build_object('id',cm.user_id,'email',u.email,'name',left(coalesce(u.raw_user_meta_data->>'full_name',u.email),80),'role',cm.role,'status',cm.status) order by cm.created_at),'[]') into result
      from toki_private.company_members cm join auth.users u on u.id=cm.user_id where cm.company_id=c.id;
    return jsonb_build_object('members',result,'invites',coalesce((select jsonb_agg(jsonb_build_object('email',email,'role',role,'expiresAt',expires_at)) from toki_private.company_invites where company_id=c.id),'[]'));
  elsif p_action='invite' then
    if p_email is null or length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'INVALID'; end if;
    if (select count(*) from toki_private.company_invites where company_id=c.id)>=100
      and not exists(select 1 from toki_private.company_invites where company_id=c.id and email=lower(btrim(p_email))) then raise exception 'LIMIT'; end if;
    -- Invites never confer administrator privileges. Promotion requires a separate action.
    insert into toki_private.company_invites(company_id,email) values(c.id,lower(btrim(p_email)))
      on conflict(company_id,email) do update set role='member',expires_at=now()+interval '7 days';
  elsif p_action='cancel_invite' then
    delete from toki_private.company_invites where company_id=c.id and email=lower(btrim(p_email));
  elsif p_action in ('approve','block','role') then
    select * into target from toki_private.company_members where company_id=c.id and user_id=p_member;
    if target.user_id is null then raise exception 'INVALID'; end if;
    if p_action='approve' and target.status<>'active' then
      if target.status='pending' and target.created_at<=now()-interval '7 days' then raise exception 'REQUEST_EXPIRED'; end if;
      if (select count(*) from toki_private.company_members where company_id=c.id and status='active')>=500 then raise exception 'LIMIT'; end if;
    end if;
    if (p_action='block' or p_action='role' and p_role='member') and target.role='admin' and target.status='active'
      and (select count(*) from toki_private.company_members where company_id=c.id and role='admin' and status='active')<=1 then raise exception 'LAST_ADMIN'; end if;
    if p_action='role' then
      if p_role is null or p_role not in ('admin','member') or target.status<>'active' then raise exception 'INVALID'; end if;
      update toki_private.company_members set role=p_role where company_id=c.id and user_id=p_member;
    else
      update toki_private.company_members set status=case when p_action='approve' then 'active' else 'blocked' end where company_id=c.id and user_id=p_member;
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
  bucket_name:=case when p_action in ('read','list') then 'read' when p_action='save' then 'write' when p_action in ('join','create') then 'join' else 'admin' end;
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
  if p_action='join' and length(p_code)<=64 and btrim(p_code) ~ '^[a-fA-F0-9]{32}$' then
    select id into joining from toki_private.companies where code=upper(btrim(p_code)) for update;
    if joining is not null
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
    if p_action is null or p_action not in ('read','save','list','join','create','members','invite','cancel_invite','approve','block','role')
      or length(p_code)>64 or length(p_name)>80 or length(p_email)>254 or length(p_role)>10
      or (p_payload is not null and (p_action<>'save' or octet_length(p_payload::text)>2097152)) then raise exception 'INVALID'; end if;
    result:=toki_private.company_action(p_action,p_company,p_code,p_name,p_member,p_email,p_role,p_payload,p_version);
  exception when others then
    failure:=case when SQLERRM in ('AUTH','DENIED','COMPANY','CONFLICT','LAST_ADMIN','LIMIT','JOIN_LIMIT','REQUEST_EXPIRED') then SQLERRM else 'INVALID' end;
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
