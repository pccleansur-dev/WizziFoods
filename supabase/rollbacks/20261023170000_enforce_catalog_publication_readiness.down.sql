begin;

create or replace function private.publish_catalog(
  target_tenant_id uuid,
  target_location_id uuid,
  target_requester_id uuid,
  expected_draft_revision integer
)
returns private.published_catalogs
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  current_published_revision integer;
  draft private.catalog_drafts%rowtype;
  publication private.published_catalogs%rowtype;
begin
  perform private.require_catalog_admin(
    target_tenant_id,
    target_location_id,
    target_requester_id
  );

  select current_draft.*
  into draft
  from private.catalog_drafts current_draft
  where current_draft.tenant_id = target_tenant_id
    and current_draft.location_id = target_location_id
  for update;

  if not found then
    raise exception 'catalog draft not found'
      using errcode = 'P0002';
  end if;

  if draft.revision <> expected_draft_revision then
    raise exception 'catalog draft revision changed'
      using errcode = '40001';
  end if;

  if not draft.is_dirty then
    raise exception 'catalog draft has no unpublished changes'
      using errcode = '22023';
  end if;

  select published.revision
  into current_published_revision
  from private.published_catalogs published
  where published.tenant_id = target_tenant_id
    and published.location_id = target_location_id
  order by published.revision desc
  limit 1;

  if draft.base_published_revision is distinct from current_published_revision then
    raise exception 'catalog draft is based on a stale publication'
      using errcode = '40001';
  end if;

  insert into private.published_catalogs (
    tenant_id,
    location_id,
    revision,
    source_draft_revision,
    snapshot,
    published_by
  ) values (
    target_tenant_id,
    target_location_id,
    coalesce(current_published_revision, 0) + 1,
    draft.revision,
    draft.snapshot,
    target_requester_id
  )
  returning * into publication;

  update private.catalog_drafts
  set
    base_published_revision = publication.revision,
    snapshot = jsonb_set(snapshot, '{baseRevision}', to_jsonb(publication.revision)),
    is_dirty = false,
    updated_at = statement_timestamp()
  where tenant_id = target_tenant_id
    and location_id = target_location_id;

  return publication;
end;
$$;

revoke all on function private.publish_catalog(uuid, uuid, uuid, integer)
from public, anon, authenticated;
grant execute on function private.publish_catalog(uuid, uuid, uuid, integer)
to authenticator;

drop function private.catalog_publication_issues(jsonb, text[]);

commit;
