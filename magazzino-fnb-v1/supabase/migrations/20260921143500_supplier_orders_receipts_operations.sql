create or replace function private.record_store_article_supplier_price()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_package_quantity numeric(14,3);
  v_base_unit public.catalog_base_unit;
  v_article_name text;
  v_supplier_name text;
  v_absolute_change numeric(14,4);
  v_percent_change numeric(12,4);
  v_severity public.notification_severity := 'NORMAL';
  v_source public.purchase_price_source := 'MANUAL'::public.purchase_price_source;
begin
  if tg_op = 'UPDATE' and current_setting('app.purchase_price_source', true) = 'RECEIPT' then
    v_source := 'RECEIPT'::public.purchase_price_source;
  end if;

  select a.package_quantity, a.base_unit, a.name, s.name
    into v_package_quantity, v_base_unit, v_article_name, v_supplier_name
  from public.store_articles sa
  join public.articles a on a.id = sa.article_id
  join public.store_suppliers ss on ss.id = new.store_supplier_id
  join public.suppliers s on s.id = ss.supplier_id
  where sa.id = new.store_article_id
    and sa.store_id = new.store_id
    and ss.store_id = new.store_id;

  if not found then raise exception 'Invalid store/article/supplier relationship'; end if;

  if tg_op = 'INSERT' then
    insert into public.purchase_price_history (
      store_id, store_article_supplier_id, package_price,
      package_quantity_snapshot, base_unit_snapshot, unit_price_snapshot,
      previous_package_price, absolute_change, percent_change, source, recorded_by
    ) values (
      new.store_id, new.id, new.current_package_price,
      v_package_quantity, v_base_unit, round(new.current_package_price / v_package_quantity, 6),
      null, null, null, 'MANUAL'::public.purchase_price_source, (select auth.uid())
    );
    return new;
  end if;

  if new.current_package_price is not distinct from old.current_package_price then return new; end if;

  v_absolute_change := new.current_package_price - old.current_package_price;
  v_percent_change := case when old.current_package_price = 0 then null
    else round((v_absolute_change / old.current_package_price) * 100, 4) end;
  if v_percent_change is not null and abs(v_percent_change) > 5 then
    v_severity := 'SIGNIFICANT';
  end if;

  insert into public.purchase_price_history (
    store_id, store_article_supplier_id, package_price,
    package_quantity_snapshot, base_unit_snapshot, unit_price_snapshot,
    previous_package_price, absolute_change, percent_change, source, recorded_by
  ) values (
    new.store_id, new.id, new.current_package_price,
    v_package_quantity, v_base_unit, round(new.current_package_price / v_package_quantity, 6),
    old.current_package_price, v_absolute_change, v_percent_change,
    v_source, (select auth.uid())
  );

  insert into public.notifications (
    recipient_user_id, store_id, type, severity, title, body, entity_type, entity_id
  )
  select p.id, new.store_id, 'PRICE_CHANGE'::public.notification_type, v_severity,
    'Variazione prezzo',
    v_article_name || ' · ' || v_supplier_name || ': ' || old.current_package_price::text || ' € → ' || new.current_package_price::text || ' €',
    'STORE_ARTICLE_SUPPLIER', new.id
  from public.profiles p
  where p.active = true and p.global_role = 'ADMIN'::public.global_role;

  return new;
end;
$$;

revoke all on function private.record_store_article_supplier_price() from public, anon, authenticated;

create or replace function private.procurement_require_store_access(p_store_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not private.current_user_has_store_access(p_store_id) then
    raise exception 'Procurement store access denied' using errcode = '42501';
  end if;
end;
$$;

create or replace function private.procurement_record_receipt_price(
  p_store_article_supplier_id uuid,
  p_new_package_price numeric
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.store_article_suppliers%rowtype;
  v_article public.articles%rowtype;
  v_previous numeric(14,4);
  v_absolute numeric(14,4);
  v_percent numeric(12,4);
begin
  if p_new_package_price is null or p_new_package_price < 0 then
    raise exception 'Receipt package price must be nonnegative';
  end if;

  select sas.* into v_link
  from public.store_article_suppliers sas
  where sas.id = p_store_article_supplier_id
    and sas.active = true
  for update;
  if not found then raise exception 'Active supplier link not found'; end if;

  select a.* into v_article
  from public.store_articles sa
  join public.articles a on a.id = sa.article_id
  where sa.id = v_link.store_article_id
    and sa.store_id = v_link.store_id
    and sa.active = true
    and a.active = true;
  if not found then raise exception 'Active store article not found'; end if;

  v_previous := v_link.current_package_price;

  if p_new_package_price is distinct from v_previous then
    perform set_config('app.purchase_price_source', 'RECEIPT', true);
    update public.store_article_suppliers
      set current_package_price = p_new_package_price,
          updated_at = now()
    where id = v_link.id;
  else
    v_absolute := 0;
    v_percent := case when v_previous = 0 then null else 0 end;
    insert into public.purchase_price_history (
      store_id, store_article_supplier_id, package_price,
      package_quantity_snapshot, base_unit_snapshot, unit_price_snapshot,
      previous_package_price, absolute_change, percent_change, source, recorded_by
    ) values (
      v_link.store_id, v_link.id, p_new_package_price,
      v_article.package_quantity, v_article.base_unit,
      round(p_new_package_price / v_article.package_quantity, 6),
      v_previous, v_absolute, v_percent,
      'RECEIPT'::public.purchase_price_source, (select auth.uid())
    );
  end if;
end;
$$;

create or replace function private.procurement_refresh_order_status(p_order_id uuid)
returns public.supplier_order_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.supplier_order_status;
  v_next public.supplier_order_status;
  v_open integer;
  v_complete integer;
  v_total integer;
begin
  select o.status into v_current
  from public.supplier_orders o
  where o.id = p_order_id
  for update;
  if not found then raise exception 'Order not found'; end if;
  if v_current in ('DRAFT','CANCELLED') then return v_current; end if;

  select count(*),
         count(*) filter (where l.status in ('COMPLETED','NOT_SUPPLIED','CLOSED_WITH_DISCREPANCY')),
         count(*) filter (where l.status not in ('COMPLETED','NOT_SUPPLIED','CLOSED_WITH_DISCREPANCY'))
    into v_total, v_complete, v_open
  from public.supplier_order_lines l
  where l.order_id = p_order_id;

  if v_total > 0 and v_open = 0 then
    v_next := 'COMPLETED'::public.supplier_order_status;
  elsif exists (select 1 from public.supplier_receipts r where r.order_id=p_order_id and r.status='CONFIRMED') then
    v_next := 'PARTIALLY_RECEIVED'::public.supplier_order_status;
  else
    v_next := 'ORDERED'::public.supplier_order_status;
  end if;

  update public.supplier_orders
  set status = v_next, updated_at = now()
  where id = p_order_id;
  return v_next;
end;
$$;

create or replace function private.procurement_nc_type_for_outcome(
  p_outcome public.supplier_receipt_outcome
) returns public.supplier_nc_type
language sql
immutable
security invoker
set search_path = ''
as $$
  select case p_outcome
    when 'PARTIAL_QUANTITY'::public.supplier_receipt_outcome then 'QUANTITY_MISMATCH'::public.supplier_nc_type
    when 'MISSING'::public.supplier_receipt_outcome then 'MISSING_ITEM'::public.supplier_nc_type
    when 'WRONG_ITEM'::public.supplier_receipt_outcome then 'WRONG_ITEM'::public.supplier_nc_type
    when 'QUALITY_NOT_SUITABLE'::public.supplier_receipt_outcome then 'QUALITY_NOT_SUITABLE'::public.supplier_nc_type
    when 'UNBILLED'::public.supplier_receipt_outcome then 'UNBILLED_ITEM'::public.supplier_nc_type
    else 'OTHER'::public.supplier_nc_type
  end;
$$;

create or replace function private.procurement_nc_status_for_resolution(
  p_resolution public.supplier_nc_resolution
) returns public.supplier_nc_status
language sql
immutable
security invoker
set search_path = ''
as $$
  select case p_resolution
    when 'REPLACEMENT'::public.supplier_nc_resolution then 'AWAITING_REPLACEMENT'::public.supplier_nc_status
    when 'CREDIT_NOTE'::public.supplier_nc_resolution then 'AWAITING_CREDIT_NOTE'::public.supplier_nc_status
    when 'NEXT_DELIVERY'::public.supplier_nc_resolution then 'OPEN'::public.supplier_nc_status
    when 'ACCEPT_AS_OTHER_ARTICLE'::public.supplier_nc_resolution then 'RESOLVED'::public.supplier_nc_status
    when 'CLOSE'::public.supplier_nc_resolution then 'CLOSED'::public.supplier_nc_status
    when 'NO_ACTION'::public.supplier_nc_resolution then 'CLOSED'::public.supplier_nc_status
    else 'OPEN'::public.supplier_nc_status
  end;
$$;

revoke all on function private.procurement_require_store_access(uuid) from public, anon, authenticated;
revoke all on function private.procurement_record_receipt_price(uuid,numeric) from public, anon, authenticated;
revoke all on function private.procurement_refresh_order_status(uuid) from public, anon, authenticated;
revoke all on function private.procurement_nc_type_for_outcome(public.supplier_receipt_outcome) from public, anon, authenticated;
revoke all on function private.procurement_nc_status_for_resolution(public.supplier_nc_resolution) from public, anon, authenticated;

create or replace function public.orders_list_need_candidates(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  perform private.procurement_require_store_access(p_store_id);

  select coalesce(jsonb_agg(x.obj order by x.article_name), '[]'::jsonb) into v_result
  from (
    select a.name as article_name,
      jsonb_build_object(
        'storeArticleId', sa.id,
        'articleName', a.name,
        'baseUnit', a.base_unit,
        'packageQuantity', a.package_quantity,
        'onHand', coalesce(sb.on_hand,0),
        'reserved', coalesce(sb.reserved,0),
        'available', coalesce(sb.available,0),
        'minStock', sa.min_stock,
        'targetStock', sa.target_stock,
        'underMin', coalesce(sb.available,0) < sa.min_stock,
        'suggestedQuantity', case
          when coalesce(sb.available,0) < sa.min_stock
          then greatest(sa.target_stock - coalesce(sb.available,0), 0)
          else 0 end,
        'suppliers', coalesce((
          select jsonb_agg(jsonb_build_object(
            'linkId', sas.id,
            'storeSupplierId', ss.id,
            'supplierId', s.id,
            'supplierName', s.name,
            'currentPackagePrice', sas.current_package_price,
            'isPreferred', sas.is_preferred
          ) order by sas.is_preferred desc, s.name)
          from public.store_article_suppliers sas
          join public.store_suppliers ss on ss.id=sas.store_supplier_id and ss.store_id=sas.store_id
          join public.suppliers s on s.id=ss.supplier_id
          where sas.store_article_id=sa.id
            and sas.store_id=sa.store_id
            and sas.active=true and ss.active=true and s.active=true
        ), '[]'::jsonb)
      ) as obj
    from public.store_articles sa
    join public.articles a on a.id=sa.article_id
    left join public.stock_balances sb on sb.store_article_id=sa.id and sb.store_id=sa.store_id
    where sa.store_id=p_store_id and sa.active=true and a.active=true
  ) x;

  return v_result;
end;
$$;

create or replace function public.orders_list(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  perform private.procurement_require_store_access(p_store_id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', o.id,
    'storeId', o.store_id,
    'storeSupplierId', o.store_supplier_id,
    'supplierName', s.name,
    'status', o.status,
    'estimatedTotal', o.estimated_total,
    'notes', o.notes,
    'createdAt', o.created_at,
    'createdBy', o.created_by,
    'orderedAt', o.ordered_at,
    'cancelledAt', o.cancelled_at,
    'lineCount', (select count(*) from public.supplier_order_lines l where l.order_id=o.id),
    'openLineCount', (select count(*) from public.supplier_order_lines l where l.order_id=o.id and l.status not in ('COMPLETED','NOT_SUPPLIED','CLOSED_WITH_DISCREPANCY'))
  ) order by o.created_at desc), '[]'::jsonb)
  into v_result
  from public.supplier_orders o
  join public.store_suppliers ss on ss.id=o.store_supplier_id
  join public.suppliers s on s.id=ss.supplier_id
  where o.store_id=p_store_id;

  return v_result;
end;
$$;

create or replace function public.orders_get(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order public.supplier_orders%rowtype;
  v_supplier_name text;
  v_result jsonb;
begin
  select o.*, s.name into v_order, v_supplier_name
  from public.supplier_orders o
  join public.store_suppliers ss on ss.id=o.store_supplier_id
  join public.suppliers s on s.id=ss.supplier_id
  where o.id=p_order_id;

  if not found then raise exception 'Order not found'; end if;
  perform private.procurement_require_store_access(v_order.store_id);

  select jsonb_build_object(
    'id', v_order.id,
    'storeId', v_order.store_id,
    'storeSupplierId', v_order.store_supplier_id,
    'supplierName', v_supplier_name,
    'status', v_order.status,
    'estimatedTotal', v_order.estimated_total,
    'notes', v_order.notes,
    'createdAt', v_order.created_at,
    'createdBy', v_order.created_by,
    'orderedAt', v_order.ordered_at,
    'cancelledAt', v_order.cancelled_at,
    'cancellationReason', v_order.cancellation_reason,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'storeArticleId', l.store_article_id,
        'storeArticleSupplierId', l.store_article_supplier_id,
        'articleName', l.article_name_snapshot,
        'baseUnit', l.base_unit_snapshot,
        'packageQuantity', l.package_quantity_snapshot,
        'orderedQuantity', l.ordered_quantity_base,
        'acceptedQuantity', l.accepted_quantity_base,
        'remainingQuantity', greatest(l.ordered_quantity_base-l.accepted_quantity_base,0),
        'estimatedPackagePrice', l.estimated_package_price,
        'estimatedTotal', l.estimated_total,
        'status', l.status
      ) order by l.article_name_snapshot)
      from public.supplier_order_lines l where l.order_id=v_order.id
    ), '[]'::jsonb),
    'receipts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'status', r.status,
        'documentNumber', r.document_number,
        'documentDate', r.document_date,
        'documentTotal', r.document_total,
        'extraAmount', r.extra_amount,
        'extraNote', r.extra_note,
        'notes', r.notes,
        'confirmedAt', r.confirmed_at,
        'lines', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', rl.id,
            'orderLineId', rl.order_line_id,
            'expectedStoreArticleId', rl.expected_store_article_id,
            'actualStoreArticleId', rl.actual_store_article_id,
            'documentedQuantity', rl.documented_quantity_base,
            'receivedQuantity', rl.received_quantity_base,
            'acceptedQuantity', rl.accepted_quantity_base,
            'documentPackagePrice', rl.document_package_price,
            'outcome', rl.outcome,
            'resolution', rl.resolution,
            'note', rl.note,
            'movementId', rl.movement_id
          ) order by rl.created_at)
          from public.supplier_receipt_lines rl where rl.receipt_id=r.id
        ), '[]'::jsonb)
      ) order by r.confirmed_at desc)
      from public.supplier_receipts r where r.order_id=v_order.id
    ), '[]'::jsonb),
    'nonConformities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', nc.id,
        'orderLineId', nc.order_line_id,
        'receiptId', nc.receipt_id,
        'receiptLineId', nc.receipt_line_id,
        'type', nc.type,
        'quantityAffected', nc.quantity_affected_base,
        'status', nc.status,
        'resolution', nc.resolution,
        'note', nc.note,
        'creditNoteNumber', nc.credit_note_number,
        'creditNoteDate', nc.credit_note_date,
        'creditNoteAmount', nc.credit_note_amount,
        'createdAt', nc.created_at,
        'updatedAt', nc.updated_at,
        'resolvedAt', nc.resolved_at
      ) order by nc.created_at desc)
      from public.supplier_nonconformities nc where nc.order_id=v_order.id
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.orders_create_drafts(
  p_store_id uuid,
  p_lines jsonb,
  p_notes text,
  p_operation_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_existing public.procurement_operations%rowtype;
  v_item jsonb;
  v_link public.store_article_suppliers%rowtype;
  v_sa public.store_articles%rowtype;
  v_article public.articles%rowtype;
  v_qty numeric(14,3);
  v_supplier_id uuid;
  v_order_id uuid;
  v_order_ids jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  perform private.procurement_require_store_access(p_store_id);
  if p_operation_key is null or length(btrim(p_operation_key))=0 then raise exception 'Operation key is required'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines)=0 then
    raise exception 'At least one order line is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(btrim(p_operation_key),0));
  select * into v_existing from public.procurement_operations where operation_key=btrim(p_operation_key);
  if found then
    if v_existing.action='CREATE_DRAFTS' and v_existing.store_id=p_store_id and v_existing.actor_id=v_actor then
      return v_existing.result_json;
    end if;
    raise exception 'Procurement operation key conflict';
  end if;

  create temporary table if not exists pg_temp.procurement_draft_lines (
    store_article_id uuid,
    link_id uuid,
    store_supplier_id uuid,
    article_name text,
    base_unit public.catalog_base_unit,
    package_quantity numeric(14,3),
    quantity_base numeric(14,3),
    package_price numeric(14,4),
    primary key (store_article_id)
  ) on commit drop;
  truncate pg_temp.procurement_draft_lines;

  for v_item in select value from jsonb_array_elements(p_lines)
  loop
    begin
      v_qty := (v_item->>'quantityBase')::numeric;
    exception when others then
      raise exception 'Invalid order quantity';
    end;
    if v_qty is null or v_qty <= 0 or v_qty <> round(v_qty,3) then
      raise exception 'Invalid order quantity';
    end if;

    select sas.* into v_link
    from public.store_article_suppliers sas
    where sas.id=(v_item->>'storeArticleSupplierId')::uuid
      and sas.store_article_id=(v_item->>'storeArticleId')::uuid
      and sas.store_id=p_store_id
      and sas.active=true;
    if not found then raise exception 'Active supplier link not found'; end if;

    select sa.* into v_sa
    from public.store_articles sa
    where sa.id=v_link.store_article_id and sa.store_id=p_store_id and sa.active=true;
    if not found then raise exception 'Active store article not found'; end if;

    select a.* into v_article
    from public.articles a where a.id=v_sa.article_id and a.active=true;
    if not found then raise exception 'Active article not found'; end if;

    insert into pg_temp.procurement_draft_lines (
      store_article_id, link_id, store_supplier_id, article_name,
      base_unit, package_quantity, quantity_base, package_price
    ) values (
      v_sa.id, v_link.id, v_link.store_supplier_id, v_article.name,
      v_article.base_unit, v_article.package_quantity, v_qty, v_link.current_package_price
    );
  end loop;

  for v_supplier_id in
    select distinct d.store_supplier_id from pg_temp.procurement_draft_lines d
  loop
    insert into public.supplier_orders (
      store_id, store_supplier_id, status, estimated_total, notes, created_by
    ) values (
      p_store_id, v_supplier_id, 'DRAFT', 0, nullif(btrim(p_notes),''), v_actor
    ) returning id into v_order_id;

    insert into public.supplier_order_lines (
      order_id, store_id, store_article_id, store_article_supplier_id,
      article_name_snapshot, base_unit_snapshot, package_quantity_snapshot,
      ordered_quantity_base, estimated_package_price
    )
    select v_order_id, p_store_id, d.store_article_id, d.link_id,
           d.article_name, d.base_unit, d.package_quantity,
           d.quantity_base, d.package_price
    from pg_temp.procurement_draft_lines d
    where d.store_supplier_id=v_supplier_id;

    update public.supplier_orders o
    set estimated_total=(
      select coalesce(sum(l.estimated_total),0)
      from public.supplier_order_lines l where l.order_id=o.id
    ), updated_at=now()
    where o.id=v_order_id;

    v_order_ids := v_order_ids || jsonb_build_array(v_order_id);
  end loop;

  v_result := jsonb_build_object('orderIds', v_order_ids);
  insert into public.procurement_operations(operation_key,store_id,action,entity_type,result_json,actor_id)
  values (btrim(p_operation_key),p_store_id,'CREATE_DRAFTS','SUPPLIER_ORDER',v_result,v_actor);
  return v_result;
end;
$$;

create or replace function public.orders_mark_ordered(
  p_order_id uuid,
  p_operation_key text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_order public.supplier_orders%rowtype;
  v_existing public.procurement_operations%rowtype;
begin
  if p_operation_key is null or length(btrim(p_operation_key))=0 then raise exception 'Operation key is required'; end if;
  select * into v_order from public.supplier_orders where id=p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  perform private.procurement_require_store_access(v_order.store_id);

  perform pg_advisory_xact_lock(hashtextextended(btrim(p_operation_key),0));
  select * into v_existing from public.procurement_operations where operation_key=btrim(p_operation_key);
  if found then
    if v_existing.action='MARK_ORDERED' and v_existing.entity_id=p_order_id and v_existing.actor_id=v_actor then return p_order_id; end if;
    raise exception 'Procurement operation key conflict';
  end if;

  if v_order.status <> 'DRAFT' then raise exception 'Only draft orders can be marked ordered'; end if;
  update public.supplier_orders
  set status='ORDERED', ordered_at=now(), ordered_by=v_actor, updated_at=now()
  where id=p_order_id;

  insert into public.procurement_operations(operation_key,store_id,action,entity_type,entity_id,result_json,actor_id)
  values (btrim(p_operation_key),v_order.store_id,'MARK_ORDERED','SUPPLIER_ORDER',p_order_id,jsonb_build_object('orderId',p_order_id),v_actor);
  return p_order_id;
end;
$$;

create or replace function public.orders_cancel(
  p_order_id uuid,
  p_reason text,
  p_operation_key text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_order public.supplier_orders%rowtype;
  v_existing public.procurement_operations%rowtype;
begin
  if nullif(btrim(p_reason),'') is null then raise exception 'Cancellation reason is required'; end if;
  if p_operation_key is null or length(btrim(p_operation_key))=0 then raise exception 'Operation key is required'; end if;
  select * into v_order from public.supplier_orders where id=p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  perform private.procurement_require_store_access(v_order.store_id);

  perform pg_advisory_xact_lock(hashtextextended(btrim(p_operation_key),0));
  select * into v_existing from public.procurement_operations where operation_key=btrim(p_operation_key);
  if found then
    if v_existing.action='CANCEL_ORDER' and v_existing.entity_id=p_order_id and v_existing.actor_id=v_actor then return p_order_id; end if;
    raise exception 'Procurement operation key conflict';
  end if;

  if v_order.status not in ('DRAFT','ORDERED') then raise exception 'Order cannot be cancelled in current state'; end if;
  if exists(select 1 from public.supplier_receipts r where r.order_id=p_order_id and r.status='CONFIRMED') then
    raise exception 'Order with receipts cannot be cancelled';
  end if;

  update public.supplier_orders
  set status='CANCELLED', cancelled_at=now(), cancelled_by=v_actor,
      cancellation_reason=btrim(p_reason), updated_at=now()
  where id=p_order_id;

  insert into public.procurement_operations(operation_key,store_id,action,entity_type,entity_id,result_json,actor_id)
  values (btrim(p_operation_key),v_order.store_id,'CANCEL_ORDER','SUPPLIER_ORDER',p_order_id,jsonb_build_object('orderId',p_order_id),v_actor);
  return p_order_id;
end;
$$;

create or replace function public.orders_confirm_receipt(
  p_order_id uuid,
  p_document_number text,
  p_document_date date,
  p_document_total numeric,
  p_extra_amount numeric,
  p_extra_note text,
  p_notes text,
  p_lines jsonb,
  p_operation_key text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_order public.supplier_orders%rowtype;
  v_existing public.procurement_operations%rowtype;
  v_receipt_id uuid;
  v_receipt_line_id uuid;
  v_item jsonb;
  v_line public.supplier_order_lines%rowtype;
  v_link public.store_article_suppliers%rowtype;
  v_actual_link public.store_article_suppliers%rowtype;
  v_actual_article_id uuid;
  v_actual_package_qty numeric(14,3);
  v_doc_qty numeric(14,3);
  v_recv_qty numeric(14,3);
  v_accept_qty numeric(14,3);
  v_doc_price numeric(14,4);
  v_outcome public.supplier_receipt_outcome;
  v_resolution public.supplier_nc_resolution;
  v_note text;
  v_price_confirmed boolean;
  v_unit_cost numeric(18,6);
  v_movement_id uuid;
  v_new_accepted numeric(14,3);
  v_line_status public.supplier_order_line_status;
  v_nc_status public.supplier_nc_status;
  v_nc_id uuid;
  v_subtotal numeric(18,4) := 0;
  v_expected_doc_total numeric(18,4);
  v_line_total numeric(18,4);
  v_has_unpriced boolean := false;
begin
  if p_operation_key is null or length(btrim(p_operation_key))=0 then raise exception 'Operation key is required'; end if;
  if nullif(btrim(p_document_number),'') is null then raise exception 'Document number is required'; end if;
  if p_document_date is null then raise exception 'Document date is required'; end if;
  if p_document_total is not null and p_document_total < 0 then raise exception 'Document total cannot be negative'; end if;
  if coalesce(p_extra_amount,0) < 0 then raise exception 'Extra amount cannot be negative'; end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'At least one receipt line is required'; end if;

  select * into v_order from public.supplier_orders where id=p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  perform private.procurement_require_store_access(v_order.store_id);

  perform pg_advisory_xact_lock(hashtextextended(btrim(p_operation_key),0));
  select * into v_existing from public.procurement_operations where operation_key=btrim(p_operation_key);
  if found then
    if v_existing.action='CONFIRM_RECEIPT' and v_existing.entity_id=p_order_id and v_existing.actor_id=v_actor then
      return (v_existing.result_json->>'receiptId')::uuid;
    end if;
    raise exception 'Procurement operation key conflict';
  end if;

  if v_order.status not in ('ORDERED','PARTIALLY_RECEIVED') then
    raise exception 'Order is not awaiting receipt';
  end if;

  insert into public.supplier_receipts (
    store_id, order_id, store_supplier_id, document_number, document_date,
    document_total, extra_amount, extra_note, notes, created_by
  ) values (
    v_order.store_id, v_order.id, v_order.store_supplier_id, btrim(p_document_number), p_document_date,
    p_document_total, coalesce(p_extra_amount,0), nullif(btrim(p_extra_note),''), nullif(btrim(p_notes),''),
    v_actor
  ) returning id into v_receipt_id;

  for v_item in select value from jsonb_array_elements(p_lines)
  loop
    select * into v_line
    from public.supplier_order_lines l
    where l.id=(v_item->>'orderLineId')::uuid
      and l.order_id=v_order.id
      and l.store_id=v_order.store_id
    for update;
    if not found then raise exception 'Order line not found'; end if;
    if v_line.status in ('COMPLETED','NOT_SUPPLIED','CLOSED_WITH_DISCREPANCY') then
      raise exception 'Order line is already closed';
    end if;

    begin
      v_doc_qty := coalesce((v_item->>'documentedQuantity')::numeric,0);
      v_recv_qty := coalesce((v_item->>'receivedQuantity')::numeric,0);
      v_accept_qty := coalesce((v_item->>'acceptedQuantity')::numeric,0);
      v_doc_price := case when v_item ? 'documentPackagePrice' and nullif(v_item->>'documentPackagePrice','') is not null
                          then (v_item->>'documentPackagePrice')::numeric else null end;
      v_outcome := (v_item->>'outcome')::public.supplier_receipt_outcome;
      v_resolution := case when v_item ? 'resolution' and nullif(v_item->>'resolution','') is not null
                           then (v_item->>'resolution')::public.supplier_nc_resolution else null end;
    exception when others then
      raise exception 'Invalid receipt line';
    end;

    v_note := nullif(btrim(v_item->>'note'),'');
    v_price_confirmed := coalesce((v_item->>'priceChangeConfirmed')::boolean,false);

    if v_doc_qty < 0 or v_recv_qty < 0 or v_accept_qty < 0
       or v_doc_qty<>round(v_doc_qty,3) or v_recv_qty<>round(v_recv_qty,3) or v_accept_qty<>round(v_accept_qty,3)
       or v_accept_qty>v_recv_qty then
      raise exception 'Invalid receipt quantity';
    end if;
    if v_doc_price is not null and v_doc_price < 0 then raise exception 'Receipt package price must be nonnegative'; end if;
    if v_outcome <> 'CONFORMING' and v_resolution is null then raise exception 'Nonconforming receipt requires resolution'; end if;
    if v_resolution='OTHER' and v_note is null then raise exception 'Other resolution requires note'; end if;
    if v_outcome='CONFORMING' and (v_recv_qty<>v_accept_qty or v_doc_qty<>v_accept_qty) then
      raise exception 'Conforming line quantities must match';
    end if;

    select * into v_link
    from public.store_article_suppliers sas
    where sas.id=v_line.store_article_supplier_id
      and sas.store_article_id=v_line.store_article_id
      and sas.store_id=v_order.store_id
      and sas.store_supplier_id=v_order.store_supplier_id
      and sas.active=true;
    if not found then raise exception 'Order supplier link is no longer active'; end if;

    v_actual_article_id := coalesce(nullif(v_item->>'actualStoreArticleId','')::uuid, v_line.store_article_id);
    v_actual_link := null;

    if v_actual_article_id <> v_line.store_article_id then
      if v_outcome <> 'WRONG_ITEM' or v_resolution <> 'ACCEPT_AS_OTHER_ARTICLE' then
        raise exception 'Alternate article requires wrong-item acceptance';
      end if;
      select sas.* into v_actual_link
      from public.store_article_suppliers sas
      where sas.store_article_id=v_actual_article_id
        and sas.store_id=v_order.store_id
        and sas.store_supplier_id=v_order.store_supplier_id
        and sas.active=true;
      if not found then raise exception 'Alternate article is not active for this supplier'; end if;
    else
      v_actual_link := v_link;
    end if;

    select a.package_quantity into v_actual_package_qty
    from public.store_articles sa join public.articles a on a.id=sa.article_id
    where sa.id=v_actual_article_id and sa.store_id=v_order.store_id and sa.active=true and a.active=true;
    if not found then raise exception 'Actual article not available'; end if;

    if v_doc_price is not null
       and v_doc_price is distinct from v_actual_link.current_package_price
       and not v_price_confirmed then
      raise exception 'Receipt price change requires confirmation';
    end if;

    if v_doc_price is null then
      v_has_unpriced := true;
    else
      v_line_total := round((v_doc_qty / v_actual_package_qty) * v_doc_price, 4);
      v_subtotal := v_subtotal + v_line_total;
    end if;

    insert into public.supplier_receipt_lines (
      receipt_id, order_id, store_id, order_line_id,
      expected_store_article_id, actual_store_article_id,
      documented_quantity_base, received_quantity_base, accepted_quantity_base,
      document_package_price, price_change_confirmed, outcome, resolution, note
    ) values (
      v_receipt_id, v_order.id, v_order.store_id, v_line.id,
      v_line.store_article_id, v_actual_article_id,
      v_doc_qty, v_recv_qty, v_accept_qty,
      v_doc_price, v_price_confirmed, v_outcome, v_resolution, v_note
    ) returning id into v_receipt_line_id;

    if v_accept_qty > 0 then
      if v_doc_price is not null then
        v_unit_cost := round(v_doc_price / v_actual_package_qty,6);
      else
        v_unit_cost := private.current_stock_unit_cost(v_actual_article_id);
        if v_unit_cost is null then
          v_unit_cost := round(v_actual_link.current_package_price / v_actual_package_qty,6);
        end if;
      end if;

      v_movement_id := private.post_stock_movement(
        v_order.store_id,
        v_actual_article_id,
        'SUPPLIER_RECEIPT'::public.stock_movement_type,
        v_accept_qty,
        v_unit_cost,
        'SUPPLIER_RECEIPT'::public.stock_source_type,
        v_receipt_id,
        v_receipt_line_id,
        null,
        'receipt:' || v_receipt_line_id::text,
        'Ricezione fornitore ' || btrim(p_document_number),
        now()
      );

      update public.supplier_receipt_lines set movement_id=v_movement_id where id=v_receipt_line_id;

      if v_doc_price is not null then
        perform private.procurement_record_receipt_price(v_actual_link.id, v_doc_price);
      end if;
    end if;

    if v_actual_article_id = v_line.store_article_id then
      v_new_accepted := v_line.accepted_quantity_base + v_accept_qty;
      if v_new_accepted > v_line.ordered_quantity_base then
        raise exception 'Accepted quantity exceeds ordered quantity';
      end if;
    else
      v_new_accepted := v_line.accepted_quantity_base;
    end if;

    if v_outcome='CONFORMING' then
      v_line_status := case when v_new_accepted >= v_line.ordered_quantity_base then 'COMPLETED' else 'PARTIAL' end;
    elsif v_outcome in ('PARTIAL_QUANTITY','MISSING') then
      if v_resolution='NEXT_DELIVERY' then
        v_line_status := case when v_new_accepted>0 then 'PARTIAL' else 'TO_RECEIVE' end;
      elsif v_resolution in ('CLOSE','NO_ACTION') then
        v_line_status := case when v_new_accepted=0 then 'NOT_SUPPLIED' else 'CLOSED_WITH_DISCREPANCY' end;
      else
        v_line_status := case when v_new_accepted>0 then 'PARTIAL' else 'TO_RECEIVE' end;
      end if;
    elsif v_outcome='WRONG_ITEM' then
      v_line_status := case
        when v_resolution='REPLACEMENT' then 'AWAITING_REPLACEMENT'
        when v_resolution='CREDIT_NOTE' then 'AWAITING_CREDIT_NOTE'
        else 'CLOSED_WITH_DISCREPANCY' end;
    elsif v_outcome='QUALITY_NOT_SUITABLE' then
      v_line_status := case
        when v_resolution='REPLACEMENT' then 'AWAITING_REPLACEMENT'
        when v_resolution='CREDIT_NOTE' then 'AWAITING_CREDIT_NOTE'
        else 'CLOSED_WITH_DISCREPANCY' end;
    elsif v_outcome='UNBILLED' then
      v_line_status := case
        when v_new_accepted >= v_line.ordered_quantity_base then 'COMPLETED'
        when v_resolution in ('CLOSE','NO_ACTION') then 'CLOSED_WITH_DISCREPANCY'
        else 'PARTIAL' end;
    else
      v_line_status := case
        when v_resolution='REPLACEMENT' then 'AWAITING_REPLACEMENT'
        when v_resolution='CREDIT_NOTE' then 'AWAITING_CREDIT_NOTE'
        when v_resolution in ('CLOSE','NO_ACTION','ACCEPT_AS_OTHER_ARTICLE') then 'CLOSED_WITH_DISCREPANCY'
        else case when v_new_accepted>0 then 'PARTIAL' else 'TO_RECEIVE' end end;
    end if;

    update public.supplier_order_lines
    set accepted_quantity_base=v_new_accepted,
        status=v_line_status,
        updated_at=now()
    where id=v_line.id;

    if v_outcome <> 'CONFORMING' then
      v_nc_status := private.procurement_nc_status_for_resolution(v_resolution);
      insert into public.supplier_nonconformities (
        store_id, order_id, order_line_id, receipt_id, receipt_line_id,
        type, quantity_affected_base, status, resolution, note,
        created_by, updated_by, resolved_at
      ) values (
        v_order.store_id, v_order.id, v_line.id, v_receipt_id, v_receipt_line_id,
        private.procurement_nc_type_for_outcome(v_outcome),
        case
          when v_outcome='MISSING' then greatest(v_line.ordered_quantity_base-v_new_accepted,0)
          else nullif(v_recv_qty-v_accept_qty,0)
        end,
        v_nc_status, v_resolution, v_note,
        v_actor, v_actor,
        case when v_nc_status in ('RESOLVED','CLOSED') then now() else null end
      ) returning id into v_nc_id;
    end if;

    if v_actual_article_id=v_line.store_article_id and v_accept_qty>0 then
      update public.supplier_nonconformities nc
      set status='RESOLVED', updated_by=v_actor, updated_at=now(), resolved_at=now(),
          note=coalesce(nc.note,'') || case when nc.note is null then '' else E'\n' end || 'Risolta da ricezione successiva.'
      where nc.order_line_id=v_line.id
        and nc.id<>coalesce(v_nc_id,'00000000-0000-0000-0000-000000000000'::uuid)
        and nc.status in ('OPEN','AWAITING_REPLACEMENT')
        and nc.resolution in ('NEXT_DELIVERY','REPLACEMENT');
    end if;
  end loop;

  if p_document_total is not null then
    v_expected_doc_total := round(v_subtotal + coalesce(p_extra_amount,0),4);
    if abs(p_document_total-v_expected_doc_total) > 0.01 and nullif(btrim(p_extra_note),'') is null then
      raise exception 'Document total difference requires explanation';
    end if;
    if v_has_unpriced and nullif(btrim(p_extra_note),'') is null and abs(p_document_total-v_expected_doc_total)>0.01 then
      raise exception 'Unpriced document lines require explanation';
    end if;
  end if;

  perform private.procurement_refresh_order_status(v_order.id);

  insert into public.procurement_operations(operation_key,store_id,action,entity_type,entity_id,result_json,actor_id)
  values (
    btrim(p_operation_key),v_order.store_id,'CONFIRM_RECEIPT','SUPPLIER_ORDER',v_order.id,
    jsonb_build_object('receiptId',v_receipt_id),v_actor
  );

  return v_receipt_id;
end;
$$;

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
begin
  if p_operation_key is null or length(btrim(p_operation_key))=0 then raise exception 'Operation key is required'; end if;
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
    when p_resolution in ('CLOSE','NO_ACTION','ACCEPT_AS_OTHER_ARTICLE') then 'CLOSED_WITH_DISCREPANCY'
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

create or replace function public.orders_record_credit_note(
  p_nonconformity_id uuid,
  p_number text,
  p_date date,
  p_amount numeric,
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
begin
  if p_operation_key is null or length(btrim(p_operation_key))=0 then raise exception 'Operation key is required'; end if;
  if nullif(btrim(p_number),'') is null or p_date is null or p_amount is null or p_amount<0 then
    raise exception 'Credit note number, date and amount are required';
  end if;

  select * into v_nc from public.supplier_nonconformities where id=p_nonconformity_id for update;
  if not found then raise exception 'Supplier nonconformity not found'; end if;
  perform private.procurement_require_store_access(v_nc.store_id);

  perform pg_advisory_xact_lock(hashtextextended(btrim(p_operation_key),0));
  select * into v_existing from public.procurement_operations where operation_key=btrim(p_operation_key);
  if found then
    if v_existing.action='RECORD_CREDIT_NOTE' and v_existing.entity_id=p_nonconformity_id and v_existing.actor_id=v_actor then return p_nonconformity_id; end if;
    raise exception 'Procurement operation key conflict';
  end if;

  if v_nc.status<>'AWAITING_CREDIT_NOTE' or v_nc.resolution<>'CREDIT_NOTE' then
    raise exception 'Nonconformity is not awaiting credit note';
  end if;

  update public.supplier_nonconformities
  set status='RESOLVED', credit_note_number=btrim(p_number), credit_note_date=p_date,
      credit_note_amount=p_amount, note=coalesce(nullif(btrim(p_note),''),note),
      updated_by=v_actor, updated_at=now(), resolved_at=now()
  where id=v_nc.id;

  update public.supplier_order_lines
  set status='CLOSED_WITH_DISCREPANCY', updated_at=now()
  where id=v_nc.order_line_id;

  perform private.procurement_refresh_order_status(v_nc.order_id);

  insert into public.procurement_operations(operation_key,store_id,action,entity_type,entity_id,result_json,actor_id)
  values (btrim(p_operation_key),v_nc.store_id,'RECORD_CREDIT_NOTE','SUPPLIER_NONCONFORMITY',v_nc.id,jsonb_build_object('nonConformityId',v_nc.id),v_actor);
  return v_nc.id;
end;
$$;

revoke all on function public.orders_list_need_candidates(uuid) from public, anon;
revoke all on function public.orders_list(uuid) from public, anon;
revoke all on function public.orders_get(uuid) from public, anon;
revoke all on function public.orders_create_drafts(uuid,jsonb,text,text) from public, anon;
revoke all on function public.orders_mark_ordered(uuid,text) from public, anon;
revoke all on function public.orders_cancel(uuid,text,text) from public, anon;
revoke all on function public.orders_confirm_receipt(uuid,text,date,numeric,numeric,text,text,jsonb,text) from public, anon;
revoke all on function public.orders_update_nc(uuid,public.supplier_nc_resolution,text,text) from public, anon;
revoke all on function public.orders_record_credit_note(uuid,text,date,numeric,text,text) from public, anon;

grant execute on function public.orders_list_need_candidates(uuid) to authenticated;
grant execute on function public.orders_list(uuid) to authenticated;
grant execute on function public.orders_get(uuid) to authenticated;
grant execute on function public.orders_create_drafts(uuid,jsonb,text,text) to authenticated;
grant execute on function public.orders_mark_ordered(uuid,text) to authenticated;
grant execute on function public.orders_cancel(uuid,text,text) to authenticated;
grant execute on function public.orders_confirm_receipt(uuid,text,date,numeric,numeric,text,text,jsonb,text) to authenticated;
grant execute on function public.orders_update_nc(uuid,public.supplier_nc_resolution,text,text) to authenticated;
grant execute on function public.orders_record_credit_note(uuid,text,date,numeric,text,text) to authenticated;
