-- Extraordinary inventory + anomaly acceptance. Must leave no test data behind.
begin;

do $$
declare
  v_admin uuid;
  v_store uuid;
  v_cat uuid;
  v_a_ok uuid; v_a_diff uuid; v_a_atomic_ok uuid; v_a_atomic_block uuid; v_a_unknown uuid;
  v_sa_ok uuid := '00000000-0000-0000-0000-00000000e101'::uuid;
  v_sa_diff uuid := '00000000-0000-0000-0000-00000000e102'::uuid;
  v_sa_atomic_ok uuid := '00000000-0000-0000-0000-00000000e201'::uuid;
  v_sa_atomic_block uuid := '00000000-0000-0000-0000-00000000e202'::uuid;
  v_sa_unknown uuid := '00000000-0000-0000-0000-00000000e301'::uuid;
  v_s_ok uuid; v_s_diff uuid; v_s_atomic uuid; v_s_missing_reason uuid; v_s_unknown uuid;
  v_l_ok uuid; v_l_diff uuid; v_l_atomic_ok uuid; v_l_atomic_block uuid; v_l_missing uuid; v_l_unknown uuid;
  v_anomaly uuid; v_unknown_anomaly uuid;
  v_reservation uuid;
  v_counted_at timestamptz;
  v_on numeric;
  v_before_movements int;
  v_before_anomalies int;
  v_before_notifications int;
  v_after_notifications int;
  v_status public.stock_anomaly_status;
  v_final public.inventory_reason;
begin
  select id into v_admin
  from public.profiles
  where active=true and global_role='ADMIN'::public.global_role
  order by created_at limit 1;
  select id into v_store from public.stores where slug='eccellenze-della-costiera';
  if v_admin is null or v_store is null then raise exception 'Extraordinary acceptance prerequisites missing'; end if;
  perform set_config('request.jwt.claim.sub',v_admin::text,true);

  insert into public.categories(name)
  values ('__inv_extra_'||gen_random_uuid()::text)
  returning id into v_cat;

  insert into public.articles(name,category_id,base_unit,package_quantity) values ('__extra_ok_'||gen_random_uuid()::text,v_cat,'PZ',1) returning id into v_a_ok;
  insert into public.articles(name,category_id,base_unit,package_quantity) values ('__extra_diff_'||gen_random_uuid()::text,v_cat,'PZ',1) returning id into v_a_diff;
  insert into public.articles(name,category_id,base_unit,package_quantity) values ('__extra_atomic_ok_'||gen_random_uuid()::text,v_cat,'PZ',1) returning id into v_a_atomic_ok;
  insert into public.articles(name,category_id,base_unit,package_quantity) values ('__extra_atomic_block_'||gen_random_uuid()::text,v_cat,'PZ',1) returning id into v_a_atomic_block;
  insert into public.articles(name,category_id,base_unit,package_quantity) values ('__extra_unknown_'||gen_random_uuid()::text,v_cat,'PZ',1) returning id into v_a_unknown;

  insert into public.store_articles(id,store_id,article_id,min_stock,target_stock) values(v_sa_ok,v_store,v_a_ok,0,20);
  insert into public.store_articles(id,store_id,article_id,min_stock,target_stock) values(v_sa_diff,v_store,v_a_diff,0,20);
  insert into public.store_articles(id,store_id,article_id,min_stock,target_stock) values(v_sa_atomic_ok,v_store,v_a_atomic_ok,0,20);
  insert into public.store_articles(id,store_id,article_id,min_stock,target_stock) values(v_sa_atomic_block,v_store,v_a_atomic_block,0,20);
  insert into public.store_articles(id,store_id,article_id,min_stock,target_stock) values(v_sa_unknown,v_store,v_a_unknown,0,20);

  perform public.admin_adjust_stock(v_sa_ok,5,'Extra acceptance seed','extra-seed-ok');
  perform public.admin_adjust_stock(v_sa_diff,10,'Extra acceptance seed','extra-seed-diff');
  perform public.admin_adjust_stock(v_sa_atomic_ok,10,'Extra acceptance seed','extra-seed-atomic-ok');
  perform public.admin_adjust_stock(v_sa_atomic_block,10,'Extra acceptance seed','extra-seed-atomic-block');
  perform public.admin_adjust_stock(v_sa_unknown,6,'Extra acceptance seed','extra-seed-unknown');

  -- Conforme: chiude sessione ma non crea né movimento né anomalia.
  v_s_ok := public.inventory_start(v_store,'EXTRAORDINARY'::public.inventory_type,array[v_sa_ok],'extra-ok-start');
  select id into v_l_ok from public.inventory_lines where session_id=v_s_ok and store_article_id=v_sa_ok;
  perform public.inventory_save_count(v_s_ok,v_l_ok,5,null,null);
  v_before_movements := (select count(*) from public.stock_movements where source_id=v_s_ok);
  v_before_anomalies := (select count(*) from public.stock_anomalies where source_id=v_s_ok);
  perform public.inventory_confirm_extraordinary(v_s_ok,'extra-ok-confirm');
  if (select status from public.inventory_sessions where id=v_s_ok)<>'CLOSED'::public.inventory_status then raise exception 'Conforming extraordinary session did not close'; end if;
  if (select count(*) from public.stock_movements where source_id=v_s_ok)<>v_before_movements then raise exception 'Conforming extraordinary count created movement'; end if;
  if (select count(*) from public.stock_anomalies where source_id=v_s_ok)<>v_before_anomalies then raise exception 'Conforming extraordinary count created anomaly'; end if;

  -- Differenza + movimento successivo al conteggio: delta resta -2 e saldo finale 13.
  v_s_diff := public.inventory_start(v_store,'EXTRAORDINARY'::public.inventory_type,array[v_sa_diff],'extra-diff-start');
  select id into v_l_diff from public.inventory_lines where session_id=v_s_diff and store_article_id=v_sa_diff;
  perform public.inventory_save_count(v_s_diff,v_l_diff,8,'MISSING_MOVEMENT'::public.inventory_reason,null);
  select counted_at into v_counted_at from public.inventory_counts where inventory_line_id=v_l_diff and round_number=1;
  perform private.post_stock_movement(v_store,v_sa_diff,'ADMIN_ADJUSTMENT'::public.stock_movement_type,5,null,'ADMIN'::public.stock_source_type,null,null,null,'extra-after-count','Later legitimate movement',v_counted_at + interval '1 second');
  v_before_notifications := (select count(*) from public.notifications where entity_type='inventory_session' and entity_id=v_s_diff and type='EXTRAORDINARY_ADJUSTMENT_REVIEW_REQUIRED'::public.notification_type);
  perform public.inventory_confirm_extraordinary(v_s_diff,'extra-diff-confirm');
  select on_hand into v_on from public.stock_balances where store_article_id=v_sa_diff;
  if v_on<>13 then raise exception 'Extraordinary timing expected on_hand 13, got %',v_on; end if;
  if (select count(*) from public.stock_movements where source_id=v_s_diff and source_line_id=v_l_diff and movement_type='EXTRAORDINARY_ADJUSTMENT'::public.stock_movement_type and quantity_delta_base=-2)<>1 then
    raise exception 'Extraordinary adjustment -2 missing or duplicated';
  end if;
  if (select count(*) from public.stock_anomalies where source_id=v_s_diff and source_line_id=v_l_diff and status='TO_VERIFY'::public.stock_anomaly_status)<>1 then
    raise exception 'Extraordinary anomaly missing or duplicated';
  end if;
  select id into v_anomaly from public.stock_anomalies where source_id=v_s_diff and source_line_id=v_l_diff;
  v_after_notifications := (select count(*) from public.notifications where entity_type='inventory_session' and entity_id=v_s_diff and type='EXTRAORDINARY_ADJUSTMENT_REVIEW_REQUIRED'::public.notification_type);
  if v_after_notifications<=v_before_notifications then raise exception 'Extraordinary notification not created'; end if;

  -- Retry: nessun duplicato di movimento, anomalia o notifica.
  perform public.inventory_confirm_extraordinary(v_s_diff,'extra-diff-confirm');
  if (select count(*) from public.stock_movements where source_id=v_s_diff and source_line_id=v_l_diff and movement_type='EXTRAORDINARY_ADJUSTMENT'::public.stock_movement_type)<>1 then raise exception 'Retry duplicated extraordinary movement'; end if;
  if (select count(*) from public.stock_anomalies where source_id=v_s_diff and source_line_id=v_l_diff)<>1 then raise exception 'Retry duplicated anomaly'; end if;
  if (select count(*) from public.notifications where entity_type='inventory_session' and entity_id=v_s_diff and type='EXTRAORDINARY_ADJUSTMENT_REVIEW_REQUIRED'::public.notification_type)<>v_after_notifications then raise exception 'Retry duplicated notification'; end if;

  -- Motivo obbligatorio quando il fisico differisce dal teorico.
  v_s_missing_reason := public.inventory_start(v_store,'EXTRAORDINARY'::public.inventory_type,array[v_sa_unknown],'extra-missing-reason-start');
  select id into v_l_missing from public.inventory_lines where session_id=v_s_missing_reason and store_article_id=v_sa_unknown;
  perform public.inventory_save_count(v_s_missing_reason,v_l_missing,5,null,null);
  begin
    perform public.inventory_confirm_extraordinary(v_s_missing_reason,'extra-missing-reason-confirm');
    raise exception 'Expected preliminary reason rejection';
  exception when others then
    if position('Preliminary reason is required' in sqlerrm)=0 then raise; end if;
  end;
  if (select status from public.inventory_sessions where id=v_s_missing_reason)<>'IN_PROGRESS'::public.inventory_status then raise exception 'Failed confirmation changed session state'; end if;

  -- Atomicità multi-riga: prima riga sarebbe -1, seconda -2 ma ha 9 riservati; tutto rollback.
  v_s_atomic := public.inventory_start(v_store,'EXTRAORDINARY'::public.inventory_type,array[v_sa_atomic_ok,v_sa_atomic_block],'extra-atomic-start');
  select id into v_l_atomic_ok from public.inventory_lines where session_id=v_s_atomic and store_article_id=v_sa_atomic_ok;
  select id into v_l_atomic_block from public.inventory_lines where session_id=v_s_atomic and store_article_id=v_sa_atomic_block;
  perform public.inventory_save_count(v_s_atomic,v_l_atomic_ok,9,'PREVIOUS_ERROR'::public.inventory_reason,null);
  perform public.inventory_save_count(v_s_atomic,v_l_atomic_block,8,'PREVIOUS_ERROR'::public.inventory_reason,null);
  v_reservation := private.open_stock_reservation(v_store,v_sa_atomic_block,9,'STORE_SUPPLY'::public.stock_reservation_type,v_s_atomic,v_l_atomic_block,'extra-atomic-reservation');
  begin
    perform public.inventory_confirm_extraordinary(v_s_atomic,'extra-atomic-confirm');
    raise exception 'Expected reserved-stock rejection';
  exception when others then
    if position('Reserved quantity exceeds resulting stock' in sqlerrm)=0 then raise; end if;
  end;
  if (select on_hand from public.stock_balances where store_article_id=v_sa_atomic_ok)<>10 then raise exception 'Atomic rollback failed on first line stock'; end if;
  if exists(select 1 from public.stock_movements where source_id=v_s_atomic and movement_type='EXTRAORDINARY_ADJUSTMENT'::public.stock_movement_type) then raise exception 'Atomic rollback left movement'; end if;
  if exists(select 1 from public.stock_anomalies where source_id=v_s_atomic) then raise exception 'Atomic rollback left anomaly'; end if;
  if (select status from public.inventory_sessions where id=v_s_atomic)<>'IN_PROGRESS'::public.inventory_status then raise exception 'Atomic rollback changed session state'; end if;
  perform private.release_stock_reservation(v_reservation);

  -- Workflow anomalia: start review -> resolve; resolve senza nota è rifiutato.
  perform public.anomaly_start_review(v_anomaly,'extra-anomaly-review');
  select status into v_status from public.stock_anomalies where id=v_anomaly;
  if v_status<>'IN_REVIEW'::public.stock_anomaly_status then raise exception 'Anomaly did not enter review'; end if;
  begin
    perform public.anomaly_resolve(v_anomaly,'PREVIOUS_ERROR'::public.inventory_reason,'','extra-anomaly-resolve-blank');
    raise exception 'Expected resolution note rejection';
  exception when others then
    if position('Resolution note is required' in sqlerrm)=0 then raise; end if;
  end;
  perform public.anomaly_resolve(v_anomaly,'PREVIOUS_ERROR'::public.inventory_reason,'Errore verificato e azione correttiva registrata.','extra-anomaly-resolve');
  select status,final_reason into v_status,v_final from public.stock_anomalies where id=v_anomaly;
  if v_status<>'RESOLVED'::public.stock_anomaly_status or v_final<>'PREVIOUS_ERROR'::public.inventory_reason then raise exception 'Anomaly resolution state invalid'; end if;
  perform public.anomaly_resolve(v_anomaly,'PREVIOUS_ERROR'::public.inventory_reason,'Errore verificato e azione correttiva registrata.','extra-anomaly-resolve');

  -- Seconda anomalia chiusa senza causa determinata.
  v_s_unknown := public.inventory_start(v_store,'EXTRAORDINARY'::public.inventory_type,array[v_sa_unknown],'extra-unknown-start');
  select id into v_l_unknown from public.inventory_lines where session_id=v_s_unknown and store_article_id=v_sa_unknown;
  perform public.inventory_save_count(v_s_unknown,v_l_unknown,5,'UNKNOWN'::public.inventory_reason,null);
  perform public.inventory_confirm_extraordinary(v_s_unknown,'extra-unknown-confirm');
  select id into v_unknown_anomaly from public.stock_anomalies where source_id=v_s_unknown and source_line_id=v_l_unknown;
  perform public.anomaly_close_unknown(v_unknown_anomaly,'Indagine conclusa senza causa certa.','extra-unknown-close');
  select status,final_reason into v_status,v_final from public.stock_anomalies where id=v_unknown_anomaly;
  if v_status<>'CLOSED_UNKNOWN'::public.stock_anomaly_status or v_final<>'UNKNOWN'::public.inventory_reason then raise exception 'Unknown anomaly closure invalid'; end if;
end $$;

rollback;
select 'INVENTORY_EXTRAORDINARY_ACCEPTANCE_PASS_ROLLED_BACK' as result;
