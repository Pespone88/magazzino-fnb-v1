-- Inventory workflow acceptance. Must leave no test data behind.
begin;

do $$
declare
  v_admin uuid;
  v_store uuid;
  v_other_store uuid;
  v_category uuid;
  v_article1 uuid; v_article2 uuid; v_article3 uuid; v_other_article uuid;
  v_sa1 uuid; v_sa2 uuid; v_sa3 uuid; v_other_sa uuid;
  v_session uuid; v_session_retry uuid;
  v_line1 uuid; v_line2 uuid;
  v_count1 uuid; v_count1_retry uuid;
  v_counted numeric;
  v_rows int;
  v_round int;
  v_status public.inventory_status;
begin
  select id into v_admin
  from public.profiles
  where active=true and global_role='ADMIN'::public.global_role
  order by created_at limit 1;

  select id into v_store from public.stores where slug='eccellenze-della-costiera';
  select id into v_other_store from public.stores where slug='nonna-titti';
  if v_admin is null or v_store is null or v_other_store is null then
    raise exception 'Inventory acceptance prerequisites missing';
  end if;

  perform set_config('request.jwt.claim.sub',v_admin::text,true);

  insert into public.categories(name)
  values ('__inventory_accept_'||gen_random_uuid()::text)
  returning id into v_category;

  insert into public.articles(name,category_id,base_unit,package_quantity)
  values ('__inv_a1_'||gen_random_uuid()::text,v_category,'PZ',1)
  returning id into v_article1;
  insert into public.articles(name,category_id,base_unit,package_quantity)
  values ('__inv_a2_'||gen_random_uuid()::text,v_category,'PZ',1)
  returning id into v_article2;
  insert into public.articles(name,category_id,base_unit,package_quantity)
  values ('__inv_inactive_'||gen_random_uuid()::text,v_category,'PZ',1)
  returning id into v_article3;
  insert into public.articles(name,category_id,base_unit,package_quantity)
  values ('__inv_other_'||gen_random_uuid()::text,v_category,'PZ',1)
  returning id into v_other_article;

  insert into public.store_articles(store_id,article_id,min_stock,target_stock,active)
  values (v_store,v_article1,0,10,true) returning id into v_sa1;
  insert into public.store_articles(store_id,article_id,min_stock,target_stock,active)
  values (v_store,v_article2,0,10,true) returning id into v_sa2;
  insert into public.store_articles(store_id,article_id,min_stock,target_stock,active)
  values (v_store,v_article3,0,10,false) returning id into v_sa3;
  insert into public.store_articles(store_id,article_id,min_stock,target_stock,active)
  values (v_other_store,v_other_article,0,10,true) returning id into v_other_sa;

  v_session := public.inventory_start(v_store,'MONTHLY'::public.inventory_type,null,'inv-acc-start');
  v_session_retry := public.inventory_start(v_store,'MONTHLY'::public.inventory_type,null,'inv-acc-start');
  if v_session_retry<>v_session then raise exception 'Start idempotency failed'; end if;

  select count(*) into v_rows from public.inventory_lines where session_id=v_session;
  if v_rows<>2 then raise exception 'Monthly snapshot must include exactly two active store articles, got %',v_rows; end if;
  if exists(select 1 from public.inventory_lines where session_id=v_session and store_article_id in (v_sa3,v_other_sa)) then
    raise exception 'Inactive or cross-store article leaked into snapshot';
  end if;

  select id into v_line1 from public.inventory_lines where session_id=v_session and store_article_id=v_sa1;
  select id into v_line2 from public.inventory_lines where session_id=v_session and store_article_id=v_sa2;

  v_count1 := public.inventory_save_count(v_session,v_line1,0.375,null,null);
  v_count1_retry := public.inventory_save_count(v_session,v_line1,0.500,null,null);
  if v_count1_retry<>v_count1 then raise exception 'Draft update created duplicate count'; end if;
  select counted_quantity into v_counted from public.inventory_counts where id=v_count1;
  if v_counted<>0.500 then raise exception 'Draft count update failed'; end if;

  perform public.inventory_save_count(v_session,v_line2,2,null,null);
  perform public.inventory_submit_round(v_session,'inv-acc-submit-1');

  begin
    perform public.inventory_save_count(v_session,v_line1,0.750,null,null);
    raise exception 'Expected submitted-count immutability';
  exception when others then
    if position('Submitted inventory count is immutable' in sqlerrm)=0
      and position('Inventory count unavailable in current state' in sqlerrm)=0 then raise; end if;
  end;

  perform public.inventory_accept_lines(v_session,array[v_line1],'inv-acc-accept-1');
  perform public.inventory_request_recount(v_session,array[v_line2],'inv-acc-recount-1');

  select current_round into v_round from public.inventory_lines where id=v_line2;
  if v_round<>2 then raise exception 'Recount did not increment round'; end if;
  if not exists(select 1 from public.inventory_counts where inventory_line_id=v_line2 and round_number=1 and submitted_at is not null) then
    raise exception 'Previous recount round was not preserved';
  end if;

  perform public.inventory_save_count(v_session,v_line2,1.250,null,null);
  perform public.inventory_submit_round(v_session,'inv-acc-submit-2');

  select status into v_status from public.inventory_sessions where id=v_session;
  if v_status<>'IN_REVIEW'::public.inventory_status then raise exception 'Session did not return to review'; end if;
  if (select count(*) from public.inventory_counts where inventory_line_id=v_line2)<>2 then
    raise exception 'Recount history must contain both rounds';
  end if;
end $$;

rollback;
select 'INVENTORY_CORE_ACCEPTANCE_PASS_ROLLED_BACK' as result;
