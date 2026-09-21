-- Supplier orders and receipts acceptance. Must leave no test data behind.
begin;

do $$
declare
  v_admin uuid; v_store uuid; v_cat uuid;
  v_a1 uuid; v_a2 uuid; v_a3 uuid;
  v_sa1 uuid; v_sa2 uuid; v_sa3 uuid;
  v_s1 uuid; v_s2 uuid; v_ss1 uuid; v_ss2 uuid;
  v_link1 uuid; v_link2 uuid; v_link3 uuid;
  v_result jsonb; v_order1 uuid; v_order2 uuid;
  v_line1 uuid; v_line2 uuid; v_line3 uuid;
  v_receipt1 uuid; v_receipt2 uuid; v_receipt3 uuid;
  v_nc uuid;
  v_on numeric; v_count int;
begin
  select id into v_admin from public.profiles
  where active=true and global_role='ADMIN'::public.global_role order by created_at limit 1;
  select id into v_store from public.stores where slug='eccellenze-della-costiera';
  if v_admin is null or v_store is null then raise exception 'Acceptance prerequisites missing'; end if;
  perform set_config('request.jwt.claim.sub',v_admin::text,true);

  insert into public.categories(name) values ('__proc_'||gen_random_uuid()::text) returning id into v_cat;
  insert into public.articles(name,category_id,base_unit,package_quantity) values ('__proc_a1_'||gen_random_uuid()::text,v_cat,'PZ',1) returning id into v_a1;
  insert into public.articles(name,category_id,base_unit,package_quantity) values ('__proc_a2_'||gen_random_uuid()::text,v_cat,'PZ',1) returning id into v_a2;
  insert into public.articles(name,category_id,base_unit,package_quantity) values ('__proc_a3_'||gen_random_uuid()::text,v_cat,'PZ',1) returning id into v_a3;
  insert into public.store_articles(store_id,article_id,min_stock,target_stock) values(v_store,v_a1,5,10) returning id into v_sa1;
  insert into public.store_articles(store_id,article_id,min_stock,target_stock) values(v_store,v_a2,1,5) returning id into v_sa2;
  insert into public.store_articles(store_id,article_id,min_stock,target_stock) values(v_store,v_a3,2,8) returning id into v_sa3;

  insert into public.suppliers(name) values ('__proc_s1_'||gen_random_uuid()::text) returning id into v_s1;
  insert into public.suppliers(name) values ('__proc_s2_'||gen_random_uuid()::text) returning id into v_s2;
  insert into public.store_suppliers(store_id,supplier_id,active) values(v_store,v_s1,true) returning id into v_ss1;
  insert into public.store_suppliers(store_id,supplier_id,active) values(v_store,v_s2,true) returning id into v_ss2;
  insert into public.store_article_suppliers(store_id,store_article_id,store_supplier_id,current_package_price,is_preferred,active)
    values(v_store,v_sa1,v_ss1,2,true,true) returning id into v_link1;
  insert into public.store_article_suppliers(store_id,store_article_id,store_supplier_id,current_package_price,is_preferred,active)
    values(v_store,v_sa2,v_ss2,3,true,true) returning id into v_link2;
  insert into public.store_article_suppliers(store_id,store_article_id,store_supplier_id,current_package_price,is_preferred,active)
    values(v_store,v_sa3,v_ss1,4,true,true) returning id into v_link3;

  v_result := public.orders_create_drafts(
    v_store,
    jsonb_build_array(
      jsonb_build_object('storeArticleId',v_sa1,'storeArticleSupplierId',v_link1,'quantityBase',10),
      jsonb_build_object('storeArticleId',v_sa2,'storeArticleSupplierId',v_link2,'quantityBase',2),
      jsonb_build_object('storeArticleId',v_sa3,'storeArticleSupplierId',v_link3,'quantityBase',5)
    ),
    null,'proc-create'
  );

  if jsonb_array_length(v_result->'orderIds')<>2 then raise exception 'Expected two supplier orders'; end if;
  if public.orders_create_drafts(v_store,jsonb_build_array(jsonb_build_object('storeArticleId',v_sa1,'storeArticleSupplierId',v_link1,'quantityBase',10)),null,'proc-create')<>v_result then
    raise exception 'Create-drafts retry must be idempotent';
  end if;

  select id into v_order1 from public.supplier_orders where store_supplier_id=v_ss1;
  select id into v_order2 from public.supplier_orders where store_supplier_id=v_ss2;
  select id into v_line1 from public.supplier_order_lines where order_id=v_order1 and store_article_id=v_sa1;
  select id into v_line3 from public.supplier_order_lines where order_id=v_order1 and store_article_id=v_sa3;
  select id into v_line2 from public.supplier_order_lines where order_id=v_order2 and store_article_id=v_sa2;

  if (select estimated_total from public.supplier_orders where id=v_order1)<>40 then
    raise exception 'Frozen estimated total mismatch';
  end if;

  perform public.orders_mark_ordered(v_order1,'proc-order1-ordered');

  begin
    perform public.orders_confirm_receipt(
      v_order1,'DDT-1',current_date,33.2,0,null,null,
      jsonb_build_array(
        jsonb_build_object('orderLineId',v_line1,'documentedQuantity',10,'receivedQuantity',6,'acceptedQuantity',6,'documentPackagePrice',2.2,'priceChangeConfirmed',false,'outcome','PARTIAL_QUANTITY','resolution','NEXT_DELIVERY'),
        jsonb_build_object('orderLineId',v_line3,'documentedQuantity',0,'receivedQuantity',5,'acceptedQuantity',5,'documentPackagePrice',null,'priceChangeConfirmed',false,'outcome','UNBILLED','resolution','NO_ACTION','note','Merce presente ma non fatturata')
      ),
      'proc-receipt1-rejected'
    );
    raise exception 'Expected price confirmation rejection';
  exception when others then
    if position('Receipt price change requires confirmation' in sqlerrm)=0 then raise; end if;
  end;

  v_receipt1 := public.orders_confirm_receipt(
    v_order1,'DDT-1',current_date,33.2,0,'Totale DDT comprende righe non valorizzate nell’app',null,
    jsonb_build_array(
      jsonb_build_object('orderLineId',v_line1,'documentedQuantity',10,'receivedQuantity',6,'acceptedQuantity',6,'documentPackagePrice',2.2,'priceChangeConfirmed',true,'outcome','PARTIAL_QUANTITY','resolution','NEXT_DELIVERY'),
      jsonb_build_object('orderLineId',v_line3,'documentedQuantity',0,'receivedQuantity',5,'acceptedQuantity',5,'documentPackagePrice',null,'priceChangeConfirmed',false,'outcome','UNBILLED','resolution','NO_ACTION','note','Merce presente ma non fatturata')
    ),
    'proc-receipt1'
  );

  if public.orders_confirm_receipt(
    v_order1,'DDT-1',current_date,33.2,0,'Totale DDT comprende righe non valorizzate nell’app',null,
    jsonb_build_array(
      jsonb_build_object('orderLineId',v_line1,'documentedQuantity',10,'receivedQuantity',6,'acceptedQuantity',6,'documentPackagePrice',2.2,'priceChangeConfirmed',true,'outcome','PARTIAL_QUANTITY','resolution','NEXT_DELIVERY'),
      jsonb_build_object('orderLineId',v_line3,'documentedQuantity',0,'receivedQuantity',5,'acceptedQuantity',5,'documentPackagePrice',null,'priceChangeConfirmed',false,'outcome','UNBILLED','resolution','NO_ACTION')
    ),
    'proc-receipt1'
  )<>v_receipt1 then raise exception 'Receipt retry must return same id'; end if;

  if (select status from public.supplier_orders where id=v_order1)<>'PARTIALLY_RECEIVED' then raise exception 'Order should be partial'; end if;
  if (select accepted_quantity_base from public.supplier_order_lines where id=v_line1)<>6 then raise exception 'Accepted quantity mismatch'; end if;
  select on_hand into v_on from public.stock_balances where store_article_id=v_sa1;
  if v_on<>6 then raise exception 'Accepted stock expected 6, got %',v_on; end if;
  select on_hand into v_on from public.stock_balances where store_article_id=v_sa3;
  if v_on<>5 then raise exception 'Unbilled accepted stock expected 5, got %',v_on; end if;
  if (select count(*) from public.stock_movements where source_id=v_receipt1 and movement_type='SUPPLIER_RECEIPT')<>2 then raise exception 'Receipt must create two movements'; end if;
  if not exists(select 1 from public.purchase_price_history where store_article_supplier_id=v_link1 and source='RECEIPT' and package_price=2.2) then raise exception 'Receipt price history missing'; end if;

  v_receipt2 := public.orders_confirm_receipt(
    v_order1,'DDT-2',current_date,8.8,0,null,null,
    jsonb_build_array(
      jsonb_build_object('orderLineId',v_line1,'documentedQuantity',4,'receivedQuantity',4,'acceptedQuantity',4,'documentPackagePrice',2.2,'priceChangeConfirmed',false,'outcome','CONFORMING')
    ),
    'proc-receipt2'
  );
  if (select status from public.supplier_orders where id=v_order1)<>'COMPLETED' then raise exception 'Order should be completed'; end if;
  select on_hand into v_on from public.stock_balances where store_article_id=v_sa1;
  if v_on<>10 then raise exception 'Final received stock expected 10, got %',v_on; end if;
  if exists(select 1 from public.supplier_nonconformities where order_line_id=v_line1 and status in ('OPEN','AWAITING_REPLACEMENT')) then
    raise exception 'Next-delivery NC should resolve after completion';
  end if;

  perform public.orders_mark_ordered(v_order2,'proc-order2-ordered');
  v_receipt3 := public.orders_confirm_receipt(
    v_order2,'DDT-Q',current_date,6,0,null,null,
    jsonb_build_array(
      jsonb_build_object('orderLineId',v_line2,'documentedQuantity',2,'receivedQuantity',2,'acceptedQuantity',0,'documentPackagePrice',3,'priceChangeConfirmed',false,'outcome','QUALITY_NOT_SUITABLE','resolution','CREDIT_NOTE','note','Qualità rifiutata')
    ),
    'proc-receipt3'
  );
  select id into v_nc from public.supplier_nonconformities where receipt_id=v_receipt3 and order_line_id=v_line2;
  if v_nc is null or (select status from public.supplier_nonconformities where id=v_nc)<>'AWAITING_CREDIT_NOTE' then raise exception 'Credit-note NC missing'; end if;
  if exists(select 1 from public.stock_movements where source_id=v_receipt3) then raise exception 'Rejected goods must not enter stock'; end if;

  perform public.orders_record_credit_note(v_nc,'NC-1',current_date,6,'Ricevuta','proc-credit');
  if (select status from public.supplier_nonconformities where id=v_nc)<>'RESOLVED' then raise exception 'Credit-note NC not resolved'; end if;
  if (select status from public.supplier_orders where id=v_order2)<>'COMPLETED' then raise exception 'Order should close after credit note'; end if;

  select count(*) into v_count from public.procurement_operations where operation_key like 'proc-%';
  if v_count<7 then raise exception 'Procurement audit operations missing'; end if;
end $$;

rollback;
select 'PROCUREMENT_ACCEPTANCE_PASS_ROLLED_BACK' as result;
