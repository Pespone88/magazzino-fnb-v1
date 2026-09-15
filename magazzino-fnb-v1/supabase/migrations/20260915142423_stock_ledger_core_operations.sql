create or replace function private.ensure_stock_balance(
  p_store_article_id uuid,
  p_store_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1
  from public.store_articles sa
  where sa.id = p_store_article_id
    and sa.store_id = p_store_id;
  if not found then
    raise exception 'Invalid store/article relationship';
  end if;

  insert into public.stock_balances (store_article_id, store_id)
  values (p_store_article_id, p_store_id)
  on conflict (store_article_id) do nothing;

  perform 1
  from public.stock_balances sb
  where sb.store_article_id = p_store_article_id
    and sb.store_id = p_store_id
  for update;
  if not found then
    raise exception 'Invalid store/article relationship';
  end if;
end;
$$;

create or replace function private.current_stock_unit_cost(p_store_article_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select pph.unit_price_snapshot
  from public.purchase_price_history pph
  join public.store_article_suppliers sas
    on sas.id = pph.store_article_supplier_id
  where sas.store_article_id = p_store_article_id
    and pph.source = 'RECEIPT'::public.purchase_price_source
  order by pph.recorded_at desc, pph.id desc
  limit 1;
$$;

create or replace function private.current_user_stock_name()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
    'Utente'
  )
  from public.profiles p
  where p.id = (select auth.uid())
    and p.active = true;
$$;

create or replace function private.post_stock_movement(
  p_store_id uuid,
  p_store_article_id uuid,
  p_movement_type public.stock_movement_type,
  p_quantity_delta numeric,
  p_unit_cost numeric,
  p_source_type public.stock_source_type,
  p_source_id uuid,
  p_source_line_id uuid,
  p_reversal_of uuid,
  p_operation_key text,
  p_reason text,
  p_occurred_at timestamptz default now()
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_actor_name text;
  v_existing public.stock_movements%rowtype;
  v_on_hand numeric(14,3);
  v_reserved numeric(14,3);
  v_new_on_hand numeric(14,3);
  v_reason text := nullif(btrim(p_reason), '');
  v_id uuid;
begin
  if v_actor is null then
    raise exception 'Authentication required';
  end if;
  if p_quantity_delta is null or p_quantity_delta = 0 then
    raise exception 'Quantity must be non-zero';
  end if;
  if p_quantity_delta <> round(p_quantity_delta, 3) then
    raise exception 'Quantity supports at most 3 decimals';
  end if;
  if p_unit_cost is not null and p_unit_cost < 0 then
    raise exception 'Unit cost cannot be negative';
  end if;
  if p_operation_key is null or length(btrim(p_operation_key)) = 0 then
    raise exception 'Operation key is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(btrim(p_operation_key), 0));

  select * into v_existing
  from public.stock_movements sm
  where sm.operation_key = btrim(p_operation_key);

  if found then
    if v_existing.store_id = p_store_id
      and v_existing.store_article_id = p_store_article_id
      and v_existing.movement_type = p_movement_type
      and v_existing.quantity_delta_base = p_quantity_delta
      and v_existing.unit_cost_snapshot is not distinct from p_unit_cost
      and v_existing.source_type = p_source_type
      and v_existing.source_id is not distinct from p_source_id
      and v_existing.source_line_id is not distinct from p_source_line_id
      and v_existing.reversal_of_movement_id is not distinct from p_reversal_of
      and v_existing.reason is not distinct from v_reason
      and v_existing.created_by = v_actor
    then
      return v_existing.id;
    end if;
    raise exception 'Movement operation key conflict';
  end if;

  perform private.ensure_stock_balance(p_store_article_id, p_store_id);

  select sb.on_hand, sb.reserved
    into v_on_hand, v_reserved
  from public.stock_balances sb
  where sb.store_article_id = p_store_article_id
    and sb.store_id = p_store_id
  for update;

  v_new_on_hand := v_on_hand + p_quantity_delta;
  if v_new_on_hand < 0 then
    raise exception 'Stock would become negative';
  end if;
  if v_new_on_hand < v_reserved then
    raise exception 'Reserved quantity exceeds resulting stock';
  end if;

  v_actor_name := coalesce(private.current_user_stock_name(), 'Utente');

  insert into public.stock_movements (
    store_id, store_article_id, movement_type, quantity_delta_base,
    unit_cost_snapshot, source_type, source_id, source_line_id,
    reversal_of_movement_id, operation_key, reason, occurred_at,
    created_by, created_by_name_snapshot
  ) values (
    p_store_id, p_store_article_id, p_movement_type, p_quantity_delta,
    p_unit_cost, p_source_type, p_source_id, p_source_line_id,
    p_reversal_of, btrim(p_operation_key), v_reason, coalesce(p_occurred_at, now()),
    v_actor, v_actor_name
  ) returning id into v_id;

  update public.stock_balances
  set on_hand = v_new_on_hand,
      updated_at = now(),
      last_movement_id = v_id
  where store_article_id = p_store_article_id
    and store_id = p_store_id;

  return v_id;
end;
$$;

create or replace function private.reverse_stock_movement(
  p_movement_id uuid,
  p_reason text,
  p_operation_key text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_existing public.stock_movements%rowtype;
  v_original public.stock_movements%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if v_actor is null then
    raise exception 'Authentication required';
  end if;
  if p_operation_key is null or length(btrim(p_operation_key)) = 0 then
    raise exception 'Operation key is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(btrim(p_operation_key), 0));

  select * into v_existing
  from public.stock_movements sm
  where sm.operation_key = btrim(p_operation_key);
  if found then
    if v_existing.movement_type = 'REVERSAL'::public.stock_movement_type
      and v_existing.reversal_of_movement_id = p_movement_id
      and v_existing.reason is not distinct from v_reason
      and v_existing.created_by = v_actor
    then
      return v_existing.id;
    end if;
    raise exception 'Movement operation key conflict';
  end if;

  select * into v_original
  from public.stock_movements sm
  where sm.id = p_movement_id
  for update;
  if not found then
    raise exception 'Movement not found';
  end if;
  if v_original.movement_type = 'REVERSAL'::public.stock_movement_type then
    raise exception 'Movement not reversible';
  end if;
  if exists (
    select 1 from public.stock_movements sm
    where sm.reversal_of_movement_id = p_movement_id
  ) then
    raise exception 'Movement already reversed';
  end if;

  return private.post_stock_movement(
    v_original.store_id,
    v_original.store_article_id,
    'REVERSAL'::public.stock_movement_type,
    -v_original.quantity_delta_base,
    v_original.unit_cost_snapshot,
    'REVERSAL'::public.stock_source_type,
    v_original.id,
    null,
    v_original.id,
    btrim(p_operation_key),
    v_reason,
    now()
  );
end;
$$;

create or replace function public.admin_adjust_stock(
  p_store_article_id uuid,
  p_quantity_delta numeric,
  p_reason text,
  p_operation_key text
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_store_id uuid;
  v_reason text := nullif(btrim(p_reason), '');
  v_existing public.stock_movements%rowtype;
begin
  if not private.current_user_is_admin() then
    raise exception 'Stock administration requires ADMIN';
  end if;
  if v_reason is null then
    raise exception 'Adjustment reason is required';
  end if;
  if p_operation_key is null or length(btrim(p_operation_key)) = 0 then
    raise exception 'Operation key is required';
  end if;

  select * into v_existing
  from public.stock_movements sm
  where sm.operation_key = btrim(p_operation_key);
  if found then
    if v_existing.store_article_id = p_store_article_id
      and v_existing.movement_type = 'ADMIN_ADJUSTMENT'::public.stock_movement_type
      and v_existing.quantity_delta_base = p_quantity_delta
      and v_existing.reason = v_reason
      and v_existing.created_by = (select auth.uid())
    then
      return v_existing.id;
    end if;
    raise exception 'Movement operation key conflict';
  end if;

  select sa.store_id into v_store_id
  from public.store_articles sa
  where sa.id = p_store_article_id;
  if not found then
    raise exception 'Store article not found';
  end if;

  return private.post_stock_movement(
    v_store_id,
    p_store_article_id,
    'ADMIN_ADJUSTMENT'::public.stock_movement_type,
    p_quantity_delta,
    private.current_stock_unit_cost(p_store_article_id),
    'ADMIN'::public.stock_source_type,
    null,
    null,
    null,
    btrim(p_operation_key),
    v_reason,
    now()
  );
end;
$$;

create or replace function public.admin_reverse_stock_movement(
  p_movement_id uuid,
  p_reason text,
  p_operation_key text
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not private.current_user_is_admin() then
    raise exception 'Stock administration requires ADMIN';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'Reversal reason is required';
  end if;
  return private.reverse_stock_movement(p_movement_id, p_reason, p_operation_key);
end;
$$;

drop index if exists public.stock_movements_reversal_idx;
create unique index stock_movements_one_reversal_per_original
  on public.stock_movements(reversal_of_movement_id)
  where reversal_of_movement_id is not null;

revoke all on function private.ensure_stock_balance(uuid,uuid) from public, anon;
revoke all on function private.current_stock_unit_cost(uuid) from public, anon;
revoke all on function private.current_user_stock_name() from public, anon;
revoke all on function private.post_stock_movement(uuid,uuid,public.stock_movement_type,numeric,numeric,public.stock_source_type,uuid,uuid,uuid,text,text,timestamptz) from public, anon;
revoke all on function private.reverse_stock_movement(uuid,text,text) from public, anon;

grant execute on function private.ensure_stock_balance(uuid,uuid) to authenticated;
grant execute on function private.current_stock_unit_cost(uuid) to authenticated;
grant execute on function private.current_user_stock_name() to authenticated;
grant execute on function private.post_stock_movement(uuid,uuid,public.stock_movement_type,numeric,numeric,public.stock_source_type,uuid,uuid,uuid,text,text,timestamptz) to authenticated;
grant execute on function private.reverse_stock_movement(uuid,text,text) to authenticated;

revoke all on function public.admin_adjust_stock(uuid,numeric,text,text) from public, anon;
revoke all on function public.admin_reverse_stock_movement(uuid,text,text) from public, anon;
grant execute on function public.admin_adjust_stock(uuid,numeric,text,text) to authenticated;
grant execute on function public.admin_reverse_stock_movement(uuid,text,text) to authenticated;
