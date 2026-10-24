begin;

drop function if exists private.staff_team_summary(uuid, uuid);
drop function if exists private.reset_staff_pin(uuid, uuid, uuid, uuid, text);
drop function if exists private.set_staff_active(uuid, uuid, uuid, uuid, boolean);
drop function if exists private.update_staff_member(uuid, uuid, uuid, uuid, text, text, uuid[]);
drop function if exists private.create_staff_member(uuid, uuid, uuid, text, text, text, text, uuid[]);
drop function if exists private.list_staff_members(uuid, uuid, uuid);
drop function if exists private.staff_guard_last_manager(uuid, uuid, uuid);
drop function if exists private.staff_revoke_sessions(uuid, uuid);
drop function if exists private.staff_replace_sectors(uuid, uuid, uuid, text, uuid[]);
drop function if exists private.staff_member_view(uuid, uuid);

drop table if exists private.staff_sector_assignments;

drop function if exists private.staff_assignment_requires_waiter();

commit;
