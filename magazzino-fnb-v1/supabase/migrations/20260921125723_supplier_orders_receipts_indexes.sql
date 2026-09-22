create index procurement_operations_actor_idx on public.procurement_operations(actor_id);

create index supplier_nc_order_line_store_idx
  on public.supplier_nonconformities(order_line_id, order_id, store_id);
create index supplier_nc_order_store_idx
  on public.supplier_nonconformities(order_id, store_id);
create index supplier_nc_receipt_store_idx
  on public.supplier_nonconformities(receipt_id, order_id, store_id);
create index supplier_nc_created_by_idx
  on public.supplier_nonconformities(created_by);
create index supplier_nc_receipt_line_idx
  on public.supplier_nonconformities(receipt_line_id);

create index supplier_order_lines_article_store_idx
  on public.supplier_order_lines(store_article_id, store_id);
create index supplier_order_lines_order_store_idx
  on public.supplier_order_lines(order_id, store_id);
create index supplier_order_lines_supplier_link_idx
  on public.supplier_order_lines(store_article_supplier_id);

create index supplier_orders_cancelled_by_idx
  on public.supplier_orders(cancelled_by) where cancelled_by is not null;
create index supplier_orders_created_by_idx
  on public.supplier_orders(created_by);
create index supplier_orders_ordered_by_idx
  on public.supplier_orders(ordered_by) where ordered_by is not null;
create index supplier_orders_supplier_store_idx
  on public.supplier_orders(store_supplier_id, store_id);

create index supplier_receipt_lines_actual_article_store_idx
  on public.supplier_receipt_lines(actual_store_article_id, store_id)
  where actual_store_article_id is not null;
create index supplier_receipt_lines_expected_article_store_idx
  on public.supplier_receipt_lines(expected_store_article_id, store_id);
create index supplier_receipt_lines_order_line_store_idx
  on public.supplier_receipt_lines(order_line_id, order_id, store_id);
create index supplier_receipt_lines_receipt_order_store_idx
  on public.supplier_receipt_lines(receipt_id, order_id, store_id);

create index supplier_receipts_created_by_idx
  on public.supplier_receipts(created_by);
create index supplier_receipts_order_store_idx
  on public.supplier_receipts(order_id, store_id);
create index supplier_receipts_reversed_by_idx
  on public.supplier_receipts(reversed_by) where reversed_by is not null;
create index supplier_receipts_store_idx
  on public.supplier_receipts(store_id);
create index supplier_receipts_supplier_store_idx
  on public.supplier_receipts(store_supplier_id, store_id);
