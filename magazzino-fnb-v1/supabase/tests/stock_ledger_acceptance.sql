-- Stock ledger acceptance. Must leave no test data behind.
begin;

do $$
declare
  v_admin uuid;
  v_s1 uuid;
  v_s2 uuid;
  v_cat uuid; v_a1 uuid; v_a2 uuid; v_sa1 uuid; v_sa2 uuid;
  v_m1 uuid; v_m_prec uuid; v_m_neg uuid; v_rev uuid;
  v_r1 uuid; v_r2 uuid;
  v_on numeric; v_reserved numeric; v_available numeric; v_sum numeric; v_open_sum numeric;
  v_delta numeric; v_cost numeric;
begin
  select id into v_admin from public.profiles where active=true and global_role='ADMIN' order by created_at limit 1;
  select id into v_s1 from public.stores where slug='eccellenze-della-costiera';
  select id into v_s2 from public.stores where slug='nonna-titti';
  if v_admin is null or v_s1 is null or v_s2 is null then raise exception 'Acceptance prerequisites missing'; end if;

  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  perform set_config('app.stock_test.admin',v_admin::text,true);

  insert into public.categories(name) values ('__stock_accept_'||gen_random_uuid()::text) returning id into v_cat;
  insert into public.articles(name,category_id,base_unit,package_quantity)
    values ('__stock_a1_'||gen_random_uuid()::text,v_cat,'PZ',1) returning id into v_a1;
  insert into public.articles(name,category_id,base_unit,package_quantity)
    values ('__stock_a2_'||gen_random_uuid()::text,v_cat,'PZ',1) returning id into v_a2;
  insert into public.store_articles(store_id,article_id,min_stock,target_stock)
    values (v_s1,v_a1,0,20) returning id into v_sa1;
  insert into public.store_articles(store_id,article_id,min_stock,target_stock)
    values (v_s2,v_a2,0,20) returning id into v_sa2;

  perform set_config('app.stock_test.store1',v_s1::text,true);
  perform set_config('app.stock_test.store2',v_s2::text,true);
  perform set_config('app.stock_test.sa1',v_sa1::text,true);
  perform set_config('app.stock_test.sa2',v_sa2::text,true);

  v_m1 := public.admin_adjust_stock(v_sa1,10,'Acceptance opening','acc-open-s1');
  perform public.admin_adjust_stock(v_sa2,8,'Acceptance opening','acc-open-s2');
  v_m_prec := public.admin_adjust_stock(v_sa1,0.375,'Precision','acc-precision');

  select unit_cost_snapshot into v_cost from public.stock_movements where id=v_m1;
  if v_cost is not null then raise exception 'Unknown cost must remain NULL'; end if;

  select on_hand,reserved,available into v_on,v_reserved,v_available from public.stock_balances where store_article_id=v_sa1;
  if v_on<>10.375 or v_reserved<>0 or v_available<>10.375 then raise exception 'Initial balance mismatch'; end if;

  v_r1 := private.open_stock_reservation(v_s1,v_sa1,2,'STORE_SUPPLY',gen_random_uuid(),null,'acc-res-open');
  select on_hand,reserved,available into v_on,v_reserved,v_available from public.stock_balances where store_article_id=v_sa1;
  if v_on<>10.375 or v_reserved<>2 or v_available<>8.375 then raise exception 'Reservation projection mismatch'; end if;

  begin
    perform private.open_stock_reservation(v_s1,v_sa1,9,'STORE_SUPPLY',gen_random_uuid(),null,'acc-res-too-much');
    raise exception 'Expected reservation rejection';
  exception when others then
    if position('Reservation exceeds available stock' in sqlerrm)=0 then raise; end if;
  end;

  begin
    perform public.admin_adjust_stock(v_sa1,-100,'Negative test','acc-negative');
    raise exception 'Expected negative-stock rejection';
  exception when others then
    if position('Stock would become negative' in sqlerrm)=0 then raise; end if;
  end;

  v_m_neg := public.admin_adjust_stock(v_sa1,-1,'Reversal target','acc-neg-one');
  v_rev := public.admin_reverse_stock_movement(v_m_neg,'Undo test','acc-reverse-one');
  if not exists(select 1 from public.stock_movements where id=v_m_neg) then raise exception 'Original movement disappeared'; end if;
  if (select count(*) from public.stock_movements where reversal_of_movement_id=v_m_neg)<>1 then raise exception 'Reversal row missing'; end if;

  begin
    perform public.admin_reverse_stock_movement(v_m_neg,'Again','acc-reverse-two');
    raise exception 'Expected already-reversed rejection';
  exception when others then
    if position('Movement already reversed' in sqlerrm)=0 then raise; end if;
  end;
  begin
    perform public.admin_reverse_stock_movement(v_rev,'Reverse reversal','acc-reverse-reversal');
    raise exception 'Expected reversal-of-reversal rejection';
  exception when others then
    if position('Movement not reversible' in sqlerrm)=0 then raise; end if;
  end;

  v_r2 := private.open_stock_reservation(v_s1,v_sa1,1,'STORE_SUPPLY',gen_random_uuid(),null,'acc-res-consume');
  perform private.consume_stock_reservation(v_r2,'STORE_SUPPLY',null,'STORE_SUPPLY','acc-consume-move','Acceptance consume');
  perform private.release_stock_reservation(v_r1);

  select on_hand,reserved,available into v_on,v_reserved,v_available from public.stock_balances where store_article_id=v_sa1;
  select coalesce(sum(quantity_delta_base),0) into v_sum from public.stock_movements where store_article_id=v_sa1;
  select coalesce(sum(quantity_base),0) into v_open_sum from public.stock_reservations where store_article_id=v_sa1 and status='OPEN';
  if v_on<>v_sum then raise exception 'Ledger sum does not equal on_hand'; end if;
  if v_reserved<>v_open_sum then raise exception 'Open reservations do not equal reserved'; end if;
  if v_available<>v_on-v_reserved then raise exception 'Available projection mismatch'; end if;
  if v_on<0 or v_reserved<0 or v_reserved>v_on then raise exception 'Negative/invalid stock invariant'; end if;

  begin
    perform private.ensure_stock_balance(v_sa1,v_s2);
    raise exception 'Expected store/article mismatch rejection';
  exception when others then
    if position('Invalid store/article relationship' in sqlerrm)=0 then raise; end if;
  end;

  select quantity_delta_base into v_delta from public.stock_movements where id=v_m_prec;
  if v_delta<>0.375 then raise exception '0.375 precision lost'; end if;
end $$;

-- Cross-store RLS: temporarily turn the selected Admin into an Eccellenze-only user.
update public.profiles set global_role='USER'::public.global_role where id=current_setting('app.stock_test.admin')::uuid;
insert into public.store_memberships(user_id,store_id,role,active)
values (current_setting('app.stock_test.admin')::uuid,current_setting('app.stock_test.store1')::uuid,'RESPONSABILE',true)
on conflict (user_id,store_id) do update set role='RESPONSABILE',active=true;

set local role authenticated;

do $$
declare
  v_sa1 uuid := current_setting('app.stock_test.sa1')::uuid;
  v_sa2 uuid := current_setting('app.stock_test.sa2')::uuid;
  v_store1 uuid := current_setting('app.stock_test.store1')::uuid;
  v_count int;
begin
  select count(*) into v_count from public.stock_balances where store_article_id=v_sa1;
  if v_count<>1 then raise exception 'Assigned-store balance not visible'; end if;
  select count(*) into v_count from public.stock_balances where store_article_id=v_sa2;
  if v_count<>0 then raise exception 'Cross-store balance leaked'; end if;
  select count(*) into v_count from public.stock_movements where store_article_id=v_sa2;
  if v_count<>0 then raise exception 'Cross-store movement leaked'; end if;

  begin
    insert into public.stock_balances(store_article_id,store_id,on_hand,reserved) values (v_sa1,v_store1,0,0);
    raise exception 'Expected direct balance write denial';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.admin_adjust_stock(v_sa1,1,'Unauthorized','acc-user-admin');
    raise exception 'Expected non-admin RPC rejection';
  exception when others then
    if position('Stock administration requires ADMIN' in sqlerrm)=0 then raise; end if;
  end;
end $$;

reset role;
update public.profiles set global_role='ADMIN'::public.global_role where id=current_setting('app.stock_test.admin')::uuid;
set local role authenticated;

do $$
declare
  v_sa1 uuid := current_setting('app.stock_test.sa1')::uuid;
  v_sa2 uuid := current_setting('app.stock_test.sa2')::uuid;
begin
  if (select count(*) from public.stock_balances where store_article_id in (v_sa1,v_sa2))<>2 then
    raise exception 'Admin cannot read both stores';
  end if;
end $$;

reset role;

do $$
declare
  v_m uuid;
begin
  select id into v_m from public.stock_movements where operation_key='acc-open-s1';
  begin
    update public.stock_movements set reason='tampered' where id=v_m;
    raise exception 'Expected immutable movement rejection';
  exception when others then
    if position('Stock movements are immutable' in sqlerrm)=0 then raise; end if;
  end;
end $$;

rollback;
select 'STOCK_LEDGER_ACCEPTANCE_PASS_ROLLED_BACK' as result;
