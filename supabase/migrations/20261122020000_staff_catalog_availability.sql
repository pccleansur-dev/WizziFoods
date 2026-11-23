begin;

do $migration$
begin
  if not exists (
    select 1 from pg_attribute
    where attrelid = 'private.catalog_product_availability'::regclass
      and attname = 'updated_by_staff' and not attisdropped
  ) then
    alter table private.catalog_product_availability
      alter column updated_by drop not null,
      add column updated_by_staff uuid,
      add constraint catalog_availability_staff_fk foreign key (tenant_id, updated_by_staff)
        references public.staff_members(tenant_id, id) on delete restrict,
      add constraint catalog_availability_one_actor check (
        (updated_by is null) <> (updated_by_staff is null)
      );
  end if;
end;
$migration$;

create or replace function private.write_catalog_product_availability(
  target_tenant_id uuid,
  target_location_id uuid,
  target_requester_id uuid,
  target_product_id uuid,
  target_is_available boolean,
  expected_version integer,
  target_staff_id uuid
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
  if target_staff_id is null then
    perform private.require_catalog_admin(
      target_tenant_id, target_location_id, target_requester_id
    );
  elsif target_requester_id is not null or not exists (
    select 1
    from public.staff_members staff
    join public.tenants tenant on tenant.id = staff.tenant_id
    where staff.tenant_id = target_tenant_id
      and staff.location_id = target_location_id
      and staff.id = target_staff_id
      and staff.role = 'manager'
      and staff.is_active
      and tenant.status = 'active'
  ) then
    raise exception 'staff cannot change availability' using errcode = 'PT200';
  end if;

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
      updated_by_staff = target_staff_id,
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
      updated_by,
      updated_by_staff
    ) values (
      target_tenant_id,
      target_location_id,
      target_product_id,
      target_is_available,
      target_requester_id,
      target_staff_id
    )
    returning * into saved_availability;
  end if;

  return saved_availability;
end;
$$;

revoke all on function private.write_catalog_product_availability(
  uuid, uuid, uuid, uuid, boolean, integer, uuid
) from public, anon, authenticated, authenticator;

create or replace function private.set_catalog_product_availability(
  target_tenant_id uuid,
  target_location_id uuid,
  target_requester_id uuid,
  target_product_id uuid,
  target_is_available boolean,
  expected_version integer
)
returns private.catalog_product_availability
language sql
security definer
set search_path = ''
set row_security = off
as $$
  select * from private.write_catalog_product_availability(
    target_tenant_id, target_location_id, target_requester_id, target_product_id,
    target_is_available, expected_version, null
  );
$$;

create function private.set_staff_catalog_product_availability(
  target_tenant_id uuid,
  target_location_id uuid,
  target_staff_id uuid,
  target_product_id uuid,
  target_is_available boolean,
  expected_version integer
)
returns private.catalog_product_availability
language sql
security definer
set search_path = ''
set row_security = off
as $$
  select * from private.write_catalog_product_availability(
    target_tenant_id, target_location_id, null, target_product_id,
    target_is_available, expected_version, target_staff_id
  );
$$;

revoke all on function private.set_staff_catalog_product_availability(
  uuid, uuid, uuid, uuid, boolean, integer
) from public, anon, authenticated;
grant execute on function private.set_staff_catalog_product_availability(
  uuid, uuid, uuid, uuid, boolean, integer
) to authenticator;

commit;
