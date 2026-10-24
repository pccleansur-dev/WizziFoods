begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(24);

insert into auth.users (id)
values
  ('f1000000-0000-4000-8000-000000000001'),
  ('f2000000-0000-4000-8000-000000000002'),
  ('f9000000-0000-4000-8000-000000000009');

insert into public.tenants (id, slug, name, status)
values
  ('f3000000-0000-4000-8000-000000000003', 'team-one', 'Team One', 'draft'),
  ('f4000000-0000-4000-8000-000000000004', 'team-two', 'Team Two', 'draft');

insert into public.tenant_memberships (tenant_id, user_id, role)
values
  ('f3000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000001', 'admin'),
  ('f4000000-0000-4000-8000-000000000004', 'f2000000-0000-4000-8000-000000000002', 'admin');

create temporary table scope as
select
  'f3000000-0000-4000-8000-000000000003'::uuid as t1,
  (select id from public.locations where tenant_id = 'f3000000-0000-4000-8000-000000000003') as l1,
  'f4000000-0000-4000-8000-000000000004'::uuid as t2,
  (select id from public.locations where tenant_id = 'f4000000-0000-4000-8000-000000000004') as l2;

insert into private.floor_plans (tenant_id, location_id)
select t1, l1 from scope union all select t2, l2 from scope;
insert into private.floor_sectors (tenant_id, location_id, id, name, position)
select t1, l1, 'f5000000-0000-4000-8000-000000000005'::uuid, 'Salón', 0 from scope
union all
select t2, l2, 'f6000000-0000-4000-8000-000000000006'::uuid, 'Otro negocio', 0 from scope;

create function pg_temp.create_member(username text, role text, sectors uuid[] default '{}')
returns jsonb language sql as $$
  select private.create_staff_member(
    (select t1 from scope), (select l1 from scope),
    'f1000000-0000-4000-8000-000000000001',
    username, initcap(username), role,
    'scrypt-v1$c2FsdA$aGFzaA', sectors)
$$;

select has_table('private', 'staff_sector_assignments', 'sector assignments are private rows');
select table_privs_are('private', 'staff_sector_assignments', 'authenticator', array[]::text[],
  'the runtime cannot touch assignments directly');

create temporary table created as
select pg_temp.create_member('ana', 'waiter', array['f5000000-0000-4000-8000-000000000005'::uuid]) as member;
select is((select member->>'role' from created), 'waiter', 'a waiter is created');
select is((select member->'sectorIds' from created), '["f5000000-0000-4000-8000-000000000005"]'::jsonb,
  'the waiter is assigned to a salon sector');
select is((select count(*)::int from private.staff_credentials where staff_member_id = ((select member->>'id' from created))::uuid), 1,
  'the PIN hash is stored with the member');
select ok(not ((select member from created))::text like '%scrypt%', 'the member view never carries PIN material');

select throws_ok($$ select pg_temp.create_member('ana', 'waiter') $$, '23505', null,
  'usernames are unique per business');
select throws_ok($$ select pg_temp.create_member('luis', 'kitchen', array['f5000000-0000-4000-8000-000000000005'::uuid]) $$,
  '22023', null, 'only waiters receive salon sectors');
select throws_ok($$ select pg_temp.create_member('mia', 'waiter', array['f6000000-0000-4000-8000-000000000006'::uuid]) $$,
  '22023', null, 'a sector of another business cannot be assigned');
select throws_ok($$ select private.create_staff_member(
    (select t1 from scope), (select l1 from scope), 'f2000000-0000-4000-8000-000000000002',
    'eve', 'Eve', 'waiter', 'scrypt-v1$c2FsdA$aGFzaA', '{}') $$,
  '42501', null, 'an administrator of another tenant cannot create members');
select throws_ok($$ select private.create_staff_member(
    (select t1 from scope), (select l1 from scope), 'f9000000-0000-4000-8000-000000000009',
    'eve', 'Eve', 'waiter', 'scrypt-v1$c2FsdA$aGFzaA', '{}') $$,
  '42501', null, 'a user without membership cannot create members');
select throws_ok($$ select private.create_staff_member(
    (select t1 from scope), (select l1 from scope), 'f1000000-0000-4000-8000-000000000001',
    'eve', 'Eve', 'waiter', 'plain-text-pin', '{}') $$,
  '23514', null, 'a credential that is not a hash is rejected');

-- The only manager cannot be deactivated or demoted.
create temporary table manager as select pg_temp.create_member('jefe', 'manager') as member;
select throws_ok($$ select private.set_staff_active((select t1 from scope), (select l1 from scope),
    'f1000000-0000-4000-8000-000000000001', ((select member->>'id' from manager))::uuid, false) $$,
  'PT001', null, 'the last active manager cannot be deactivated');
select throws_ok($$ select private.update_staff_member((select t1 from scope), (select l1 from scope),
    'f1000000-0000-4000-8000-000000000001', ((select member->>'id' from manager))::uuid,
    'Jefe', 'waiter', '{}') $$,
  'PT001', null, 'the last active manager cannot be demoted');

create temporary table manager2 as select pg_temp.create_member('jefa', 'manager') as member;
select lives_ok($$ select private.set_staff_active((select t1 from scope), (select l1 from scope),
    'f1000000-0000-4000-8000-000000000001', ((select member->>'id' from manager))::uuid, false) $$,
  'a manager can be deactivated while another stays active');

-- Active sessions end with the deactivation.
insert into private.staff_sessions (tenant_id, staff_member_id, token_hash, expires_at)
select (select t1 from scope), ((select member->>'id' from created))::uuid, repeat('a', 64), now() + interval '1 hour';
select private.set_staff_active((select t1 from scope), (select l1 from scope),
  'f1000000-0000-4000-8000-000000000001', ((select member->>'id' from created))::uuid, false);
select is((select count(*)::int from private.staff_sessions where revoked_at is null and staff_member_id = ((select member->>'id' from created))::uuid), 0,
  'deactivating revokes active sessions');
select lives_ok($$ select private.set_staff_active((select t1 from scope), (select l1 from scope),
    'f1000000-0000-4000-8000-000000000001', ((select member->>'id' from created))::uuid, true) $$,
  'a member can be reactivated');

-- Role and sector changes.
select is((private.update_staff_member((select t1 from scope), (select l1 from scope),
    'f1000000-0000-4000-8000-000000000001', ((select member->>'id' from created))::uuid,
    'Ana', 'kitchen', '{}'))->>'role', 'kitchen', 'a role can change');
select is((select count(*)::int from private.staff_sector_assignments where staff_member_id = ((select member->>'id' from created))::uuid), 0,
  'leaving the waiter role drops salon sectors');

-- Audit trail without secrets.
select ok((select count(*) from private.audit_events where tenant_id = (select t1 from scope)
    and action in ('staff.created', 'staff.deactivated', 'staff.activated', 'staff.role_changed')) >= 5,
  'creation, deactivation, activation and role change are audited');
select is((select count(*)::int from private.audit_events where tenant_id = (select t1 from scope)
    and (reason || correlation_id) ~* '(scrypt|pin|ana|jefe)'), 0,
  'audit rows hold no PIN, hash or username');

-- Tenant isolation of reads.
select is((select jsonb_array_length(private.list_staff_members((select t1 from scope), (select l1 from scope),
    'f1000000-0000-4000-8000-000000000001'))), 3, 'the first tenant lists only its own members');
select is((select jsonb_array_length(private.list_staff_members((select t2 from scope), (select l2 from scope),
    'f2000000-0000-4000-8000-000000000002'))), 0, 'the second tenant sees none of them');
select throws_ok($$ select private.list_staff_members((select t1 from scope), (select l1 from scope),
    'f2000000-0000-4000-8000-000000000002') $$, '42501', null,
  'listing with another tenant administrator is refused');

select * from finish();
rollback;
