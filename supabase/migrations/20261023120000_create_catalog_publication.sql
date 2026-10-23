begin;

create table private.catalog_drafts (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  location_id uuid not null,
  revision integer not null default 1 check (revision > 0),
  base_published_revision integer check (base_published_revision > 0),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  is_dirty boolean not null default true,
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, location_id),
  foreign key (tenant_id, location_id)
    references public.locations(tenant_id, id)
    on delete cascade,
  foreign key (tenant_id, updated_by)
    references public.tenant_memberships(tenant_id, user_id)
    on delete restrict
);

create table private.published_catalogs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  location_id uuid not null,
  revision integer not null check (revision > 0),
  source_draft_revision integer not null check (source_draft_revision > 0),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  published_by uuid not null,
  published_at timestamptz not null default now(),
  foreign key (tenant_id, location_id)
    references public.locations(tenant_id, id)
    on delete restrict,
  foreign key (tenant_id, published_by)
    references public.tenant_memberships(tenant_id, user_id)
    on delete restrict,
  unique (tenant_id, location_id, revision)
);

create index published_catalogs_current_idx
  on private.published_catalogs (tenant_id, location_id, revision desc);

create table private.catalog_product_availability (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  location_id uuid not null,
  product_id uuid not null,
  is_available boolean not null,
  version integer not null default 1 check (version > 0),
  updated_by uuid not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, location_id, product_id),
  foreign key (tenant_id, location_id)
    references public.locations(tenant_id, id)
    on delete cascade,
  foreign key (tenant_id, updated_by)
    references public.tenant_memberships(tenant_id, user_id)
    on delete restrict
);

revoke all on table private.catalog_drafts
from public, anon, authenticated, authenticator;
revoke all on table private.published_catalogs
from public, anon, authenticated, authenticator;
revoke all on table private.catalog_product_availability
from public, anon, authenticated, authenticator;

create or replace function private.catalog_snapshot_is_valid(target_snapshot jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    jsonb_typeof(target_snapshot) = 'object'
    and target_snapshot ?& array['baseRevision', 'categories', 'products', 'sectors']
    and (
      select count(*) = 4
      from jsonb_object_keys(target_snapshot)
    )
    and jsonb_typeof(target_snapshot -> 'categories') = 'array'
    and jsonb_array_length(target_snapshot -> 'categories') <= 50
    and jsonb_typeof(target_snapshot -> 'sectors') = 'array'
    and jsonb_array_length(target_snapshot -> 'sectors') <= 20
    and jsonb_typeof(target_snapshot -> 'products') = 'array'
    and jsonb_array_length(target_snapshot -> 'products') <= 500
    and not exists (
      select 1
      from jsonb_array_elements(target_snapshot -> 'products') product
      where jsonb_typeof(product) <> 'object'
        or product ?| array['availability', 'isAvailable']
    );
$$;

create or replace function private.require_catalog_admin(
  target_tenant_id uuid,
  target_location_id uuid,
  target_requester_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $$
begin
  if not exists (
    select 1
    from public.tenant_memberships membership
    where membership.tenant_id = target_tenant_id
      and membership.user_id = target_requester_id
      and membership.role = 'admin'
  ) then
    raise exception 'tenant administrator authorization required'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.locations location
    where location.tenant_id = target_tenant_id
      and location.id = target_location_id
  ) then
    raise exception 'location does not belong to tenant'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function private.save_catalog_draft(
  target_tenant_id uuid,
  target_location_id uuid,
  target_requester_id uuid,
  target_snapshot jsonb
)
returns private.catalog_drafts
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  current_published_revision integer;
  requested_base_revision integer;
  saved_draft private.catalog_drafts%rowtype;
begin
  perform private.require_catalog_admin(
    target_tenant_id,
    target_location_id,
    target_requester_id
  );

  if not private.catalog_snapshot_is_valid(target_snapshot) then
    raise exception 'invalid catalog snapshot'
      using errcode = '22023';
  end if;

  if jsonb_typeof(target_snapshot -> 'baseRevision') = 'null' then
    requested_base_revision := null;
  elsif jsonb_typeof(target_snapshot -> 'baseRevision') = 'number'
    and (target_snapshot ->> 'baseRevision') ~ '^[1-9][0-9]*$'
  then
    requested_base_revision := (target_snapshot ->> 'baseRevision')::integer;
  else
    raise exception 'invalid base catalog revision'
      using errcode = '22023';
  end if;

  perform 1
  from private.catalog_drafts draft
  where draft.tenant_id = target_tenant_id
    and draft.location_id = target_location_id
  for update;

  select published.revision
  into current_published_revision
  from private.published_catalogs published
  where published.tenant_id = target_tenant_id
    and published.location_id = target_location_id
  order by published.revision desc
  limit 1;

  if requested_base_revision is distinct from current_published_revision then
    raise exception 'catalog draft is based on a stale publication'
      using errcode = '40001';
  end if;

  insert into private.catalog_drafts (
    tenant_id,
    location_id,
    base_published_revision,
    snapshot,
    is_dirty,
    updated_by
  ) values (
    target_tenant_id,
    target_location_id,
    current_published_revision,
    target_snapshot,
    true,
    target_requester_id
  )
  on conflict (tenant_id, location_id) do update
  set
    revision = private.catalog_drafts.revision + 1,
    base_published_revision = excluded.base_published_revision,
    snapshot = excluded.snapshot,
    is_dirty = true,
    updated_by = excluded.updated_by,
    updated_at = statement_timestamp()
  returning * into saved_draft;

  return saved_draft;
end;
$$;

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

create or replace function private.set_catalog_product_availability(
  target_tenant_id uuid,
  target_location_id uuid,
  target_requester_id uuid,
  target_product_id uuid,
  target_is_available boolean,
  expected_version integer
)
returns private.catalog_product_availability
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  current_availability private.catalog_product_availability%rowtype;
  saved_availability private.catalog_product_availability%rowtype;
begin
  perform private.require_catalog_admin(
    target_tenant_id,
    target_location_id,
    target_requester_id
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      target_tenant_id::text || ':' || target_location_id::text || ':' || target_product_id::text,
      0
    )
  );

  if not exists (
    select 1
    from private.published_catalogs published
    cross join lateral jsonb_array_elements(published.snapshot -> 'products') product
    where published.tenant_id = target_tenant_id
      and published.location_id = target_location_id
      and published.revision = (
        select max(current_publication.revision)
        from private.published_catalogs current_publication
        where current_publication.tenant_id = target_tenant_id
          and current_publication.location_id = target_location_id
      )
      and product ->> 'id' = target_product_id::text
  ) then
    raise exception 'product is not in the current published catalog'
      using errcode = '22023';
  end if;

  select availability.*
  into current_availability
  from private.catalog_product_availability availability
  where availability.tenant_id = target_tenant_id
    and availability.location_id = target_location_id
    and availability.product_id = target_product_id
  for update;

  if found then
    if expected_version is null
      or current_availability.version <> expected_version
    then
      raise exception 'product availability version changed'
        using errcode = '40001';
    end if;

    update private.catalog_product_availability
    set
      is_available = target_is_available,
      version = version + 1,
      updated_by = target_requester_id,
      updated_at = statement_timestamp()
    where tenant_id = target_tenant_id
      and location_id = target_location_id
      and product_id = target_product_id
    returning * into saved_availability;
  else
    if expected_version is not null then
      raise exception 'product availability version changed'
        using errcode = '40001';
    end if;

    insert into private.catalog_product_availability (
      tenant_id,
      location_id,
      product_id,
      is_available,
      updated_by
    ) values (
      target_tenant_id,
      target_location_id,
      target_product_id,
      target_is_available,
      target_requester_id
    )
    returning * into saved_availability;
  end if;

  return saved_availability;
end;
$$;

revoke all on function private.catalog_snapshot_is_valid(jsonb)
from public, anon, authenticated;
revoke all on function private.require_catalog_admin(uuid, uuid, uuid)
from public, anon, authenticated;
revoke all on function private.save_catalog_draft(uuid, uuid, uuid, jsonb)
from public, anon, authenticated;
revoke all on function private.publish_catalog(uuid, uuid, uuid, integer)
from public, anon, authenticated;
revoke all on function private.set_catalog_product_availability(
  uuid, uuid, uuid, uuid, boolean, integer
) from public, anon, authenticated;

grant execute on function private.save_catalog_draft(uuid, uuid, uuid, jsonb)
to authenticator;
grant execute on function private.publish_catalog(uuid, uuid, uuid, integer)
to authenticator;
grant execute on function private.set_catalog_product_availability(
  uuid, uuid, uuid, uuid, boolean, integer
) to authenticator;

commit;
