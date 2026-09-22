-- Supplier orders / receipts acceptance. Must leave no test data behind.
begin;

do $$
declare
  v_admin uuid;
  v_store uuid;
  v_cat uuid;
  v_article uuid;
  v_store_article uuid;
  v_supplier uuid;
  v_store_supplier uuid;
  v_link uuid;
  v_result jsonb;
  v_order uuid;
  v_line uuid;
  v_receipt uuid;
  v_second_receipt uuid;
  v_nc uuid;
  v_on_hand numeric;
  v_price numeric;
  v_count int;
begin
  select id into v_admin
  from public.profiles
  where active=true and global_role='ADMIN'::public.global_role
  order by created_at
  limit 1;

  select id into v_store
  from public.stores
  where slug='eccellenze-della-costiera';

  if v_admin is null or v_store is null then
    raise exception 'Acceptance prerequisites missing';
  end if;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  insert into public.categories(name)
  values ('__orders_' || gen_random_uuid()::text)
  returning id into v_cat;

  insert into public.articles(name, category_id, base_unit, package_quantity)
  values ('__orders_article_' || gen_random_uuid()::text, v_cat, 'PZ', 1)
  returning id into v_article;

  insert into public.store_articles(store_id, article_id, min_stock, target_stock)
  values (v_store, v_article, 5, 10)
  returning id into v_store_article;

  insert into public.suppliers(name)
  values ('__orders_supplier_' || gen_random_uuid()::text)
  returning id into v_supplier;

  insert into public.store_suppliers(store_id, supplier_id, active)
  values (v_store, v_supplier, true)
  returning id into v_store_supplier;

  insert into public.store_article_suppliers(
    store_id, store_article_id, store_supplier_id,
    current_package_price, is_preferred, active
  ) values (
    v_store, v_store_article, v_store_supplier,
    10, true, true
  ) returning id into v_link;

  -- Need list uses real stock and suggests target - available.
  v_result := public.orders_list_need_candidates(v_store);
  if not exists (
    select 1
    from jsonb_array_elements(v_result) x
    where x->>'storeArticleId'=v_store_article::text
      and (x->>'underMin')::boolean=true
      and (x->>'suggestedQuantity')::numeric=10
  ) then
    raise exception 'Need candidate / suggested quantity missing';
  end if;

  -- Draft creation snapshots article/supplier/price and is idempotent.
  v_result := public.orders_create_drafts(
    v_store,
    jsonb_build_array(jsonb_build_object(
      'storeArticleId', v_store_article,
      'storeArticleSupplierId', v_link,
      'quantityBase', 10
    )),
    'Acceptance order',
    'orders-acceptance-create'
  );
  v_order := (v_result->'orderIds'->>0)::uuid;

  if v_order is null then raise exception 'Draft order not created'; end if;

  select id into v_line
  from public.supplier_order_lines
  where order_id=v_order and store_article_id=v_store_article;

  if v_line is null then raise exception 'Order line not created'; end if;
  if (select estimated_package_price from public.supplier_order_lines where id=v_line) <> 10 then
    raise exception 'Order price snapshot mismatch';
  end if;

  perform public.orders_create_drafts(
    v_store,
    jsonb_build_array(jsonb_build_object(
      'storeArticleId', v_store_article,
      'storeArticleSupplierId', v_link,
      'quantityBase', 10
    )),
    'Acceptance order',
    'orders-acceptance-create'
  );

  select count(*) into v_count
  from public.supplier_orders
  where id=v_order;
  if v_count<>1 then raise exception 'Draft retry duplicated order'; end if;

  perform public.orders_mark_ordered(v_order, 'orders-acceptance-mark');
  perform public.orders_mark_ordered(v_order, 'orders-acceptance-mark');

  if (select status from public.supplier_orders where id=v_order) <> 'ORDERED'::public.supplier_order_status then
    raise exception 'Order not marked ordered';
  end if;

  -- A changed DDT price must be explicitly confirmed and must not partially write.
  begin
    perform public.orders_confirm_receipt(
      v_order, 'ACC-PRICE-FAIL', date '2026-09-22', 60, 0, null, null,
      jsonb_build_array(jsonb_build_object(
        'orderLineId', v_line,
        'documentedQuantity', 5,
        'receivedQuantity', 5,
        'acceptedQuantity', 5,
        'documentPackagePrice', 12,
        'priceChangeConfirmed', false,
        'outcome', 'CONFORMING',
        'resolution', null,
        'actualStoreArticleId', v_store_article
      )),
      'orders-acceptance-price-fail'
    );
    raise exception 'Unconfirmed receipt price change unexpectedly succeeded';
  exception
    when others then
      if sqlerrm not like '%Receipt price change requires confirmation%' then
        raise;
      end if;
  end;

  if exists(select 1 from public.supplier_receipts where order_id=v_order) then
    raise exception 'Rejected receipt left persisted data';
  end if;

  -- First partial conforming receipt: +5 stock and confirmed price 10 -> 12.
  v_receipt := public.orders_confirm_receipt(
    v_order, 'ACC-001', date '2026-09-22', 60, 0, null, null,
    jsonb_build_array(jsonb_build_object(
      'orderLineId', v_line,
      'documentedQuantity', 5,
      'receivedQuantity', 5,
      'acceptedQuantity', 5,
      'documentPackagePrice', 12,
      'priceChangeConfirmed', true,
      'outcome', 'CONFORMING',
      'resolution', null,
      'actualStoreArticleId', v_store_article
    )),
    'orders-acceptance-receipt-1'
  );

  select on_hand into v_on_hand
  from public.stock_balances
  where store_article_id=v_store_article;

  if v_on_hand<>5 then raise exception 'First receipt expected stock 5, got %', v_on_hand; end if;
  if (select accepted_quantity_base from public.supplier_order_lines where id=v_line)<>5 then
    raise exception 'First receipt accepted quantity mismatch';
  end if;
  if (select status from public.supplier_orders where id=v_order)<>'PARTIALLY_RECEIVED'::public.supplier_order_status then
    raise exception 'Order should be partially received';
  end if;

  select current_package_price into v_price
  from public.store_article_suppliers
  where id=v_link;
  if v_price<>12 then raise exception 'Confirmed receipt price was not recorded'; end if;

  if not exists (
    select 1 from public.purchase_price_history
    where store_article_supplier_id=v_link
      and source='RECEIPT'::public.purchase_price_source
      and package_price=12
  ) then raise exception 'Receipt price history missing'; end if;

  if (select count(*) from public.stock_movements where source_id=v_receipt and movement_type='SUPPLIER_RECEIPT')<>1 then
    raise exception 'Receipt must create exactly one supplier stock movement';
  end if;

  -- Same operation key is idempotent even after order state changed.
  if public.orders_confirm_receipt(
    v_order, 'ACC-001', date '2026-09-22', 60, 0, null, null,
    jsonb_build_array(jsonb_build_object(
      'orderLineId', v_line,
      'documentedQuantity', 5,
      'receivedQuantity', 5,
      'acceptedQuantity', 5,
      'documentPackagePrice', 12,
      'priceChangeConfirmed', true,
      'outcome', 'CONFORMING',
      'resolution', null,
      'actualStoreArticleId', v_store_article
    )),
    'orders-acceptance-receipt-1'
  ) <> v_receipt then
    raise exception 'Receipt idempotent retry returned different receipt';
  end if;

  if (select on_hand from public.stock_balances where store_article_id=v_store_article)<>5 then
    raise exception 'Receipt retry duplicated stock';
  end if;

  -- Missing residual creates a tracked nonconformity without stock.
  v_second_receipt := public.orders_confirm_receipt(
    v_order, 'ACC-002', date '2026-09-22', 0, 0, null, null,
    jsonb_build_array(jsonb_build_object(
      'orderLineId', v_line,
      'documentedQuantity', 0,
      'receivedQuantity', 0,
      'acceptedQuantity', 0,
      'documentPackagePrice', 12,
      'priceChangeConfirmed', true,
      'outcome', 'MISSING',
      'resolution', 'NEXT_DELIVERY',
      'note', 'Residuo in consegna successiva',
      'actualStoreArticleId', v_store_article
    )),
    'orders-acceptance-missing'
  );

  select id into v_nc
  from public.supplier_nonconformities
  where receipt_id=v_second_receipt and order_line_id=v_line;

  if v_nc is null then raise exception 'Missing receipt did not create nonconformity'; end if;
  if (select quantity_affected_base from public.supplier_nonconformities where id=v_nc)<>5 then
    raise exception 'Missing residual quantity should be 5';
  end if;
  if (select on_hand from public.stock_balances where store_article_id=v_store_article)<>5 then
    raise exception 'Missing receipt must not change stock';
  end if;

  -- Subsequent conforming receipt completes order and resolves NEXT_DELIVERY anomaly.
  perform public.orders_confirm_receipt(
    v_order, 'ACC-003', date '2026-09-22', 60, 0, null, null,
    jsonb_build_array(jsonb_build_object(
      'orderLineId', v_line,
      'documentedQuantity', 5,
      'receivedQuantity', 5,
      'acceptedQuantity', 5,
      'documentPackagePrice', 12,
      'priceChangeConfirmed', true,
      'outcome', 'CONFORMING',
      'resolution', null,
      'actualStoreArticleId', v_store_article
    )),
    'orders-acceptance-receipt-3'
  );

  if (select on_hand from public.stock_balances where store_article_id=v_store_article)<>10 then
    raise exception 'Final receipt expected stock 10';
  end if;
  if (select status from public.supplier_order_lines where id=v_line)<>'COMPLETED'::public.supplier_order_line_status then
    raise exception 'Order line should be completed';
  end if;
  if (select status from public.supplier_orders where id=v_order)<>'COMPLETED'::public.supplier_order_status then
    raise exception 'Order should be completed';
  end if;
  if (select status from public.supplier_nonconformities where id=v_nc)<>'RESOLVED'::public.supplier_nc_status then
    raise exception 'NEXT_DELIVERY nonconformity should resolve after later receipt';
  end if;
end $$;

rollback;
select 'SUPPLIER_ORDERS_RECEIPTS_ACCEPTANCE_PASS_ROLLED_BACK' as result;
