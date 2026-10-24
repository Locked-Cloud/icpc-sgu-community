-- ============================================================================
-- 0013 — HOTFIX: pg_net on this project exposes the response payload as
-- `content` (not `body`) in net._http_response. Ship the corrected processor.
-- ============================================================================

create or replace function public.cf_process_responses()
returns void
language plpgsql
security definer set search_path = public, extensions
as $$
declare
  r record;
  v_body jsonb;
  v_status text;
  v_account uuid;
begin
  if not pg_try_advisory_lock(hashtext('icpc_cf_process')) then
    return;
  end if;

  for r in
    select s.id, s.account_id, s.kind, s.from_row, resp.status_code, resp.content as body, resp.error_msg
    from public.cf_sync_requests s
    left join net._http_response resp on resp.id = s.http_id
    where s.processed = false
      and s.created_at > now() - interval '30 minutes'
    order by s.created_at
    limit 200
  loop
    v_account := r.account_id;

    if r.status_code is null then
      -- response not ready yet; skip without marking processed
      continue;
    end if;

    if r.status_code <> 200 or r.body is null then
      update public.codeforces_accounts
      set sync_status = 'failed', last_error = coalesce(r.error_msg, 'HTTP ' || r.status_code::text)
      where id = v_account;
      update public.cf_sync_requests set processed = true where id = r.id;
      continue;
    end if;

    begin
      v_body := r.body::jsonb;
      v_status := coalesce(v_body ->> 'status', 'FAILED');

      if v_status <> 'OK' then
        update public.codeforces_accounts
        set sync_status = 'failed',
            last_error = left(coalesce(v_body ->> 'comment', 'Codeforces API error'), 300)
        where id = v_account;
        update public.cf_sync_requests set processed = true where id = r.id;
        continue;
      end if;

      if r.kind = 'info' then
        perform public.cf_handle_info(v_account, v_body -> 'result' -> 0);
      elsif r.kind = 'rating' then
        perform public.cf_handle_rating(v_account, v_body -> 'result');
      elsif r.kind = 'status' then
        perform public.cf_handle_status(v_account, v_body -> 'result', r.from_row);
      end if;

      update public.cf_sync_requests set processed = true where id = r.id;
    exception when others then
      update public.codeforces_accounts
      set sync_status = 'failed', last_error = left('parse: ' || sqlerrm, 300)
      where id = v_account;
      update public.cf_sync_requests set processed = true where id = r.id;
    end;
  end loop;

  -- accounts with no recent pending requests are done (old pending rows are
  -- treated as lost responses so accounts never get stuck in 'queued')
  update public.codeforces_accounts a
  set sync_status = 'ok', last_synced_at = now()
  where a.sync_status in ('queued', 'syncing')
    and not exists (
      select 1 from public.cf_sync_requests csr
      where csr.account_id = a.id and csr.processed = false
        and csr.created_at > now() - interval '30 minutes'
    )
    and exists (
      select 1 from public.cf_sync_requests r2
      where r2.account_id = a.id and r2.processed = true
        and r2.created_at > now() - interval '30 minutes'
    );

  delete from public.cf_sync_requests
  where processed = true and created_at < now() - interval '1 day';

  perform pg_advisory_unlock(hashtext('icpc_cf_process'));
end;
$$;

revoke execute on function public.cf_process_responses() from public, authenticated, anon;
