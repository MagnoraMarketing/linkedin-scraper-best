-- ============================================================================
--  Create a settings row automatically for every new user, so the app never
--  has to deal with a missing-settings case.
-- ============================================================================

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Backfill for any user that already exists.
insert into public.user_settings (user_id)
select id from auth.users
on conflict (user_id) do nothing;
