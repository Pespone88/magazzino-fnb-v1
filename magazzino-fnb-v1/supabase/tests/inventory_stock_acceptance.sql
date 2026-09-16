-- Inventory stock approval acceptance. Must leave no test data behind.
begin;

do $$
declare
  v_admin uuid;
  v_store_open uuid;
  v_store_month uuid;
  v_cat uuid;
  v_a1 uuid; v_a2 uuid; v_a3 uuid; v_am uuid;
  v_sa1 uuid; v_sa2 uuid; v_sa3 uuid; v_sam uuid;
  v_open uuid; v_month uuid;
  v_l1 uuid; v_l2 uuid; v_l3 uuid; v_lm uuid;
  v_before_count timestamptz;
  v_after_move uuid;
  v_on numeric;
  v_movements int;
begin
  select id into v_admin from public.profiles
  where active=true and global_role='ADMIN'::public.global_role
  order by created_at limit 1;
  select id into v_store_open from public.stores where slug='eccellenze-della-costiera';
  select id into v_store_month from public.stores where slug='nonna-titti';
  if v_admin is null or v_store_open is null or v_store_month is null then raise exception 'Acceptance prerequisites missing'; end if;
  perform set_config('request.jwt.claim.sub',v_admin::text,true);

  insert into public.categories(name) values ('__inv_stock_'||gen_random_uuid()::text) returning id into v_cat;
  insert into public.articles(name,category_id,base_unit,package_quantity) values ('__open_2_'||gen_random_uuid()::text,v_cat,'PZ',1) returning id into v_a1;
  insert into public.articles(name,category_id,base_unit,package_quantity) values ('__open_0_'||gen_random_uuid()::text,v_cat,'PZ',1) returning id into v_a2;
  insert into public.articles(name,category_id,base_unit,package_quantity) values ('__open_0375_'||gen_random_uuid()::text,v_cat,'PZ',1) returning id into v_a3;
  insert into public.articles(name,category_id,base_unit,package_quantity) values ('__monthly_'||gen_random_uuid()::text,v_cat,'PZ',1) returning id into v_am;
  insert into public.store_articles(store_id,article_id,min_stock,target_stock) values(v_store_open,v_a1,0,10) returning id into v_sa1;
  insert into public.store_articles(store_id,article_id,min_stock,target_stock) values(v_store_open,v_a2,0,10) returning id into v_sa2;
  insert into public.store_articles(store_id,article_id,min_stock,target_stock) values(v_store_open,v_a3,0,10) returning id into v_sa3;
  insert into public.store_articles(store_id,article_id,min_stock,target_stock) values(v_store_month,v_am,0,20) returning id into v_sam;

  -- OPENING: 2 / 0 / 0.375 -> only two ledger rows.
  v_open := public.inventory_start(v_store_open,'OPENING'::public.inventory_type,null,'inv-stock-open-start');
  select id into v_l1 from public.inventory_lines where session_id=v_open and store_article_id=v_sa1;
  select id into v_l2 from public.inventory_lines where session_id=v_open and store_article_id=v_sa2;
  select id into v_l3 from public.inventory_lines where session_id=v_open and store_article_id=v_sa3;
  perform public.inventory_save_count(v_open,v_l1,2,null,null);
  perform public.inventory_save_count(v_open,v_l2,0,null,null);
  perform public.inventory_save_count(v_open,v_l3,0.375,null,null);
  perform public.inventory_submit_round(v_open,'inv-stock-open-submit');
  perform public.inventory_accept_lines(v_open,array[v_l1,v_l2,v_l3],'inv-stock-open-accept');

  begin
    perform public.inventory_approve(v_open,'inv-stock-open-approve');
  exception when undefined_function then
    raise exception 'inventory_approve missing';
  end;

  select count(*) into v_movements from public.stock_movements
  where source_id=v_open and movement_type='OPENING_STOCK'::public.stock_movement_type;
  if v_movements<>2 then raise exception 'Opening must create exactly two nonzero movements, got %',v_movements; end if;
  if not exists(select 1 from public.stock_movements where source_id=v_open and source_line_id=v_l3 and quantity_delta_base=0.375) then
    raise exception 'Opening 0.375 movement missing or imprecise';
  end if;
  if exists(select 1 from public.stock_movements where source_id=v_open and source_line_id=v_l2) then
    raise exception 'Opening zero count must not create movement';
  end if;
  perform public.inventory_approve(v_open,'inv-stock-open-approve');
  if (select count(*) from public.stock_movements where source_id=v_open and movement_type='OPENING_STOCK'::public.stock_movement_type)<>2 then
    raise exception 'Opening retry duplicated movements';
  end if;
  perform public.inventory_close(v_open,'inv-stock-open-close');

  -- MONTHLY timing: snapshot 10, physical count 8, later +5, approval applies -2 => final 13.
  perform public.admin_adjust_stock(v_sam,10,'Acceptance seed','inv-stock-month-seed');
  v_month := public.inventory_start(v_store_month,'MONTHLY'::public.inventory_type,null,'inv-stock-month-start');
  select id into v_lm from public.inventory_lines where session_id=v_month and store_article_id=v_sam;
  perform public.inventory_save_count(v_month,v_lm,8,null,null);
  select counted_at into v_before_count from public.inventory_counts where inventory_line_id=v_lm and round_number=1;
  perform public.inventory_submit_round(v_month,'inv-stock-month-submit');
  perform public.inventory_accept_lines(v_month,array[v_lm],'inv-stock-month-accept');

  v_after_move := private.post_stock_movement(
    v_store_month,v_sam,'ADMIN_ADJUSTMENT'::public.stock_movement_type,5,null,
    'ADMIN'::public.stock_source_type,null,null,null,'inv-stock-after-count','Later legitimate movement',
    v_before_count + interval '1 second'
  );
  perform public.inventory_approve(v_month,'inv-stock-month-approve');

  select on_hand into v_on from public.stock_balances where store_article_id=v_sam;
  if v_on<>13 then raise exception 'Monthly timing expected on_hand 13, got %',v_on; end if;
  if (select count(*) from public.stock_movements where source_id=v_month and movement_type='INVENTORY_ADJUSTMENT'::public.stock_movement_type)<>1 then
    raise exception 'Monthly must create exactly one inventory adjustment';
  end if;
  if not exists(select 1 from public.stock_movements where source_id=v_month and source_line_id=v_lm and quantity_delta_base=-2) then
    raise exception 'Monthly adjustment must be -2 based on theoretical at count';
  end if;
end $$;

rollback;
select 'INVENTORY_STOCK_ACCEPTANCE_PASS_ROLLED_BACK' as result;
