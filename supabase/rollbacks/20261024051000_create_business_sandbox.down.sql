begin;

drop function if exists private.cleanup_sandbox(uuid, uuid, uuid);
drop function if exists private.run_sandbox_simulation(uuid, uuid, uuid);
drop function if exists private.record_sandbox_step(uuid, smallint, text);

drop table if exists private.sandbox_orders;
drop table if exists private.sandbox_steps;
drop table if exists private.sandbox_runs;

commit;
