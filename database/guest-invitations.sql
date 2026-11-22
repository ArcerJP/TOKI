-- Apply after companies.sql. These RPCs do not enable Supabase anonymous sign-ups.
begin;

create table if not exists toki_private.company_guest_limits (
  guest_id uuid not null references toki_private.company_guests(id) on delete cascade,
  bucket text not null check(bucket in ('read','write')),
  started_at timestamptz not null,
  attempts integer not null check(attempts between 1 and 121),
  primary key(guest_id,bucket)
);
alter table toki_private.company_guest_limits enable row level security;
revoke all on toki_private.company_guest_limits from public,anon,authenticated;

create or replace function public.toki_guest_admin(
  p_action text,p_company uuid,p_guest uuid default null,p_name text default null,p_access jsonb default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare authorized jsonb; c toki_private.companies%rowtype; b public.toki_boards%rowtype;
  guest toki_private.company_guests%rowtype; name text; groups text[]; people uuid[]; ticket text;
begin
  -- The same authenticated administrator check, rate limit and organization lock
  -- used for the current participant-management screen.
  authorized:=public.toki_company('members',p_company);
  if authorized ? 'code' then return authorized; end if;
  select * into c from toki_private.companies where id=p_company;
  if not c.scoped_schedule then raise exception 'UPDATE_REQUIRED'; end if;
  select * into b from public.toki_boards where id=c.board_id for update;
  if not (b.payload ? 'rows') then
    update public.toki_boards set payload=toki_private.with_schedule_rows(b.payload) where id=b.id returning * into b;
  end if;
  if p_action='list' then
    return jsonb_build_object(
      'guests',coalesce((select jsonb_agg(jsonb_build_object(
        'id',g.id,'name',coalesce(b.payload->'people'->>toki_private.schedule_row_index(b.payload,g.person_id),g.display_name),
        'groupIds',g.visible_groups,'personIds',g.visible_people,
        'personId',g.person_id,'revoked',g.revoked_at is not null,
        'unusedLink',g.invite_hash is not null and g.invite_claimant_hash is null,
        'devices',(select count(*) from toki_private.company_guest_sessions s where s.guest_id=g.id)
      ) order by g.created_at,g.id) from toki_private.company_guests g where g.company_id=c.id),'[]'),
      'groups',coalesce((select jsonb_agg(g-'members' order by n)
        from jsonb_array_elements(b.payload->'groups') with ordinality as gs(g,n)),'[]'),
      'people',coalesce((select jsonb_agg(jsonb_build_object('id',r->>'id','name',b.payload->'people'->>((n-1)::integer)) order by n)
        from jsonb_array_elements(b.payload->'rows') with ordinality as rs(r,n) where r->>'kind'='person'),'[]'));
  end if;
  if p_action is null or p_action not in ('issue','add_device','set_access','revoke')
    or length(p_name)>80 or octet_length(p_access::text)>65536 then raise exception 'INVALID'; end if;
  if p_action<>'issue' then
    select * into guest from toki_private.company_guests where id=p_guest and company_id=c.id;
    if guest.id is null then raise exception 'DENIED'; end if;
  end if;
  if p_action in ('issue','set_access') then
    if jsonb_typeof(p_access) is distinct from 'object' or p_access-array['groups','people']<>'{}'
      or jsonb_typeof(p_access->'people') is distinct from 'array'
      or jsonb_array_length(p_access->'people')>100 then raise exception 'INVALID'; end if;
    groups:=toki_private.checked_visible_groups(b.payload,p_access->'groups');
    if exists(select 1 from jsonb_array_elements(p_access->'people') p
      where jsonb_typeof(p)<>'string' or not exists(select 1 from jsonb_array_elements(b.payload->'rows') r
        where r->>'kind'='person' and r->>'id'=p#>>'{}')) then raise exception 'INVALID'; end if;
    people:=array(select distinct value::uuid from jsonb_array_elements_text(p_access->'people'));
  end if;
  if p_action in ('issue','add_device') then
    ticket:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
  end if;
  if p_action='issue' then
    name:=toki_private.checked_schedule_name(p_name);
    perform toki_private.check_schedule_invitations(c.id,b.payload,name,null);
    insert into toki_private.company_guests(company_id,display_name,visible_groups,visible_people,invite_hash)
      values(c.id,name,groups,people,sha256(convert_to(ticket,'UTF8'))) returning * into guest;
  elsif p_action='add_device' then
    name:=coalesce(b.payload->'people'->>toki_private.schedule_row_index(b.payload,guest.person_id),guest.display_name);
    update toki_private.company_guests set invite_hash=sha256(convert_to(ticket,'UTF8')),
      invite_claimant_hash=null,revoked_at=null where id=guest.id;
  elsif p_action='set_access' then
    update toki_private.company_guests set visible_groups=groups,visible_people=people where id=guest.id;
    -- Revise the projected view even when underlying availability is unchanged.
    update public.toki_boards set payload=payload where id=b.id;
  elsif guest.person_id is null then
    delete from toki_private.company_guests where id=guest.id;
  else
    delete from toki_private.company_guest_sessions where guest_id=guest.id;
    update toki_private.company_guests set invite_hash=null,invite_claimant_hash=null,revoked_at=now() where id=guest.id;
  end if;
  if ticket is not null then return jsonb_build_object('ticket',ticket,'name',name); end if;
  return '{}'::jsonb;
exception when others then
  name:=case when SQLERRM in ('DENIED','NAME_TAKEN','NAME_INVALID','LIMIT','UPDATE_REQUIRED') then SQLERRM else 'INVALID' end;
  perform set_config('response.status',case name when 'DENIED' then '403' else '400' end,true);
  perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
  return jsonb_build_object('message',name,'code','TOKI_'||name);
end;
$$;
revoke all on function public.toki_guest_admin(text,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.toki_guest_admin(text,uuid,uuid,text,jsonb) to authenticated;

create or replace function public.toki_guest(
  p_action text,p_code text,p_token text,p_invite text default null,p_version bigint default null,p_payload jsonb default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c toki_private.companies%rowtype; b public.toki_boards%rowtype; guest toki_private.company_guests%rowtype;
  session_digest bytea; ticket_hash bytea; projected jsonb; row_id uuid; bucket_name text; used integer; failure text;
begin
  perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
  begin
    if p_action is null or p_action not in ('claim','read','save','leave')
      or p_code is null or p_code !~ '^[0-9A-F]{32}$' or p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception 'GUEST_ACCESS'; end if;
    session_digest:=sha256(convert_to(p_token,'UTF8'));
    if p_action='claim' then
      if p_invite is null or p_invite !~ '^[0-9a-f]{64}$' then raise exception 'GUEST_ACCESS'; end if;
      ticket_hash:=sha256(convert_to(p_invite,'UTF8'));
      select * into guest from toki_private.company_guests where invite_hash=ticket_hash;
    else
      select g.* into guest from toki_private.company_guest_sessions s join toki_private.company_guests g on g.id=s.guest_id
        where s.token_hash=session_digest;
    end if;
    if guest.id is null then raise exception 'GUEST_ACCESS'; end if;
    -- Acquire the same lock as membership administration, then recheck credentials.
    select * into c from toki_private.companies
      where id=guest.company_id and code=p_code and scoped_schedule for update;
    if c.id is null then raise exception 'GUEST_ACCESS'; end if;
    select * into guest from toki_private.company_guests where id=guest.id and revoked_at is null;
    if guest.id is null then raise exception 'GUEST_ACCESS'; end if;
    if p_action='claim' then
      if guest.invite_hash is distinct from ticket_hash then raise exception 'GUEST_ACCESS'; end if;
      if guest.invite_claimant_hash is not null and (guest.invite_claimant_hash is distinct from session_digest
        or not exists(select 1 from toki_private.company_guest_sessions s where s.token_hash=session_digest and s.guest_id=guest.id))
        then raise exception 'GUEST_ACCESS'; end if;
    elsif not exists(select 1 from toki_private.company_guest_sessions s where s.token_hash=session_digest and s.guest_id=guest.id) then
      raise exception 'GUEST_ACCESS';
    end if;
  exception when others then
    perform set_config('response.status','403',true);
    return jsonb_build_object('message','GUEST_ACCESS','code','TOKI_GUEST_ACCESS');
  end;
  bucket_name:=case when p_action='save' then 'write' else 'read' end;
  insert into toki_private.company_guest_limits as l(guest_id,bucket,started_at,attempts) values(guest.id,bucket_name,clock_timestamp(),1)
    on conflict(guest_id,bucket) do update set
      attempts=case when l.started_at<=clock_timestamp()-interval '1 minute' then 1 else least(l.attempts+1,121) end,
      started_at=case when l.started_at<=clock_timestamp()-interval '1 minute' then clock_timestamp() else l.started_at end
    returning attempts into used;
  if used>(case bucket_name when 'write' then 60 else 120 end) then
    perform set_config('response.status','429',true);
    return jsonb_build_object('message','RATE_LIMIT','code','TOKI_RATE_LIMIT');
  end if;
  begin
    if p_action='leave' then
      delete from toki_private.company_guest_sessions s where s.token_hash=session_digest and s.guest_id=guest.id;
      return jsonb_build_object('left',true);
    end if;
    select * into b from public.toki_boards where id=c.board_id for update;
    if p_action='claim' and guest.invite_claimant_hash is null then
      row_id:=coalesce(guest.person_id,gen_random_uuid());
      update toki_private.company_guests
        set person_id=row_id,invite_claimant_hash=session_digest where id=guest.id returning * into guest;
      if toki_private.schedule_row_index(b.payload,row_id) is null then
        perform toki_private.check_schedule_invitations(c.id,b.payload,guest.display_name,null);
        update public.toki_boards set payload=toki_private.append_schedule_row(b.payload,row_id,guest.display_name,'person')
          where id=b.id returning * into b;
      end if;
      insert into toki_private.company_guest_sessions(token_hash,guest_id) values(session_digest,guest.id);
    end if;
    if guest.person_id is null or toki_private.schedule_row_index(b.payload,guest.person_id) is null then
      raise exception 'GUEST_ACCESS';
    end if;
    projected:=toki_private.project_schedule(b.payload,guest.person_id,guest.visible_groups,guest.visible_people);
    if p_action='save' then
      if p_version is distinct from b.version then raise exception 'CONFLICT'; end if;
      if p_payload is null or octet_length(p_payload::text)>2097152 then raise exception 'INVALID'; end if;
      update public.toki_boards set payload=toki_private.merge_schedule_events(b.payload,projected,p_payload,guest.person_id,false)
        where id=b.id returning * into b;
      projected:=toki_private.project_schedule(b.payload,guest.person_id,guest.visible_groups,guest.visible_people);
    end if;
    return jsonb_build_object('company',jsonb_build_object('id',c.id,'name',c.name),
      'guest',jsonb_build_object('id',guest.id,'name',b.payload->'people'->>toki_private.schedule_row_index(b.payload,guest.person_id)),
      'board',jsonb_build_object('companyId',c.id,'version',b.version,'payload',projected,
        'access',jsonb_build_object('role','guest','personId',guest.person_id)));
  exception when others then
    failure:=case when SQLERRM in ('GUEST_ACCESS','DENIED','CONFLICT','SCHEDULE_BUSY','NAME_TAKEN','LIMIT') then SQLERRM else 'INVALID' end;
    perform set_config('response.status',case failure when 'GUEST_ACCESS' then '403' when 'DENIED' then '403' when 'CONFLICT' then '409' else '400' end,true);
    return jsonb_build_object('message',failure,'code','TOKI_'||failure);
  end;
end;
$$;
revoke all on function public.toki_guest(text,text,text,text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.toki_guest(text,text,text,text,bigint,jsonb) to anon;
notify pgrst,'reload schema';
commit;
