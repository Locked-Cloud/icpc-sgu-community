-- 0017: fix link_codeforces_handle 400 on every call.
--
-- codeforces_accounts.handle_lower is a STORED GENERATED column
-- (generated always as (lower(handle))). Assigning it inside
-- ON CONFLICT DO UPDATE SET is rejected by PostgreSQL when the INSERT
-- statement is parsed, so every link attempt failed with a 400 — even
-- with an empty table and no conflicting row. Dropping the assignment
-- is safe: updating `handle` regenerates handle_lower automatically.

create or replace function public.link_codeforces_handle(p_handle text)
returns void
language plpgsql
security definer set search_path = public, extensions
as $$
declare
  v_user uuid := auth.uid();
  v_handle text := btrim(p_handle);
  v_account uuid;
  v_existing_owner uuid;
begin
  if not public.is_active_user() then
    raise exception 'Account is not active';
  end if;
  if v_handle is null or v_handle !~ '^[A-Za-z0-9_.-]{1,24}$' then
    raise exception 'Invalid Codeforces handle';
  end if;

  select user_id into v_existing_owner
  from public.codeforces_accounts where handle_lower = lower(v_handle);
  if v_existing_owner is not null and v_existing_owner <> v_user then
    raise exception 'This handle is already linked to another account';
  end if;

  insert into public.codeforces_accounts (user_id, handle, sync_status)
  values (v_user, v_handle, 'queued')
  on conflict (user_id) do update
    set handle = excluded.handle,
        sync_status = 'queued',
        verified = false,
        verify_challenge = null,
        last_error = null
  returning id into v_account;

  perform set_config('icpc.trusted_write', 'on', true);
  update public.profiles set codeforces_handle = v_handle where id = v_user;

  perform public.cf_enqueue_account(v_account);
end;
$$;
