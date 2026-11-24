-- Apply after companies.sql. Register a SHA-256 hash of the dedicated worker
-- credential through the operator connection before starting the worker.
begin;
create table if not exists toki_private.company_application_mail_worker (
  singleton boolean primary key default true check(singleton),
  credential_hash bytea not null check(octet_length(credential_hash)=32)
);
alter table toki_private.company_application_mail_worker enable row level security;
revoke all on toki_private.company_application_mail_worker from public,anon,authenticated;

create or replace function toki_private.review_groups_at(board jsonb, destination jsonb)
returns jsonb language sql immutable set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_set(g,'{members}',(
    select coalesce(jsonb_agg(toki_private.schedule_row_index(destination,
      (board->'rows'->((member#>>'{}')::integer)->>'id')::uuid) order by m),'[]')
      from jsonb_array_elements(g->'members') with ordinality as people(member,m)
  )) order by n),'[]')
  from jsonb_array_elements(board->'groups') with ordinality as groups(g,n)
$$;

create or replace function toki_private.rebase_reviewed_roster(current_board jsonb, proposed jsonb, former_roster jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare event_list jsonb; meeting_list jsonb; previous_groups jsonb; proposed_groups jsonb;
  next_people jsonb; next_groups jsonb; change record; row_position integer;
begin
  if jsonb_typeof(current_board->'rows') is distinct from 'array'
    or jsonb_typeof(proposed->'rows') is distinct from 'array' then raise exception 'CONFLICT'; end if;
  if current_board-array['events','meetings'] is distinct from former_roster then
    -- Apply independent name/group edits to the current roster. Ordering
    -- revisions require their original roster so they cannot reorder new rows
    -- or overwrite someone else's ordering.
    if proposed->'rows' is distinct from former_roster->'rows' then raise exception 'CONFLICT'; end if;
    previous_groups:=toki_private.review_groups_at(former_roster,current_board);
    proposed_groups:=toki_private.review_groups_at(proposed,current_board);
    if (select array(select g->>'id' from jsonb_array_elements(previous_groups) g
          where exists(select 1 from jsonb_array_elements(proposed_groups) p where p->>'id'=g->>'id')))
      is distinct from (select array(select g->>'id' from jsonb_array_elements(proposed_groups) g
          where exists(select 1 from jsonb_array_elements(previous_groups) p where p->>'id'=g->>'id')))
      then raise exception 'CONFLICT'; end if;
    next_people:=current_board->'people';
    for change in select (former_roster->'rows'->(i-1)->>'id')::uuid as row_id,
        former_roster->'people'->(i-1) as before_name,proposed->'people'->(i-1) as after_name
      from generate_series(1,jsonb_array_length(former_roster->'rows')) i
      where former_roster->'people'->(i-1) is distinct from proposed->'people'->(i-1)
    loop
      row_position:=toki_private.schedule_row_index(current_board,change.row_id);
      if row_position is null or (next_people->row_position is distinct from change.before_name
        and next_people->row_position is distinct from change.after_name) then raise exception 'CONFLICT'; end if;
      next_people:=jsonb_set(next_people,array[row_position::text],change.after_name);
    end loop;
    next_groups:=current_board->'groups';
    for change in select coalesce(before_group->>'id',after_group->>'id') as group_id,before_group,after_group
      from jsonb_array_elements(previous_groups) with ordinality as prior(before_group,before_position)
        full join jsonb_array_elements(proposed_groups) with ordinality as next(after_group,after_position)
        on before_group->>'id'=after_group->>'id'
      where before_group is distinct from after_group
      order by coalesce(after_position,before_position)
    loop
      select (n-1)::integer into row_position from jsonb_array_elements(next_groups) with ordinality item(g,n)
        where g->>'id'=change.group_id;
      if next_groups->row_position is not distinct from change.after_group then continue; end if;
      if next_groups->row_position is distinct from change.before_group then raise exception 'CONFLICT'; end if;
      next_groups:=case when change.after_group is null then next_groups-row_position
        when row_position is null then next_groups||change.after_group
        else jsonb_set(next_groups,array[row_position::text],change.after_group) end;
    end loop;
    proposed:=jsonb_set(jsonb_set(current_board,'{people}',next_people),'{groups}',next_groups);
  end if;
  -- Group removal with current MTGs needs a fresh preview of the time restored.
  if exists(select 1 from jsonb_array_elements(current_board->'meetings') m
    where not exists(select 1 from jsonb_array_elements(proposed->'groups') g where g->>'id'=m->>'group'))
    then raise exception 'CONFLICT'; end if;
  select coalesce(jsonb_agg(jsonb_set(item,'{person}',to_jsonb(
    toki_private.schedule_row_index(proposed,(current_board->'rows'->((item->>'person')::integer)->>'id')::uuid))) order by n),'[]')
    into event_list from jsonb_array_elements(current_board->'events') with ordinality e(item,n);
  select coalesce(jsonb_agg(jsonb_set(item,'{members}',(
    select jsonb_agg(toki_private.schedule_row_index(proposed,(current_board->'rows'->((participant#>>'{}')::integer)->>'id')::uuid) order by i)
      from jsonb_array_elements(item->'members') with ordinality p(participant,i)
  )) order by n),'[]') into meeting_list from jsonb_array_elements(current_board->'meetings') with ordinality m(item,n);
  return jsonb_set(jsonb_set(proposed,'{events}',event_list),'{meetings}',meeting_list);
end;
$$;

create or replace function toki_private.apply_due_company_reviews()
returns void language plpgsql set search_path='' as $$
declare queued record; review toki_private.company_admin_reviews%rowtype; item toki_private.company_admin_review_items%rowtype;
  board public.toki_boards%rowtype; arguments jsonb; payload jsonb; outcome jsonb; usable boolean;
begin
  update toki_private.company_admin_review_items i set result=null
    from toki_private.company_admin_reviews r where r.id=i.review_id and i.result is not null
    and r.resolved_at<=now()-interval '7 days';
  for queued in select id,company_id from toki_private.company_admin_reviews
    where state='pending' and ((notified_at is not null and notified_at+interval '24 hours'<=now())
      or (notified_at is null and day<(now() at time zone 'Asia/Tokyo')::date-7))
    order by day,id limit 4
  loop
    -- All review decisions acquire the organization lock first.
    perform 1 from toki_private.companies where id=queued.company_id for update skip locked;
    if not found then continue; end if;
    select * into review from toki_private.company_admin_reviews where id=queued.id and state='pending' for update;
    if review.id is null then continue; end if;
    usable:=review.notified_at is not null and exists(
      select 1 from toki_private.company_members cm join auth.users u on u.id=cm.user_id where cm.company_id=review.company_id
        and cm.user_id=any(review.reviewers) and cm.role='admin' and cm.status='active'
        and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now())
        and exists(select 1 from auth.identities i where i.user_id=u.id and i.provider='google')
    );
    update toki_private.company_admin_reviews set state=case when usable then 'applied' else 'rejected' end,
      resolved_at=clock_timestamp() where id=review.id;
    for item in select * from toki_private.company_admin_review_items where review_id=review.id and state='pending' order by created_at,id loop
      if not usable then
        update toki_private.company_admin_review_items set state='rejected',args='{}' where id=item.id;
        continue;
      end if;
      begin
        if not exists(select 1 from toki_private.company_members cm join auth.users u on u.id=cm.user_id
          where cm.company_id=review.company_id and cm.user_id=review.actor and cm.role='admin' and cm.status='active'
            and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now())
            and exists(select 1 from auth.identities i where i.user_id=u.id and i.provider='google'))
          then raise exception 'DENIED'; end if;
        arguments:=item.args;payload:=arguments->'payload';
        if item.action like 'guest:%' then
          outcome:=toki_private.guest_admin_action(review.actor,substr(item.action,7),review.company_id,
            (arguments->>'guest')::uuid,arguments->>'name',arguments->'access');
        else
          if arguments->>'joinedAt' is not null and not exists(
            select 1 from toki_private.company_members cm where cm.company_id=review.company_id
              and cm.user_id=(arguments->>'member')::uuid and cm.created_at=(arguments->>'joinedAt')::timestamptz
          ) then raise exception 'CONFLICT'; end if;
          select b.* into board from public.toki_boards b join toki_private.companies c on c.board_id=b.id where c.id=review.company_id;
          if item.action='save' and (arguments->>'version')::bigint is distinct from board.version then
            payload:=toki_private.rebase_reviewed_roster(board.payload,payload,arguments->'roster');
          end if;
          outcome:=toki_private.company_action_internal(item.action,review.company_id,null,arguments->>'name',
            (arguments->>'member')::uuid,arguments->>'email',arguments->>'role',nullif(payload,'null'),board.version,review.actor);
        end if;
        update toki_private.company_admin_review_items set state='applied',args='{}',
          result=case when outcome ? 'invitations' or outcome ? 'ticket' then outcome else null end where id=item.id;
      exception when others then
        update toki_private.company_admin_review_items set state='failed',args='{}',result=null where id=item.id;
      end;
    end loop;
  end loop;
end;
$$;
revoke all on function toki_private.review_groups_at(jsonb,jsonb),toki_private.rebase_reviewed_roster(jsonb,jsonb,jsonb),
  toki_private.apply_due_company_reviews() from public,anon,authenticated;

create or replace function public.toki_application_mail(p_key text,p_action text,p_id uuid default null,p_lease uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job record; lease uuid;
begin
  perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
  if length(p_key) is distinct from 64 or not exists(
    select 1 from toki_private.company_application_mail_worker
    where credential_hash=sha256(convert_to(p_key,'UTF8'))) then
    perform set_config('response.status','403',true);
    return jsonb_build_object('message','DENIED');
  end if;
  if p_action='ack' then
    delete from toki_private.company_application_mail where id=p_id and lease_id=p_lease;
    if found then return jsonb_build_object('acknowledged',true); end if;
    delete from toki_private.company_workflow_mail where id=p_id and lease_id=p_lease returning kind,related,recipient,company_id into job;
    if not found then return jsonb_build_object('acknowledged',false); end if;
    if job.kind='review' then
      update toki_private.company_admin_reviews set notified_at=coalesce(notified_at,clock_timestamp())
        where id=job.related and state='pending' and job.recipient=any(reviewers)
          and exists(select 1 from toki_private.company_members cm join auth.users u on u.id=cm.user_id
            where cm.company_id=job.company_id and cm.user_id=job.recipient and cm.status='active' and cm.role='admin'
              and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now())
              and exists(select 1 from auth.identities i where i.user_id=u.id and i.provider='google'));
    end if;
    return jsonb_build_object('acknowledged',true);
  end if;
  if p_action is null or p_action not in ('claim','claim_v2','sweep') then
    perform set_config('response.status','400',true);
    return jsonb_build_object('message','INVALID');
  end if;
  if p_action='sweep' then
    perform toki_private.apply_due_company_reviews();
    return 'null'::jsonb;
  end if;
  if p_action='claim_v2' then
    delete from toki_private.company_workflow_mail where due_at<=now()-interval '7 days';
    select q.id,q.kind,q.related,q.company_id as company,c.name as organization,u.email as recipient,
      coalesce(q.label,(select coalesce(board.payload->'people'->>toki_private.schedule_row_index(board.payload,author.person_id),account.email)
        from toki_private.company_members author join auth.users account on account.id=author.user_id
        join public.toki_boards board on board.id=c.board_id where author.company_id=c.id and author.user_id=r.actor)) as label,
      r.day,request.old_name,request.new_name,
      case when q.kind='review' then (select jsonb_agg(i.summary order by i.created_at,i.id)
        from toki_private.company_admin_review_items i where i.review_id=r.id) else null end as items
    into job
    from toki_private.company_workflow_mail q
      join auth.users u on u.id=q.recipient and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now())
      join toki_private.company_members cm on cm.company_id=q.company_id and cm.user_id=q.recipient and cm.status='active'
      join toki_private.companies c on c.id=q.company_id
      left join toki_private.company_admin_reviews r on q.kind='review' and r.id=q.related
      left join toki_private.company_admin_recovery recovery on q.kind='demotion' and recovery.id=q.related
      left join toki_private.company_rename_requests request on q.kind='rename' and request.id=q.related
    where q.due_at<=now() and q.next_attempt_at<=now() and q.attempts<12
      and exists(select 1 from auth.identities i where i.user_id=u.id and i.provider='google') and (
      (q.kind='promotion' and cm.role='admin')
      or (q.kind='demotion' and cm.role='member' and recovery.resolved_at is null and recovery.id is not null)
      or (q.kind='review' and cm.role='admin' and q.recipient=any(r.reviewers) and r.state='pending'
        and (r.notified_at is null or r.notified_at+interval '24 hours'>now()))
      or (q.kind='rename' and cm.role='admin' and request.resolved_at is null and request.id is not null))
    order by q.due_at,q.id limit 1 for update of q skip locked;
    if job.id is not null then
      lease:=gen_random_uuid();
      update toki_private.company_workflow_mail set lease_id=lease,attempts=attempts+1,next_attempt_at=now()+interval '15 minutes'
        where id=job.id;
      return to_jsonb(job)||jsonb_build_object('lease',lease);
    end if;
  end if;
  delete from toki_private.company_application_mail q
    where q.requested_at<=now()-interval '7 days' or not exists(
      select 1 from toki_private.company_members applicant
      join toki_private.company_members admin on admin.company_id=applicant.company_id
        and admin.user_id=q.administrator and admin.status='active' and admin.role='admin'
      where applicant.company_id=q.company_id and applicant.user_id=q.requester
        and applicant.created_at=q.requested_at and applicant.status='pending');
  select q.id,c.name as organization,recipient.email as recipient,
      requester.email as email,applicant.request_name as name into job
    from toki_private.company_application_mail q
    join toki_private.companies c on c.id=q.company_id
    join toki_private.company_members applicant on applicant.company_id=c.id and applicant.user_id=q.requester
      and applicant.status='pending' and applicant.created_at=q.requested_at
    join toki_private.company_members admin on admin.company_id=c.id and admin.user_id=q.administrator
      and admin.status='active' and admin.role='admin'
    join auth.users requester on requester.id=q.requester and requester.email_confirmed_at is not null
    join auth.users recipient on recipient.id=q.administrator and recipient.email_confirmed_at is not null
      and (recipient.banned_until is null or recipient.banned_until<=now())
    where q.next_attempt_at<=now() and q.attempts<12
    order by q.next_attempt_at,q.id limit 1 for update of q skip locked;
  if job.id is null then return 'null'::jsonb; end if;
  lease:=gen_random_uuid();
  update toki_private.company_application_mail
    set lease_id=lease,attempts=attempts+1,next_attempt_at=now()+interval '15 minutes'
    where id=job.id;
  return to_jsonb(job)||jsonb_build_object('lease',lease);
end;
$$;
revoke all on function public.toki_application_mail(text,text,uuid,uuid) from public,anon,authenticated;
-- This narrowly scoped endpoint has its own worker credential and is not a
-- scheduling or membership endpoint.
grant execute on function public.toki_application_mail(text,text,uuid,uuid) to anon;
notify pgrst,'reload schema';
commit;
