grant select on public.stock_movements to authenticated;
grant select on public.stock_balances to authenticated;
grant select on public.stock_reservations to authenticated;

create policy stock_movements_select_accessible
on public.stock_movements
for select
to authenticated
using (private.current_user_has_store_access(store_id));

create policy stock_balances_select_accessible
on public.stock_balances
for select
to authenticated
using (private.current_user_has_store_access(store_id));

create policy stock_reservations_select_accessible
on public.stock_reservations
for select
to authenticated
using (private.current_user_has_store_access(store_id));

create or replace function private.reject_stock_movement_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'Stock movements are immutable';
end;
$$;

revoke all on function private.reject_stock_movement_mutation() from public, anon, authenticated;

drop trigger if exists stock_movements_immutable on public.stock_movements;
create trigger stock_movements_immutable
before update or delete on public.stock_movements
for each row execute function private.reject_stock_movement_mutation();
