begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(58);

insert into auth.users (id) values ('2f100000-0000-4000-8000-000000000001'), ('2f100000-0000-4000-8000-000000000002');
insert into public.tenants (id, slug, name, status) values
  ('2f200000-0000-4000-8000-000000000001', 'diner-one', 'Diner One', 'active'),
  ('2f200000-0000-4000-8000-000000000002', 'diner-two', 'Diner Two', 'active');
insert into public.tenant_memberships (tenant_id, user_id, role)
values ('2f200000-0000-4000-8000-000000000001', '2f100000-0000-4000-8000-000000000001', 'admin'),
  ('2f200000-0000-4000-8000-000000000002', '2f100000-0000-4000-8000-000000000002', 'admin');

create temporary table scope as select
  '2f200000-0000-4000-8000-000000000001'::uuid t1,
  (select id from public.locations where tenant_id = '2f200000-0000-4000-8000-000000000001') l1,
  '2f200000-0000-4000-8000-000000000002'::uuid t2;

-- One floor with two tables (1, 2) for tenant one.
select private.save_floor_plan(
  (select t1 from scope), (select l1 from scope), '2f100000-0000-4000-8000-000000000001',
  '2f300000-0000-4000-8000-000000000001', 0,
  jsonb_build_object(
    'floors', jsonb_build_array(jsonb_build_object('id','2f400000-0000-4000-8000-000000000001','name','Planta baja','position',0,'shortName',null)),
    'sectors', jsonb_build_array(jsonb_build_object('id','2f500000-0000-4000-8000-000000000001','name','Salón','position',0)),
    'tables', jsonb_build_array(
      jsonb_build_object('id','2f600000-0000-4000-8000-000000000001','label','1','sectorId','2f500000-0000-4000-8000-000000000001','floorId','2f400000-0000-4000-8000-000000000001','shape','square','x',40,'y',40,'width',100,'height',100,'rotation',0,'seatCount',4,'seatLayout','perimeter'),
      jsonb_build_object('id','2f600000-0000-4000-8000-000000000002','label','2','sectorId','2f500000-0000-4000-8000-000000000001','floorId','2f400000-0000-4000-8000-000000000001','shape','square','x',200,'y',40,'width',100,'height',100,'rotation',0,'seatCount',4,'seatLayout','perimeter')),
    'groups', '[]'::jsonb));
create temporary table staff as select (private.create_staff_member(
  (select t1 from scope), (select l1 from scope), '2f100000-0000-4000-8000-000000000001',
  'marta', 'Marta', 'manager', 'scrypt-v1$c2FsdA$aGFzaA', '{}') ->> 'id')::uuid manager;

create function pg_temp.token_of(wanted text) returns text language sql as $$
  select qr.token from private.floor_table_qr_codes qr where qr.table_id = wanted::uuid and qr.status = 'active'
$$;
create function pg_temp.h(value text) returns bytea language sql as $$ select extensions.digest(value, 'sha256') $$;

-- Accounts ------------------------------------------------------------------------------
create temporary table acc as select
  private.upsert_diner_account(repeat('a', 64), 'Ana@Example.com') ana,
  private.upsert_diner_account(repeat('b', 64), 'beto@example.com') beto;

select isnt((select ana from acc), (select beto from acc), 'two Google identities, two accounts');
select is(private.upsert_diner_account(repeat('a', 64), 'ana@example.com'), (select ana from acc),
  'the same Google identity is the same account');
select is((select email from private.diner_accounts where id = (select ana from acc)), 'ana@example.com',
  'the email is stored normalized');

-- Isolation of the tables and functions ------------------------------------------------
select ok(not has_table_privilege('authenticator', 'private.diner_accounts', 'select'),
  'the API role cannot read accounts directly');
select ok(not has_table_privilege('authenticated', 'private.diner_profile_links', 'select'),
  'authenticated cannot read the account-profile bridge');
select ok(not has_function_privilege('authenticator', 'private.diner_consent_state(uuid,uuid,text)', 'execute'),
  'helpers are not callable by the API role');

-- Login exchange: single use, tenant bound, expiring --------------------------------------
select private.create_diner_login_exchange((select ana from acc), (select t1 from scope), pg_temp.h('code-1'));
select is(private.redeem_diner_login((select t2 from scope), pg_temp.h('code-1'), pg_temp.h('s-x')), null,
  'a code from another restaurant host does not redeem');
select is(private.redeem_diner_login((select t1 from scope), pg_temp.h('code-1'), pg_temp.h('s-ana-1')), (select ana from acc),
  'the code redeems once at its own restaurant');
select is(private.redeem_diner_login((select t1 from scope), pg_temp.h('code-1'), pg_temp.h('s-ana-2')), null,
  'the code cannot be used twice');
select is(private.redeem_diner_login((select t1 from scope), pg_temp.h('unknown'), pg_temp.h('s-ana-3')), null,
  'an unknown code is just null');
select private.create_diner_login_exchange((select ana from acc), (select t1 from scope), pg_temp.h('code-old'));
update private.diner_login_exchanges set expires_at = now() - interval '1 second', created_at = now() - interval '61 seconds'
where code_hash = pg_temp.h('code-old');
select is(private.redeem_diner_login((select t1 from scope), pg_temp.h('code-old'), pg_temp.h('s-ana-4')), null,
  'an expired code does not redeem');

-- Sessions ----------------------------------------------------------------------------
select is(private.resolve_diner_session((select t1 from scope), pg_temp.h('s-ana-1')), (select ana from acc),
  'the session resolves at its restaurant');
select is(private.resolve_diner_session((select t2 from scope), pg_temp.h('s-ana-1')), null,
  'the session does not resolve at another restaurant');
select private.revoke_diner_session((select t1 from scope), pg_temp.h('s-ana-1'));
select is(private.resolve_diner_session((select t1 from scope), pg_temp.h('s-ana-1')), null,
  'a revoked session no longer resolves');

-- Profiles are per restaurant ----------------------------------------------------------
select is(private.get_diner_profile((select t1 from scope), (select ana from acc)) -> 'profile', 'null'::jsonb,
  'no profile before the diner creates one');
select is(jsonb_array_length(private.get_diner_profile((select t1 from scope), (select ana from acc)) -> 'texts'), 2,
  'the legal texts are listed even without a profile');
select lives_ok($$select private.save_diner_profile((select t1 from scope), (select ana from acc), 'Ana', null)$$,
  'creates the profile at restaurant one');
select lives_ok($$select private.save_diner_profile((select t2 from scope), (select ana from acc), 'Anita', '+5491112345678')$$,
  'creates a separate profile at restaurant two');
select isnt(
  private.diner_profile_id_of((select t1 from scope), (select ana from acc)),
  private.diner_profile_id_of((select t2 from scope), (select ana from acc)),
  'the profile ids are opaque and different per restaurant');
select throws_ok($$select private.save_diner_profile((select t1 from scope), gen_random_uuid(), 'X', null)$$,
  'PT281', null, 'an unknown account cannot create a profile');

-- Restaurants only see their own profile, never the email ---------------------------------
select private.save_diner_profile((select t1 from scope), (select beto from acc), 'Beto', null);
select is(jsonb_array_length(private.list_tenant_diner_profiles((select t1 from scope))), 2,
  'restaurant one sees its two profiles');
select is(jsonb_array_length(private.list_tenant_diner_profiles((select t2 from scope))), 1,
  'restaurant two sees only its own one');
select is(
  (select count(*)::integer from jsonb_array_elements(private.list_tenant_diner_profiles((select t1 from scope))) p
   where p::text ~* '(example\.com|account|email|google)'),
  0, 'no tenant listing carries an email, account id or Google data');
select is(
  (select count(*)::integer from jsonb_array_elements(private.list_tenant_diner_profiles((select t2 from scope))) p
   where p ->> 'displayName' = 'Ana'), 0, 'restaurant two does not see the name used at restaurant one');

-- Consents: separate, versioned, append-only, revocable ----------------------------------
create function pg_temp.consent(tenant uuid, account uuid, command text, kind text, action text, version integer default 1)
returns jsonb language sql as $$
  select private.record_diner_consent(tenant, account, command::uuid, kind, action, version, 'profile')
$$;
select throws_ok($$select pg_temp.consent((select t1 from scope), (select ana from acc), '2f700000-0000-4000-8000-000000000001', 'whatsapp_verified', 'granted')$$,
  'PT284', null, 'WhatsApp consent needs a phone');
select throws_ok($$select pg_temp.consent((select t1 from scope), (select ana from acc), '2f700000-0000-4000-8000-000000000002', 'marketing', 'granted', 7)$$,
  'PT283', null, 'a consent against an unknown text version is refused');
select throws_ok($$select pg_temp.consent((select t1 from scope), (select ana from acc), '2f700000-0000-4000-8000-000000000003', 'marketing', 'revoked')$$,
  'PT285', null, 'revoking something never granted is refused');
select lives_ok($$select pg_temp.consent((select t1 from scope), (select ana from acc), '2f700000-0000-4000-8000-000000000004', 'marketing', 'granted')$$,
  'grants marketing');
select is(private.get_diner_profile((select t1 from scope), (select ana from acc)) #>> '{profile,consents,marketing,granted}', 'true',
  'marketing is granted');
select is(private.get_diner_profile((select t1 from scope), (select ana from acc)) #>> '{profile,consents,whatsapp_verified,granted}', 'false',
  'WhatsApp is a different consent and stays off');
select is(private.get_diner_profile((select t2 from scope), (select ana from acc)) #>> '{profile,consents,marketing,granted}', 'false',
  'consent at restaurant one does not carry to restaurant two');
select lives_ok($$select pg_temp.consent((select t1 from scope), (select ana from acc), '2f700000-0000-4000-8000-000000000004', 'marketing', 'granted')$$,
  'the same command id is idempotent');
select throws_ok($$select pg_temp.consent((select t1 from scope), (select ana from acc), '2f700000-0000-4000-8000-000000000004', 'marketing', 'revoked')$$,
  'PT286', null, 'a command id reused with other data is refused');
select is((select count(*)::integer from private.diner_consent_events where profile_id = private.diner_profile_id_of((select t1 from scope), (select ana from acc))),
  1, 'only one event was appended');
select lives_ok($$select pg_temp.consent((select t1 from scope), (select ana from acc), '2f700000-0000-4000-8000-000000000005', 'marketing', 'revoked')$$,
  'revokes marketing');
select is(private.get_diner_profile((select t1 from scope), (select ana from acc)) #>> '{profile,consents,marketing,granted}', 'false',
  'marketing is revoked');
select is((select count(*)::integer from private.diner_consent_events where profile_id = private.diner_profile_id_of((select t1 from scope), (select ana from acc))),
  2, 'revoking appended a row instead of editing');
select throws_ok($$update private.diner_consent_events set action = 'granted'$$, 'PT209', null, 'consent events cannot be edited');
select throws_ok($$delete from private.diner_consent_events$$, 'PT209', null, 'consent events cannot be deleted');
select throws_ok($$update private.diner_consent_texts set body = 'cambiado cambiado cambiado'$$, 'PT209', null, 'consent texts are immutable');

-- A newer legal text makes the old version stale and grants carry their version -----------
select pg_temp.consent((select t2 from scope), (select ana from acc), '2f700000-0000-4000-8000-000000000006', 'whatsapp_verified', 'granted');
insert into private.diner_consent_texts (tenant_id, kind, version, body)
values ((select t2 from scope), 'whatsapp_verified', 2, 'Texto legal nuevo del restaurante dos para WhatsApp.');
select throws_ok($$select pg_temp.consent((select t2 from scope), (select ana from acc), '2f700000-0000-4000-8000-000000000007', 'whatsapp_verified', 'granted', 1)$$,
  'PT283', null, 'the old text version can no longer be granted');
select throws_ok($$select private.save_diner_profile((select t2 from scope), (select ana from acc), 'Anita', '+5491100000000')$$,
  'PT284', null, 'the phone cannot change while the WhatsApp consent is granted');
select is(private.list_tenant_diner_profiles((select t2 from scope)) -> 0 ->> 'whatsappPhone', '+5491112345678',
  'the restaurant sees the phone while the WhatsApp consent is granted');

-- Session links: to the session, never the table; concurrent-safe -------------------------
create temporary table sess as select
  private.ensure_table_session((select t1 from scope), (select l1 from scope), '2f600000-0000-4000-8000-000000000001', (select manager from staff)) id;
select is(private.link_diner_to_session((select t1 from scope), (select l1 from scope), (select ana from acc), pg_temp.token_of('2f600000-0000-4000-8000-000000000002')) ->> 'linked', 'false',
  'a table without an open session links to nothing');
select is(private.link_diner_to_session((select t1 from scope), (select l1 from scope), (select ana from acc), pg_temp.token_of('2f600000-0000-4000-8000-000000000001')) ->> 'linked', 'true',
  'links to the open session of the table');
select lives_ok($$select private.link_diner_to_session((select t1 from scope), (select l1 from scope), (select ana from acc), pg_temp.token_of('2f600000-0000-4000-8000-000000000001'))$$,
  'linking the same account twice is harmless');
select is((select count(*)::integer from private.diner_session_links), 1, 'a single link exists');

-- Export and logical anonymization ----------------------------------------------------------
select is(jsonb_array_length(private.export_diner_data((select ana from acc)) -> 'restaurants'), 2,
  'the export lists both restaurants of the account');
select is(private.export_diner_data((select ana from acc)) #>> '{account,email}', 'ana@example.com',
  'the export includes the diner own email');
select is(private.export_diner_data((select beto from acc)) ->> 'restaurants' ~ 'Ana', false,
  'the export of another account carries nothing of Ana');

select lives_ok($$select private.anonymize_diner_account((select ana from acc))$$, 'anonymizes the account');
select is((select (email is null and google_sub_hash is null and anonymized_at is not null) from private.diner_accounts where id = (select ana from acc)),
  true, 'the account holds no personal data');
select is((select count(*)::integer from private.diner_profiles where display_name = 'Comensal anonimizado' and whatsapp_phone is null), 2,
  'both profiles lost name and phone');
select is(private.resolve_diner_session((select t1 from scope), pg_temp.h('s-ana-1')), null,
  'sessions of an anonymized account do not resolve');
select is((select count(*)::integer from private.diner_session_links), 1,
  'the history keeps its session reference');
select is((select count(*)::integer from private.diner_consent_events where source = 'anonymization'), 1,
  'the WhatsApp consent granted was revoked by appending a row');
select throws_ok($$select private.save_diner_profile((select t1 from scope), (select ana from acc), 'Ana', null)$$,
  'PT281', null, 'an anonymized account cannot be used again');
select isnt(private.upsert_diner_account(repeat('a', 64), 'ana@example.com'), (select ana from acc),
  'the same Google identity afterwards is a brand new account');

select * from finish();
rollback;
