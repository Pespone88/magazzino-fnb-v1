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

revoke all on function public.admin_adjust_stock(uuid,numeric,text,text) from public, anon;
grant execute on function public.admin_adjust_stock(uuid,numeric,text,text) to authenticated;
