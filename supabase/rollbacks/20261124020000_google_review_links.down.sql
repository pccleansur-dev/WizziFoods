begin;
drop function if exists private.admin_google_review_link(uuid,uuid,uuid,boolean,text);
drop function if exists private.read_google_review_link(uuid,uuid);
drop table if exists private.google_review_links;
commit;
