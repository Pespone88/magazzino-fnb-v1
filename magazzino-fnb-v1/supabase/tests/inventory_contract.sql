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
