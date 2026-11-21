-- Apply after companies.sql. Register a SHA-256 hash of the dedicated worker
-- credential through the operator connection before starting the worker.
begin;
create table if not exists toki_private.company_application_mail_worker (
  singleton boolean primary key default true check(singleton),
  credential_hash bytea not null check(octet_length(credential_hash)=32)
);
alter table toki_private.company_application_mail_worker enable row level security;
revoke all on toki_private.company_application_mail_worker from public,anon,authenticated;

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
    return jsonb_build_object('acknowledged',found);
  end if;
  if p_action is distinct from 'claim' then
    perform set_config('response.status','400',true);
    return jsonb_build_object('message','INVALID');
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
