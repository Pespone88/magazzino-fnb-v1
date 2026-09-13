-- Verification contract for the foundation schema.
-- This file mirrors the remote checks performed after migration.

select to_regclass('public.stores') is not null as stores_exists;
select to_regclass('public.profiles') is not null as profiles_exists;
select to_regclass('public.store_memberships') is not null as memberships_exists;

select relname, relrowsecurity
from pg_class
where oid in (
  'public.stores'::regclass,
  'public.profiles'::regclass,
  'public.store_memberships'::regclass
)
order by relname;
