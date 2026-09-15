create type public.stock_movement_type as enum (
  'OPENING_STOCK','SUPPLIER_RECEIPT','STORE_SUPPLY','STORE_RETURN',
  'INVENTORY_ADJUSTMENT','EXTRAORDINARY_ADJUSTMENT','ADMIN_ADJUSTMENT',
  'INTERSTORE_LOAN_OUT','INTERSTORE_LOAN_IN',
  'INTERSTORE_RETURN_OUT','INTERSTORE_RETURN_IN','REVERSAL'
);

create type public.stock_source_type as enum (
  'OPENING','SUPPLIER_RECEIPT','STORE_SUPPLY','STORE_RETURN',
  'INVENTORY','ADMIN','INTERSTORE_LOAN','INTERSTORE_RETURN','REVERSAL'
);

create type public.stock_reservation_type as enum ('STORE_SUPPLY','INTERSTORE_LOAN','INTERSTORE_RETURN');
create type public.stock_reservation_status as enum ('OPEN','CONSUMED','RELEASED');

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  store_article_id uuid not null,
  movement_type public.stock_movement_type not null,
  quantity_delta_base numeric(14,3) not null,
  unit_cost_snapshot numeric(18,6),
  total_value_snapshot numeric(20,6) generated always as (
    case when unit_cost_snapshot is null then null
         else round(abs(quantity_delta_base) * unit_cost_snapshot, 6) end
  ) stored,
  source_type public.stock_source_type not null,
  source_id uuid,
  source_line_id uuid,
  reversal_of_movement_id uuid references public.stock_movements(id) on delete restrict,
  operation_key text not null,
  reason text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_by_name_snapshot text not null,
  constraint stock_movements_store_article_fk
    foreign key (store_article_id, store_id)
    references public.store_articles(id, store_id) on delete restrict,
  constraint stock_movements_nonzero check (quantity_delta_base <> 0),
  constraint stock_movements_cost_nonnegative check (unit_cost_snapshot is null or unit_cost_snapshot >= 0),
  constraint stock_movements_operation_key_not_blank check (length(btrim(operation_key)) > 0),
  constraint stock_movements_operation_key_unique unique (operation_key)
);

create table public.stock_balances (
  store_article_id uuid primary key,
  store_id uuid not null,
  on_hand numeric(14,3) not null default 0,
  reserved numeric(14,3) not null default 0,
  available numeric(14,3) generated always as (on_hand - reserved) stored,
  updated_at timestamptz not null default now(),
  last_movement_id uuid references public.stock_movements(id) on delete restrict,
  constraint stock_balances_store_article_fk
    foreign key (store_article_id, store_id)
    references public.store_articles(id, store_id) on delete restrict,
  constraint stock_balances_on_hand_nonnegative check (on_hand >= 0),
  constraint stock_balances_reserved_nonnegative check (reserved >= 0),
  constraint stock_balances_reserved_not_over_on_hand check (reserved <= on_hand)
);

create table public.stock_reservations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  store_article_id uuid not null,
  quantity_base numeric(14,3) not null,
  reservation_type public.stock_reservation_type not null,
  source_id uuid not null,
  source_line_id uuid,
  status public.stock_reservation_status not null default 'OPEN',
  operation_key text not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id) on delete restrict,
  closed_at timestamptz,
  closed_by uuid references public.profiles(id) on delete restrict,
  constraint stock_reservations_store_article_fk
    foreign key (store_article_id, store_id)
    references public.store_articles(id, store_id) on delete restrict,
  constraint stock_reservations_quantity_positive check (quantity_base > 0),
  constraint stock_reservations_operation_key_not_blank check (length(btrim(operation_key)) > 0),
  constraint stock_reservations_operation_key_unique unique (operation_key),
  constraint stock_reservations_close_state check (
    (status = 'OPEN' and closed_at is null and closed_by is null)
    or (status in ('CONSUMED','RELEASED') and closed_at is not null and closed_by is not null)
  )
);

create index stock_movements_store_date_idx on public.stock_movements(store_id, occurred_at desc);
create index stock_movements_article_date_idx on public.stock_movements(store_article_id, occurred_at desc);
create index stock_movements_reversal_idx on public.stock_movements(reversal_of_movement_id) where reversal_of_movement_id is not null;
create index stock_reservations_store_status_idx on public.stock_reservations(store_id, status);
create index stock_reservations_article_status_idx on public.stock_reservations(store_article_id, status);

alter table public.stock_movements enable row level security;
alter table public.stock_balances enable row level security;
alter table public.stock_reservations enable row level security;

revoke all on table public.stock_movements from anon, authenticated;
revoke all on table public.stock_balances from anon, authenticated;
revoke all on table public.stock_reservations from anon, authenticated;
