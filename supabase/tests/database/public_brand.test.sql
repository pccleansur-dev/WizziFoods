begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(11);

insert into auth.users (id) values ('3c100000-0000-4000-8000-000000000001'), ('3c100000-0000-4000-8000-000000000002');
insert into public.tenants (id, slug, name, status) values
  ('3c200000-0000-4000-8000-000000000001', 'brand-one', 'Brand One', 'active'),
  ('3c200000-0000-4000-8000-000000000002', 'brand-two', 'Brand Two', 'active');
insert into public.tenant_memberships (tenant_id, user_id, role) values
  ('3c200000-0000-4000-8000-000000000001', '3c100000-0000-4000-8000-000000000001', 'admin'),
  ('3c200000-0000-4000-8000-000000000002', '3c100000-0000-4000-8000-000000000002', 'admin');

create temporary table scope as select
  '3c200000-0000-4000-8000-000000000001'::uuid t1,
  (select id from public.locations where tenant_id = '3c200000-0000-4000-8000-000000000001') l1,
  '3c200000-0000-4000-8000-000000000002'::uuid t2,
  (select id from public.locations where tenant_id = '3c200000-0000-4000-8000-000000000002') l2;

select is(private.get_public_brand((select t1 from scope), (select l1 from scope)) ->> 'name', 'Brand One',
  'without a profile the restaurant name is used');
select is(private.get_public_brand((select t1 from scope), (select l1 from scope)) -> 'logo', 'null'::jsonb,
  'and there is no logo');
select is(private.get_public_brand(gen_random_uuid(), gen_random_uuid()), null, 'an unknown restaurant has no brand');

insert into private.business_profile_drafts (tenant_id, location_id, display_name, primary_color, secondary_color, updated_by)
values ((select t1 from scope), (select l1 from scope), 'La Parrilla', '#112233', '#EEEEEE', '3c100000-0000-4000-8000-000000000001');
create temporary table asset as select gen_random_uuid() id;
insert into private.business_media_assets (
  id, tenant_id, location_id, kind, status, content_type, source_size_bytes, stored_size_bytes,
  width, height, sha256, object_path, created_by)
select asset.id, (select t1 from scope), (select l1 from scope), 'logo', 'ready', 'image/png', 1000, 900,
  200, 100, repeat('ab', 32),
  'tenants/' || (select t1 from scope) || '/locations/' || (select l1 from scope) || '/business-profile/logo/' || asset.id || '.png',
  '3c100000-0000-4000-8000-000000000001'
from asset;

select is(private.get_public_brand((select t1 from scope), (select l1 from scope)) ->> 'name', 'La Parrilla',
  'the name of the profile wins');
select is(private.get_public_brand((select t1 from scope), (select l1 from scope)) ->> 'primaryColor', '#112233', 'with its colors');
select is(private.get_public_brand((select t1 from scope), (select l1 from scope)) -> 'logo', 'null'::jsonb,
  'a logo that is not chosen in the profile is not shown');

update private.business_profile_drafts set logo_asset_id = (select id from asset)
where tenant_id = (select t1 from scope);
select is(private.get_public_brand((select t1 from scope), (select l1 from scope)) -> 'logo' ->> 'version', repeat('ab', 8),
  'the chosen ready logo is returned, with a version');
select ok(private.get_public_brand((select t1 from scope), (select l1 from scope)) -> 'logo' ->> 'objectPath' ~ '^tenants/.+/business-profile/logo/.+\.png$',
  'and the place it is stored');

update private.business_media_assets set status = 'failed', stored_size_bytes = null where id = (select id from asset);
select is(private.get_public_brand((select t1 from scope), (select l1 from scope)) -> 'logo', 'null'::jsonb,
  'a logo that is not ready is not shown');

select is(private.get_public_brand((select t2 from scope), (select l2 from scope)) ->> 'name', 'Brand Two',
  'the other restaurant has its own brand');
select ok(private.get_public_brand((select t1 from scope), (select l1 from scope))::text !~* '@|account|email',
  'and nothing personal is ever in it');

select * from finish();
rollback;
