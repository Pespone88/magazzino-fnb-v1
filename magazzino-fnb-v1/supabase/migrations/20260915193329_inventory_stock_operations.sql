create or replace function public.inventory_approve(
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
  v_line record;
  v_delta numeric;
  v_cost numeric;
  v_first boolean;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  select * into v_session from public.inventory_sessions where id=p_session_id for update;
  if not found then raise exception 'Inventory not found'; end if;
  if not private.inventory_can_supervise(v_session.store_id) then raise exception 'Inventory supervision required'; end if;

  v_first := private.inventory_claim_operation(p_operation_key,'APPROVE_INVENTORY',p_session_id,null);
  if not v_first then return p_session_id; end if;

  if v_session.inventory_type not in ('OPENING'::public.inventory_type,'MONTHLY'::public.inventory_type) then
    raise exception 'Inventory type cannot use approval';
  end if;
  if v_session.status<>'IN_REVIEW'::public.inventory_status then raise exception 'Inventory is not in review'; end if;

  if exists(
    select 1
    from public.inventory_lines il
    left join public.inventory_counts ic
      on ic.inventory_line_id=il.id and ic.round_number=il.current_round
    where il.session_id=p_session_id
      and (il.review_state<>'ACCEPTED'::public.inventory_review_state or ic.id is null or ic.submitted_at is null)
  ) then raise exception 'All inventory lines must be accepted before approval'; end if;

  if v_session.inventory_type='OPENING'::public.inventory_type
    and exists(select 1 from public.stock_movements where store_id=v_session.store_id)
  then raise exception 'Opening inventory cannot be approved because stock movements already exist'; end if;

  for v_line in
    select il.id as line_id, il.store_article_id, ic.counted_quantity, ic.counted_at
    from public.inventory_lines il
    join public.inventory_counts ic
      on ic.inventory_line_id=il.id and ic.round_number=il.current_round
    where il.session_id=p_session_id
    order by il.store_article_id
  loop
    if v_session.inventory_type='OPENING'::public.inventory_type then
      if v_line.counted_quantity>0 then
        v_cost := private.current_stock_unit_cost(v_line.store_article_id);
        perform private.post_stock_movement(
          v_session.store_id,
          v_line.store_article_id,
          'OPENING_STOCK'::public.stock_movement_type,
          v_line.counted_quantity,
          v_cost,
          'OPENING'::public.stock_source_type,
          p_session_id,
          v_line.line_id,
          null,
          'inventory:'||p_session_id::text||':line:'||v_line.line_id::text||':opening',
          'Inventario di apertura',
          clock_timestamp()
        );
      end if;
    else
      v_delta := v_line.counted_quantity - private.inventory_theoretical_at(v_line.line_id,v_line.counted_at);
      if v_delta<>0 then
        v_cost := private.current_stock_unit_cost(v_line.store_article_id);
        perform private.post_stock_movement(
          v_session.store_id,
          v_line.store_article_id,
          'INVENTORY_ADJUSTMENT'::public.stock_movement_type,
          v_delta,
          v_cost,
          'INVENTORY'::public.stock_source_type,
          p_session_id,
          v_line.line_id,
          null,
          'inventory:'||p_session_id::text||':line:'||v_line.line_id::text||':approve',
          'Rettifica inventario mensile',
          clock_timestamp()
        );
      end if;
    end if;
  end loop;

  update public.inventory_sessions
  set status='APPROVED'::public.inventory_status,
      approved_at=clock_timestamp(),
      approved_by=v_actor,
      updated_at=now()
  where id=p_session_id;

  return p_session_id;
end;
$$;

create or replace function public.inventory_close(
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
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  select * into v_session from public.inventory_sessions where id=p_session_id for update;
  if not found then raise exception 'Inventory not found'; end if;
  if not private.inventory_can_supervise(v_session.store_id) then raise exception 'Inventory supervision required'; end if;

  v_first := private.inventory_claim_operation(p_operation_key,'CLOSE_INVENTORY',p_session_id,null);
  if not v_first then return p_session_id; end if;

  if v_session.inventory_type='EXTRAORDINARY'::public.inventory_type then raise exception 'Extraordinary inventory closes on confirmation'; end if;
  if v_session.status<>'APPROVED'::public.inventory_status then raise exception 'Only approved inventory can be closed'; end if;

  update public.inventory_sessions
  set status='CLOSED'::public.inventory_status,
      closed_at=clock_timestamp(),
      closed_by=v_actor,
      updated_at=now()
  where id=p_session_id;

  return p_session_id;
end;
$$;

revoke all on function public.inventory_approve(uuid,text) from public,anon;
revoke all on function public.inventory_close(uuid,text) from public,anon;
grant execute on function public.inventory_approve(uuid,text) to authenticated;
grant execute on function public.inventory_close(uuid,text) to authenticated;
