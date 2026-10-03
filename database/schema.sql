-- Run in the TOKI Supabase SQL Editor. Contains no private schedule data.
begin;
create schema if not exists toki_private;
revoke all on schema toki_private from public, anon, authenticated;

create table if not exists public.toki_members (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.toki_members enable row level security;
revoke all on public.toki_members from public, anon, authenticated;
grant select on public.toki_members to authenticated;
drop policy if exists toki_own_membership on public.toki_members;
create policy toki_own_membership on public.toki_members for select to authenticated
  using (user_id = (select auth.uid()));

create table if not exists public.toki_boards (
  id text primary key check (id = 'october-2026'),
  payload jsonb not null,
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table public.toki_boards enable row level security;
revoke all on public.toki_boards from public, anon, authenticated;
grant select on public.toki_boards to authenticated;
grant update(payload) on public.toki_boards to authenticated;
drop policy if exists toki_member_read on public.toki_boards;
create policy toki_member_read on public.toki_boards for select to authenticated
  using (exists(select 1 from public.toki_members where user_id = (select auth.uid())));
drop policy if exists toki_member_update on public.toki_boards;
create policy toki_member_update on public.toki_boards for update to authenticated
  using (exists(select 1 from public.toki_members where user_id = (select auth.uid())))
  with check (exists(select 1 from public.toki_members where user_id = (select auth.uid())));

create or replace function toki_private.validate_board()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare item jsonb; person_name jsonb;
begin
  if jsonb_typeof(new.payload) is distinct from 'object'
    or jsonb_typeof(new.payload->'people') is distinct from 'array'
    or jsonb_typeof(new.payload->'events') is distinct from 'array'
    or new.payload->'dates' is distinct from '["2026-10-03","2026-10-04","2026-10-05","2026-10-06","2026-10-07","2026-10-08"]'::jsonb then
    raise exception 'Invalid schedule structure';
  end if;
  if jsonb_array_length(new.payload->'people') <> 16 or jsonb_array_length(new.payload->'events') > 2000 then
    raise exception 'Invalid schedule size';
  end if;
  for person_name in select value from jsonb_array_elements(new.payload->'people') loop
    if jsonb_typeof(person_name) <> 'string' or length(person_name#>>'{}') not between 1 and 40 then
      raise exception 'Invalid person name';
    end if;
  end loop;
  for item in select value from jsonb_array_elements(new.payload->'events') loop
    if jsonb_typeof(item) <> 'object'
      or jsonb_typeof(item->'id') is distinct from 'string'
      or length(item->>'id') not between 1 and 100
      or jsonb_typeof(item->'person') is distinct from 'number'
      or (item->>'person') !~ '^[0-9]+$'
      or (item->>'person')::integer not between 0 and 15
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
drop trigger if exists validate_toki_board on public.toki_boards;
create trigger validate_toki_board before insert or update on public.toki_boards
  for each row execute function toki_private.validate_board();

do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='toki_boards') then
    alter publication supabase_realtime add table public.toki_boards;
  end if;
end $$;
commit;
