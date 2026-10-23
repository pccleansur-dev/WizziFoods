begin;

create table private.business_profile_drafts (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  location_id uuid not null,
  revision integer not null default 1 check (revision > 0),
  display_name text not null check (
    display_name = btrim(display_name)
    and length(display_name) between 1 and 120
  ),
  description text not null default '' check (
    description = btrim(description)
    and length(description) <= 1000
  ),
  contact_phone text not null default '' check (
    contact_phone = btrim(contact_phone)
    and length(contact_phone) <= 40
  ),
  address text not null default '' check (
    address = btrim(address)
    and length(address) <= 300
  ),
  opening_hours text not null default '' check (
    opening_hours = btrim(opening_hours)
    and length(opening_hours) <= 500
  ),
  languages text[] not null default array['es']::text[] check (
    cardinality(languages) between 1 and 5
  ),
  visual_layout text not null default 'visual' check (
    visual_layout in ('compact', 'modern', 'visual')
  ),
  heading_style text not null default 'serif' check (
    heading_style in ('sans', 'serif')
  ),
  primary_color text not null default '#1F2937' check (
    primary_color ~ '^#[0-9A-F]{6}$'
  ),
  secondary_color text not null default '#F9FAFB' check (
    secondary_color ~ '^#[0-9A-F]{6}$'
  ),
  accent_color text not null default '#D97706' check (
    accent_color ~ '^#[0-9A-F]{6}$'
  ),
  logo_asset_id uuid,
  cover_asset_id uuid,
  reference_asset_ids uuid[] not null default '{}'::uuid[] check (
    cardinality(reference_asset_ids) <= 12
  ),
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

create table private.published_business_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  location_id uuid not null,
  source_revision integer not null check (source_revision > 0),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  published_by uuid not null,
  published_at timestamptz not null default now(),
  foreign key (tenant_id, location_id)
    references public.locations(tenant_id, id)
    on delete restrict,
  foreign key (tenant_id, published_by)
    references public.tenant_memberships(tenant_id, user_id)
    on delete restrict,
  unique (tenant_id, location_id, source_revision)
);

create index published_business_profiles_current_idx
  on private.published_business_profiles (tenant_id, location_id, published_at desc);

revoke all on table private.business_profile_drafts
from public, anon, authenticated, authenticator;
revoke all on table private.published_business_profiles
from public, anon, authenticated, authenticator;

create or replace function private.save_business_profile_draft(
  target_tenant_id uuid,
  target_location_id uuid,
  target_requester_id uuid,
  target_display_name text,
  target_description text,
  target_contact_phone text,
  target_address text,
  target_opening_hours text,
  target_languages text[],
  target_visual_layout text,
  target_heading_style text,
  target_primary_color text,
  target_secondary_color text,
  target_accent_color text,
  target_logo_asset_id uuid,
  target_cover_asset_id uuid,
  target_reference_asset_ids uuid[]
)
returns private.business_profile_drafts
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  saved_draft private.business_profile_drafts%rowtype;
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

  if exists (
    select 1
    from unnest(target_languages) as language(value)
    where language.value !~ '^[a-z]{2}(-[A-Z]{2})?$'
  ) or cardinality(target_languages) <> (
    select count(distinct language.value)::integer
    from unnest(target_languages) as language(value)
  ) then
    raise exception 'languages must be unique canonical tags'
      using errcode = '22023';
  end if;

  if cardinality(target_reference_asset_ids) <> (
    select count(distinct asset.value)::integer
    from unnest(target_reference_asset_ids) as asset(value)
  ) then
    raise exception 'reference assets must be unique'
      using errcode = '22023';
  end if;

  insert into private.business_profile_drafts (
    tenant_id,
    location_id,
    display_name,
    description,
    contact_phone,
    address,
    opening_hours,
    languages,
    visual_layout,
    heading_style,
    primary_color,
    secondary_color,
    accent_color,
    logo_asset_id,
    cover_asset_id,
    reference_asset_ids,
    updated_by
  ) values (
    target_tenant_id,
    target_location_id,
    target_display_name,
    target_description,
    target_contact_phone,
    target_address,
    target_opening_hours,
    target_languages,
    target_visual_layout,
    target_heading_style,
    target_primary_color,
    target_secondary_color,
    target_accent_color,
    target_logo_asset_id,
    target_cover_asset_id,
    target_reference_asset_ids,
    target_requester_id
  )
  on conflict (tenant_id, location_id) do update
  set
    revision = private.business_profile_drafts.revision + 1,
    display_name = excluded.display_name,
    description = excluded.description,
    contact_phone = excluded.contact_phone,
    address = excluded.address,
    opening_hours = excluded.opening_hours,
    languages = excluded.languages,
    visual_layout = excluded.visual_layout,
    heading_style = excluded.heading_style,
    primary_color = excluded.primary_color,
    secondary_color = excluded.secondary_color,
    accent_color = excluded.accent_color,
    logo_asset_id = excluded.logo_asset_id,
    cover_asset_id = excluded.cover_asset_id,
    reference_asset_ids = excluded.reference_asset_ids,
    updated_by = excluded.updated_by,
    updated_at = statement_timestamp()
  returning * into saved_draft;

  return saved_draft;
end;
$$;

create or replace function private.get_business_profile_draft(
  target_tenant_id uuid,
  target_location_id uuid,
  target_requester_id uuid
)
returns setof private.business_profile_drafts
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

  return query
  select draft.*
  from private.business_profile_drafts draft
  where draft.tenant_id = target_tenant_id
    and draft.location_id = target_location_id;
end;
$$;

revoke all on function private.save_business_profile_draft(
  uuid, uuid, uuid, text, text, text, text, text, text[], text, text, text,
  text, text, uuid, uuid, uuid[]
) from public, anon, authenticated;
revoke all on function private.get_business_profile_draft(uuid, uuid, uuid)
from public, anon, authenticated;

grant execute on function private.save_business_profile_draft(
  uuid, uuid, uuid, text, text, text, text, text, text[], text, text, text,
  text, text, uuid, uuid, uuid[]
) to authenticator;
grant execute on function private.get_business_profile_draft(uuid, uuid, uuid)
to authenticator;

commit;
