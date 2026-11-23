begin;

-- Preserve live availability and staff attribution when rolling back the app.
drop function private.set_staff_catalog_product_availability(
  uuid, uuid, uuid, uuid, boolean, integer
);

commit;
