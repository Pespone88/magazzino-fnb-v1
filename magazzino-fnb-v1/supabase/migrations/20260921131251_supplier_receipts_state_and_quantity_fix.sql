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
  v_previously_accepted numeric(14,3);
begin
  select rl.documented_quantity_base, rl.received_quantity_base, rl.accepted_quantity_base,
         ol.ordered_quantity_base, ol.accepted_quantity_base
    into v_documented, v_received, v_accepted, v_ordered, v_previously_accepted
  from public.supplier_receipt_lines rl
  join public.supplier_order_lines ol on ol.id=rl.order_line_id
  where rl.id = new.receipt_line_id;

  if not found then
    raise exception 'Receipt line not found for supplier nonconformity';
  end if;

  if new.type in ('QUANTITY_MISMATCH','MISSING_ITEM') then
    new.quantity_affected_base := nullif(greatest(v_ordered - v_previously_accepted - v_accepted, 0), 0);
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

create or replace function private.validate_supplier_receipt_line_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.supplier_order_line_status;
begin
  select status into v_status
  from public.supplier_order_lines
  where id=new.order_line_id and order_id=new.order_id and store_id=new.store_id;

  if not found then raise exception 'Order line not found'; end if;
  if v_status in ('COMPLETED','NOT_SUPPLIED','CLOSED_WITH_DISCREPANCY','AWAITING_CREDIT_NOTE') then
    raise exception 'Order line is not receivable';
  end if;
  return new;
end;
$$;

revoke all on function private.validate_supplier_receipt_line_state() from public, anon, authenticated;

create trigger supplier_receipt_line_state_before_insert
before insert on public.supplier_receipt_lines
for each row execute function private.validate_supplier_receipt_line_state();
