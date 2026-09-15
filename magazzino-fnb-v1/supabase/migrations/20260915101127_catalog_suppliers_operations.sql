create or replace function private.current_user_can_read_article(target_article_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_user_is_admin()
    or exists (
      select 1 from public.store_articles sa
      where sa.article_id = target_article_id
        and private.current_user_has_store_access(sa.store_id)
    );
$$;

create or replace function private.current_user_can_read_supplier(target_supplier_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_user_is_admin()
    or exists (
      select 1 from public.store_suppliers ss
      where ss.supplier_id = target_supplier_id
        and private.current_user_has_store_access(ss.store_id)
    );
$$;

revoke all on function private.current_user_can_read_article(uuid) from public, anon;
revoke all on function private.current_user_can_read_supplier(uuid) from public, anon;
grant execute on function private.current_user_can_read_article(uuid) to authenticated;
grant execute on function private.current_user_can_read_supplier(uuid) to authenticated;

grant select, insert, update on table public.categories to authenticated;
grant select, insert, update on table public.articles to authenticated;
grant select, insert, update on table public.store_articles to authenticated;
grant select, insert, update on table public.suppliers to authenticated;
grant select, insert, update on table public.store_suppliers to authenticated;
grant select, insert, update on table public.store_article_suppliers to authenticated;
grant select on table public.purchase_price_history to authenticated;
grant select on table public.notifications to authenticated;
grant update (read_at) on table public.notifications to authenticated;

create policy categories_select_authenticated on public.categories for select to authenticated using (true);
create policy categories_insert_admin on public.categories for insert to authenticated with check (private.current_user_is_admin());
create policy categories_update_admin on public.categories for update to authenticated using (private.current_user_is_admin()) with check (private.current_user_is_admin());
create policy articles_select_accessible on public.articles for select to authenticated using (private.current_user_can_read_article(id));
create policy articles_insert_admin on public.articles for insert to authenticated with check (private.current_user_is_admin());
create policy articles_update_admin on public.articles for update to authenticated using (private.current_user_is_admin()) with check (private.current_user_is_admin());
create policy store_articles_select_accessible on public.store_articles for select to authenticated using (private.current_user_has_store_access(store_id));
create policy store_articles_insert_admin on public.store_articles for insert to authenticated with check (private.current_user_is_admin());
create policy store_articles_update_admin on public.store_articles for update to authenticated using (private.current_user_is_admin()) with check (private.current_user_is_admin());
create policy suppliers_select_accessible on public.suppliers for select to authenticated using (private.current_user_can_read_supplier(id));
create policy suppliers_insert_admin on public.suppliers for insert to authenticated with check (private.current_user_is_admin());
create policy suppliers_update_admin on public.suppliers for update to authenticated using (private.current_user_is_admin()) with check (private.current_user_is_admin());
create policy store_suppliers_select_accessible on public.store_suppliers for select to authenticated using (private.current_user_has_store_access(store_id));
create policy store_suppliers_insert_admin on public.store_suppliers for insert to authenticated with check (private.current_user_is_admin());
create policy store_suppliers_update_admin on public.store_suppliers for update to authenticated using (private.current_user_is_admin()) with check (private.current_user_is_admin());
create policy store_article_suppliers_select_accessible on public.store_article_suppliers for select to authenticated using (private.current_user_has_store_access(store_id));
create policy store_article_suppliers_insert_admin on public.store_article_suppliers for insert to authenticated with check (private.current_user_is_admin());
create policy store_article_suppliers_update_admin on public.store_article_suppliers for update to authenticated using (private.current_user_is_admin()) with check (private.current_user_is_admin());
create policy purchase_price_history_select_accessible on public.purchase_price_history for select to authenticated using (private.current_user_has_store_access(store_id));
create policy notifications_select_own on public.notifications for select to authenticated using (recipient_user_id = (select auth.uid()));
create policy notifications_update_own on public.notifications for update to authenticated using (recipient_user_id = (select auth.uid())) with check (recipient_user_id = (select auth.uid()));

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
begin
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
    'MANUAL'::public.purchase_price_source, (select auth.uid())
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
create trigger store_article_supplier_price_audit
  after insert or update of current_package_price on public.store_article_suppliers
  for each row execute function private.record_store_article_supplier_price();

create or replace function public.admin_create_store_article(
  p_store_id uuid, p_name text, p_category_id uuid, p_base_unit public.catalog_base_unit,
  p_ean text, p_package_quantity numeric, p_min_stock numeric, p_target_stock numeric
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_article_id uuid; v_store_article_id uuid;
begin
  if not private.current_user_is_admin() then raise exception 'Catalog administration requires ADMIN'; end if;
  insert into public.articles (name, category_id, base_unit, ean, package_quantity)
  values (btrim(p_name), p_category_id, p_base_unit, nullif(btrim(p_ean), ''), p_package_quantity)
  returning id into v_article_id;
  insert into public.store_articles (store_id, article_id, min_stock, target_stock)
  values (p_store_id, v_article_id, p_min_stock, p_target_stock)
  returning id into v_store_article_id;
  return v_store_article_id;
end; $$;

create or replace function public.admin_associate_article_to_store(
  p_store_id uuid, p_article_id uuid, p_min_stock numeric, p_target_stock numeric
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  if not private.current_user_is_admin() then raise exception 'Catalog administration requires ADMIN'; end if;
  insert into public.store_articles (store_id, article_id, min_stock, target_stock, active)
  values (p_store_id, p_article_id, p_min_stock, p_target_stock, true)
  on conflict (store_id, article_id) do update set
    min_stock=excluded.min_stock, target_stock=excluded.target_stock, active=true, updated_at=now()
  returning id into v_id;
  return v_id;
end; $$;

create or replace function public.admin_associate_supplier_to_store(
  p_store_id uuid, p_supplier_id uuid, p_customer_code text,
  p_minimum_order_amount numeric, p_delivery_notes text
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  if not private.current_user_is_admin() then raise exception 'Catalog administration requires ADMIN'; end if;
  insert into public.store_suppliers (store_id, supplier_id, customer_code, minimum_order_amount, delivery_notes, active)
  values (p_store_id, p_supplier_id, nullif(btrim(p_customer_code), ''), p_minimum_order_amount, nullif(btrim(p_delivery_notes), ''), true)
  on conflict (store_id, supplier_id) do update set
    customer_code=excluded.customer_code, minimum_order_amount=excluded.minimum_order_amount,
    delivery_notes=excluded.delivery_notes, active=true, updated_at=now()
  returning id into v_id;
  return v_id;
end; $$;

create or replace function public.admin_link_article_supplier(
  p_store_article_id uuid, p_store_id uuid, p_supplier_id uuid,
  p_supplier_article_code text, p_current_package_price numeric, p_is_preferred boolean
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_store_supplier_id uuid; v_id uuid;
begin
  if not private.current_user_is_admin() then raise exception 'Catalog administration requires ADMIN'; end if;
  insert into public.store_suppliers (store_id, supplier_id, active)
  values (p_store_id, p_supplier_id, true)
  on conflict (store_id, supplier_id) do update set active=true, updated_at=now()
  returning id into v_store_supplier_id;
  if p_is_preferred then
    update public.store_article_suppliers set is_preferred=false, updated_at=now()
    where store_article_id=p_store_article_id and active=true and is_preferred=true;
  end if;
  insert into public.store_article_suppliers (
    store_id, store_article_id, store_supplier_id, supplier_article_code,
    current_package_price, is_preferred, active
  ) values (
    p_store_id, p_store_article_id, v_store_supplier_id,
    nullif(btrim(p_supplier_article_code), ''), p_current_package_price, p_is_preferred, true
  ) on conflict (store_article_id, store_supplier_id) do update set
    supplier_article_code=excluded.supplier_article_code,
    current_package_price=excluded.current_package_price,
    is_preferred=excluded.is_preferred, active=true, updated_at=now()
  returning id into v_id;
  return v_id;
end; $$;

create or replace function public.admin_set_preferred_supplier(p_store_article_supplier_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_store_article_id uuid;
begin
  if not private.current_user_is_admin() then raise exception 'Catalog administration requires ADMIN'; end if;
  select store_article_id into v_store_article_id from public.store_article_suppliers
  where id=p_store_article_supplier_id and active=true;
  if not found then raise exception 'Active article supplier link not found'; end if;
  update public.store_article_suppliers set is_preferred=false, updated_at=now()
  where store_article_id=v_store_article_id and active=true and is_preferred=true;
  update public.store_article_suppliers set is_preferred=true, updated_at=now()
  where id=p_store_article_supplier_id;
end; $$;

create or replace function public.admin_set_supplier_price(p_store_article_supplier_id uuid, p_new_package_price numeric)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not private.current_user_is_admin() then raise exception 'Catalog administration requires ADMIN'; end if;
  if p_new_package_price < 0 then raise exception 'Package price cannot be negative'; end if;
  update public.store_article_suppliers set current_package_price=p_new_package_price, updated_at=now()
  where id=p_store_article_supplier_id and active=true;
  if not found then raise exception 'Active article supplier link not found'; end if;
end; $$;

revoke all on function public.admin_create_store_article(uuid,text,uuid,public.catalog_base_unit,text,numeric,numeric,numeric) from public, anon;
revoke all on function public.admin_associate_article_to_store(uuid,uuid,numeric,numeric) from public, anon;
revoke all on function public.admin_associate_supplier_to_store(uuid,uuid,text,numeric,text) from public, anon;
revoke all on function public.admin_link_article_supplier(uuid,uuid,uuid,text,numeric,boolean) from public, anon;
revoke all on function public.admin_set_preferred_supplier(uuid) from public, anon;
revoke all on function public.admin_set_supplier_price(uuid,numeric) from public, anon;
grant execute on function public.admin_create_store_article(uuid,text,uuid,public.catalog_base_unit,text,numeric,numeric,numeric) to authenticated;
grant execute on function public.admin_associate_article_to_store(uuid,uuid,numeric,numeric) to authenticated;
grant execute on function public.admin_associate_supplier_to_store(uuid,uuid,text,numeric,text) to authenticated;
grant execute on function public.admin_link_article_supplier(uuid,uuid,uuid,text,numeric,boolean) to authenticated;
grant execute on function public.admin_set_preferred_supplier(uuid) to authenticated;
grant execute on function public.admin_set_supplier_price(uuid,numeric) to authenticated;
