create type public.supplier_order_status as enum (
  'DRAFT','ORDERED','PARTIALLY_RECEIVED','COMPLETED','CANCELLED'
);

create type public.supplier_order_line_status as enum (
  'TO_RECEIVE','PARTIAL','COMPLETED','NOT_SUPPLIED',
  'AWAITING_REPLACEMENT','AWAITING_CREDIT_NOTE','CLOSED_WITH_DISCREPANCY'
);

create type public.supplier_receipt_status as enum ('CONFIRMED','REVERSED');

create type public.supplier_receipt_outcome as enum (
  'CONFORMING','PARTIAL_QUANTITY','MISSING','WRONG_ITEM',
  'QUALITY_NOT_SUITABLE','UNBILLED','OTHER'
);

create type public.supplier_nc_type as enum (
  'QUANTITY_MISMATCH','MISSING_ITEM','WRONG_ITEM',
  'QUALITY_NOT_SUITABLE','UNBILLED_ITEM','OTHER'
);

create type public.supplier_nc_resolution as enum (
  'NEXT_DELIVERY','CLOSE','NO_ACTION','REPLACEMENT',
  'ACCEPT_AS_OTHER_ARTICLE','CREDIT_NOTE','OTHER'
);

create type public.supplier_nc_status as enum (
  'OPEN','AWAITING_REPLACEMENT','AWAITING_CREDIT_NOTE','RESOLVED','CLOSED'
);

create table public.supplier_orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  store_supplier_id uuid not null,
  status public.supplier_order_status not null default 'DRAFT',
  estimated_total numeric(16,4) not null default 0,
  notes text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  ordered_at timestamptz,
  ordered_by uuid references public.profiles(id) on delete restrict,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id) on delete restrict,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_orders_id_store_unique unique (id, store_id),
  constraint supplier_orders_supplier_store_fk
    foreign key (store_supplier_id, store_id)
    references public.store_suppliers(id, store_id) on delete restrict,
  constraint supplier_orders_total_nonnegative check (estimated_total >= 0),
  constraint supplier_orders_cancel_state check (
    (status <> 'CANCELLED' and cancelled_at is null and cancelled_by is null and cancellation_reason is null)
    or
    (status = 'CANCELLED' and cancelled_at is not null and cancelled_by is not null
      and cancellation_reason is not null and length(btrim(cancellation_reason)) > 0)
  )
);

create table public.supplier_order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  store_id uuid not null,
  store_article_id uuid not null,
  store_article_supplier_id uuid not null references public.store_article_suppliers(id) on delete restrict,
  article_name_snapshot text not null,
  base_unit_snapshot public.catalog_base_unit not null,
  package_quantity_snapshot numeric(14,3) not null,
  ordered_quantity_base numeric(14,3) not null,
  estimated_package_price numeric(14,4) not null,
  estimated_total numeric(18,4) generated always as (
    round((ordered_quantity_base / package_quantity_snapshot) * estimated_package_price, 4)
  ) stored,
  accepted_quantity_base numeric(14,3) not null default 0,
  status public.supplier_order_line_status not null default 'TO_RECEIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_order_lines_id_order_store_unique unique (id, order_id, store_id),
  constraint supplier_order_lines_order_store_fk
    foreign key (order_id, store_id)
    references public.supplier_orders(id, store_id) on delete restrict,
  constraint supplier_order_lines_article_store_fk
    foreign key (store_article_id, store_id)
    references public.store_articles(id, store_id) on delete restrict,
  constraint supplier_order_lines_article_unique unique (order_id, store_article_id),
  constraint supplier_order_lines_article_name_not_blank check (length(btrim(article_name_snapshot)) > 0),
  constraint supplier_order_lines_package_qty_positive check (package_quantity_snapshot > 0),
  constraint supplier_order_lines_ordered_qty_positive check (ordered_quantity_base > 0),
  constraint supplier_order_lines_ordered_qty_precision check (ordered_quantity_base = round(ordered_quantity_base, 3)),
  constraint supplier_order_lines_accepted_qty_nonnegative check (accepted_quantity_base >= 0),
  constraint supplier_order_lines_accepted_qty_precision check (accepted_quantity_base = round(accepted_quantity_base, 3)),
  constraint supplier_order_lines_estimated_price_nonnegative check (estimated_package_price >= 0)
);

create table public.supplier_receipts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  order_id uuid not null,
  store_supplier_id uuid not null,
  status public.supplier_receipt_status not null default 'CONFIRMED',
  document_number text not null,
  document_date date not null,
  document_total numeric(16,4),
  extra_amount numeric(16,4) not null default 0,
  extra_note text,
  notes text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  confirmed_at timestamptz not null default now(),
  reversed_at timestamptz,
  reversed_by uuid references public.profiles(id) on delete restrict,
  reversal_reason text,
  created_at timestamptz not null default now(),
  constraint supplier_receipts_id_order_store_unique unique (id, order_id, store_id),
  constraint supplier_receipts_order_store_fk
    foreign key (order_id, store_id)
    references public.supplier_orders(id, store_id) on delete restrict,
  constraint supplier_receipts_supplier_store_fk
    foreign key (store_supplier_id, store_id)
    references public.store_suppliers(id, store_id) on delete restrict,
  constraint supplier_receipts_document_number_not_blank check (length(btrim(document_number)) > 0),
  constraint supplier_receipts_document_total_nonnegative check (document_total is null or document_total >= 0),
  constraint supplier_receipts_extra_amount_nonnegative check (extra_amount >= 0),
  constraint supplier_receipts_reversal_state check (
    (status = 'CONFIRMED' and reversed_at is null and reversed_by is null and reversal_reason is null)
    or
    (status = 'REVERSED' and reversed_at is not null and reversed_by is not null
      and reversal_reason is not null and length(btrim(reversal_reason)) > 0)
  )
);

create unique index supplier_receipts_supplier_document_unique
  on public.supplier_receipts(store_supplier_id, document_number, document_date)
  where status = 'CONFIRMED';

create table public.supplier_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null,
  order_id uuid not null,
  store_id uuid not null,
  order_line_id uuid not null,
  expected_store_article_id uuid not null,
  actual_store_article_id uuid,
  documented_quantity_base numeric(14,3) not null default 0,
  received_quantity_base numeric(14,3) not null default 0,
  accepted_quantity_base numeric(14,3) not null default 0,
  document_package_price numeric(14,4),
  price_change_confirmed boolean not null default false,
  outcome public.supplier_receipt_outcome not null,
  resolution public.supplier_nc_resolution,
  note text,
  movement_id uuid references public.stock_movements(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint supplier_receipt_lines_receipt_order_store_fk
    foreign key (receipt_id, order_id, store_id)
    references public.supplier_receipts(id, order_id, store_id) on delete restrict,
  constraint supplier_receipt_lines_order_line_store_fk
    foreign key (order_line_id, order_id, store_id)
    references public.supplier_order_lines(id, order_id, store_id) on delete restrict,
  constraint supplier_receipt_lines_expected_article_store_fk
    foreign key (expected_store_article_id, store_id)
    references public.store_articles(id, store_id) on delete restrict,
  constraint supplier_receipt_lines_actual_article_store_fk
    foreign key (actual_store_article_id, store_id)
    references public.store_articles(id, store_id) on delete restrict,
  constraint supplier_receipt_lines_one_order_line unique (receipt_id, order_line_id),
  constraint supplier_receipt_lines_documented_nonnegative check (documented_quantity_base >= 0),
  constraint supplier_receipt_lines_received_nonnegative check (received_quantity_base >= 0),
  constraint supplier_receipt_lines_accepted_nonnegative check (accepted_quantity_base >= 0),
  constraint supplier_receipt_lines_quantities_precision check (
    documented_quantity_base = round(documented_quantity_base,3)
    and received_quantity_base = round(received_quantity_base,3)
    and accepted_quantity_base = round(accepted_quantity_base,3)
  ),
  constraint supplier_receipt_lines_accepted_not_over_received check (accepted_quantity_base <= received_quantity_base),
  constraint supplier_receipt_lines_price_nonnegative check (document_package_price is null or document_package_price >= 0)
);

create table public.supplier_nonconformities (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  order_id uuid not null,
  order_line_id uuid not null,
  receipt_id uuid not null,
  receipt_line_id uuid not null references public.supplier_receipt_lines(id) on delete restrict,
  type public.supplier_nc_type not null,
  quantity_affected_base numeric(14,3),
  status public.supplier_nc_status not null default 'OPEN',
  resolution public.supplier_nc_resolution,
  note text,
  credit_note_number text,
  credit_note_date date,
  credit_note_amount numeric(16,4),
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint supplier_nc_order_store_fk
    foreign key (order_id, store_id)
    references public.supplier_orders(id, store_id) on delete restrict,
  constraint supplier_nc_order_line_store_fk
    foreign key (order_line_id, order_id, store_id)
    references public.supplier_order_lines(id, order_id, store_id) on delete restrict,
  constraint supplier_nc_receipt_store_fk
    foreign key (receipt_id, order_id, store_id)
    references public.supplier_receipts(id, order_id, store_id) on delete restrict,
  constraint supplier_nc_quantity_nonzero check (quantity_affected_base is null or quantity_affected_base <> 0),
  constraint supplier_nc_quantity_precision check (quantity_affected_base is null or quantity_affected_base = round(quantity_affected_base,3)),
  constraint supplier_nc_credit_amount_nonnegative check (credit_note_amount is null or credit_note_amount >= 0),
  constraint supplier_nc_credit_fields_coherent check (
    (credit_note_number is null and credit_note_date is null and credit_note_amount is null)
    or
    (credit_note_number is not null and length(btrim(credit_note_number)) > 0
      and credit_note_date is not null and credit_note_amount is not null)
  )
);

create table public.procurement_operations (
  operation_key text primary key,
  store_id uuid not null references public.stores(id) on delete restrict,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  result_json jsonb not null default '{}'::jsonb,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint procurement_operations_key_not_blank check (length(btrim(operation_key)) > 0),
  constraint procurement_operations_action_not_blank check (length(btrim(action)) > 0),
  constraint procurement_operations_entity_type_not_blank check (length(btrim(entity_type)) > 0)
);

create index supplier_orders_store_status_created_idx
  on public.supplier_orders(store_id, status, created_at desc);
create index supplier_order_lines_order_status_idx
  on public.supplier_order_lines(order_id, status);
create index supplier_order_lines_article_idx
  on public.supplier_order_lines(store_article_id);
create index supplier_receipts_order_date_idx
  on public.supplier_receipts(order_id, confirmed_at desc);
create index supplier_receipt_lines_order_line_idx
  on public.supplier_receipt_lines(order_line_id);
create index supplier_receipt_lines_movement_idx
  on public.supplier_receipt_lines(movement_id)
  where movement_id is not null;
create index supplier_nc_store_status_idx
  on public.supplier_nonconformities(store_id, status, created_at desc);
create index supplier_nc_order_idx
  on public.supplier_nonconformities(order_id, created_at desc);
create index supplier_nc_receipt_idx
  on public.supplier_nonconformities(receipt_id);
create index supplier_nc_updated_by_idx
  on public.supplier_nonconformities(updated_by);
create index procurement_operations_store_date_idx
  on public.procurement_operations(store_id, created_at desc);

alter table public.supplier_orders enable row level security;
alter table public.supplier_order_lines enable row level security;
alter table public.supplier_receipts enable row level security;
alter table public.supplier_receipt_lines enable row level security;
alter table public.supplier_nonconformities enable row level security;
alter table public.procurement_operations enable row level security;

revoke all on table public.supplier_orders from anon, authenticated;
revoke all on table public.supplier_order_lines from anon, authenticated;
revoke all on table public.supplier_receipts from anon, authenticated;
revoke all on table public.supplier_receipt_lines from anon, authenticated;
revoke all on table public.supplier_nonconformities from anon, authenticated;
revoke all on table public.procurement_operations from anon, authenticated;
