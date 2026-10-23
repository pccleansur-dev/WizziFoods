begin;

drop function if exists private.get_business_profile_draft(uuid, uuid, uuid);
drop function if exists private.save_business_profile_draft(
  uuid, uuid, uuid, text, text, text, text, text, text[], text, text, text,
  text, text, uuid, uuid, uuid[]
);
drop table if exists private.published_business_profiles;
drop table if exists private.business_profile_drafts;

commit;
