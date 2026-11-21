-- Apply after the month-picker and two-path join UI have been published.
begin;
alter table toki_private.companies alter column invitation_v2 set default true;
update toki_private.companies set invitation_v2=true where not invitation_v2;
commit;
