begin;
alter table private.google_review_links drop constraint google_review_links_url_check;
alter table private.google_review_links add constraint google_review_links_url_check check (
  length(url) <= 1024 and url ~ '^https://(g\.page|maps\.app\.goo\.gl|search\.google\.com|maps\.google\.com|www\.google\.com|google\.com)/'
) not valid;
commit;
