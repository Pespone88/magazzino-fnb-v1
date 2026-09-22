alter table public.supplier_receipt_lines
  add constraint supplier_receipt_lines_resolution_matrix
  check (
    (outcome = 'CONFORMING' and resolution is null)
    or (outcome = 'PARTIAL_QUANTITY' and resolution in ('NEXT_DELIVERY','CLOSE'))
    or (outcome = 'MISSING' and resolution in ('NEXT_DELIVERY','NO_ACTION'))
    or (outcome = 'WRONG_ITEM' and resolution in ('REPLACEMENT','ACCEPT_AS_OTHER_ARTICLE'))
    or (outcome = 'QUALITY_NOT_SUITABLE' and resolution in ('REPLACEMENT','CREDIT_NOTE'))
    or (outcome = 'UNBILLED' and resolution in ('NO_ACTION','CLOSE','OTHER'))
    or (outcome = 'OTHER' and resolution in ('OTHER','CLOSE','NO_ACTION','REPLACEMENT','CREDIT_NOTE','NEXT_DELIVERY'))
  );

alter table public.supplier_nonconformities
  add constraint supplier_nc_resolution_matrix
  check (
    resolution is null
    or (type = 'QUANTITY_MISMATCH' and resolution in ('NEXT_DELIVERY','CLOSE'))
    or (type = 'MISSING_ITEM' and resolution in ('NEXT_DELIVERY','NO_ACTION'))
    or (type = 'WRONG_ITEM' and resolution in ('REPLACEMENT','ACCEPT_AS_OTHER_ARTICLE'))
    or (type = 'QUALITY_NOT_SUITABLE' and resolution in ('REPLACEMENT','CREDIT_NOTE'))
    or (type = 'UNBILLED_ITEM' and resolution in ('NO_ACTION','CLOSE','OTHER'))
    or (type = 'OTHER' and resolution in ('OTHER','CLOSE','NO_ACTION','REPLACEMENT','CREDIT_NOTE','NEXT_DELIVERY'))
  );

create or replace function public.orders_update_nc(
  p_nonconformity_id uuid,
  p_resolution public.supplier_nc_resolution,
  p_note text,
  p_operation_key text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_nc public.supplier_nonconformities%rowtype;
  v_existing public.procurement_operations%rowtype;
  v_status public.supplier_nc_status;
  v_line_status public.supplier_order_line_status;
  v_allowed boolean := false;
begin
  if p_operation_key is null or length(btrim(p_operation_key))=0 then raise exception 'Operation key is required'; end if;
  if p_resolution is null then raise exception 'Resolution is required'; end if;
  if p_resolution='OTHER' and nullif(btrim(p_note),'') is null then raise exception 'Other resolution requires note'; end if;

  select * into v_nc from public.supplier_nonconformities where id=p_nonconformity_id for update;
  if not found then raise exception 'Supplier nonconformity not found'; end if;
  perform private.procurement_require_store_access(v_nc.store_id);

  perform pg_advisory_xact_lock(hashtextextended(btrim(p_operation_key),0));
  select * into v_existing from public.procurement_operations where operation_key=btrim(p_operation_key);
  if found then
    if v_existing.action='UPDATE_NC' and v_existing.entity_id=p_nonconformity_id and v_existing.actor_id=v_actor then return p_nonconformity_id; end if;
    raise exception 'Procurement operation key conflict';
  end if;

  if v_nc.status in ('RESOLVED','CLOSED') then raise exception 'Supplier nonconformity is already closed'; end if;

  v_allowed := case v_nc.type
    when 'QUANTITY_MISMATCH' then p_resolution in ('NEXT_DELIVERY','CLOSE')
    when 'MISSING_ITEM' then p_resolution in ('NEXT_DELIVERY','NO_ACTION')
    when 'WRONG_ITEM' then p_resolution = 'REPLACEMENT'
    when 'QUALITY_NOT_SUITABLE' then p_resolution in ('REPLACEMENT','CREDIT_NOTE')
    when 'UNBILLED_ITEM' then p_resolution in ('NO_ACTION','CLOSE','OTHER')
    when 'OTHER' then p_resolution in ('OTHER','CLOSE','NO_ACTION','REPLACEMENT','CREDIT_NOTE','NEXT_DELIVERY')
    else false
  end;

  if not v_allowed then
    raise exception 'Resolution not allowed for nonconformity type';
  end if;

  v_status := private.procurement_nc_status_for_resolution(p_resolution);

  update public.supplier_nonconformities
  set resolution=p_resolution, status=v_status,
      note=coalesce(nullif(btrim(p_note),''),note),
      updated_by=v_actor, updated_at=now(),
      resolved_at=case when v_status in ('RESOLVED','CLOSED') then now() else null end
  where id=p_nonconformity_id;

  v_line_status := case
    when p_resolution='REPLACEMENT' then 'AWAITING_REPLACEMENT'
    when p_resolution='CREDIT_NOTE' then 'AWAITING_CREDIT_NOTE'
    when p_resolution in ('CLOSE','NO_ACTION') then 'CLOSED_WITH_DISCREPANCY'
    else null
  end;

  if v_line_status is not null then
    update public.supplier_order_lines set status=v_line_status, updated_at=now()
    where id=v_nc.order_line_id;
  end if;

  perform private.procurement_refresh_order_status(v_nc.order_id);

  insert into public.procurement_operations(operation_key,store_id,action,entity_type,entity_id,result_json,actor_id)
  values (btrim(p_operation_key),v_nc.store_id,'UPDATE_NC','SUPPLIER_NONCONFORMITY',v_nc.id,jsonb_build_object('nonConformityId',v_nc.id),v_actor);
  return v_nc.id;
end;
$$;

revoke all on function public.orders_update_nc(uuid,public.supplier_nc_resolution,text,text) from public, anon;
grant execute on function public.orders_update_nc(uuid,public.supplier_nc_resolution,text,text) to authenticated;
