create or replace function private.inventory_notify_supervisors(
  p_store_id uuid,
  p_type public.notification_type,
  p_title text,
  p_body text,
  p_entity_type text,
  p_entity_id uuid
) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications(recipient_user_id,store_id,type,severity,title,body,entity_type,entity_id)
  select r.user_id,p_store_id,p_type,'NORMAL'::public.notification_severity,p_title,p_body,p_entity_type,p_entity_id
  from (
    select p.id as user_id
    from public.profiles p
    where p.active=true and p.global_role='ADMIN'::public.global_role
    union
    select sm.user_id
    from public.store_memberships sm
    join public.profiles p on p.id=sm.user_id
    where sm.store_id=p_store_id and sm.active=true and p.active=true
      and sm.role in ('RESPONSABILE'::public.store_role,'VICE'::public.store_role)
  ) r;
$$;

create or replace function private.inventory_notify_warehouse(
  p_store_id uuid,
  p_type public.notification_type,
  p_title text,
  p_body text,
  p_entity_type text,
  p_entity_id uuid
) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications(recipient_user_id,store_id,type,severity,title,body,entity_type,entity_id)
  select sm.user_id,p_store_id,p_type,'NORMAL'::public.notification_severity,p_title,p_body,p_entity_type,p_entity_id
  from public.store_memberships sm
  join public.profiles p on p.id=sm.user_id
  where sm.store_id=p_store_id and sm.active=true and p.active=true
    and sm.role='MAGAZZINIERE'::public.store_role;
$$;

create or replace function public.inventory_start(
  p_store_id uuid,
  p_inventory_type public.inventory_type,
  p_selected_store_article_ids uuid[],
  p_operation_key text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_key text := btrim(coalesce(p_operation_key,''));
  v_existing public.inventory_sessions%rowtype;
  v_session_id uuid;
  v_line_count integer;
  v_selected_count integer;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if v_key='' then raise exception 'Operation key is required'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_key,0));
  select * into v_existing from public.inventory_sessions where operation_key=v_key;
  if found then
    if v_existing.store_id=p_store_id and v_existing.inventory_type=p_inventory_type and v_existing.started_by=v_actor then
      if p_inventory_type='EXTRAORDINARY'::public.inventory_type then
        select count(distinct x) into v_selected_count from unnest(coalesce(p_selected_store_article_ids,'{}'::uuid[])) x;
        if (select count(*) from public.inventory_lines where session_id=v_existing.id) <> v_selected_count
          or exists(select 1 from public.inventory_lines where session_id=v_existing.id and not (store_article_id=any(coalesce(p_selected_store_article_ids,'{}'::uuid[]))))
        then raise exception 'Inventory operation key conflict'; end if;
      end if;
      return v_existing.id;
    end if;
    raise exception 'Inventory operation key conflict';
  end if;

  if p_inventory_type in ('OPENING'::public.inventory_type,'MONTHLY'::public.inventory_type) then
    if not private.inventory_can_supervise(p_store_id) then raise exception 'Inventory supervision required'; end if;
  else
    if not private.inventory_can_count(p_store_id) then raise exception 'Inventory access denied'; end if;
    if cardinality(coalesce(p_selected_store_article_ids,'{}'::uuid[]))=0 then raise exception 'Select at least one article'; end if;
  end if;

  if p_inventory_type='OPENING'::public.inventory_type then
    if exists(select 1 from public.inventory_sessions where store_id=p_store_id and inventory_type='OPENING'::public.inventory_type) then
      raise exception 'Opening inventory already exists';
    end if;
    if exists(select 1 from public.stock_movements where store_id=p_store_id) then
      raise exception 'Opening inventory requires empty stock history';
    end if;
  end if;

  if p_inventory_type='EXTRAORDINARY'::public.inventory_type then
    if exists(
      select 1 from unnest(p_selected_store_article_ids) x
      where not exists(select 1 from public.store_articles sa where sa.id=x and sa.store_id=p_store_id and sa.active=true)
    ) then raise exception 'Invalid inventory article selection'; end if;
  end if;

  insert into public.inventory_sessions(store_id,inventory_type,started_by,operation_key)
  values(p_store_id,p_inventory_type,v_actor,v_key)
  returning id into v_session_id;

  if p_inventory_type='EXTRAORDINARY'::public.inventory_type then
    insert into public.inventory_lines(
      session_id,store_id,store_article_id,article_name_snapshot,base_unit_snapshot,
      snapshot_on_hand,snapshot_reserved
    )
    select v_session_id,sa.store_id,sa.id,a.name,a.base_unit,
      coalesce(sb.on_hand,0),coalesce(sb.reserved,0)
    from public.store_articles sa
    join public.articles a on a.id=sa.article_id
    left join public.stock_balances sb on sb.store_article_id=sa.id
    where sa.store_id=p_store_id and sa.active=true
      and sa.id=any(p_selected_store_article_ids)
    group by sa.store_id,sa.id,a.name,a.base_unit,sb.on_hand,sb.reserved;
  else
    insert into public.inventory_lines(
      session_id,store_id,store_article_id,article_name_snapshot,base_unit_snapshot,
      snapshot_on_hand,snapshot_reserved
    )
    select v_session_id,sa.store_id,sa.id,a.name,a.base_unit,
      coalesce(sb.on_hand,0),coalesce(sb.reserved,0)
    from public.store_articles sa
    join public.articles a on a.id=sa.article_id
    left join public.stock_balances sb on sb.store_article_id=sa.id
    where sa.store_id=p_store_id and sa.active=true;
  end if;

  select count(*) into v_line_count from public.inventory_lines where session_id=v_session_id;
  if v_line_count=0 then raise exception 'Inventory has no articles'; end if;
  return v_session_id;
end;
$$;

create or replace function public.inventory_save_count(
  p_session_id uuid,
  p_line_id uuid,
  p_quantity numeric,
  p_preliminary_reason public.inventory_reason,
  p_note text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_session public.inventory_sessions%rowtype;
  v_line public.inventory_lines%rowtype;
  v_count public.inventory_counts%rowtype;
  v_note text := nullif(btrim(p_note),'');
  v_id uuid;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if p_quantity is null or p_quantity<0 or p_quantity<>round(p_quantity,3) then raise exception 'Invalid inventory quantity'; end if;

  select * into v_session from public.inventory_sessions where id=p_session_id for update;
  if not found then raise exception 'Inventory not found'; end if;
  if not private.inventory_can_count(v_session.store_id) then raise exception 'Inventory access denied'; end if;
  if v_session.status not in ('IN_PROGRESS'::public.inventory_status,'RECOUNT'::public.inventory_status) then raise exception 'Inventory count unavailable in current state'; end if;

  select * into v_line from public.inventory_lines where id=p_line_id and session_id=p_session_id for update;
  if not found then raise exception 'Inventory line not found'; end if;
  if v_session.status='RECOUNT'::public.inventory_status and v_line.review_state<>'RECOUNT_REQUIRED'::public.inventory_review_state then
    raise exception 'Inventory line is not requested for recount';
  end if;
  if p_preliminary_reason='OTHER'::public.inventory_reason and v_note is null then raise exception 'Other reason requires note'; end if;

  select * into v_count from public.inventory_counts
  where inventory_line_id=v_line.id and round_number=v_line.current_round
  for update;
  if found then
    if v_count.submitted_at is not null then raise exception 'Submitted inventory count is immutable'; end if;
    if v_count.counted_by<>v_actor then raise exception 'Inventory draft belongs to another user'; end if;
    update public.inventory_counts
    set counted_quantity=p_quantity,counted_at=clock_timestamp(),preliminary_reason=p_preliminary_reason,note=v_note,updated_at=now()
    where id=v_count.id returning id into v_id;
  else
    insert into public.inventory_counts(session_id,inventory_line_id,round_number,counted_quantity,counted_by,preliminary_reason,note)
    values(p_session_id,v_line.id,v_line.current_round,p_quantity,v_actor,p_preliminary_reason,v_note)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.inventory_submit_round(p_session_id uuid,p_operation_key text)
returns uuid
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
  if not private.inventory_can_count(v_session.store_id) then raise exception 'Inventory access denied'; end if;

  v_first := private.inventory_claim_operation(p_operation_key,'SUBMIT_ROUND',p_session_id,null);
  if not v_first then return p_session_id; end if;
  if v_session.inventory_type='EXTRAORDINARY'::public.inventory_type then raise exception 'Extraordinary inventory uses direct confirmation'; end if;
  if v_session.status not in ('IN_PROGRESS'::public.inventory_status,'RECOUNT'::public.inventory_status) then raise exception 'Inventory count unavailable in current state'; end if;

  if exists(
    select 1 from public.inventory_lines il
    where il.session_id=p_session_id
      and (v_session.status='IN_PROGRESS'::public.inventory_status or il.review_state='RECOUNT_REQUIRED'::public.inventory_review_state)
      and not exists(
        select 1 from public.inventory_counts ic
        where ic.inventory_line_id=il.id and ic.round_number=il.current_round
      )
  ) then raise exception 'Complete all required counts before submission'; end if;

  update public.inventory_counts ic
  set submitted_at=coalesce(ic.submitted_at,now()),updated_at=now()
  from public.inventory_lines il
  where il.id=ic.inventory_line_id and il.session_id=p_session_id
    and ic.round_number=il.current_round
    and (v_session.status='IN_PROGRESS'::public.inventory_status or il.review_state='RECOUNT_REQUIRED'::public.inventory_review_state);

  if v_session.status='RECOUNT'::public.inventory_status then
    update public.inventory_lines set review_state='PENDING'::public.inventory_review_state
    where session_id=p_session_id and review_state='RECOUNT_REQUIRED'::public.inventory_review_state;
  end if;

  update public.inventory_sessions
  set status='IN_REVIEW'::public.inventory_status,submitted_at=now(),submitted_by=v_actor,updated_at=now()
  where id=p_session_id;

  perform private.inventory_notify_supervisors(
    v_session.store_id,'INVENTORY_REVIEW_REQUIRED'::public.notification_type,
    'Inventario da verificare','Un inventario è stato inviato in verifica.','inventory_session',p_session_id
  );
  return p_session_id;
end;
$$;

create or replace function public.inventory_accept_lines(p_session_id uuid,p_line_ids uuid[],p_operation_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.inventory_sessions%rowtype;
  v_first boolean;
begin
  select * into v_session from public.inventory_sessions where id=p_session_id for update;
  if not found then raise exception 'Inventory not found'; end if;
  if not private.inventory_can_supervise(v_session.store_id) then raise exception 'Inventory supervision required'; end if;
  v_first := private.inventory_claim_operation(p_operation_key,'ACCEPT_LINES',p_session_id,null);
  if not v_first then return p_session_id; end if;
  if v_session.status<>'IN_REVIEW'::public.inventory_status then raise exception 'Inventory is not in review'; end if;
  if cardinality(coalesce(p_line_ids,'{}'::uuid[]))=0 then raise exception 'Select at least one inventory line'; end if;
  if exists(select 1 from unnest(p_line_ids) x where not exists(
    select 1 from public.inventory_lines il
    join public.inventory_counts ic on ic.inventory_line_id=il.id and ic.round_number=il.current_round
    where il.id=x and il.session_id=p_session_id and ic.submitted_at is not null
  )) then raise exception 'Inventory line is not ready for acceptance'; end if;
  update public.inventory_lines set review_state='ACCEPTED'::public.inventory_review_state
  where session_id=p_session_id and id=any(p_line_ids);
  return p_session_id;
end;
$$;

create or replace function public.inventory_request_recount(p_session_id uuid,p_line_ids uuid[],p_operation_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.inventory_sessions%rowtype;
  v_first boolean;
begin
  select * into v_session from public.inventory_sessions where id=p_session_id for update;
  if not found then raise exception 'Inventory not found'; end if;
  if not private.inventory_can_supervise(v_session.store_id) then raise exception 'Inventory supervision required'; end if;
  v_first := private.inventory_claim_operation(p_operation_key,'REQUEST_RECOUNT',p_session_id,null);
  if not v_first then return p_session_id; end if;
  if v_session.status<>'IN_REVIEW'::public.inventory_status then raise exception 'Inventory is not in review'; end if;
  if cardinality(coalesce(p_line_ids,'{}'::uuid[]))=0 then raise exception 'Select at least one inventory line'; end if;
  if exists(select 1 from unnest(p_line_ids) x where not exists(select 1 from public.inventory_lines where id=x and session_id=p_session_id)) then
    raise exception 'Inventory line not found';
  end if;
  update public.inventory_lines
  set current_round=current_round+1,review_state='RECOUNT_REQUIRED'::public.inventory_review_state
  where session_id=p_session_id and id=any(p_line_ids);
  update public.inventory_sessions set status='RECOUNT'::public.inventory_status,updated_at=now() where id=p_session_id;
  perform private.inventory_notify_warehouse(
    v_session.store_id,'INVENTORY_RECOUNT_REQUIRED'::public.notification_type,
    'Riconteggio richiesto','Sono state richieste una o più referenze da ricontare.','inventory_session',p_session_id
  );
  return p_session_id;
end;
$$;

revoke all on function private.inventory_notify_supervisors(uuid,public.notification_type,text,text,text,uuid) from public,anon,authenticated;
revoke all on function private.inventory_notify_warehouse(uuid,public.notification_type,text,text,text,uuid) from public,anon,authenticated;

revoke all on function public.inventory_start(uuid,public.inventory_type,uuid[],text) from public,anon;
revoke all on function public.inventory_save_count(uuid,uuid,numeric,public.inventory_reason,text) from public,anon;
revoke all on function public.inventory_submit_round(uuid,text) from public,anon;
revoke all on function public.inventory_accept_lines(uuid,uuid[],text) from public,anon;
revoke all on function public.inventory_request_recount(uuid,uuid[],text) from public,anon;
grant execute on function public.inventory_start(uuid,public.inventory_type,uuid[],text) to authenticated;
grant execute on function public.inventory_save_count(uuid,uuid,numeric,public.inventory_reason,text) to authenticated;
grant execute on function public.inventory_submit_round(uuid,text) to authenticated;
grant execute on function public.inventory_accept_lines(uuid,uuid[],text) to authenticated;
grant execute on function public.inventory_request_recount(uuid,uuid[],text) to authenticated;
