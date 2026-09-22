-- Acceptance: CF is already the stock/order unit.
-- package_quantity is the number of pieces inside one case and must not divide CF pricing.
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
  v_line_total numeric;
  v_order_total numeric;
  v_on_hand numeric;
  v_unit_cost numeric;
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
  values ('__cf_pricing_' || gen_random_uuid()::text)
  returning id into v_cat;

  insert into public.articles(name, category_id, base_unit, package_quantity)
  values ('__cf_pricing_article_' || gen_random_uuid()::text, v_cat, 'CF', 24)
  returning id into v_article;

  insert into public.store_articles(store_id, article_id, min_stock, target_stock)
  values (v_store, v_article, 0, 0)
  returning id into v_store_article;

  insert into public.suppliers(name)
  values ('__cf_pricing_supplier_' || gen_random_uuid()::text)
  returning id into v_supplier;

  insert into public.store_suppliers(store_id, supplier_id, active)
  values (v_store, v_supplier, true)
  returning id into v_store_supplier;

  insert into public.store_article_suppliers(
    store_id, store_article_id, store_supplier_id,
    current_package_price, is_preferred, active
  ) values (
    v_store, v_store_article, v_store_supplier,
    2.90, true, true
  ) returning id into v_link;

  v_result := public.orders_create_drafts(
    v_store,
    jsonb_build_array(jsonb_build_object(
      'storeArticleId', v_store_article,
      'storeArticleSupplierId', v_link,
      'quantityBase', 50
    )),
    'CF pricing acceptance',
    'cf-pricing-create'
  );
  v_order := (v_result->'orderIds'->>0)::uuid;

  select id, estimated_total into v_line, v_line_total
  from public.supplier_order_lines
  where order_id=v_order and store_article_id=v_store_article;

  select estimated_total into v_order_total
  from public.supplier_orders
  where id=v_order;

  if v_line_total <> 145.0000 then
    raise exception 'CF line total expected 145, got %', v_line_total;
  end if;
  if v_order_total <> 145.0000 then
    raise exception 'CF order total expected 145, got %', v_order_total;
  end if;

  perform public.orders_mark_ordered(v_order, 'cf-pricing-mark');

  v_receipt := public.orders_confirm_receipt(
    v_order,
    'CF-PRICING-DDT',
    date '2026-09-22',
    29.00,
    0,
    null,
    null,
    jsonb_build_array(jsonb_build_object(
      'orderLineId', v_line,
      'documentedQuantity', 10,
      'receivedQuantity', 10,
      'acceptedQuantity', 10,
      'documentPackagePrice', 2.90,
      'priceChangeConfirmed', false,
      'outcome', 'CONFORMING',
      'resolution', null,
      'actualStoreArticleId', v_store_article
    )),
    'cf-pricing-receipt'
  );

  select on_hand into v_on_hand
  from public.stock_balances
  where store_article_id=v_store_article;

  if v_on_hand <> 10 then
    raise exception 'CF receipt stock expected 10, got %', v_on_hand;
  end if;

  select unit_cost_snapshot into v_unit_cost
  from public.stock_movements
  where source_id=v_receipt
    and movement_type='SUPPLIER_RECEIPT'
    and store_article_id=v_store_article;

  if v_unit_cost <> 2.900000 then
    raise exception 'CF stock unit cost expected 2.90, got %', v_unit_cost;
  end if;
end $$;

rollback;
select 'SUPPLIER_ORDERS_CF_PRICING_ACCEPTANCE_PASS_ROLLED_BACK' as result;
