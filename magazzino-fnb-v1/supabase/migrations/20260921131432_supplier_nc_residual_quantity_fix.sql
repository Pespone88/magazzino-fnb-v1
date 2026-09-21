create or replace function private.set_supplier_nc_quantity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_documented numeric(14,3);
  v_received numeric(14,3);
  v_accepted numeric(14,3);
  v_ordered numeric(14,3);
  v_order_line_accepted numeric(14,3);
begin
  select rl.documented_quantity_base, rl.received_quantity_base, rl.accepted_quantity_base,
         ol.ordered_quantity_base, ol.accepted_quantity_base
    into v_documented, v_received, v_accepted, v_ordered, v_order_line_accepted
  from public.supplier_receipt_lines rl
  join public.supplier_order_lines ol on ol.id=rl.order_line_id
  where rl.id = new.receipt_line_id;

  if not found then
    raise exception 'Receipt line not found for supplier nonconformity';
  end if;

  if new.type in ('QUANTITY_MISMATCH','MISSING_ITEM') then
    new.quantity_affected_base := nullif(greatest(v_ordered - v_order_line_accepted, 0), 0);
  elsif new.type in ('WRONG_ITEM','QUALITY_NOT_SUITABLE') then
    new.quantity_affected_base := nullif(greatest(v_received, v_documented), 0);
  elsif new.type = 'UNBILLED_ITEM' then
    new.quantity_affected_base := nullif(v_received, 0);
  elsif new.type = 'OTHER' and new.quantity_affected_base is null then
    new.quantity_affected_base := nullif(greatest(v_received - v_accepted, 0), 0);
  end if;

  return new;
end;
$$;

revoke all on function private.set_supplier_nc_quantity() from public, anon, authenticated;
