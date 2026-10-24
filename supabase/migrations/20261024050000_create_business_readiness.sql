begin;

-- Business readiness and publication (T15).
-- The database owns the minimum requirements. Saving progress is never blocked:
-- only publish_location refuses, and it re-evaluates every requirement inside
-- its own transaction while holding share locks on what it reads, so a minimum
-- cannot be removed between the check and the commit.

create table private.location_publications (
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  location_id uuid not null,
  revision integer not null default 1 check (revision > 0),
  published_by uuid not null,
  published_at timestamptz not null default now(),
  primary key (tenant_id, location_id),
  foreign key (tenant_id, location_id)
    references public.locations(tenant_id, id)
    on delete restrict,
  foreign key (tenant_id, published_by)
    references public.tenant_memberships(tenant_id, user_id)
    on delete restrict
);

revoke all on table private.location_publications
from public, anon, authenticated, authenticator;

-- Same coverage rule T11 applies when publishing, evaluated over the published
-- snapshot: every category, product and variant needs a title per language.
create or replace function private.catalog_covers_languages(
  target_snapshot jsonb,
  required_languages text[]
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select not exists (
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
    select 1
    from localized_items localized
    cross join unnest(required_languages) required(language)
    where not exists (
      select 1
      from jsonb_array_elements(localized.item -> 'content') content
      where content ->> 'language' = required.language
        and length(btrim(content ->> 'title')) > 0
    )
  );
$$;

-- Evaluates the requirement matrix. Internal: callers authorize first.
create or replace function private.location_readiness(
  target_tenant_id uuid,
  target_location_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  blockers text[] := '{}';
  warnings text[] := '{}';
  profile private.business_profile_drafts%rowtype;
  published_snapshot jsonb;
  catalog_dirty boolean;
  floor_tables integer;
  floor_tables_with_qr integer;
  payment_methods integer;
  staff_members integer;
  staff_managers integer;
  publication private.location_publications%rowtype;
begin
  select draft.* into profile
  from private.business_profile_drafts draft
  where draft.tenant_id = target_tenant_id
    and draft.location_id = target_location_id;

  if not found then
    blockers := array_append(blockers, 'PROFILE_MISSING');
  elsif profile.contact_phone = '' and profile.address = '' then
    blockers := array_append(blockers, 'PROFILE_CONTACT_MISSING');
  end if;

  select published.snapshot into published_snapshot
  from private.published_catalogs published
  where published.tenant_id = target_tenant_id
    and published.location_id = target_location_id
  order by published.revision desc
  limit 1;

  if published_snapshot is null then
    blockers := array_append(blockers, 'CATALOG_NOT_PUBLISHED');
  elsif profile.tenant_id is not null then
    if not private.catalog_covers_languages(published_snapshot, profile.languages) then
      blockers := array_append(blockers, 'CATALOG_LANGUAGE_MISSING');
    end if;
  end if;

  select active_tables, tables_with_qr
  into floor_tables, floor_tables_with_qr
  from private.floor_plan_readiness(target_tenant_id, target_location_id);
  if floor_tables = 0 then
    blockers := array_append(blockers, 'FLOOR_NO_TABLES');
  elsif floor_tables_with_qr < floor_tables then
    blockers := array_append(blockers, 'FLOOR_TABLE_WITHOUT_QR');
  end if;

  select available_methods into payment_methods
  from private.payment_readiness(target_tenant_id, target_location_id);
  if payment_methods = 0 then
    blockers := array_append(blockers, 'PAYMENT_NO_METHOD');
  end if;

  select draft.is_dirty into catalog_dirty
  from private.catalog_drafts draft
  where draft.tenant_id = target_tenant_id
    and draft.location_id = target_location_id;
  if coalesce(catalog_dirty, false) and published_snapshot is not null then
    warnings := array_append(warnings, 'CATALOG_DRAFT_UNPUBLISHED');
  end if;

  if exists (
    select 1
    from private.catalog_imports pending
    where pending.tenant_id = target_tenant_id
      and pending.location_id = target_location_id
      and pending.status in ('queued', 'processing', 'review')
  ) then
    warnings := array_append(warnings, 'CATALOG_IMPORTS_PENDING');
  end if;

  select team.active_members, team.active_managers
  into staff_members, staff_managers
  from private.staff_team_summary(target_tenant_id, target_location_id) team;
  if staff_members = 0 then
    warnings := array_append(warnings, 'TEAM_EMPTY');
  end if;

  select current_publication.* into publication
  from private.location_publications current_publication
  where current_publication.tenant_id = target_tenant_id
    and current_publication.location_id = target_location_id;

  return jsonb_build_object(
    'blockers', to_jsonb(blockers),
    'warnings', to_jsonb(warnings),
    'team', jsonb_build_object(
      'activeManagers', staff_managers,
      'activeMembers', staff_members
    ),
    'published', case
      when publication.tenant_id is null then null
      else jsonb_build_object(
        'at', publication.published_at,
        'by', publication.published_by,
        'revision', publication.revision
      )
    end
  );
end;
$$;

create or replace function private.get_location_readiness(
  target_tenant_id uuid,
  target_location_id uuid,
  target_requester_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
begin
  perform private.require_floor_plan_admin(
    target_tenant_id, target_location_id, target_requester_id
  );
  return private.location_readiness(target_tenant_id, target_location_id);
end;
$$;

-- The only way to declare the business ready to operate.
create or replace function private.publish_location(
  target_tenant_id uuid,
  target_location_id uuid,
  target_requester_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set row_security = off
as $$
declare
  readiness jsonb;
  publication private.location_publications%rowtype;
begin
  perform private.require_floor_plan_admin(
    target_tenant_id, target_location_id, target_requester_id
  );

  -- Serializes concurrent publications of the same location.
  perform 1
  from public.locations location
  where location.tenant_id = target_tenant_id
    and location.id = target_location_id
  for update;

  if exists (
    select 1
    from private.location_publications existing
    where existing.tenant_id = target_tenant_id
      and existing.location_id = target_location_id
  ) then
    raise exception 'location is already published' using errcode = 'PT101';
  end if;

  -- Writers of each requirement take the matching row lock; sharing them here
  -- makes them wait for this transaction, so the state validated below is the
  -- state that commits. Rows are locked in a fixed order to avoid deadlocks.
  perform 1
  from private.business_profile_drafts profile
  where profile.tenant_id = target_tenant_id
    and profile.location_id = target_location_id
  for share;

  perform 1
  from private.floor_plans plan
  where plan.tenant_id = target_tenant_id
    and plan.location_id = target_location_id
  for share;

  perform 1
  from private.floor_tables floor_table
  where floor_table.tenant_id = target_tenant_id
    and floor_table.location_id = target_location_id
    and floor_table.retired_at is null
  order by floor_table.id
  for share;

  perform private.ensure_payment_methods(target_tenant_id, target_location_id);
  perform 1
  from private.payment_methods method
  where method.tenant_id = target_tenant_id
    and method.location_id = target_location_id
  order by method.method_key
  for share;

  readiness := private.location_readiness(target_tenant_id, target_location_id);
  if jsonb_array_length(readiness -> 'blockers') > 0 then
    raise exception 'publication requirements missing: %',
      array_to_string(
        array(select jsonb_array_elements_text(readiness -> 'blockers')), ','
      )
      using errcode = 'PT100';
  end if;

  insert into private.location_publications (
    tenant_id, location_id, published_by
  ) values (
    target_tenant_id, target_location_id, target_requester_id
  )
  returning * into publication;

  perform private.append_audit_event(
    target_tenant_id, 'tenant_admin', target_requester_id,
    'business.published', 'Negocio publicado por el Administrador',
    gen_random_uuid()::text, 'location', target_location_id
  );

  return private.location_readiness(target_tenant_id, target_location_id);
end;
$$;

revoke all on function
  private.catalog_covers_languages(jsonb, text[]),
  private.location_readiness(uuid, uuid),
  private.get_location_readiness(uuid, uuid, uuid),
  private.publish_location(uuid, uuid, uuid)
from public, anon, authenticated;

grant execute on function
  private.get_location_readiness(uuid, uuid, uuid),
  private.publish_location(uuid, uuid, uuid)
to authenticator;

commit;
