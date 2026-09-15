create or replace function private.open_stock_reservation(
  p_store_id uuid,
  p_store_article_id uuid,
  p_quantity numeric,
  p_reservation_type public.stock_reservation_type,
  p_source_id uuid,
  p_source_line_id uuid,
  p_operation_key text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_key text := btrim(p_operation_key);
  v_existing public.stock_reservations%rowtype;
  v_on_hand numeric(14,3);
  v_reserved numeric(14,3);
  v_id uuid;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Reservation quantity must be positive'; end if;
  if p_quantity <> round(p_quantity, 3) then raise exception 'Quantity supports at most 3 decimals'; end if;
  if p_source_id is null then raise exception 'Reservation source is required'; end if;
  if p_operation_key is null or length(v_key) = 0 then raise exception 'Operation key is required'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_key, 0));

  select * into v_existing
  from public.stock_reservations sr
  where sr.operation_key = v_key;

  if found then
    if v_existing.store_id = p_store_id
      and v_existing.store_article_id = p_store_article_id
      and v_existing.quantity_base = p_quantity
      and v_existing.reservation_type = p_reservation_type
      and v_existing.source_id = p_source_id
      and v_existing.source_line_id is not distinct from p_source_line_id
      and v_existing.created_by = v_actor
    then
      return v_existing.id;
    end if;
    raise exception 'Reservation operation key conflict';
  end if;

  perform private.ensure_stock_balance(p_store_article_id, p_store_id);

  select sb.on_hand, sb.reserved into v_on_hand, v_reserved
  from public.stock_balances sb
  where sb.store_article_id = p_store_article_id and sb.store_id = p_store_id
  for update;

  if (v_on_hand - v_reserved) < p_quantity then
    raise exception 'Reservation exceeds available stock';
  end if;

  insert into public.stock_reservations (
    store_id, store_article_id, quantity_base, reservation_type,
    source_id, source_line_id, status, operation_key, created_by
  ) values (
    p_store_id, p_store_article_id, p_quantity, p_reservation_type,
    p_source_id, p_source_line_id, 'OPEN'::public.stock_reservation_status, v_key, v_actor
  ) returning id into v_id;

  update public.stock_balances
  set reserved = v_reserved + p_quantity, updated_at = now()
  where store_article_id = p_store_article_id and store_id = p_store_id;

  return v_id;
end;
$$;

create or replace function private.release_stock_reservation(p_reservation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_reservation public.stock_reservations%rowtype;
  v_reserved numeric(14,3);
begin
  if v_actor is null then raise exception 'Authentication required'; end if;

  select * into v_reservation
  from public.stock_reservations sr
  where sr.id = p_reservation_id
  for update;
  if not found then raise exception 'Reservation not found'; end if;
  if v_reservation.status <> 'OPEN'::public.stock_reservation_status then
    raise exception 'Reservation already closed';
  end if;

  perform private.ensure_stock_balance(v_reservation.store_article_id, v_reservation.store_id);
  select sb.reserved into v_reserved
  from public.stock_balances sb
  where sb.store_article_id = v_reservation.store_article_id and sb.store_id = v_reservation.store_id
  for update;

  if v_reserved < v_reservation.quantity_base then
    raise exception 'Reservation balance mismatch';
  end if;

  update public.stock_reservations
  set status = 'RELEASED'::public.stock_reservation_status,
      closed_at = now(), closed_by = v_actor
  where id = p_reservation_id;

  update public.stock_balances
  set reserved = v_reserved - v_reservation.quantity_base, updated_at = now()
  where store_article_id = v_reservation.store_article_id and store_id = v_reservation.store_id;
end;
$$;

create or replace function private.consume_stock_reservation(
  p_reservation_id uuid,
  p_movement_type public.stock_movement_type,
  p_unit_cost numeric,
  p_source_type public.stock_source_type,
  p_movement_operation_key text,
  p_reason text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_reservation public.stock_reservations%rowtype;
  v_reserved numeric(14,3);
  v_movement_id uuid;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if p_movement_type = 'REVERSAL'::public.stock_movement_type then
    raise exception 'Reservation cannot be consumed as reversal';
  end if;

  select * into v_reservation
  from public.stock_reservations sr
  where sr.id = p_reservation_id
  for update;
  if not found then raise exception 'Reservation not found'; end if;
  if v_reservation.status <> 'OPEN'::public.stock_reservation_status then
    raise exception 'Reservation already closed';
  end if;

  perform private.ensure_stock_balance(v_reservation.store_article_id, v_reservation.store_id);
  select sb.reserved into v_reserved
  from public.stock_balances sb
  where sb.store_article_id = v_reservation.store_article_id and sb.store_id = v_reservation.store_id
  for update;

  if v_reserved < v_reservation.quantity_base then
    raise exception 'Reservation balance mismatch';
  end if;

  update public.stock_reservations
  set status = 'CONSUMED'::public.stock_reservation_status,
      closed_at = now(), closed_by = v_actor
  where id = p_reservation_id;

  update public.stock_balances
  set reserved = v_reserved - v_reservation.quantity_base, updated_at = now()
  where store_article_id = v_reservation.store_article_id and store_id = v_reservation.store_id;

  v_movement_id := private.post_stock_movement(
    v_reservation.store_id,
    v_reservation.store_article_id,
    p_movement_type,
    -v_reservation.quantity_base,
    p_unit_cost,
    p_source_type,
    v_reservation.source_id,
    v_reservation.source_line_id,
    null,
    p_movement_operation_key,
    p_reason,
    now()
  );

  return v_movement_id;
end;
$$;

revoke all on function private.open_stock_reservation(uuid,uuid,numeric,public.stock_reservation_type,uuid,uuid,text) from public, anon;
revoke all on function private.release_stock_reservation(uuid) from public, anon;
revoke all on function private.consume_stock_reservation(uuid,public.stock_movement_type,numeric,public.stock_source_type,text,text) from public, anon;
grant execute on function private.open_stock_reservation(uuid,uuid,numeric,public.stock_reservation_type,uuid,uuid,text) to authenticated;
grant execute on function private.release_stock_reservation(uuid) to authenticated;
grant execute on function private.consume_stock_reservation(uuid,public.stock_movement_type,numeric,public.stock_source_type,text,text) to authenticated;
