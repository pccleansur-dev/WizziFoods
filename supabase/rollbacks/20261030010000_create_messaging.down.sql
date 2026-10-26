begin;

-- Destructive: drops the WhatsApp connection (sealed credentials), templates,
-- automations, outbox, history and webhook records. Diner profiles and consents stay.
-- Consents revoked through "BAJA" keep their rows; the old source check is restored
-- as NOT VALID so those rows (which cannot be edited) do not block the rollback.
drop trigger loyalty_rewards_enqueue_message on private.loyalty_rewards;

drop function private.decide_one_off_event(uuid, uuid, uuid, uuid, text);
drop function private.propose_one_off_event(uuid, uuid, uuid, uuid, uuid, uuid[], jsonb);
drop function private.decide_messaging_automation(uuid, uuid, uuid, uuid, text);
drop function private.save_messaging_automation(uuid, uuid, uuid, text, uuid);
drop function private.set_whatsapp_template_cost(uuid, uuid, uuid, uuid, numeric);
drop function private.upsert_whatsapp_templates(uuid, uuid, uuid, jsonb);
drop function private.set_whatsapp_sending(uuid, uuid, uuid, boolean);
drop function private.disconnect_whatsapp(uuid, uuid, uuid);
drop function private.connect_whatsapp(uuid, uuid, uuid, text, text, text, bytea, smallint);
drop function private.list_messaging_audience(uuid, uuid, uuid);
drop function private.list_messaging_events(uuid, uuid, uuid, integer);
drop function private.get_messaging_overview(uuid, uuid, uuid);
drop function private.require_messaging_manager(uuid, uuid, uuid);
drop function private.messaging_overview_json(uuid, uuid);
drop function private.messaging_template_json(private.whatsapp_templates);
drop function private.record_whatsapp_opt_out(text, text);
drop function private.record_messaging_delivery(text, text, text, text);
drop function private.finish_messaging_webhook_event(text, text);
drop function private.claim_messaging_webhook_event(text, text);
drop function private.enqueue_due_messaging_automations();
drop function private.on_reward_granted_enqueue_message();
drop function private.enqueue_messaging_event(uuid, uuid, uuid, text, text, jsonb);
drop function private.read_whatsapp_credentials(uuid, uuid);
drop function private.finish_messaging_send(uuid, uuid, uuid, text, text, text);
drop function private.begin_messaging_send(uuid, uuid, uuid);
drop function private.claim_messaging_outbox(integer, integer);
drop function private.log_messaging_event(private.messaging_outbox, text, text);
drop function private.messaging_send_decision(uuid, uuid, uuid, timestamptz);
drop function private.messaging_consent_ok(uuid, uuid, text);
drop function private.messaging_last_activity(uuid, uuid);

-- The outbox and history reject deletes on purpose; this rollback is deliberate.
alter table private.messaging_events disable trigger messaging_events_append_only;
alter table private.messaging_events disable trigger messaging_events_no_truncate;
alter table private.messaging_outbox disable trigger messaging_outbox_no_delete;
alter table private.messaging_outbox disable trigger messaging_outbox_no_truncate;
drop table private.messaging_webhook_events;
drop table private.messaging_events;
drop table private.messaging_outbox;
drop table private.messaging_automations;
drop table private.whatsapp_templates;
drop table private.whatsapp_connections;

alter table private.diner_consent_events
  drop constraint diner_consent_events_source_check;
alter table private.diner_consent_events
  add constraint diner_consent_events_source_check
  check (source in ('menu', 'profile', 'anonymization')) not valid;

commit;
