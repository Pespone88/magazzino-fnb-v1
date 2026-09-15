create or replace function public.admin_create_supplier_for_store(
  p_store_id uuid,
  p_name text,
  p_vat_number text,
  p_customer_code text,
  p_minimum_order_amount numeric,
  p_delivery_notes text
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_supplier_id uuid;
  v_store_supplier_id uuid;
begin
  if not private.current_user_is_admin() then
    raise exception 'Catalog administration requires ADMIN';
  end if;

  insert into public.suppliers (name, vat_number)
  values (btrim(p_name), nullif(btrim(p_vat_number), ''))
  returning id into v_supplier_id;

  insert into public.store_suppliers (
    store_id,
    supplier_id,
    customer_code,
    minimum_order_amount,
    delivery_notes,
    active
  ) values (
    p_store_id,
    v_supplier_id,
    nullif(btrim(p_customer_code), ''),
    p_minimum_order_amount,
    nullif(btrim(p_delivery_notes), ''),
    true
  )
  returning id into v_store_supplier_id;

  return v_store_supplier_id;
end;
$$;

revoke all on function public.admin_create_supplier_for_store(uuid,text,text,text,numeric,text) from public, anon;
grant execute on function public.admin_create_supplier_for_store(uuid,text,text,text,numeric,text) to authenticated;
