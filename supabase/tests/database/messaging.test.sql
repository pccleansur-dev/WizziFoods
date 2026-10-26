begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(114);

insert into auth.users (id) values ('3d100000-0000-4000-8000-000000000001'), ('3d100000-0000-4000-8000-000000000002');
insert into public.tenants (id, slug, name, status) values
  ('3d200000-0000-4000-8000-000000000001', 'messaging-one', 'Messaging One', 'active'),
  ('3d200000-0000-4000-8000-000000000002', 'messaging-two', 'Messaging Two', 'active');
insert into public.tenant_memberships (tenant_id, user_id, role)
values ('3d200000-0000-4000-8000-000000000001', '3d100000-0000-4000-8000-000000000001', 'admin'),
  ('3d200000-0000-4000-8000-000000000002', '3d100000-0000-4000-8000-000000000002', 'admin');

create temporary table scope as select
  '3d200000-0000-4000-8000-000000000001'::uuid t1,
  (select id from public.locations where tenant_id = '3d200000-0000-4000-8000-000000000001') l1,
  '3d200000-0000-4000-8000-000000000002'::uuid t2,
  (select id from public.locations where tenant_id = '3d200000-0000-4000-8000-000000000002') l2;

create function pg_temp.member(username text, role text) returns uuid language sql as $$
  select (private.create_staff_member(
    (select t1 from scope), (select l1 from scope),
    '3d100000-0000-4000-8000-000000000001',
    username, initcap(username), role, 'scrypt-v1$c2FsdA$aGFzaA', '{}') ->> 'id')::uuid
$$;
create temporary table staff as select
  pg_temp.member('ana', 'waiter') ana,
  pg_temp.member('marta', 'manager') manager;
insert into public.staff_members (id, tenant_id, location_id, username, display_name, role, created_by)
values ('3d800000-0000-4000-8000-000000000001', (select t2 from scope), (select l2 from scope),
  'otra', 'Otra', 'manager', '3d100000-0000-4000-8000-000000000002');

-- Local time of the first location is moved so "now" falls at the wanted hour.
create function pg_temp.at_hour(wanted integer) returns void language plpgsql as $$
declare
  shift integer := wanted - extract(hour from now() at time zone 'UTC')::integer;
begin
  if shift > 14 then shift := shift - 24; end if;
  if shift < -12 then shift := shift + 24; end if;
  update public.locations set timezone = 'Etc/GMT' ||
    case when shift > 0 then '-' || shift::text when shift < 0 then '+' || (-shift)::text else '' end
  where id = (select l1 from scope);
end;
$$;

create temporary table people (tag text primary key, account uuid, profile uuid, tenant uuid);
create function pg_temp.diner(
  target_tenant uuid, tag text, phone text, whatsapp boolean, marketing boolean
) returns uuid language plpgsql as $$
declare
  acc uuid := private.upsert_diner_account(
    substr(md5(tag) || md5(tag || 'x'), 1, 64), tag || '@example.com');
  prof uuid;
begin
  perform private.save_diner_profile(target_tenant, acc, initcap(tag), phone);
  prof := private.diner_profile_id_of(target_tenant, acc);
  if whatsapp then
    perform private.record_diner_consent(
      target_tenant, acc, gen_random_uuid(), 'whatsapp_verified', 'granted', 1, 'profile');
  end if;
  if marketing then
    perform private.record_diner_consent(
      target_tenant, acc, gen_random_uuid(), 'marketing', 'granted', 1, 'profile');
  end if;
  insert into people values (tag, acc, prof, target_tenant);
  return prof;
end;
$$;
create function pg_temp.pid(tag text) returns uuid language sql as $$
  select profile from people where people.tag = pid.tag
$$;

create function pg_temp.mgr() returns uuid language sql as $$ select manager from staff $$;
create function pg_temp.overview() returns jsonb language sql as $$
  select private.get_messaging_overview((select t1 from scope), (select l1 from scope), pg_temp.mgr())
$$;
create function pg_temp.template(wanted text) returns uuid language sql as $$
  select id from private.whatsapp_templates
  where tenant_id = (select t1 from scope) and name = wanted
$$;
-- A confirmed one-off message for one person; returns the outbox id.
create function pg_temp.one_off(tag text, template_name text, confirm boolean default true)
returns uuid language plpgsql as $$
declare
  command uuid := gen_random_uuid();
begin
  perform private.propose_one_off_event(
    (select t1 from scope), (select l1 from scope), pg_temp.mgr(), command,
    pg_temp.template(template_name), array[pg_temp.pid(tag)], '["Hola"]');
  if confirm then
    perform private.decide_one_off_event(
      (select t1 from scope), (select l1 from scope), pg_temp.mgr(), command, 'confirm');
  end if;
  return (select id from private.messaging_outbox where batch_id = command);
end;
$$;
create function pg_temp.decision(outbox uuid, moment timestamptz default now()) returns text language sql as $$
  select d ->> 'action' || ':' || (d ->> 'reason')
  from (select private.messaging_send_decision(
    (select t1 from scope), (select l1 from scope), outbox, moment) d) x
$$;
create function pg_temp.status_of(outbox uuid) returns text language sql as $$
  select status from private.messaging_outbox where id = outbox
$$;

-- 1. Permissions and isolation -------------------------------------------------------------

select throws_ok(
  $$select private.get_messaging_overview((select t1 from scope), (select l1 from scope), (select ana from staff))$$,
  'PT222', null, 'a waiter cannot read messaging');
select throws_ok(
  $$select private.get_messaging_overview((select t1 from scope), (select l1 from scope), '3d800000-0000-4000-8000-000000000001')$$,
  'PT200', null, 'a manager of another business cannot reach this location');
select is(pg_temp.overview() -> 'connection', 'null'::jsonb, 'no connection yet: the module is simply off');
select is(jsonb_array_length(pg_temp.overview() -> 'automations'), 4, 'the four permanent automations are listed');

-- 2. Connection ----------------------------------------------------------------------------

select throws_ok(
  $$select private.set_whatsapp_sending((select t1 from scope), (select l1 from scope), pg_temp.mgr(), true)$$,
  'PT293', null, 'sending cannot be switched on without a connection');
select is(
  (private.connect_whatsapp((select t1 from scope), (select l1 from scope), pg_temp.mgr(),
    '10000000001', '20000000001', '+5491100000001', '\x0102'::bytea, 1::smallint)
   -> 'connection' ->> 'phoneNumberId'),
  '10000000001', 'the manager connects the number');
select is(pg_temp.overview() -> 'connection' ->> 'sendingEnabled', 'false',
  'real sending is off by default');
select ok(pg_temp.overview()::text !~* 'ciphertext|token', 'the overview never carries credentials');
select is(private.read_whatsapp_credentials((select t1 from scope), (select l1 from scope)) ->> 'keyVersion',
  '1', 'the sealed credential is readable server-side');
select is(private.read_whatsapp_credentials((select t2 from scope), (select l2 from scope)), null,
  'another business has no credential');
select throws_ok(
  $$select private.connect_whatsapp((select t2 from scope), (select l2 from scope), '3d800000-0000-4000-8000-000000000001',
    '10000000001', '20000000009', null, '\x03'::bytea, 1::smallint)$$,
  'PT294', null, 'a number is connected to one business only');
select lives_ok(
  $$select private.connect_whatsapp((select t2 from scope), (select l2 from scope), '3d800000-0000-4000-8000-000000000001',
    '10000000002', '20000000002', null, '\x03'::bytea, 1::smallint)$$,
  'the other business connects its own number');

-- 3. Templates -----------------------------------------------------------------------------

select lives_ok($$select private.upsert_whatsapp_templates(
  (select t1 from scope), (select l1 from scope), pg_temp.mgr(), jsonb_build_array(
    jsonb_build_object('name','premio_ganado','language','es_AR','category','operational','body','Hola {{1}}, ganaste {{2}}','status','approved'),
    jsonb_build_object('name','promo_semana','language','es_AR','category','promotional','body','Hola {{1}}, esta semana...','status','approved'),
    jsonb_build_object('name','promo_nueva','language','es_AR','category','promotional','body','Hola {{1}}','status','pending')))$$,
  'templates are synced');
select is(jsonb_array_length(pg_temp.overview() -> 'templates'), 3, 'three templates listed');
select is(jsonb_array_length(private.get_messaging_overview(
  (select t2 from scope), (select l2 from scope), '3d800000-0000-4000-8000-000000000001') -> 'templates'), 0,
  'the other business sees none of them');
select throws_ok($$select private.upsert_whatsapp_templates(
  (select t1 from scope), (select l1 from scope), pg_temp.mgr(),
  jsonb_build_array(jsonb_build_object('name','Mal Nombre','language','es_AR','category','promotional','body','x','status','approved')))$$,
  'PT297', null, 'a bad template is refused');
select is(
  (private.set_whatsapp_template_cost((select t1 from scope), (select l1 from scope), pg_temp.mgr(),
    pg_temp.template('promo_semana'), 4.5) -> 'templates' -> 2 ->> 'estimatedCostCents')::numeric,
  4.5, 'the estimated cost per message is stored per template');
select throws_ok($$select private.set_whatsapp_template_cost((select t1 from scope), (select l1 from scope), pg_temp.mgr(),
  pg_temp.template('promo_semana'), -1)$$, 'PT297', null, 'a negative cost is refused');

-- 4. Automations: approved once ------------------------------------------------------------

select throws_ok($$select private.save_messaging_automation((select t1 from scope), (select l1 from scope), pg_temp.mgr(),
  'birthday', pg_temp.template('promo_nueva'))$$, 'PT295', null, 'an unapproved template cannot be used');
select throws_ok($$select private.save_messaging_automation((select t1 from scope), (select l1 from scope), pg_temp.mgr(),
  'weekly_blast', pg_temp.template('promo_semana'))$$, 'PT296', null, 'only the four permanent automations exist');
select is(
  (select item ->> 'status' from jsonb_array_elements(private.save_messaging_automation(
    (select t1 from scope), (select l1 from scope), pg_temp.mgr(), 'reward_earned',
    pg_temp.template('premio_ganado')) -> 'automations') item where item ->> 'kind' = 'reward_earned'),
  'pending_approval', 'a configured automation waits for approval');
create temporary table auto as select
  (select item ->> 'id' from jsonb_array_elements(pg_temp.overview() -> 'automations') item
   where item ->> 'kind' = 'reward_earned')::uuid reward_earned;
select throws_ok($$select private.decide_messaging_automation((select t1 from scope), (select l1 from scope), pg_temp.mgr(),
  (select reward_earned from auto), 'resume')$$, 'PT296', null, 'cannot resume before the first approval');
select lives_ok($$select private.decide_messaging_automation((select t1 from scope), (select l1 from scope), pg_temp.mgr(),
  (select reward_earned from auto), 'approve')$$, 'the manager approves it once');
select is((select status from private.messaging_automations where id = (select reward_earned from auto)),
  'approved', 'and it is approved');
select throws_ok($$select private.decide_messaging_automation((select t1 from scope), (select l1 from scope), '3d800000-0000-4000-8000-000000000001',
  (select reward_earned from auto), 'approve')$$, 'PT200', null, 'another business cannot decide on it');
select lives_ok($$select private.upsert_whatsapp_templates(
  (select t1 from scope), (select l1 from scope), pg_temp.mgr(), jsonb_build_array(
    jsonb_build_object('name','premio_ganado','language','es_AR','category','operational','body','Hola {{1}}, ganaste {{2}}!','status','approved')))$$,
  're-sync with a changed text');
select is((select status from private.messaging_automations where id = (select reward_earned from auto)),
  'pending_approval', 'a changed template text asks for a new approval');
select lives_ok($$select private.decide_messaging_automation((select t1 from scope), (select l1 from scope), pg_temp.mgr(),
  (select reward_earned from auto), 'approve')$$, 'approved again');
select is((select status from private.messaging_automations where id = (select reward_earned from auto)),
  'approved', 'approved once more');
select lives_ok($$select private.decide_messaging_automation((select t1 from scope), (select l1 from scope), pg_temp.mgr(),
  (select reward_earned from auto), 'pause')$$, 'pause');
select is((select status from private.messaging_automations where id = (select reward_earned from auto)),
  'paused', 'an automation can be paused');
select lives_ok($$select private.decide_messaging_automation((select t1 from scope), (select l1 from scope), pg_temp.mgr(),
  (select reward_earned from auto), 'resume')$$, 'and resumed without asking again');

-- 5. The sending policy --------------------------------------------------------------------

do $$ begin
perform pg_temp.diner((select t1 from scope), 'paula', '+5491122220001', true, true);
perform pg_temp.diner((select t1 from scope), 'wally', '+5491122220002', true, false);
perform pg_temp.diner((select t1 from scope), 'nadia', '+5491122220003', false, false);
perform pg_temp.diner((select t1 from scope), 'anita', '+5491122220004', true, true);
perform pg_temp.diner((select t1 from scope), 'viejo', '+5491122220005', true, true);
perform pg_temp.diner((select t1 from scope), 'tope', '+5491122220006', true, true);
perform pg_temp.diner((select t2 from scope), 'paula2', '+5491122220001', true, true);
end $$;
do $$ begin perform pg_temp.at_hour(15); end $$;

create temporary table msg as select
  pg_temp.one_off('paula', 'promo_semana') paula_promo,
  pg_temp.one_off('wally', 'promo_semana') wally_promo,
  pg_temp.one_off('wally', 'premio_ganado') wally_oper,
  pg_temp.one_off('nadia', 'premio_ganado') nadia_oper,
  pg_temp.one_off('anita', 'promo_semana') anita_promo,
  pg_temp.one_off('viejo', 'promo_semana') viejo_promo,
  pg_temp.one_off('viejo', 'premio_ganado') viejo_oper,
  pg_temp.one_off('tope', 'promo_semana') tope_promo,
  pg_temp.one_off('tope', 'premio_ganado') tope_oper;

select is(pg_temp.decision((select paula_promo from msg)), 'block:sending_disabled',
  'with sending off (default) nothing leaves');
select lives_ok($$select private.set_whatsapp_sending((select t1 from scope), (select l1 from scope), pg_temp.mgr(), true)$$,
  'the manager switches sending on');
select is(pg_temp.decision((select paula_promo from msg)), 'send:ok', 'promotional with both consents inside the hours is allowed');
select is(pg_temp.decision((select wally_promo from msg)), 'block:marketing_consent_missing',
  'promotional without the marketing consent is blocked');
select is(pg_temp.decision((select wally_oper from msg)), 'send:ok', 'operational needs only the WhatsApp consent');
select is(pg_temp.decision((select nadia_oper from msg)), 'block:whatsapp_consent_missing',
  'operational without any consent is blocked');
select is(pg_temp.decision(gen_random_uuid()), 'block:unknown_message', 'an unknown message is blocked, never sent');
select throws_ok($$select pg_temp.one_off('paula', 'promo_nueva')$$, 'PT295', null,
  'a pending template can never be proposed');

do $$ begin perform pg_temp.at_hour(23); end $$;
select is(pg_temp.decision((select paula_promo from msg)), 'defer:outside_hours', 'promotional at 23:00 local waits');
select is(
  ((private.messaging_send_decision((select t1 from scope), (select l1 from scope),
    (select paula_promo from msg), now()) ->> 'retryAt')::timestamptz
   at time zone (select timezone from public.locations where id = (select l1 from scope)))::time,
  time '10:00', 'it waits until 10:00 local');
select is(pg_temp.decision((select wally_oper from msg)), 'send:ok', 'operational goes out right away at night');
do $$ begin perform pg_temp.at_hour(9); end $$;
select is(pg_temp.decision((select paula_promo from msg)), 'defer:outside_hours', 'promotional at 09:00 local waits');
do $$ begin perform pg_temp.at_hour(20); end $$;
select is(pg_temp.decision((select paula_promo from msg)), 'defer:outside_hours', '20:00 local is already outside');
do $$ begin perform pg_temp.at_hour(10); end $$;
select is(pg_temp.decision((select paula_promo from msg)), 'send:ok', '10:00 local is inside');
do $$ begin perform pg_temp.at_hour(15); end $$;

select is(pg_temp.decision(pg_temp.one_off('paula', 'promo_semana', false)), 'block:not_confirmed',
  'an unconfirmed one-off event is blocked');

-- Weekly and monthly allowance (rolling 7 and 30 days) per person and restaurant.
insert into private.messaging_outbox (tenant_id, location_id, profile_id, origin, batch_id, event_key,
  template_id, template_name, template_language, category, status, sent_at)
select (select t1 from scope), (select l1 from scope), pg_temp.pid('tope'), 'one_off', gen_random_uuid(),
  'old:' || n, pg_temp.template('promo_semana'), 'promo_semana', 'es_AR', 'promotional', 'sent',
  now() - interval '2 days'
from generate_series(1, 2) n;
select is(pg_temp.decision((select tope_promo from msg)), 'block:weekly_cap', 'two promotional messages in a week is the limit');
select is(pg_temp.decision((select tope_oper from msg)), 'send:ok', 'operational ones spend no allowance');
update private.messaging_outbox set sent_at = now() - interval '8 days'
where profile_id = pg_temp.pid('tope') and event_key like 'old:%';
select is(pg_temp.decision((select tope_promo from msg)), 'send:ok', 'the week rolls over');
insert into private.messaging_outbox (tenant_id, location_id, profile_id, origin, batch_id, event_key,
  template_id, template_name, template_language, category, status, sent_at)
select (select t1 from scope), (select l1 from scope), pg_temp.pid('tope'), 'one_off', gen_random_uuid(),
  'older:' || n, pg_temp.template('promo_semana'), 'promo_semana', 'es_AR', 'promotional', 'delivered',
  now() - interval '9 days'
from generate_series(1, 6) n;
select is(pg_temp.decision((select tope_promo from msg)), 'block:monthly_cap', 'eight in a month is the limit');
select is(pg_temp.decision((select tope_oper from msg)), 'send:ok', 'operational still goes out');

-- Twelve months without activity stop promotions, not operational notices.
do $$
begin
  set local session_replication_role = replica;
  update private.diner_profiles set created_at = now() - interval '13 months',
    updated_at = now() - interval '13 months' where id = pg_temp.pid('viejo');
  update private.diner_consent_events set occurred_at = now() - interval '13 months'
  where profile_id = pg_temp.pid('viejo');
  set local session_replication_role = origin;
end;
$$;
select is(pg_temp.decision((select viejo_promo from msg)), 'block:inactive_12_months',
  '12 months without activity stop promotions');
select is(pg_temp.decision((select viejo_oper from msg)), 'send:ok', 'operational notices are unaffected');
select lives_ok($$select private.record_diner_consent((select t1 from scope), (select account from people where tag = 'viejo'),
  gen_random_uuid(), 'marketing', 'revoked', 1, 'profile')$$, 'they revoke...');
select lives_ok($$select private.record_diner_consent((select t1 from scope), (select account from people where tag = 'viejo'),
  gen_random_uuid(), 'marketing', 'granted', 1, 'profile')$$, '...and renew the consent');
select is(pg_temp.decision((select viejo_promo from msg)), 'send:ok', 'renewing the consent is activity: promotions resume');

-- An anonymized profile never receives anything.
select lives_ok($$select private.anonymize_diner_account((select account from people where tag = 'anita'))$$, 'anonymize');
select is(pg_temp.decision((select anita_promo from msg)), 'block:anonymized_profile', 'an anonymized profile is blocked');

-- 6. BAJA ----------------------------------------------------------------------------------

select is(private.record_whatsapp_opt_out('10000000001', '+5491122220001'), 'applied', 'BAJA is applied');
select is(private.diner_consent_state((select t1 from scope), pg_temp.pid('paula'), 'marketing') ->> 'granted',
  'false', 'the marketing consent is revoked');
select is((select source from private.diner_consent_events where profile_id = pg_temp.pid('paula')
  and kind = 'marketing' order by id desc limit 1), 'whatsapp_optout', 'with an origin of its own');
select is(pg_temp.status_of((select paula_promo from msg)), 'blocked', 'what was waiting is blocked at once');
select is(pg_temp.decision(pg_temp.one_off('paula', 'promo_semana')), 'block:marketing_consent_missing',
  'later promotions are blocked');
select is(private.diner_consent_state((select t1 from scope), pg_temp.pid('paula'), 'whatsapp_verified') ->> 'granted',
  'true', 'the operational consent is untouched');
select is(private.diner_consent_state((select t2 from scope), pg_temp.pid('paula2'), 'marketing') ->> 'granted',
  'true', 'the same phone at another business keeps its consent');
select is(private.record_whatsapp_opt_out('10000000001', '+5491122220001'), 'unchanged', 'repeating BAJA changes nothing');
select is(private.record_whatsapp_opt_out('99999999999', '+5491122220001'), 'unknown_number', 'an unknown number is ignored');
select is(private.record_whatsapp_opt_out('10000000001', 'not-a-phone'), 'ignored', 'a malformed sender is ignored');
select throws_ok($$update private.diner_consent_events set action = 'granted' where profile_id = pg_temp.pid('paula')$$,
  'PT209', null, 'consents stay append-only');

-- 7. Queue: claim, begin, finish, retries --------------------------------------------------

create temporary table q as select pg_temp.one_off('tope', 'premio_ganado') op;
update private.messaging_outbox set next_attempt_at = now() - interval '1 second';
select ok(jsonb_array_length(private.claim_messaging_outbox(100, 60)) >= 1, 'due messages are claimed');
select is(jsonb_array_length(private.claim_messaging_outbox(100, 60)), 0, 'a claimed message is invisible to other workers');
select is(private.begin_messaging_send((select t1 from scope), (select l1 from scope), (select op from q)) ->> 'action',
  'send', 'the first worker starts the send');
select is(private.begin_messaging_send((select t1 from scope), (select l1 from scope), (select op from q)) ->> 'action',
  'skip', 'the second one on the same message skips');
select is(pg_temp.status_of((select op from q)), 'sending', 'sending');
select is(private.finish_messaging_send((select t1 from scope), (select l1 from scope), (select op from q),
  'transient_failure', null, 'timeout') ->> 'status', 'queued', 'a transient failure goes back to the queue');
select ok((select next_attempt_at from private.messaging_outbox where id = (select op from q)) > now() + interval '20 seconds',
  'after a waiting time');
select is((select attempts from private.messaging_outbox where id = (select op from q)), 1, 'the attempt is counted');
update private.messaging_outbox set next_attempt_at = now() where id = (select op from q);
select is(private.begin_messaging_send((select t1 from scope), (select l1 from scope), (select op from q)) ->> 'attempt',
  '2', 'second attempt');
select is(private.finish_messaging_send((select t1 from scope), (select l1 from scope), (select op from q),
  'transient_failure', null, 'timeout') ->> 'status', 'queued', 'fails again');
select ok((select next_attempt_at from private.messaging_outbox where id = (select op from q)) > now() + interval '50 seconds',
  'the waiting time grows');
update private.messaging_outbox set attempts = 4, next_attempt_at = now() where id = (select op from q);
select is(private.begin_messaging_send((select t1 from scope), (select l1 from scope), (select op from q)) ->> 'attempt',
  '5', 'fifth and last attempt');
select is(private.finish_messaging_send((select t1 from scope), (select l1 from scope), (select op from q),
  'transient_failure', null, 'timeout') ->> 'status', 'failed', 'out of attempts it fails for good');
select is(private.finish_messaging_send((select t1 from scope), (select l1 from scope), (select op from q),
  'sent', 'wamid.late', null) ->> 'applied', 'false', 'a closed message cannot be finished again');

create temporary table r as select pg_temp.one_off('wally', 'premio_ganado') op;
update private.messaging_outbox set next_attempt_at = now() - interval '1 second' where id = (select op from r);
do $$ begin perform private.begin_messaging_send((select t1 from scope), (select l1 from scope), (select op from r)); end $$;
select is(private.finish_messaging_send((select t1 from scope), (select l1 from scope), (select op from r),
  'sent', 'wamid.AAA', null) ->> 'status', 'sent', 'a sent message keeps the provider id');
select is(private.record_messaging_delivery('10000000001', 'wamid.AAA', 'delivered', null), 'applied', 'delivery is recorded');
select is(pg_temp.status_of((select op from r)), 'delivered', 'the message is delivered');
select is(private.record_messaging_delivery('10000000001', 'wamid.AAA', 'delivered', null), 'unchanged', 'a repeated status changes nothing');
select is(private.record_messaging_delivery('10000000002', 'wamid.AAA', 'delivered', null), 'unknown_message',
  'another business cannot touch it');
select is(private.record_messaging_delivery('99999999999', 'wamid.AAA', 'delivered', null), 'unknown_number', 'unknown number');
select is(private.claim_messaging_webhook_event('evt-1', 'status'), 'new', 'webhook event seen once');
select is(private.claim_messaging_webhook_event('evt-1', 'status'), 'retry', 'unfinished: retried');
select lives_ok($$select private.finish_messaging_webhook_event('evt-1', 'applied')$$, 'finished');
select is(private.claim_messaging_webhook_event('evt-1', 'status'), 'duplicate', 'and then a duplicate');

-- A message left "sending" with an expired lease is never sent again.
create temporary table s as select pg_temp.one_off('wally', 'premio_ganado') op;
update private.messaging_outbox set status = 'sending', attempts = 1, sent_at = now() - interval '1 hour',
  locked_until = now() - interval '1 minute' where id = (select op from s);
do $$ begin perform private.claim_messaging_outbox(10, 60); end $$;
select is(pg_temp.status_of((select op from s)), 'failed', 'a lost lease closes the message as failed');
select is((select last_error from private.messaging_outbox where id = (select op from s)), 'lost_lease', 'with its reason');

-- 8. History -------------------------------------------------------------------------------

select ok((select count(*) from private.messaging_events where kind = 'blocked' and reason = 'opt_out') >= 1,
  'blocked messages leave an event with the reason');
select ok(exists (select 1 from private.messaging_events where kind = 'retry_scheduled'), 'retries leave events');
select throws_ok($$update private.messaging_events set reason = 'x'$$, 'PT209', null, 'events are append-only');
select throws_ok($$delete from private.messaging_outbox where id = (select op from s)$$, 'PT209', null, 'the outbox is never deleted');
select is(jsonb_array_length(private.list_messaging_events(
  (select t2 from scope), (select l2 from scope), '3d800000-0000-4000-8000-000000000001', 50)), 0,
  'the other business has no history of ours');
select ok(private.list_messaging_events((select t1 from scope), (select l1 from scope), pg_temp.mgr(), 50)::text !~ '@|account',
  'the log carries no email and no account id');

-- 9. Events that create messages -----------------------------------------------------------

insert into private.loyalty_rewards (tenant_id, location_id, profile_id, reward_kind, reward_value, expires_at)
values ((select t1 from scope), (select l1 from scope), pg_temp.pid('wally'), 'percent', 1000, now() + interval '30 days');
select is((select count(*) from private.messaging_outbox where event_key like 'reward_earned:%'), 1::bigint,
  'an earned reward queues its notice (operational, approved automation)');
insert into private.loyalty_rewards (tenant_id, location_id, profile_id, reward_kind, reward_value, expires_at)
values ((select t1 from scope), (select l1 from scope), pg_temp.pid('nadia'), 'percent', 1000, now() + interval '30 days');
select is((select count(*) from private.messaging_outbox where event_key like 'reward_earned:%'), 1::bigint,
  'a person without consent gets nothing queued, and the reward is still granted');
select lives_ok($$select private.save_messaging_automation((select t1 from scope), (select l1 from scope), pg_temp.mgr(),
  'reward_expiring', pg_temp.template('promo_semana'))$$, 'configure the expiring-reward automation');
select is(private.enqueue_due_messaging_automations() ->> 'queued', '0', 'an unapproved automation queues nothing');
do $$ begin perform private.decide_messaging_automation((select t1 from scope), (select l1 from scope), pg_temp.mgr(),
  (select id from private.messaging_automations where kind = 'reward_expiring'), 'approve'); end $$;
insert into private.loyalty_rewards (tenant_id, location_id, profile_id, reward_kind, reward_value, expires_at)
values ((select t1 from scope), (select l1 from scope), pg_temp.pid('viejo'), 'amount', 50000, now() + interval '2 days');
select is(private.enqueue_due_messaging_automations() ->> 'queued', '1', 'a reward about to expire queues one notice');
select is(private.enqueue_due_messaging_automations() ->> 'queued', '0', 'and only once');

-- 10. Disconnecting ------------------------------------------------------------------------

select lives_ok($$select private.disconnect_whatsapp((select t1 from scope), (select l1 from scope), pg_temp.mgr())$$, 'disconnect');
select is(private.read_whatsapp_credentials((select t1 from scope), (select l1 from scope)), null, 'the credential is gone');
select is((select count(*) from private.whatsapp_templates where tenant_id = (select t1 from scope)), 0::bigint, 'templates are gone');
select is((select count(*) from private.messaging_outbox where tenant_id = (select t1 from scope)
  and status in ('queued', 'awaiting_confirmation')), 0::bigint, 'nothing is left waiting');
select is((select count(*) from private.messaging_automations where tenant_id = (select t1 from scope)
  and status <> 'pending_approval'), 0::bigint, 'automations need approval again');
select is(private.read_whatsapp_credentials((select t2 from scope), (select l2 from scope)) ->> 'phoneNumberId', '10000000002',
  'the other business keeps its own connection');

select * from finish();
rollback;
