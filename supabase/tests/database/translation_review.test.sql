begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(5);

create function pg_temp.snapshot(review text) returns jsonb language sql as $$
  select jsonb_build_object(
    'sectors', jsonb_build_array(jsonb_build_object('id', 's')),
    'categories', jsonb_build_array(jsonb_build_object('id', 'c', 'content', jsonb_build_array(
      jsonb_build_object('language', 'es', 'title', 'Principales', 'description', ''),
      jsonb_build_object('language', 'en', 'title', 'Main dishes', 'description', '')))),
    'products', jsonb_build_array(jsonb_build_object('id', 'p',
      'content', jsonb_build_array(
        jsonb_build_object('language', 'es', 'title', 'Milanesa', 'description', ''),
        case when review is null
          then jsonb_build_object('language', 'en', 'title', 'Milanese', 'description', '')
          else jsonb_build_object('language', 'en', 'title', 'Milanese', 'description', '', 'review', review) end),
      'variants', jsonb_build_array(jsonb_build_object('id', 'v', 'content', jsonb_build_array(
        jsonb_build_object('language', 'es', 'title', 'Napolitana', 'description', ''),
        jsonb_build_object('language', 'en', 'title', 'Neapolitan', 'description', ''))))))
  );
$$;

select is(private.catalog_publication_issues(pg_temp.snapshot(null), array['es', 'en']), array[]::text[],
  'a reviewed bilingual catalog is ready');
select is(private.catalog_publication_issues(pg_temp.snapshot('machine'), array['es', 'en']),
  array['PENDING_TRANSLATION_REVIEW'],
  'text a machine wrote and nobody approved blocks the publication');
select is(private.catalog_publication_issues(pg_temp.snapshot('machine'), array['es']),
  array['PENDING_TRANSLATION_REVIEW'],
  'even in a language the business no longer requires');
select is(private.catalog_publication_issues(pg_temp.snapshot('human'), array['es', 'en']), array[]::text[],
  'only the machine mark blocks');
select is(private.catalog_publication_issues(
  jsonb_set(pg_temp.snapshot('machine'), '{categories,0,content,1,review}', '"machine"'), array['es', 'en']),
  array['PENDING_TRANSLATION_REVIEW'],
  'marks in categories and variants count too, once');

select * from finish();
rollback;
