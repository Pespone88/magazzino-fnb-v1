create index if not exists articles_category_id_idx
  on public.articles (category_id);

create index if not exists notifications_store_id_idx
  on public.notifications (store_id);

create index if not exists purchase_price_history_recorded_by_idx
  on public.purchase_price_history (recorded_by);

create index if not exists store_article_suppliers_article_store_idx
  on public.store_article_suppliers (store_article_id, store_id);

create index if not exists store_article_suppliers_supplier_store_idx
  on public.store_article_suppliers (store_supplier_id, store_id);

create index if not exists store_suppliers_supplier_id_idx
  on public.store_suppliers (supplier_id);
