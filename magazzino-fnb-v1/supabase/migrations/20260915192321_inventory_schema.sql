create type public.inventory_type as enum ('OPENING','MONTHLY','EXTRAORDINARY');
create type public.inventory_status as enum ('IN_PROGRESS','IN_REVIEW','RECOUNT','APPROVED','CLOSED');
create type public.inventory_review_state as enum ('PENDING','ACCEPTED','RECOUNT_REQUIRED');
create type public.inventory_reason as enum (
  'PREVIOUS_ERROR','MISSING_MOVEMENT','UNRECORDED_WASTE',
  'PREVIOUS_INVENTORY_ERROR','UNKNOWN','OTHER'
);
create type public.stock_anomaly_origin as enum (
  'EXTRAORDINARY_COUNT','STORE_SUPPLY_DISCREPANCY','INTERSTORE_DISCREPANCY',
  'STORE_RETURN_DISCREPANCY','OPERATING_ERROR'
);
create type public.stock_anomaly_status as enum ('TO_VERIFY','IN_REVIEW','RESOLVED','CLOSED_UNKNOWN');

alter type public.notification_type add value if not exists 'INVENTORY_REVIEW_REQUIRED';
alter type public.notification_type add value if not exists 'INVENTORY_RECOUNT_REQUIRED';
alter type public.notification_type add value if not exists 'EXTRAORDINARY_ADJUSTMENT_REVIEW_REQUIRED';

create table public.inventory_sessions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  inventory_type public.inventory_type not null,
  status public.inventory_status not null default 'IN_PROGRESS',
  snapshot_at timestamptz not null default now(),
  started_at timestamptz not null default now(),
  started_by uuid not null references public.profiles(id) on delete restrict,
  submitted_at timestamptz,
  submitted_by uuid references public.profiles(id) on delete restrict,
  approved_at timestamptz,
  approved_by uuid references public.profiles(id) on delete restrict,
  closed_at timestamptz,
  closed_by uuid references public.profiles(id) on delete restrict,
  operation_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_sessions_id_store_unique unique (id, store_id),
  constraint inventory_sessions_operation_key_unique unique (operation_key),
  constraint inventory_sessions_operation_key_not_blank check (length(btrim(operation_key)) > 0),
  constraint inventory_sessions_extraordinary_status check (
    inventory_type <> 'EXTRAORDINARY'::public.inventory_type
    or status in ('IN_PROGRESS'::public.inventory_status, 'CLOSED'::public.inventory_status)
  ),
  constraint inventory_sessions_closed_metadata check (
    (status = 'CLOSED'::public.inventory_status and closed_at is not null and closed_by is not null)
    or (status <> 'CLOSED'::public.inventory_status and closed_at is null and closed_by is null)
  ),
  constraint inventory_sessions_approved_metadata check (
    inventory_type = 'EXTRAORDINARY'::public.inventory_type
    or (
      (status in ('APPROVED'::public.inventory_status,'CLOSED'::public.inventory_status)
       and approved_at is not null and approved_by is not null)
      or
      (status not in ('APPROVED'::public.inventory_status,'CLOSED'::public.inventory_status)
       and approved_at is null and approved_by is null)
    )
  )
);

create unique index inventory_sessions_one_opening_per_store
  on public.inventory_sessions(store_id)
  where inventory_type = 'OPENING'::public.inventory_type;

create unique index inventory_sessions_one_full_open_per_store
  on public.inventory_sessions(store_id)
  where inventory_type in ('OPENING'::public.inventory_type,'MONTHLY'::public.inventory_type)
    and status <> 'CLOSED'::public.inventory_status;

create table public.inventory_lines (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  store_id uuid not null,
  store_article_id uuid not null,
  article_name_snapshot text not null,
  base_unit_snapshot public.catalog_base_unit not null,
  snapshot_on_hand numeric(14,3) not null default 0,
  snapshot_reserved numeric(14,3) not null default 0,
  review_state public.inventory_review_state not null default 'PENDING',
  current_round integer not null default 1,
  created_at timestamptz not null default now(),
  constraint inventory_lines_session_store_fk
    foreign key (session_id, store_id)
    references public.inventory_sessions(id, store_id) on delete restrict,
  constraint inventory_lines_article_store_fk
    foreign key (store_article_id, store_id)
    references public.store_articles(id, store_id) on delete restrict,
  constraint inventory_lines_session_article_unique unique (session_id, store_article_id),
  constraint inventory_lines_id_session_unique unique (id, session_id),
  constraint inventory_lines_article_name_not_blank check (length(btrim(article_name_snapshot)) > 0),
  constraint inventory_lines_snapshot_on_hand_nonnegative check (snapshot_on_hand >= 0),
  constraint inventory_lines_snapshot_reserved_nonnegative check (snapshot_reserved >= 0),
  constraint inventory_lines_snapshot_reserved_valid check (snapshot_reserved <= snapshot_on_hand),
  constraint inventory_lines_round_positive check (current_round >= 1)
);

create table public.inventory_counts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  inventory_line_id uuid not null,
  round_number integer not null,
  counted_quantity numeric(14,3) not null,
  counted_at timestamptz not null default now(),
  counted_by uuid not null references public.profiles(id) on delete restrict,
  preliminary_reason public.inventory_reason,
  note text,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_counts_line_session_fk
    foreign key (inventory_line_id, session_id)
    references public.inventory_lines(id, session_id) on delete restrict,
  constraint inventory_counts_line_round_unique unique (inventory_line_id, round_number),
  constraint inventory_counts_quantity_nonnegative check (counted_quantity >= 0),
  constraint inventory_counts_round_positive check (round_number >= 1),
  constraint inventory_counts_other_note check (
    preliminary_reason <> 'OTHER'::public.inventory_reason
    or (note is not null and length(btrim(note)) > 0)
  )
);

create table public.stock_anomalies (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  store_article_id uuid not null,
  origin_type public.stock_anomaly_origin not null,
  source_id uuid not null,
  source_line_id uuid,
  movement_id uuid references public.stock_movements(id) on delete restrict,
  quantity_difference numeric(14,3),
  preliminary_reason public.inventory_reason not null,
  final_reason public.inventory_reason,
  status public.stock_anomaly_status not null default 'TO_VERIFY',
  resolution_note text,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles(id) on delete restrict,
  resolved_at timestamptz,
  constraint stock_anomalies_article_store_fk
    foreign key (store_article_id, store_id)
    references public.store_articles(id, store_id) on delete restrict,
  constraint stock_anomalies_difference_nonzero check (
    quantity_difference is null or quantity_difference <> 0
  ),
  constraint stock_anomalies_resolution_state check (
    (status in ('TO_VERIFY'::public.stock_anomaly_status,'IN_REVIEW'::public.stock_anomaly_status)
      and final_reason is null and resolved_at is null)
    or
    (status = 'RESOLVED'::public.stock_anomaly_status
      and final_reason is not null
      and resolution_note is not null and length(btrim(resolution_note)) > 0
      and resolved_at is not null)
    or
    (status = 'CLOSED_UNKNOWN'::public.stock_anomaly_status
      and final_reason = 'UNKNOWN'::public.inventory_reason
      and resolved_at is not null)
  )
);

create table public.inventory_operations (
  operation_key text primary key,
  action text not null,
  session_id uuid references public.inventory_sessions(id) on delete restrict,
  anomaly_id uuid references public.stock_anomalies(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  result_id uuid,
  created_at timestamptz not null default now(),
  constraint inventory_operations_key_not_blank check (length(btrim(operation_key)) > 0),
  constraint inventory_operations_action_not_blank check (length(btrim(action)) > 0)
);

alter table public.inventory_sessions enable row level security;
alter table public.inventory_lines enable row level security;
alter table public.inventory_counts enable row level security;
alter table public.inventory_operations enable row level security;
alter table public.stock_anomalies enable row level security;

revoke all on table public.inventory_sessions from anon, authenticated;
revoke all on table public.inventory_lines from anon, authenticated;
revoke all on table public.inventory_counts from anon, authenticated;
revoke all on table public.inventory_operations from anon, authenticated;
revoke all on table public.stock_anomalies from anon, authenticated;
