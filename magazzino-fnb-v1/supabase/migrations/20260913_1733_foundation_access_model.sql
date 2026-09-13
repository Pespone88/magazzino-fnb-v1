-- Foundation access model for MAGAZZINO FNB V1
-- Scope: stores, profiles, store memberships, and RLS helpers only.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create type public.global_role as enum ('ADMIN', 'USER');
create type public.store_role as enum ('RESPONSABILE', 'VICE', 'MAGAZZINIERE');

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stores_name_not_blank check (length(btrim(name)) > 0),
  constraint stores_slug_not_blank check (length(btrim(slug)) > 0)
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  first_name text,
  last_name text,
  global_role public.global_role not null default 'USER',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.store_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  store_id uuid not null references public.stores(id) on delete restrict,
  role public.store_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_memberships_user_store_unique unique (user_id, store_id)
);

create index store_memberships_store_id_idx
  on public.store_memberships (store_id)
  where active = true;

create index store_memberships_user_id_idx
  on public.store_memberships (user_id)
  where active = true;

insert into public.stores (name, slug)
values
  ('Eccellenze della Costiera', 'eccellenze-della-costiera'),
  ('Nonna Titti', 'nonna-titti');

create or replace function private.current_user_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.active = true
        and p.global_role = 'ADMIN'::public.global_role
    );
$$;

create or replace function private.current_user_has_store_access(target_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and (
      exists (
        select 1
        from public.profiles p
        where p.id = (select auth.uid())
          and p.active = true
          and p.global_role = 'ADMIN'::public.global_role
      )
      or exists (
        select 1
        from public.profiles p
        join public.store_memberships sm on sm.user_id = p.id
        where p.id = (select auth.uid())
          and p.active = true
          and sm.active = true
          and sm.store_id = target_store_id
      )
    );
$$;

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, first_name, last_name)
  values (
    new.id,
    nullif(btrim(new.raw_user_meta_data ->> 'first_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'last_name'), '')
  );
  return new;
end;
$$;

revoke all on function private.current_user_is_admin() from public;
revoke all on function private.current_user_has_store_access(uuid) from public;
revoke all on function private.handle_new_auth_user() from public;
grant execute on function private.current_user_is_admin() to authenticated;
grant execute on function private.current_user_has_store_access(uuid) to authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_auth_user();

alter table public.stores enable row level security;
alter table public.profiles enable row level security;
alter table public.store_memberships enable row level security;

revoke all on table public.stores from anon, authenticated;
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.store_memberships from anon, authenticated;

grant select, insert, update on table public.stores to authenticated;
grant select, update on table public.profiles to authenticated;
grant select, insert, update on table public.store_memberships to authenticated;

create policy stores_select_accessible
on public.stores
for select
to authenticated
using (
  active = true
  and private.current_user_has_store_access(id)
);

create policy stores_insert_admin
on public.stores
for insert
to authenticated
with check (private.current_user_is_admin());

create policy stores_update_admin
on public.stores
for update
to authenticated
using (private.current_user_is_admin())
with check (private.current_user_is_admin());

create policy profiles_select_self_or_admin
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or private.current_user_is_admin()
);

create policy profiles_update_admin
on public.profiles
for update
to authenticated
using (private.current_user_is_admin())
with check (private.current_user_is_admin());

create policy memberships_select_self_or_admin
on public.store_memberships
for select
to authenticated
using (
  user_id = (select auth.uid())
  or private.current_user_is_admin()
);

create policy memberships_insert_admin
on public.store_memberships
for insert
to authenticated
with check (private.current_user_is_admin());

create policy memberships_update_admin
on public.store_memberships
for update
to authenticated
using (private.current_user_is_admin())
with check (private.current_user_is_admin());
