create index stock_balances_last_movement_id_idx
  on public.stock_balances(last_movement_id);
create index stock_balances_store_article_store_idx
  on public.stock_balances(store_article_id, store_id);
create index stock_movements_created_by_idx
  on public.stock_movements(created_by);
create index stock_movements_store_article_store_idx
  on public.stock_movements(store_article_id, store_id);
create index stock_reservations_closed_by_idx
  on public.stock_reservations(closed_by);
create index stock_reservations_created_by_idx
  on public.stock_reservations(created_by);
create index stock_reservations_store_article_store_idx
  on public.stock_reservations(store_article_id, store_id);
