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
create or replace function public.toki_company(
  p_action text,p_company uuid default null,p_code text default null,p_name text default null,
  p_member uuid default null,p_email text default null,p_role text default null,
  p_payload jsonb default null,p_version bigint default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  uid uuid:=auth.uid(); mail text; c toki_private.companies%rowtype;
  m toki_private.company_members%rowtype; b public.toki_boards%rowtype; result jsonb;
  target toki_private.company_members%rowtype;
begin
  if uid is null or not exists(select 1 from auth.identities i where i.user_id=uid and i.provider='google')
    or not exists(select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]'::jsonb)) a where a->>'method'='oauth')
    or not exists(select 1 from auth.sessions s where s.id=(auth.jwt()->>'session_id')::uuid and s.user_id=uid)
    then raise exception 'AUTH'; end if;
  select lower(email) into mail from auth.users where id=uid and email_confirmed_at is not null;
  if mail is null then raise exception 'AUTH'; end if;
  if p_action='list' then
    -- An invitation authorizes exactly the verified email; blocked members stay blocked.
    insert into toki_private.company_members(company_id,user_id,role,status)
      select company_id,uid,role,'active' from toki_private.company_invites where email=mail and expires_at>now()
      on conflict(company_id,user_id) do update set role=excluded.role,status='active'
        where company_members.status='pending';
    delete from toki_private.company_invites i where email=mail and exists(
      select 1 from toki_private.company_members cm where cm.company_id=i.company_id and cm.user_id=uid and cm.status='active');
    select coalesce(jsonb_agg(jsonb_build_object('id',cc.id,'name',cc.name,'code',cc.code,'role',cm.role,'status',cm.status) order by cc.created_at),'[]') into result
      from toki_private.company_members cm join toki_private.companies cc on cc.id=cm.company_id where cm.user_id=uid;
    return result;
  elsif p_action='create' then
    if p_name is null or length(btrim(p_name)) not between 1 and 80 then raise exception 'INVALID'; end if;
    -- Serialize account-level creation limits.
    perform 1 from auth.users where id=uid for update;
    if (select count(*) from toki_private.company_members where user_id=uid and role='admin')>=5 then raise exception 'LIMIT'; end if;
    insert into public.toki_boards(id,payload) values(gen_random_uuid()::text,'{"schemaVersion":4,"people":[],"groups":[],"events":[],"meetings":[]}') returning * into b;
    insert into toki_private.companies(name,board_id) values(btrim(p_name),b.id) returning * into c;
    insert into toki_private.company_members(company_id,user_id,role,status) values(c.id,uid,'admin','active');
    return jsonb_build_object('id',c.id);
  elsif p_action='join' then
    select * into c from toki_private.companies where code=upper(btrim(p_code));
    if c.id is null then raise exception 'COMPANY'; end if;
    perform 1 from auth.users where id=uid for update;
    if (select count(*) from toki_private.company_members where user_id=uid and status='pending')>=5
      and not exists(select 1 from toki_private.company_members where company_id=c.id and user_id=uid) then raise exception 'LIMIT'; end if;
    insert into toki_private.company_members(company_id,user_id) values(c.id,uid) on conflict do nothing;
    return jsonb_build_object('id',c.id);
  end if;
  -- One company lock serializes membership revocation with board writes and admin changes.
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
    select coalesce(jsonb_agg(jsonb_build_object('id',cm.user_id,'email',u.email,'name',coalesce(u.raw_user_meta_data->>'full_name',u.email),'role',cm.role,'status',cm.status) order by cm.created_at),'[]') into result
      from toki_private.company_members cm join auth.users u on u.id=cm.user_id where cm.company_id=c.id;
    return jsonb_build_object('members',result,'invites',coalesce((select jsonb_agg(jsonb_build_object('email',email,'role',role,'expiresAt',expires_at)) from toki_private.company_invites where company_id=c.id and expires_at>now()),'[]'));
  elsif p_action='invite' then
    if p_email is null or length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'INVALID'; end if;
    if (select count(*) from toki_private.company_invites where company_id=c.id and expires_at>now())>=100 then raise exception 'LIMIT'; end if;
    -- Invites never confer administrator privileges. Promotion requires a separate action.
    insert into toki_private.company_invites(company_id,email) values(c.id,lower(btrim(p_email)))
      on conflict(company_id,email) do update set role='member',expires_at=now()+interval '7 days';
  elsif p_action='cancel_invite' then
    delete from toki_private.company_invites where company_id=c.id and email=lower(btrim(p_email));
  elsif p_action in ('approve','block','role') then
    select * into target from toki_private.company_members where company_id=c.id and user_id=p_member;
    if target.user_id is null then raise exception 'INVALID'; end if;
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
revoke all on function public.toki_company(text,uuid,text,text,uuid,text,text,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.toki_company(text,uuid,text,text,uuid,text,text,jsonb,bigint) to authenticated;
-- Close both the exposed legacy wrapper and its definer implementation.
revoke all on function public.toki_share(text,text,uuid,text,jsonb,bigint) from public,anon,authenticated;
revoke all on function toki_private.share_action(text,text,uuid,text,jsonb,bigint) from public,anon,authenticated;
revoke all on public.toki_boards from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
