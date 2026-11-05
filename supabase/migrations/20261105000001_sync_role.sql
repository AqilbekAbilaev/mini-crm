-- GoTrue inserts the user first and sets app_metadata in a later UPDATE,
-- so the insert trigger alone never sees the role. Keep profiles.role in sync with app_metadata.role.

create function public.sync_user_role() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.profiles
  set role = coalesce((new.raw_app_meta_data ->> 'role')::public.user_role, 'executor')
  where id = new.id;
  return new;
end $$;
revoke execute on function public.sync_user_role() from public, anon, authenticated;

create trigger on_auth_user_role_changed after update of raw_app_meta_data on auth.users
  for each row execute function public.sync_user_role();

-- backfill users created before this migration
update public.profiles p
set role = coalesce((u.raw_app_meta_data ->> 'role')::public.user_role, 'executor')
from auth.users u where u.id = p.id;
