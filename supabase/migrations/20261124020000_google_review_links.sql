begin;
create table private.google_review_links (
  tenant_id uuid not null,
  location_id uuid not null,
  url text not null check (
    length(url) <= 1024 and url ~ '^https://(g\.page|maps\.app\.goo\.gl|search\.google\.com|maps\.google\.com|www\.google\.com|google\.com)/'
  ),
  primary key (tenant_id, location_id),
  foreign key (tenant_id, location_id) references public.locations(tenant_id, id) on delete cascade
);
revoke all on private.google_review_links from public, anon, authenticated, authenticator;

create function private.read_google_review_link(tenant uuid, location uuid)
returns text language sql stable security definer set search_path = '' set row_security = off as $$
  select url from private.google_review_links where (tenant_id, location_id) = (tenant, location);
$$;

create function private.admin_google_review_link(
  tenant uuid, location uuid, requester uuid, save boolean, review_url text
) returns text language plpgsql security definer set search_path = '' set row_security = off as $$
begin
  perform private.require_floor_plan_admin(tenant, location, requester);
  if save then
    if review_url is null then
      delete from private.google_review_links where (tenant_id, location_id) = (tenant, location);
    else
      insert into private.google_review_links values(tenant, location, review_url)
      on conflict(tenant_id, location_id) do update set url = excluded.url;
    end if;
  end if;
  return private.read_google_review_link(tenant, location);
end
$$;

revoke all on function private.read_google_review_link(uuid,uuid),
  private.admin_google_review_link(uuid,uuid,uuid,boolean,text) from public, anon, authenticated, authenticator;
grant execute on function private.read_google_review_link(uuid,uuid),
  private.admin_google_review_link(uuid,uuid,uuid,boolean,text) to authenticator;
commit;
