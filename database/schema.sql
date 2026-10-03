-- Run in the Supabase SQL Editor. Safe to apply to the previous login-based schema.
-- Private names, schedules and sharing tokens are not included in this file.
begin;
create schema if not exists toki_private;
revoke all on schema toki_private from public, anon, authenticated;
create table if not exists public.toki_boards (
  id text primary key check (id = 'october-2026'),
  payload jsonb not null,
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table public.toki_boards enable row level security;
revoke all on public.toki_boards from public, anon, authenticated;
revoke update(payload) on public.toki_boards from public, anon, authenticated;
-- Retain legacy membership records but disable the old API path.
do $$ begin
  if to_regclass('public.toki_members') is not null then
    revoke all on public.toki_members from public, anon, authenticated;
  end if;
end $$;
create table if not exists toki_private.share_links (
  board_id text primary key references public.toki_boards(id),
  token_hash bytea not null unique
);
create table if not exists toki_private.registrations (
  board_id text not null references public.toki_boards(id),
  registration uuid not null,
  person integer not null,
  primary key(board_id, registration)
);
revoke all on toki_private.share_links, toki_private.registrations from public, anon, authenticated;
alter table toki_private.share_links enable row level security;
alter table toki_private.registrations enable row level security;
create or replace function toki_private.validate_board()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare item jsonb; person_name jsonb; grp jsonb; member jsonb;
begin
  if jsonb_typeof(new.payload) is distinct from 'object'
    or jsonb_typeof(new.payload->'people') is distinct from 'array'
    or new.payload->'schemaVersion' is distinct from '2'::jsonb
    or jsonb_typeof(new.payload->'groups') is distinct from 'array'
    or jsonb_typeof(new.payload->'events') is distinct from 'array'
    or new.payload->'dates' is distinct from '["2026-10-03","2026-10-04","2026-10-05","2026-10-06","2026-10-07","2026-10-08"]'::jsonb then
    raise exception 'Invalid schedule structure';
  end if;
  if jsonb_array_length(new.payload->'people') not between 0 and 100 or jsonb_array_length(new.payload->'groups') > 50 or jsonb_array_length(new.payload->'events') > 2000 then
    raise exception 'Invalid schedule size';
  end if;
  for person_name in select value from jsonb_array_elements(new.payload->'people') loop
    if jsonb_typeof(person_name) <> 'string' or length(person_name#>>'{}') not between 1 and 40 then
      raise exception 'NAME_INVALID';
    end if;
  end loop;
  if exists(select 1 from jsonb_array_elements_text(new.payload->'people') n(name) where name is distinct from btrim(regexp_replace(normalize(name,NFKC),'[[:space:]]+',' ','g')) or name ~ '[[:cntrl:]]') then raise exception 'NAME_INVALID'; end if;
  if (select count(*)<>count(distinct lower(normalize(value,NFKC))) from jsonb_array_elements_text(new.payload->'people')) then raise exception 'NAME_TAKEN'; end if;
  for grp in select value from jsonb_array_elements(new.payload->'groups') loop
    if jsonb_typeof(grp) is distinct from 'object'
      or jsonb_typeof(grp->'id') is distinct from 'string' or (grp->>'id') !~ '^[a-zA-Z0-9_-]{1,100}$'
      or jsonb_typeof(grp->'name') is distinct from 'string' or length(grp->>'name') not between 1 and 40
      or (grp->>'name') is distinct from btrim(regexp_replace(normalize(grp->>'name',NFKC),'[[:space:]]+',' ','g')) or (grp->>'name') ~ '[[:cntrl:]]'
      or jsonb_typeof(grp->'members') is distinct from 'array' then raise exception 'INVALID'; end if;
    for member in select value from jsonb_array_elements(grp->'members') loop
      if jsonb_typeof(member)<>'number' or (member#>>'{}') !~ '^[0-9]+$' or (member#>>'{}')::integer not between 0 and jsonb_array_length(new.payload->'people')-1 then raise exception 'INVALID'; end if;
    end loop;
    if (select count(*)<>count(distinct value) from jsonb_array_elements(grp->'members')) then raise exception 'INVALID'; end if;
  end loop;
  if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(new.payload->'groups')) then raise exception 'INVALID'; end if;
  if (select count(*)<>count(distinct lower(value->>'name')) from jsonb_array_elements(new.payload->'groups')) then raise exception 'NAME_TAKEN'; end if;
  for item in select value from jsonb_array_elements(new.payload->'events') loop
    if jsonb_typeof(item) <> 'object'
      or jsonb_typeof(item->'id') is distinct from 'string'
      or length(item->>'id') not between 1 and 100
      or (item ? 'person') = (item ? 'group')
      or ((item ? 'person') and (jsonb_typeof(item->'person') is distinct from 'number' or (item->>'person') !~ '^[0-9]+$' or (item->>'person')::integer not between 0 and jsonb_array_length(new.payload->'people')-1))
      or ((item ? 'group') and (jsonb_typeof(item->'group') is distinct from 'string' or not exists(select 1 from jsonb_array_elements(new.payload->'groups') g where g->>'id'=item->>'group')))
      or jsonb_typeof(item->'date') is distinct from 'string'
      or not (new.payload->'dates' @> jsonb_build_array(item->>'date'))
      or jsonb_typeof(item->'start') is distinct from 'number'
      or jsonb_typeof(item->'end') is distinct from 'number'
      or (item->>'start') !~ '^[0-9]+$' or (item->>'end') !~ '^[0-9]+$'
      or (item->>'start')::integer < 480 or (item->>'end')::integer > 1440
      or (item->>'end')::integer <= (item->>'start')::integer
      or jsonb_typeof(item->'title') is distinct from 'string'
      or length(item->>'title') not between 1 and 100
      or jsonb_typeof(item->'detail') is distinct from 'string'
      or length(item->>'detail') > 2000 then
      raise exception 'Invalid event';
    end if;
  end loop;
  if (select count(*) <> count(distinct value->>'id') from jsonb_array_elements(new.payload->'events')) then
    raise exception 'Duplicate event IDs';
  end if;
  if TG_OP = 'UPDATE' then
    new.version := old.version + 1;
  else
    new.version := 1;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
revoke all on function toki_private.validate_board() from public, anon, authenticated;

do $$ begin
  if not exists(select 1 from pg_trigger where tgname='validate_toki_board' and tgrelid='public.toki_boards'::regclass) then
    create trigger validate_toki_board before insert or update on public.toki_boards
      for each row execute function toki_private.validate_board();
  end if;
end $$;

-- This privileged function is outside the exposed API schema. Every action checks the link.
create or replace function toki_private.share_action(
  p_token text, p_action text, p_registration uuid,
  p_name text, p_payload jsonb, p_version bigint
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  board_id text;
  board public.toki_boards%rowtype;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'LINK'; end if;
  select l.board_id into board_id from toki_private.share_links l where l.token_hash=sha256(convert_to(p_token,'UTF8'));
  if board_id is null then raise exception 'LINK'; end if;
  if p_action in ('join','save') then raise exception 'UPDATE_REQUIRED'; end if;
  if p_action='save_grouped' then
    select * into board from public.toki_boards b where b.id=board_id for update;
    if p_version is distinct from board.version then raise exception 'CONFLICT'; end if;
    if p_payload->'schemaVersion' is distinct from '2'::jsonb or p_payload->'dates' is distinct from board.payload->'dates' then raise exception 'INVALID'; end if;
    update public.toki_boards set payload=p_payload where id=board.id returning * into board;
  elsif p_action='read' then
    select * into board from public.toki_boards b where b.id=board_id;
  else raise exception 'INVALID'; end if;
  if board.id is null then raise exception 'LINK'; end if;
  return jsonb_build_object('payload',board.payload,'version',board.version);
end;
$$;
revoke all on function toki_private.share_action(text,text,uuid,text,jsonb,bigint) from public, anon, authenticated;
grant usage on schema toki_private to anon, authenticated;
grant execute on function toki_private.share_action(text,text,uuid,text,jsonb,bigint) to anon, authenticated;

create or replace function public.toki_share(
  p_token text, p_action text default 'read', p_registration uuid default null,
  p_name text default null, p_payload jsonb default null, p_version bigint default null
) returns jsonb language sql security invoker set search_path = '' as $$
  select toki_private.share_action(p_token,p_action,p_registration,p_name,p_payload,p_version);
$$;
revoke all on function public.toki_share(text,text,uuid,text,jsonb,bigint) from public, anon, authenticated;
grant execute on function public.toki_share(text,text,uuid,text,jsonb,bigint) to anon, authenticated;
-- Preserve all existing schedules while upgrading their format once.
update public.toki_boards set payload=payload || jsonb_build_object('schemaVersion',2,'groups',coalesce(payload->'groups','[]'::jsonb))
  where payload->'schemaVersion' is distinct from '2'::jsonb;
notify pgrst, 'reload schema';
commit;
