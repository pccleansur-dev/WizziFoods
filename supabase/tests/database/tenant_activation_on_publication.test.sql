begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(4);

insert into auth.users (id) values
  ('d1000000-0000-4000-8000-000000000001'),
  ('d1000000-0000-4000-8000-000000000002');
insert into public.tenants (id, slug, name, status)
values
  ('d3000000-0000-4000-8000-000000000003', 'activation-draft', 'Activation Draft', 'draft'),
  ('d4000000-0000-4000-8000-000000000004', 'activation-suspended', 'Activation Suspended', 'suspended');
insert into public.tenant_memberships (tenant_id, user_id, role)
values
  ('d3000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000001', 'admin'),
  ('d4000000-0000-4000-8000-000000000004', 'd1000000-0000-4000-8000-000000000002', 'admin');

select is(
  (select status from public.tenants where id = 'd3000000-0000-4000-8000-000000000003'),
  'draft',
  'a provisioned business starts as draft'
);

insert into private.location_publications (tenant_id, location_id, published_by)
select 'd3000000-0000-4000-8000-000000000003', id, 'd1000000-0000-4000-8000-000000000001'
from public.locations where tenant_id = 'd3000000-0000-4000-8000-000000000003';

select is(
  (select status from public.tenants where id = 'd3000000-0000-4000-8000-000000000003'),
  'active',
  'publishing the location activates the draft business'
);

insert into private.location_publications (tenant_id, location_id, published_by)
select 'd4000000-0000-4000-8000-000000000004', id, 'd1000000-0000-4000-8000-000000000002'
from public.locations where tenant_id = 'd4000000-0000-4000-8000-000000000004';

select is(
  (select status from public.tenants where id = 'd4000000-0000-4000-8000-000000000004'),
  'suspended',
  'publishing never reactivates a suspended business'
);

select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'activate_tenant_on_publication'
     and has_function_privilege('authenticated', p.oid, 'execute')),
  0,
  'the activation trigger function is not callable by clients'
);

select * from finish();
rollback;
