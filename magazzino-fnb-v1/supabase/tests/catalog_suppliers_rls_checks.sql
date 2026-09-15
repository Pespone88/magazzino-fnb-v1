-- Transaction-only RLS verification for Catalog + Suppliers.
begin;

create temp table catalog_test_actor on commit drop as
select id
from public.profiles
where active = true
  and global_role = 'ADMIN'::public.global_role
limit 1;

do $$
declare
  v_actor uuid;
  v_category uuid;
  v_eccellenze uuid;
  v_nonna uuid;
  v_article_ecc uuid;
  v_article_nonna uuid;
begin
  select id into v_actor from pg_temp.catalog_test_actor limit 1;
  if v_actor is null then raise exception 'No active ADMIN available for RLS test'; end if;

  select id into v_eccellenze from public.stores where slug = 'eccellenze-della-costiera';
  select id into v_nonna from public.stores where slug = 'nonna-titti';

  insert into public.categories (name)
  values ('__RLS_TEST_CATEGORY__')
  returning id into v_category;

  insert into public.articles (name, category_id, base_unit, package_quantity)
  values ('__RLS_TEST_ECCELLENZE__', v_category, 'PZ'::public.catalog_base_unit, 1)
  returning id into v_article_ecc;

  insert into public.articles (name, category_id, base_unit, package_quantity)
  values ('__RLS_TEST_NONNA_TITTI__', v_category, 'PZ'::public.catalog_base_unit, 1)
  returning id into v_article_nonna;

  insert into public.store_articles (store_id, article_id, min_stock, target_stock)
  values
    (v_eccellenze, v_article_ecc, 0, 0),
    (v_nonna, v_article_nonna, 0, 0);

  insert into public.store_memberships (user_id, store_id, role, active)
  values (v_actor, v_eccellenze, 'MAGAZZINIERE'::public.store_role, true)
  on conflict (user_id, store_id) do update
    set role = excluded.role, active = true, updated_at = now();

  update public.store_memberships
  set active = false, updated_at = now()
  where user_id = v_actor
    and store_id = v_nonna;

  update public.profiles
  set global_role = 'USER'::public.global_role, updated_at = now()
  where id = v_actor;

  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_actor::text, 'role', 'authenticated')::text,
    true
  );
end;
$$;

set local role authenticated;

select
  (
    select count(*) = 1
    from public.store_articles sa
    join public.articles a on a.id = sa.article_id
    where a.name in ('__RLS_TEST_ECCELLENZE__', '__RLS_TEST_NONNA_TITTI__')
  ) as sees_only_assigned_store,
  not exists (
    select 1
    from public.articles a
    where a.name = '__RLS_TEST_NONNA_TITTI__'
  ) as cannot_see_other_article;

reset role;
rollback;
