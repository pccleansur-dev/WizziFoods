begin;

drop trigger if exists validate_business_profile_media_before_write
on private.business_profile_drafts;
drop function if exists private.validate_business_profile_media();

commit;
