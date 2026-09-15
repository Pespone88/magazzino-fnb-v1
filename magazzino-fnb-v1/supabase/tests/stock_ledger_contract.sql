-- Stock ledger contract.
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

select to_regprocedure('private.ensure_stock_balance(uuid,uuid)') is not null as has_ensure_balance;
select to_regprocedure('private.current_stock_unit_cost(uuid)') is not null as has_current_cost;
select to_regprocedure('private.current_user_stock_name()') is not null as has_stock_user_name;
select to_regprocedure('private.post_stock_movement(uuid,uuid,public.stock_movement_type,numeric,numeric,public.stock_source_type,uuid,uuid,uuid,text,text,timestamptz)') is not null as has_post_movement;
select to_regprocedure('private.reverse_stock_movement(uuid,text,text)') is not null as has_reverse_movement;
select to_regprocedure('public.admin_adjust_stock(uuid,numeric,text,text)') is not null as has_admin_adjust;
select to_regprocedure('public.admin_reverse_stock_movement(uuid,text,text)') is not null as has_admin_reverse;

select has_function_privilege('anon', 'public.admin_adjust_stock(uuid,numeric,text,text)', 'EXECUTE') as anon_adjust_execute;
select has_function_privilege('anon', 'public.admin_reverse_stock_movement(uuid,text,text)', 'EXECUTE') as anon_reverse_execute;
select has_function_privilege('authenticated', 'public.admin_adjust_stock(uuid,numeric,text,text)', 'EXECUTE') as authenticated_adjust_execute;
select has_function_privilege('authenticated', 'public.admin_reverse_stock_movement(uuid,text,text)', 'EXECUTE') as authenticated_reverse_execute;

select to_regprocedure('private.open_stock_reservation(uuid,uuid,numeric,public.stock_reservation_type,uuid,uuid,text)') is not null as has_open_reservation;
select to_regprocedure('private.release_stock_reservation(uuid)') is not null as has_release_reservation;
select to_regprocedure('private.consume_stock_reservation(uuid,public.stock_movement_type,numeric,public.stock_source_type,text,text)') is not null as has_consume_reservation;

select to_regprocedure('public.open_stock_reservation(uuid,uuid,numeric,public.stock_reservation_type,uuid,uuid,text)') is null as no_public_open_reservation;
select to_regprocedure('public.release_stock_reservation(uuid)') is null as no_public_release_reservation;
select to_regprocedure('public.consume_stock_reservation(uuid,public.stock_movement_type,numeric,public.stock_source_type,text,text)') is null as no_public_consume_reservation;
