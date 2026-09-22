create or replace function private.validate_supplier_receipt_line_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.supplier_order_line_status;
  v_estimated_price numeric(14,4);
  v_store_supplier_id uuid;
  v_current_price numeric(14,4);
begin
  select l.status, l.estimated_package_price, o.store_supplier_id
    into v_status, v_estimated_price, v_store_supplier_id
  from public.supplier_order_lines l
  join public.supplier_orders o on o.id=l.order_id and o.store_id=l.store_id
  where l.id=new.order_line_id and l.order_id=new.order_id and l.store_id=new.store_id;

  if not found then raise exception 'Order line not found'; end if;
  if v_status in ('COMPLETED','NOT_SUPPLIED','CLOSED_WITH_DISCREPANCY','AWAITING_CREDIT_NOTE') then
    raise exception 'Order line is not receivable';
  end if;

  if new.document_package_price is not null then
    select sas.current_package_price into v_current_price
    from public.store_article_suppliers sas
    where sas.store_id=new.store_id
      and sas.store_article_id=new.actual_store_article_id
      and sas.store_supplier_id=v_store_supplier_id
      and sas.active=true;

    if not found then raise exception 'Active supplier link not found'; end if;

    if (
      new.document_package_price is distinct from v_estimated_price
      or new.document_package_price is distinct from v_current_price
    ) and not new.price_change_confirmed then
      raise exception 'Receipt price change requires confirmation';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.validate_supplier_receipt_line_state() from public, anon, authenticated;
