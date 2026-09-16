-- Defense-in-depth: raw inventory tables remain inaccessible to clients.
create policy inventory_sessions_deny_direct
on public.inventory_sessions for all to authenticated
using (false) with check (false);

create policy inventory_lines_deny_direct
on public.inventory_lines for all to authenticated
using (false) with check (false);

create policy inventory_counts_deny_direct
on public.inventory_counts for all to authenticated
using (false) with check (false);

create policy inventory_operations_deny_direct
on public.inventory_operations for all to authenticated
using (false) with check (false);

create policy stock_anomalies_deny_direct
on public.stock_anomalies for all to authenticated
using (false) with check (false);

revoke all on table public.inventory_sessions from anon, authenticated;
revoke all on table public.inventory_lines from anon, authenticated;
revoke all on table public.inventory_counts from anon, authenticated;
revoke all on table public.inventory_operations from anon, authenticated;
revoke all on table public.stock_anomalies from anon, authenticated;

-- Query/FK indexes.
create index inventory_sessions_store_status_started_idx
  on public.inventory_sessions(store_id,status,started_at desc);
create index inventory_sessions_started_by_idx on public.inventory_sessions(started_by);
create index inventory_sessions_submitted_by_idx on public.inventory_sessions(submitted_by) where submitted_by is not null;
create index inventory_sessions_approved_by_idx on public.inventory_sessions(approved_by) where approved_by is not null;
create index inventory_sessions_closed_by_idx on public.inventory_sessions(closed_by) where closed_by is not null;

create index inventory_lines_session_store_idx on public.inventory_lines(session_id,store_id);
create index inventory_lines_store_article_store_idx on public.inventory_lines(store_article_id,store_id);

create index inventory_counts_line_session_idx on public.inventory_counts(inventory_line_id,session_id);
create index inventory_counts_counted_by_idx on public.inventory_counts(counted_by);

create index inventory_operations_session_idx on public.inventory_operations(session_id) where session_id is not null;
create index inventory_operations_anomaly_idx on public.inventory_operations(anomaly_id) where anomaly_id is not null;
create index inventory_operations_actor_idx on public.inventory_operations(actor_id);

create index stock_anomalies_store_status_created_idx on public.stock_anomalies(store_id,status,created_at desc);
create index stock_anomalies_store_article_store_idx on public.stock_anomalies(store_article_id,store_id);
create index stock_anomalies_movement_idx on public.stock_anomalies(movement_id) where movement_id is not null;
create index stock_anomalies_created_by_idx on public.stock_anomalies(created_by);
create index stock_anomalies_updated_by_idx on public.stock_anomalies(updated_by);

-- Reassert private-function isolation after all inventory migrations.
revoke all on function private.inventory_store_role(uuid) from public,anon,authenticated;
revoke all on function private.inventory_can_supervise(uuid) from public,anon,authenticated;
revoke all on function private.inventory_can_count(uuid) from public,anon,authenticated;
revoke all on function private.inventory_theoretical_at(uuid,timestamptz) from public,anon,authenticated;
revoke all on function private.inventory_claim_operation(text,text,uuid,uuid) from public,anon,authenticated;
revoke all on function private.inventory_notify_supervisors(uuid,public.notification_type,text,text,text,uuid) from public,anon,authenticated;
revoke all on function private.inventory_notify_warehouse(uuid,public.notification_type,text,text,text,uuid) from public,anon,authenticated;
