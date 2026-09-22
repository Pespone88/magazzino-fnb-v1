alter table public.supplier_order_lines
  add constraint supplier_order_lines_accepted_not_over_ordered
  check (accepted_quantity_base <= ordered_quantity_base);

alter table public.supplier_receipts
  add constraint supplier_receipts_extra_explained
  check (extra_amount = 0 or (extra_note is not null and length(btrim(extra_note)) > 0));

alter table public.supplier_receipt_lines
  alter column actual_store_article_id set not null;

alter table public.supplier_receipt_lines
  add constraint supplier_receipt_lines_outcome_coherent
  check (
    (
      outcome = 'CONFORMING'
      and resolution is null
      and actual_store_article_id = expected_store_article_id
      and documented_quantity_base = received_quantity_base
      and received_quantity_base = accepted_quantity_base
    )
    or
    (
      outcome <> 'CONFORMING'
      and resolution is not null
    )
  );

alter table public.supplier_receipt_lines
  add constraint supplier_receipt_lines_other_resolution_note
  check (
    resolution <> 'OTHER'
    or (note is not null and length(btrim(note)) > 0)
  );

alter table public.supplier_receipt_lines
  add constraint supplier_receipt_lines_wrong_item_coherent
  check (
    outcome <> 'WRONG_ITEM'
    or (
      resolution = 'ACCEPT_AS_OTHER_ARTICLE'
      and actual_store_article_id <> expected_store_article_id
      and accepted_quantity_base > 0
    )
    or (
      resolution <> 'ACCEPT_AS_OTHER_ARTICLE'
      and actual_store_article_id = expected_store_article_id
      and accepted_quantity_base = 0
    )
  );

alter table public.supplier_receipt_lines
  add constraint supplier_receipt_lines_missing_coherent
  check (
    outcome <> 'MISSING'
    or (received_quantity_base = 0 and accepted_quantity_base = 0)
  );

alter table public.supplier_receipt_lines
  add constraint supplier_receipt_lines_unbilled_coherent
  check (
    outcome <> 'UNBILLED'
    or documented_quantity_base = 0
  );

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
begin
  select documented_quantity_base, received_quantity_base, accepted_quantity_base
    into v_documented, v_received, v_accepted
  from public.supplier_receipt_lines
  where id = new.receipt_line_id;

  if not found then
    raise exception 'Receipt line not found for supplier nonconformity';
  end if;

  if new.type = 'QUANTITY_MISMATCH' then
    new.quantity_affected_base := nullif(
      greatest(v_documented - v_received, 0) + greatest(v_received - v_accepted, 0),
      0
    );
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

create trigger supplier_nc_quantity_before_insert
before insert on public.supplier_nonconformities
for each row execute function private.set_supplier_nc_quantity();
