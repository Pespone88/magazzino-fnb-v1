-- Stock ledger schema contract.
-- Run after migrations. Every query must return the expected secure state.

select to_regclass('public.stock_movements') is not null as has_movements;
select to_regclass('public.stock_balances') is not null as has_balances;
select to_regclass('public.stock_reservations') is not null as has_reservations;

select relname, relrowsecurity
from pg_class
where oid in (
  'public.stock_movements'::regclass,
  'public.stock_balances'::regclass,
  'public.stock_reservations'::regclass
)
order by relname;

select has_table_privilege('authenticated', 'public.stock_movements', 'UPDATE') as movement_update;
select has_table_privilege('authenticated', 'public.stock_movements', 'DELETE') as movement_delete;
select has_table_privilege('authenticated', 'public.stock_balances', 'INSERT,UPDATE,DELETE') as balance_write;
select has_table_privilege('authenticated', 'public.stock_reservations', 'INSERT,UPDATE,DELETE') as reservation_write;
