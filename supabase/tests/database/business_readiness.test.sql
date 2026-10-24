begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(32);

insert into auth.users (id)
values
  ('d1000000-0000-4000-8000-000000000001'),
  ('d2000000-0000-4000-8000-000000000002');

insert into public.tenants (id, slug, name, status)
values
  ('d3000000-0000-4000-8000-000000000003', 'ready-one', 'Ready One', 'draft'),
  ('d4000000-0000-4000-8000-000000000004', 'ready-two', 'Ready Two', 'draft');

insert into public.tenant_memberships (tenant_id, user_id, role)
values
  ('d3000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000001', 'admin'),
  ('d4000000-0000-4000-8000-000000000004', 'd2000000-0000-4000-8000-000000000002', 'admin');

create temporary table scope as
select
  'd3000000-0000-4000-8000-000000000003'::uuid as t1,
  (select id from public.locations where tenant_id = 'd3000000-0000-4000-8000-000000000003') as l1,
  'd4000000-0000-4000-8000-000000000004'::uuid as t2,
  (select id from public.locations where tenant_id = 'd4000000-0000-4000-8000-000000000004') as l2;

create function pg_temp.readiness(which integer default 1)
returns jsonb language sql as $$
  select case which
    when 1 then private.get_location_readiness((select t1 from scope), (select l1 from scope), 'd1000000-0000-4000-8000-000000000001')
    else private.get_location_readiness((select t2 from scope), (select l2 from scope), 'd2000000-0000-4000-8000-000000000002')
  end
$$;

create function pg_temp.publish()
returns jsonb language sql as $$
  select private.publish_location((select t1 from scope), (select l1 from scope), 'd1000000-0000-4000-8000-000000000001')
$$;

create function pg_temp.profile(phone text, address text, languages text[] default array['es'])
returns void language plpgsql as $$
begin
  perform private.save_business_profile_draft(
    (select t1 from scope), (select l1 from scope), 'd1000000-0000-4000-8000-000000000001',
    'Bar Uno', '', phone, address, '', languages, 'visual', 'serif',
    '#1F2937', '#F9FAFB', '#D97706', null, null, '{}'::uuid[]
  );
end $$;

create function pg_temp.catalog_draft()
returns void language plpgsql as $$
begin
  perform private.save_catalog_draft(
    (select t1 from scope), (select l1 from scope), 'd1000000-0000-4000-8000-000000000001',
    '{
      "baseRevision": null,
      "categories": [{"id":"d5000000-0000-4000-8000-000000000005","position":0,"content":[{"language":"es","title":"Principales","description":""}]}],
      "sectors": [{"id":"d6000000-0000-4000-8000-000000000006","position":0,"kind":"kitchen","name":"Cocina"}],
      "products": [{"id":"d7000000-0000-4000-8000-000000000007","categoryId":"d5000000-0000-4000-8000-000000000005","sectorId":"d6000000-0000-4000-8000-000000000006","position":0,"priceCents":125000,"imageAssetId":null,"content":[{"language":"es","title":"Milanesa","description":"Con papas"}],"variants":[]}]
    }'::jsonb
  );
end $$;

create function pg_temp.blockers(which integer default 1)
returns text language sql as $$
  select coalesce(string_agg(code, ',' order by code), '')
  from jsonb_array_elements_text(pg_temp.readiness(which) -> 'blockers') code
$$;

create function pg_temp.warnings(which integer default 1)
returns text language sql as $$
  select coalesce(string_agg(code, ',' order by code), '')
  from jsonb_array_elements_text(pg_temp.readiness(which) -> 'warnings') code
$$;

-- 1. A new business lists what is missing and explains nothing is saved by it.
select is(pg_temp.blockers(), 'CATALOG_NOT_PUBLISHED,FLOOR_NO_TABLES,PROFILE_MISSING',
  'a new business reports the missing steps (cash already satisfies payments)');
select is(pg_temp.warnings(), 'TEAM_EMPTY', 'no staff is only a warning');
select is(pg_temp.readiness() -> 'published', 'null'::jsonb, 'a new business is not published');
select throws_ok($$ select pg_temp.publish() $$, 'PT100', null,
  'publishing is refused while requirements are missing');
select is((select count(*)::int from private.audit_events where action = 'business.published'), 0,
  'a refused publication leaves no audit event');

-- 2. Authorization and tenant isolation.
select throws_ok($$
  select private.get_location_readiness((select t1 from scope), (select l1 from scope),
    'd2000000-0000-4000-8000-000000000002')
$$, '42501', null, 'an administrator of another tenant cannot read this readiness');
select throws_ok($$
  select private.publish_location((select t1 from scope), (select l1 from scope),
    'd2000000-0000-4000-8000-000000000002')
$$, '42501', null, 'an administrator of another tenant cannot publish this business');
select throws_ok($$
  select private.publish_location((select t2 from scope), (select l1 from scope),
    'd2000000-0000-4000-8000-000000000002')
$$, '42501', null, 'a location from another tenant is refused');
select is(pg_temp.blockers(2), 'CATALOG_NOT_PUBLISHED,FLOOR_NO_TABLES,PROFILE_MISSING',
  'the second tenant has its own readiness');

-- 3. Profile.
select lives_ok($$ select pg_temp.profile('', '') $$, 'the profile can be saved without contact data');
select is(pg_temp.blockers(), 'CATALOG_NOT_PUBLISHED,FLOOR_NO_TABLES,PROFILE_CONTACT_MISSING',
  'a profile without phone or address is incomplete');
select lives_ok($$ select pg_temp.profile('+54 11 5555 0000', '') $$, 'a phone is enough');
select is(pg_temp.blockers(), 'CATALOG_NOT_PUBLISHED,FLOOR_NO_TABLES', 'the profile requirement is met');

-- 4. Catalog: drafts and imports never count as published.
select lives_ok($$ select pg_temp.catalog_draft() $$, 'a catalog draft can be saved');
select is(pg_temp.blockers(), 'CATALOG_NOT_PUBLISHED,FLOOR_NO_TABLES',
  'an unpublished draft does not satisfy the catalog');
insert into private.catalog_imports (tenant_id, location_id, requester_id, idempotency_key, source_kind, status, draft)
values ((select t1 from scope), (select l1 from scope), 'd1000000-0000-4000-8000-000000000001',
  'd8000000-0000-4000-8000-000000000008', 'manual', 'review', '{"items":[]}'::jsonb);
select is(pg_temp.warnings(), 'CATALOG_IMPORTS_PENDING,TEAM_EMPTY', 'a pending import is reported as a warning');
select lives_ok($$ select private.publish_catalog((select t1 from scope), (select l1 from scope),
  'd1000000-0000-4000-8000-000000000001', 1) $$, 'the catalog is published explicitly');
select is(pg_temp.blockers(), 'FLOOR_NO_TABLES', 'only the floor plan remains');
select lives_ok($$ select pg_temp.profile('+54 11 5555 0000', '', array['es', 'en']) $$,
  'languages can change after publishing');
select is(pg_temp.blockers(), 'CATALOG_LANGUAGE_MISSING,FLOOR_NO_TABLES',
  'a new language the published catalog does not cover is reported');
select lives_ok($$ select pg_temp.profile('+54 11 5555 0000', '') $$, 'languages go back to Spanish only');

-- 5. Floor plan.
select lives_ok($$
  select private.save_floor_plan(
    (select t1 from scope), (select l1 from scope), 'd1000000-0000-4000-8000-000000000001',
    'd9000000-0000-4000-8000-000000000009', 0,
    jsonb_build_object(
      'floors', jsonb_build_array(jsonb_build_object('id','dc000000-0000-4000-8000-00000000000c','name','Planta baja','position',0,'shortName',null)),
      'sectors', jsonb_build_array(jsonb_build_object('id','da000000-0000-4000-8000-00000000000a','name','Salón','position',0)),
      'tables', jsonb_build_array(jsonb_build_object(
        'id','db000000-0000-4000-8000-00000000000b','label','1','sectorId','da000000-0000-4000-8000-00000000000a','floorId','dc000000-0000-4000-8000-00000000000c',
        'shape','rectangle','x',40,'y',40,'width',100,'height',80,'rotation',0,'seatCount',4,'seatLayout','perimeter')),
      'groups', '[]'::jsonb))
$$, 'a table with a QR is saved');
select is(pg_temp.blockers(), '', 'every requirement is met');

-- 6. Publication revalidates inside the transaction.
update private.floor_table_qr_codes
set status = 'revoked', revoked_at = now(), revoked_reason = 'rotated'
where tenant_id = (select t1 from scope);
select is(pg_temp.blockers(), 'FLOOR_TABLE_WITHOUT_QR', 'a table without a valid QR blocks');
select throws_ok($$ select pg_temp.publish() $$, 'PT100', null,
  'publish rechecks the QR even though the profile and catalog were fine');
select lives_ok($$ select private.rotate_floor_table_qr(
  (select t1 from scope), (select l1 from scope), 'd1000000-0000-4000-8000-000000000001',
  'db000000-0000-4000-8000-00000000000b') $$, 'the audited rotation issues a new valid QR');
select is(pg_temp.blockers(), '', 'the requirement is met again');
select ok((select prosrc from pg_proc where proname = 'publish_location') ~* 'for share',
  'publish locks what it validates so the minimums cannot change before commit');

-- 7. Publication.
select is((pg_temp.publish() -> 'published' ->> 'revision')::int, 1, 'the business is published');
select is((select count(*)::int from private.audit_events
  where tenant_id = (select t1 from scope) and action = 'business.published'
    and actor_id = 'd1000000-0000-4000-8000-000000000001'), 1,
  'publication is audited with the administrator');
select throws_ok($$ select pg_temp.publish() $$, 'PT101', null, 'publishing twice is refused');
select is(pg_temp.readiness(2) -> 'published', 'null'::jsonb, 'the other tenant stays unpublished');

select * from finish();
rollback;
