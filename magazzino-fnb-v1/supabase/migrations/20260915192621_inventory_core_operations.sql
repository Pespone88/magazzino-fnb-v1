create or replace function private.inventory_store_role(p_store_id uuid)
returns public.store_role
language sql
stable
security definer
set search_path = ''
as $$
  select sm.role
  from public.store_memberships sm
  join public.profiles p on p.id = sm.user_id
  where sm.user_id = (select auth.uid())
    and sm.store_id = p_store_id
    and sm.active = true
    and p.active = true
  limit 1;
$$;

create or replace function private.inventory_can_supervise(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.current_user_is_admin()
    or coalesce(private.inventory_store_role(p_store_id) in ('RESPONSABILE'::public.store_role,'VICE'::public.store_role), false);
$$;

create or replace function private.inventory_can_count(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.current_user_is_admin()
    or private.inventory_store_role(p_store_id) is not null;
$$;

create or replace function private.inventory_theoretical_at(
  p_inventory_line_id uuid,
  p_counted_at timestamptz
) returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select il.snapshot_on_hand + coalesce((
    select sum(sm.quantity_delta_base)
    from public.stock_movements sm
    where sm.store_article_id = il.store_article_id
      and sm.store_id = il.store_id
      and sm.occurred_at > s.snapshot_at
      and sm.occurred_at <= p_counted_at
  ), 0::numeric)
  from public.inventory_lines il
  join public.inventory_sessions s on s.id = il.session_id
  where il.id = p_inventory_line_id;
$$;

create or replace function private.inventory_claim_operation(
  p_operation_key text,
  p_action text,
  p_session_id uuid,
  p_anomaly_id uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_key text := btrim(coalesce(p_operation_key,''));
  v_action text := btrim(coalesce(p_action,''));
  v_existing public.inventory_operations%rowtype;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if v_key = '' then raise exception 'Operation key is required'; end if;
  if v_action = '' then raise exception 'Operation action is required'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_key, 0));
  select * into v_existing from public.inventory_operations where operation_key = v_key;
  if found then
    if v_existing.action = v_action
      and v_existing.session_id is not distinct from p_session_id
      and v_existing.anomaly_id is not distinct from p_anomaly_id
      and v_existing.actor_id = v_actor
    then
      return false;
    end if;
    raise exception 'Inventory operation key conflict';
  end if;

  insert into public.inventory_operations(operation_key,action,session_id,anomaly_id,actor_id)
  values(v_key,v_action,p_session_id,p_anomaly_id,v_actor);
  return true;
end;
$$;

create or replace function public.inventory_list_sessions(p_store_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.current_user_has_store_access(p_store_id) then
    raise exception 'Inventory access denied';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'storeId', s.store_id,
        'inventoryType', s.inventory_type,
        'status', s.status,
        'snapshotAt', s.snapshot_at,
        'startedAt', s.started_at,
        'startedBy', s.started_by,
        'startedByName', coalesce(nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),'Utente'),
        'submittedAt', s.submitted_at,
        'approvedAt', s.approved_at,
        'closedAt', s.closed_at,
        'totalLines', (select count(*) from public.inventory_lines il where il.session_id=s.id),
        'countedLines', (
          select count(*) from public.inventory_lines il
          where il.session_id=s.id
            and exists (
              select 1 from public.inventory_counts ic
              where ic.inventory_line_id=il.id and ic.round_number=il.current_round
            )
        ),
        'recountLines', (
          select count(*) from public.inventory_lines il
          where il.session_id=s.id and il.review_state='RECOUNT_REQUIRED'::public.inventory_review_state
        )
      ) order by s.started_at desc, s.id desc
    )
    from public.inventory_sessions s
    join public.profiles p on p.id=s.started_by
    where s.store_id=p_store_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.inventory_get_session(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.inventory_sessions%rowtype;
  v_role public.store_role;
  v_is_admin boolean;
  v_show_review boolean;
  v_lines jsonb;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;

  select * into v_session from public.inventory_sessions where id=p_session_id;
  if not found then raise exception 'Inventory not found'; end if;
  if not private.current_user_has_store_access(v_session.store_id) then raise exception 'Inventory access denied'; end if;

  v_is_admin := private.current_user_is_admin();
  v_role := private.inventory_store_role(v_session.store_id);
  v_show_review := v_is_admin
    or v_session.inventory_type='EXTRAORDINARY'::public.inventory_type
    or (
      v_role in ('RESPONSABILE'::public.store_role,'VICE'::public.store_role)
      and v_session.status in ('IN_REVIEW'::public.inventory_status,'APPROVED'::public.inventory_status,'CLOSED'::public.inventory_status)
    );

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', il.id,
      'storeArticleId', il.store_article_id,
      'articleName', il.article_name_snapshot,
      'baseUnit', il.base_unit_snapshot,
      'reviewState', il.review_state,
      'currentRound', il.current_round,
      'snapshotOnHand', case when v_show_review then il.snapshot_on_hand else null end,
      'snapshotReserved', case when v_show_review then il.snapshot_reserved else null end,
      'currentCount', (
        select jsonb_build_object(
          'id', ic.id,
          'roundNumber', ic.round_number,
          'countedQuantity', ic.counted_quantity,
          'countedAt', ic.counted_at,
          'countedBy', ic.counted_by,
          'preliminaryReason', ic.preliminary_reason,
          'note', ic.note,
          'submittedAt', ic.submitted_at
        )
        from public.inventory_counts ic
        where ic.inventory_line_id=il.id and ic.round_number=il.current_round
      ),
      'theoreticalAtCount', case when v_show_review then (
        select private.inventory_theoretical_at(il.id,ic.counted_at)
        from public.inventory_counts ic
        where ic.inventory_line_id=il.id and ic.round_number=il.current_round
      ) else null end,
      'delta', case when v_show_review then (
        select ic.counted_quantity - private.inventory_theoretical_at(il.id,ic.counted_at)
        from public.inventory_counts ic
        where ic.inventory_line_id=il.id and ic.round_number=il.current_round
      ) else null end,
      'differenceValue', case when v_show_review then (
        select case when private.current_stock_unit_cost(il.store_article_id) is null then null
          else abs(ic.counted_quantity - private.inventory_theoretical_at(il.id,ic.counted_at)) * private.current_stock_unit_cost(il.store_article_id) end
        from public.inventory_counts ic
        where ic.inventory_line_id=il.id and ic.round_number=il.current_round
      ) else null end,
      'countHistory', case when v_show_review then coalesce((
        select jsonb_agg(jsonb_build_object(
          'id',h.id,'roundNumber',h.round_number,'countedQuantity',h.counted_quantity,
          'countedAt',h.counted_at,'countedBy',h.counted_by,'preliminaryReason',h.preliminary_reason,
          'note',h.note,'submittedAt',h.submitted_at
        ) order by h.round_number)
        from public.inventory_counts h where h.inventory_line_id=il.id
      ),'[]'::jsonb) else '[]'::jsonb end
    ) order by il.article_name_snapshot, il.id
  ),'[]'::jsonb) into v_lines
  from public.inventory_lines il
  where il.session_id=v_session.id;

  return jsonb_build_object(
    'id', v_session.id,
    'storeId', v_session.store_id,
    'inventoryType', v_session.inventory_type,
    'status', v_session.status,
    'snapshotAt', v_session.snapshot_at,
    'startedAt', v_session.started_at,
    'startedBy', v_session.started_by,
    'submittedAt', v_session.submitted_at,
    'approvedAt', v_session.approved_at,
    'closedAt', v_session.closed_at,
    'canSupervise', private.inventory_can_supervise(v_session.store_id),
    'canCount', private.inventory_can_count(v_session.store_id),
    'lines', v_lines
  );
end;
$$;

create or replace function public.inventory_list_session_anomalies(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
begin
  select store_id into v_store_id from public.inventory_sessions where id=p_session_id;
  if v_store_id is null then raise exception 'Inventory not found'; end if;
  if (select auth.uid()) is null or not private.current_user_has_store_access(v_store_id) then
    raise exception 'Inventory access denied';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',a.id,'storeId',a.store_id,'storeArticleId',a.store_article_id,
      'articleName',ar.name,'originType',a.origin_type,'sourceId',a.source_id,
      'sourceLineId',a.source_line_id,'movementId',a.movement_id,
      'quantityDifference',a.quantity_difference,'preliminaryReason',a.preliminary_reason,
      'finalReason',a.final_reason,'status',a.status,'resolutionNote',a.resolution_note,
      'createdAt',a.created_at,'createdBy',a.created_by,'updatedAt',a.updated_at,
      'updatedBy',a.updated_by,'resolvedAt',a.resolved_at
    ) order by a.created_at desc,a.id desc)
    from public.stock_anomalies a
    join public.store_articles sa on sa.id=a.store_article_id
    join public.articles ar on ar.id=sa.article_id
    where a.source_id=p_session_id
  ),'[]'::jsonb);
end;
$$;

revoke all on function private.inventory_store_role(uuid) from public, anon, authenticated;
revoke all on function private.inventory_can_supervise(uuid) from public, anon, authenticated;
revoke all on function private.inventory_can_count(uuid) from public, anon, authenticated;
revoke all on function private.inventory_theoretical_at(uuid,timestamptz) from public, anon, authenticated;
revoke all on function private.inventory_claim_operation(text,text,uuid,uuid) from public, anon, authenticated;

revoke all on function public.inventory_list_sessions(uuid) from public, anon;
revoke all on function public.inventory_get_session(uuid) from public, anon;
revoke all on function public.inventory_list_session_anomalies(uuid) from public, anon;
grant execute on function public.inventory_list_sessions(uuid) to authenticated;
grant execute on function public.inventory_get_session(uuid) to authenticated;
grant execute on function public.inventory_list_session_anomalies(uuid) to authenticated;
