create or replace function public.inventory_confirm_extraordinary(
  p_session_id uuid,
  p_operation_key text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_session public.inventory_sessions%rowtype;
  v_first boolean;
  v_line record;
  v_delta numeric;
  v_cost numeric;
  v_movement_id uuid;
  v_anomaly_count integer := 0;
  v_reason_text text;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;

  select * into v_session
  from public.inventory_sessions
  where id = p_session_id
  for update;
  if not found then raise exception 'Inventory not found'; end if;
  if v_session.inventory_type <> 'EXTRAORDINARY'::public.inventory_type then
    raise exception 'Inventory is not extraordinary';
  end if;
  if not private.inventory_can_count(v_session.store_id) then
    raise exception 'Inventory access denied';
  end if;

  v_first := private.inventory_claim_operation(
    p_operation_key,
    'CONFIRM_EXTRAORDINARY',
    p_session_id,
    null
  );
  if not v_first then return p_session_id; end if;

  if v_session.status <> 'IN_PROGRESS'::public.inventory_status then
    raise exception 'Extraordinary inventory is not open';
  end if;

  if exists (
    select 1
    from public.inventory_lines il
    where il.session_id = p_session_id
      and not exists (
        select 1
        from public.inventory_counts ic
        where ic.inventory_line_id = il.id
          and ic.round_number = il.current_round
          and ic.submitted_at is null
      )
  ) then
    raise exception 'Complete all extraordinary counts before confirmation';
  end if;

  for v_line in
    select il.store_article_id
    from public.inventory_lines il
    where il.session_id = p_session_id
    order by il.store_article_id
  loop
    perform private.ensure_stock_balance(v_line.store_article_id, v_session.store_id);
  end loop;

  for v_line in
    select
      il.id as line_id,
      il.store_article_id,
      ic.id as count_id,
      ic.counted_quantity,
      ic.counted_at,
      ic.preliminary_reason,
      ic.note
    from public.inventory_lines il
    join public.inventory_counts ic
      on ic.inventory_line_id = il.id
     and ic.round_number = il.current_round
    where il.session_id = p_session_id
    order by il.store_article_id
  loop
    v_delta := v_line.counted_quantity
      - private.inventory_theoretical_at(v_line.line_id, v_line.counted_at);

    if v_delta <> 0 then
      if v_line.preliminary_reason is null then
        raise exception 'Preliminary reason is required for inventory difference';
      end if;
      if v_line.preliminary_reason = 'OTHER'::public.inventory_reason
        and nullif(btrim(v_line.note), '') is null
      then
        raise exception 'Other reason requires note';
      end if;

      v_cost := private.current_stock_unit_cost(v_line.store_article_id);
      v_reason_text := 'Conteggio straordinario: ' || v_line.preliminary_reason::text;

      v_movement_id := private.post_stock_movement(
        v_session.store_id,
        v_line.store_article_id,
        'EXTRAORDINARY_ADJUSTMENT'::public.stock_movement_type,
        v_delta,
        v_cost,
        'INVENTORY'::public.stock_source_type,
        p_session_id,
        v_line.line_id,
        null,
        'inventory:' || p_session_id::text || ':line:' || v_line.line_id::text || ':extraordinary',
        v_reason_text,
        clock_timestamp()
      );

      insert into public.stock_anomalies (
        store_id,
        store_article_id,
        origin_type,
        source_id,
        source_line_id,
        movement_id,
        quantity_difference,
        preliminary_reason,
        status,
        created_by,
        updated_by
      ) values (
        v_session.store_id,
        v_line.store_article_id,
        'EXTRAORDINARY_COUNT'::public.stock_anomaly_origin,
        p_session_id,
        v_line.line_id,
        v_movement_id,
        v_delta,
        v_line.preliminary_reason,
        'TO_VERIFY'::public.stock_anomaly_status,
        v_actor,
        v_actor
      );

      v_anomaly_count := v_anomaly_count + 1;
    end if;
  end loop;

  update public.inventory_counts ic
  set submitted_at = coalesce(ic.submitted_at, clock_timestamp()),
      updated_at = now()
  from public.inventory_lines il
  where il.id = ic.inventory_line_id
    and il.session_id = p_session_id
    and ic.round_number = il.current_round;

  update public.inventory_sessions
  set status = 'CLOSED'::public.inventory_status,
      submitted_at = coalesce(submitted_at, clock_timestamp()),
      submitted_by = coalesce(submitted_by, v_actor),
      closed_at = clock_timestamp(),
      closed_by = v_actor,
      updated_at = now()
  where id = p_session_id;

  if v_anomaly_count > 0 then
    perform private.inventory_notify_supervisors(
      v_session.store_id,
      'EXTRAORDINARY_ADJUSTMENT_REVIEW_REQUIRED'::public.notification_type,
      'Rettifica straordinaria da verificare',
      'Un conteggio straordinario ha generato una differenza da analizzare.',
      'inventory_session',
      p_session_id
    );
  end if;

  return p_session_id;
end;
$$;

create or replace function public.anomaly_start_review(
  p_anomaly_id uuid,
  p_operation_key text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_anomaly public.stock_anomalies%rowtype;
  v_first boolean;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;

  select * into v_anomaly
  from public.stock_anomalies
  where id = p_anomaly_id
  for update;
  if not found then raise exception 'Anomaly not found'; end if;
  if not private.inventory_can_supervise(v_anomaly.store_id) then
    raise exception 'Anomaly supervision required';
  end if;

  v_first := private.inventory_claim_operation(
    p_operation_key,
    'ANOMALY_START_REVIEW',
    null,
    p_anomaly_id
  );
  if not v_first then return p_anomaly_id; end if;

  if v_anomaly.status <> 'TO_VERIFY'::public.stock_anomaly_status then
    raise exception 'Anomaly cannot enter review from current state';
  end if;

  update public.stock_anomalies
  set status = 'IN_REVIEW'::public.stock_anomaly_status,
      updated_at = now(),
      updated_by = v_actor
  where id = p_anomaly_id;

  return p_anomaly_id;
end;
$$;

create or replace function public.anomaly_resolve(
  p_anomaly_id uuid,
  p_final_reason public.inventory_reason,
  p_resolution_note text,
  p_operation_key text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_anomaly public.stock_anomalies%rowtype;
  v_first boolean;
  v_note text := nullif(btrim(p_resolution_note), '');
begin
  if v_actor is null then raise exception 'Authentication required'; end if;

  select * into v_anomaly
  from public.stock_anomalies
  where id = p_anomaly_id
  for update;
  if not found then raise exception 'Anomaly not found'; end if;
  if not private.inventory_can_supervise(v_anomaly.store_id) then
    raise exception 'Anomaly supervision required';
  end if;
  if p_final_reason is null then raise exception 'Final reason is required'; end if;
  if p_final_reason = 'UNKNOWN'::public.inventory_reason then
    raise exception 'Use unknown closure when cause is not determined';
  end if;
  if v_note is null then raise exception 'Resolution note is required'; end if;

  v_first := private.inventory_claim_operation(
    p_operation_key,
    'ANOMALY_RESOLVE',
    null,
    p_anomaly_id
  );
  if not v_first then return p_anomaly_id; end if;

  if v_anomaly.status not in (
    'TO_VERIFY'::public.stock_anomaly_status,
    'IN_REVIEW'::public.stock_anomaly_status
  ) then
    raise exception 'Anomaly cannot be resolved from current state';
  end if;

  update public.stock_anomalies
  set status = 'RESOLVED'::public.stock_anomaly_status,
      final_reason = p_final_reason,
      resolution_note = v_note,
      resolved_at = clock_timestamp(),
      updated_at = now(),
      updated_by = v_actor
  where id = p_anomaly_id;

  return p_anomaly_id;
end;
$$;

create or replace function public.anomaly_close_unknown(
  p_anomaly_id uuid,
  p_resolution_note text,
  p_operation_key text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_anomaly public.stock_anomalies%rowtype;
  v_first boolean;
  v_note text := nullif(btrim(p_resolution_note), '');
begin
  if v_actor is null then raise exception 'Authentication required'; end if;

  select * into v_anomaly
  from public.stock_anomalies
  where id = p_anomaly_id
  for update;
  if not found then raise exception 'Anomaly not found'; end if;
  if not private.inventory_can_supervise(v_anomaly.store_id) then
    raise exception 'Anomaly supervision required';
  end if;

  v_first := private.inventory_claim_operation(
    p_operation_key,
    'ANOMALY_CLOSE_UNKNOWN',
    null,
    p_anomaly_id
  );
  if not v_first then return p_anomaly_id; end if;

  if v_anomaly.status not in (
    'TO_VERIFY'::public.stock_anomaly_status,
    'IN_REVIEW'::public.stock_anomaly_status
  ) then
    raise exception 'Anomaly cannot be closed from current state';
  end if;

  update public.stock_anomalies
  set status = 'CLOSED_UNKNOWN'::public.stock_anomaly_status,
      final_reason = 'UNKNOWN'::public.inventory_reason,
      resolution_note = v_note,
      resolved_at = clock_timestamp(),
      updated_at = now(),
      updated_by = v_actor
  where id = p_anomaly_id;

  return p_anomaly_id;
end;
$$;

revoke all on function public.inventory_confirm_extraordinary(uuid,text) from public, anon;
revoke all on function public.anomaly_start_review(uuid,text) from public, anon;
revoke all on function public.anomaly_resolve(uuid,public.inventory_reason,text,text) from public, anon;
revoke all on function public.anomaly_close_unknown(uuid,text,text) from public, anon;

grant execute on function public.inventory_confirm_extraordinary(uuid,text) to authenticated;
grant execute on function public.anomaly_start_review(uuid,text) to authenticated;
grant execute on function public.anomaly_resolve(uuid,public.inventory_reason,text,text) to authenticated;
grant execute on function public.anomaly_close_unknown(uuid,text,text) to authenticated;
