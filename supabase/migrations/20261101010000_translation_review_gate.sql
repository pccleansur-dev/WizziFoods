begin;

-- T32: text a machine translated carries `"review": "machine"` in the draft and stays a draft
-- until an administrator approves it (the editor removes the mark). A catalog that still has
-- such text cannot be published, so the published snapshot never contains the mark and the
-- diner keeps reading exactly the shape it always read.
create or replace function private.catalog_publication_issues(
  target_snapshot jsonb,
  required_languages text[]
)
returns text[]
language sql
immutable
set search_path = ''
as $$
  with localized_items as (
    select category as item
    from jsonb_array_elements(target_snapshot -> 'categories') category
    union all
    select product as item
    from jsonb_array_elements(target_snapshot -> 'products') product
    union all
    select variant as item
    from jsonb_array_elements(target_snapshot -> 'products') product
    cross join lateral jsonb_array_elements(product -> 'variants') variant
  )
  select array_remove(array[
    case
      when jsonb_array_length(target_snapshot -> 'categories') = 0
      then 'MISSING_CATEGORY'
    end,
    case
      when jsonb_array_length(target_snapshot -> 'sectors') = 0
      then 'MISSING_SECTOR'
    end,
    case
      when jsonb_array_length(target_snapshot -> 'products') = 0
      then 'MISSING_PRODUCT'
    end,
    case
      when exists (
        select 1
        from localized_items localized
        cross join unnest(required_languages) required(language)
        where not exists (
          select 1
          from jsonb_array_elements(localized.item -> 'content') content
          where content ->> 'language' = required.language
            and length(btrim(content ->> 'title')) > 0
        )
      )
      then 'MISSING_LOCALIZED_CONTENT'
    end,
    case
      when exists (
        select 1
        from localized_items localized
        cross join lateral jsonb_array_elements(localized.item -> 'content') content
        where content ->> 'review' = 'machine'
      )
      then 'PENDING_TRANSLATION_REVIEW'
    end
  ], null)::text[];
$$;

commit;
