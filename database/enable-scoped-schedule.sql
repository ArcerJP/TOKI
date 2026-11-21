begin;

-- Apply after the updated client has been deployed. Existing rows keep their
-- order, availability and groups. Administrators can then register account rows.
alter table toki_private.companies alter column scoped_schedule set default true;
update public.toki_boards b
set payload=toki_private.with_schedule_rows(b.payload)
from toki_private.companies c
where c.board_id=b.id and not c.scoped_schedule;
update toki_private.companies set scoped_schedule=true where not scoped_schedule;

commit;
