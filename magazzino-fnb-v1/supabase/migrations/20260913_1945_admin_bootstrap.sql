-- One-time bootstrap for the first global administrator.
-- The actual email value is inserted out-of-band and is NOT committed to source control.

create table if not exists private.admin_bootstrap_emails (
  email text primary key,
  created_at timestamptz not null default now(),
  constraint admin_bootstrap_email_normalized check (email = lower(btrim(email))),
  constraint admin_bootstrap_email_not_blank check (length(btrim(email)) > 3)
);

revoke all on table private.admin_bootstrap_emails from public, anon, authenticated;

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  bootstrap_admin boolean := false;
begin
  select
    new.email is not null
    and exists (
      select 1
      from private.admin_bootstrap_emails b
      where b.email = lower(btrim(new.email))
    )
    and not exists (
      select 1
      from public.profiles p
      where p.global_role = 'ADMIN'::public.global_role
        and p.active = true
    )
  into bootstrap_admin;

  insert into public.profiles (
    id,
    first_name,
    last_name,
    global_role
  )
  values (
    new.id,
    nullif(btrim(new.raw_user_meta_data ->> 'first_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'last_name'), ''),
    case
      when bootstrap_admin then 'ADMIN'::public.global_role
      else 'USER'::public.global_role
    end
  );

  if bootstrap_admin then
    delete from private.admin_bootstrap_emails
    where email = lower(btrim(new.email));
  end if;

  return new;
end;
$$;

revoke all on function private.handle_new_auth_user() from public;
