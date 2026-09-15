-- Inventory schema/security contract. Run after migrations.
select to_regclass('public.inventory_sessions') is not null as has_sessions;
select to_regclass('public.inventory_lines') is not null as has_lines;
select to_regclass('public.inventory_counts') is not null as has_counts;
select to_regclass('public.inventory_operations') is not null as has_operations;
select to_regclass('public.stock_anomalies') is not null as has_anomalies;

select has_table_privilege('authenticated','public.inventory_sessions','INSERT,UPDATE,DELETE') as session_direct_write
where to_regclass('public.inventory_sessions') is not null;
select has_table_privilege('authenticated','public.inventory_lines','SELECT,INSERT,UPDATE,DELETE') as line_direct_access
where to_regclass('public.inventory_lines') is not null;
select has_table_privilege('authenticated','public.inventory_counts','SELECT,INSERT,UPDATE,DELETE') as count_direct_access
where to_regclass('public.inventory_counts') is not null;
select has_table_privilege('authenticated','public.stock_anomalies','INSERT,UPDATE,DELETE') as anomaly_direct_write
where to_regclass('public.stock_anomalies') is not null;

select to_regprocedure('private.inventory_store_role(uuid)') is not null as has_store_role_helper;
select to_regprocedure('private.inventory_can_supervise(uuid)') is not null as has_supervise_helper;
select to_regprocedure('private.inventory_can_count(uuid)') is not null as has_count_helper;
select to_regprocedure('private.inventory_theoretical_at(uuid,timestamptz)') is not null as has_theoretical_helper;
select to_regprocedure('public.inventory_list_sessions(uuid)') is not null as has_list_sessions_rpc;
select to_regprocedure('public.inventory_get_session(uuid)') is not null as has_get_session_rpc;
select to_regprocedure('public.inventory_list_session_anomalies(uuid)') is not null as has_list_anomalies_rpc;

select case when to_regprocedure('private.inventory_theoretical_at(uuid,timestamptz)') is null then false
  else has_function_privilege('authenticated','private.inventory_theoretical_at(uuid,timestamptz)','EXECUTE') end
  as authenticated_private_theoretical_execute;
select case when to_regprocedure('public.inventory_get_session(uuid)') is null then false
  else has_function_privilege('authenticated','public.inventory_get_session(uuid)','EXECUTE') end
  as authenticated_get_session_execute;
