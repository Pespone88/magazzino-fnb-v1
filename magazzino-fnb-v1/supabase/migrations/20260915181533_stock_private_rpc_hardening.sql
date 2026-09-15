alter function public.admin_adjust_stock(uuid,numeric,text,text) security definer;
alter function public.admin_reverse_stock_movement(uuid,text,text) security definer;

revoke all on function private.ensure_stock_balance(uuid,uuid) from authenticated;
revoke all on function private.current_stock_unit_cost(uuid) from authenticated;
revoke all on function private.current_user_stock_name() from authenticated;
revoke all on function private.post_stock_movement(uuid,uuid,public.stock_movement_type,numeric,numeric,public.stock_source_type,uuid,uuid,uuid,text,text,timestamptz) from authenticated;
revoke all on function private.reverse_stock_movement(uuid,text,text) from authenticated;
revoke all on function private.open_stock_reservation(uuid,uuid,numeric,public.stock_reservation_type,uuid,uuid,text) from authenticated;
revoke all on function private.release_stock_reservation(uuid) from authenticated;
revoke all on function private.consume_stock_reservation(uuid,public.stock_movement_type,numeric,public.stock_source_type,text,text) from authenticated;

revoke all on function public.admin_adjust_stock(uuid,numeric,text,text) from public, anon, authenticated;
revoke all on function public.admin_reverse_stock_movement(uuid,text,text) from public, anon, authenticated;
grant execute on function public.admin_adjust_stock(uuid,numeric,text,text) to authenticated;
grant execute on function public.admin_reverse_stock_movement(uuid,text,text) to authenticated;
