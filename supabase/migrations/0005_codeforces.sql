-- ============================================================================
-- 0005 — CODEFORCES INTEGRATION
-- Async fetches via pg_net, responses processed by pg_cron every 5 minutes,
-- stale handles refreshed every 15 minutes. Accepted problems are deduped by
-- (contestId, problem index). Handle verification uses the CF "last name"
-- field as a challenge channel.
-- ============================================================================

create table public.codeforces_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  handle text not null,
  handle_lower text not null generated always as (lower(handle)) stored,
  verified boolean not null default false,
  verify_challenge text,
  sync_status text not null default 'idle'
    check (sync_status in ('idle', 'queued', 'syncing', 'ok', 'failed')),
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (handle_lower)
);

create trigger trg_cf_accounts_updated_at
  before update on public.codeforces_accounts
  for each row execute function public.set_updated_at();

create table public.codeforces_snapshots (
  account_id uuid primary key references public.codeforces_accounts (id) on delete cascade,
  handle text not null,
  rating int,
  max_rating int,
  rank text,
  max_rank text,
  contribution int,
  title_photo text,
  contests_count int not null default 0,
  fetched_at timestamptz not null default now()
);

create table public.codeforces_rating_history (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.codeforces_accounts (id) on delete cascade,
  contest_id int not null,
  contest_name text not null,
  rank int,
  rating_update_at timestamptz not null,
  old_rating int,
  new_rating int,
  unique (account_id, contest_id)
);

create index idx_cf_rating_history_account on public.codeforces_rating_history (account_id, rating_update_at);

create table public.codeforces_solved (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.codeforces_accounts (id) on delete cascade,
  contest_id int not null,
  problem_index text not null,
  problem_name text,
  rating int,
  tags text[] not null default '{}',
  solved_at timestamptz,
  unique (account_id, contest_id, problem_index)
);

create index idx_cf_solved_account on public.codeforces_solved (account_id);

-- Pending pg_net requests tracker
create table public.cf_sync_requests (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.codeforces_accounts (id) on delete cascade,
  kind text not null check (kind in ('info', 'rating', 'status')),
  from_row int not null default 1,
  http_id bigint not null,
  processed boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_cf_sync_requests_pending on public.cf_sync_requests (processed, created_at);

-- ----------------------------------------------------------------------------
-- Allow trusted (security definer) code to write protected profile fields.
-- The flag is transaction-local, set only inside trusted functions.
-- ----------------------------------------------------------------------------
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if coalesce(current_setting('icpc.trusted_write', true), '') <> 'on'
     and not public.is_admin() then
    if new.role is distinct from old.role then
      new.role := old.role;
    end if;
    if new.status is distinct from old.status then
      new.status := old.status;
    end if;
    if new.review_note is distinct from old.review_note
       or new.reviewed_by is distinct from old.reviewed_by
       or new.reviewed_at is distinct from old.reviewed_at then
      new.review_note := old.review_note;
      new.reviewed_by := old.reviewed_by;
      new.reviewed_at := old.reviewed_at;
    end if;
    if new.codeforces_handle is distinct from old.codeforces_handle then
      new.codeforces_handle := old.codeforces_handle;
    end if;
  end if;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- Fetch enqueue helper
-- ----------------------------------------------------------------------------
create or replace function public.cf_enqueue_fetch(p_account_id uuid, p_kind text, p_from int default 1)
returns void
language plpgsql
security definer set search_path = public, extensions
as $$
declare
  v_handle text;
  v_url text;
  v_http_id bigint;
begin
  select handle into v_handle from public.codeforces_accounts where id = p_account_id;
  if v_handle is null then return; end if;

  v_url := case p_kind
    when 'info'   then 'https://codeforces.com/api/user.info?handles=' || v_handle
    when 'rating' then 'https://codeforces.com/api/user.rating?handle=' || v_handle
    when 'status' then 'https://codeforces.com/api/user.status?handle=' || v_handle
                     || '&from=' || p_from::text || '&count=2000'
  end;

  select net.http_get(v_url) into v_http_id;

  insert into public.cf_sync_requests (account_id, kind, from_row, http_id)
  values (p_account_id, p_kind, p_from, v_http_id);
end;
$$;

create or replace function public.cf_enqueue_account(p_account_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.codeforces_accounts
  set sync_status = 'queued', last_error = null
  where id = p_account_id and sync_status <> 'syncing';

  perform public.cf_enqueue_fetch(p_account_id, 'info', 1);
  perform public.cf_enqueue_fetch(p_account_id, 'rating', 1);
  perform public.cf_enqueue_fetch(p_account_id, 'status', 1);
end;
$$;

-- ----------------------------------------------------------------------------
-- Link / unlink / verify / sync RPCs
-- ----------------------------------------------------------------------------
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
        handle_lower = excluded.handle_lower,
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

create or replace function public.unlink_codeforces_handle()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  delete from public.codeforces_accounts where user_id = auth.uid();
  perform set_config('icpc.trusted_write', 'on', true);
  update public.profiles set codeforces_handle = null where id = auth.uid();
end;
$$;

-- Ownership verification: user sets the CF profile "last name" to the
-- challenge code, then requests a sync. The processor confirms it.
create or replace function public.start_handle_verification()
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  v_code text := upper(substr(md5(random()::text), 1, 6));
begin
  update public.codeforces_accounts
  set verify_challenge = v_code
  where user_id = auth.uid();

  if not found then
    raise exception 'Link a Codeforces handle first';
  end if;
  return v_code;
end;
$$;

create or replace function public.sync_codeforces()
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  a public.codeforces_accounts%rowtype;
  v_min_minutes int;
begin
  select * into a from public.codeforces_accounts where user_id = auth.uid();
  if not found then
    raise exception 'Link a Codeforces handle first';
  end if;

  select coalesce(max(min_cf_sync_interval_minutes), 30) into v_min_minutes
  from public.community_settings where id = 1;

  if coalesce(a.updated_at, a.created_at) > now() - (v_min_minutes || ' minutes')::interval
     and not public.is_admin() then
    raise exception 'Please wait at least % minutes between syncs', v_min_minutes;
  end if;

  if exists (select 1 from public.cf_sync_requests r
             where r.account_id = a.id and r.processed = false
               and r.created_at > now() - interval '10 minutes') then
    raise exception 'A sync is already in progress — results arrive within a few minutes';
  end if;

  perform public.cf_enqueue_account(a.id);
end;
$$;

-- ----------------------------------------------------------------------------
-- Response processor (cron every 5 min). Maps CF tags onto the local topic
-- taxonomy where a natural mapping exists (partial coverage, documented).
-- ----------------------------------------------------------------------------
create or replace function public.cf_map_tag(p_tag text)
returns text
language sql immutable
as $$
  select case p_tag
    when 'dp' then 'dynamic-programming'
    when 'sortings' then 'sorting'
    when 'constructive algorithms' then 'implementation'
    else replace(p_tag, ' ', '-')
  end;
$$;

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

create or replace function public.cf_handle_info(p_account uuid, p_info jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_user uuid;
  v_challenge text;
  v_last_name text;
  v_first_name text;
begin
  select user_id, verify_challenge into v_user, v_challenge
  from public.codeforces_accounts where id = p_account;

  insert into public.codeforces_snapshots (account_id, handle, rating, max_rating, rank, max_rank,
                                           contribution, title_photo, fetched_at)
  values (
    p_account,
    coalesce(p_info ->> 'handle', (select handle from public.codeforces_accounts where id = p_account)),
    (p_info ->> 'rating')::int,
    (p_info ->> 'maxRating')::int,
    p_info ->> 'rank',
    p_info ->> 'maxRank',
    coalesce((p_info ->> 'contribution')::int, 0),
    p_info ->> 'titlePhoto',
    now()
  )
  on conflict (account_id) do update
    set handle = excluded.handle,
        rating = excluded.rating,
        max_rating = excluded.max_rating,
        rank = excluded.rank,
        max_rank = excluded.max_rank,
        contribution = excluded.contribution,
        title_photo = excluded.title_photo,
        fetched_at = now();

  -- optional ownership verification via the CF last-name field
  if v_challenge is not null then
    v_last_name := coalesce(p_info ->> 'lastName', '');
    v_first_name := coalesce(p_info ->> 'firstName', '');
    if upper(v_last_name) = v_challenge or upper(v_first_name) = v_challenge then
      update public.codeforces_accounts
      set verified = true, verify_challenge = null
      where id = p_account;
      perform public.notify(v_user, 'system', 'Codeforces handle verified',
        'Your Codeforces handle has been successfully verified.', '/codeforces', 'codeforces', p_account::text);
    end if;
  end if;
end;
$$;

create or replace function public.cf_handle_rating(p_account uuid, p_result jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  delete from public.codeforces_rating_history where account_id = p_account;

  insert into public.codeforces_rating_history
    (account_id, contest_id, contest_name, rank, rating_update_at, old_rating, new_rating)
  select
    p_account,
    (e ->> 'contestId')::int,
    e ->> 'contestName',
    (e ->> 'rank')::int,
    to_timestamp((e ->> 'ratingUpdateTimeSeconds')::bigint),
    (e ->> 'oldRating')::int,
    (e ->> 'newRating')::int
  from jsonb_array_elements(p_result) e;

  update public.codeforces_snapshots
  set contests_count = (select count(*) from public.codeforces_rating_history where account_id = p_account)
  where account_id = p_account;
end;
$$;

create or replace function public.cf_handle_status(p_account uuid, p_result jsonb, p_from int)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_user uuid;
  v_count int;
  v_problem_id uuid;
  e jsonb;
begin
  select user_id into v_user from public.codeforces_accounts where id = p_account;

  for e in select * from jsonb_array_elements(p_result) loop
    continue when e ->> 'verdict' is distinct from 'OK';
    continue when (e -> 'problem' ->> 'contestId') is null;
    continue when coalesce(e -> 'problem' ->> 'index', '') = '';

    insert into public.codeforces_solved (account_id, contest_id, problem_index, problem_name, rating, tags, solved_at)
    values (
      p_account,
      (e -> 'problem' ->> 'contestId')::int,
      e -> 'problem' ->> 'index',
      e -> 'problem' ->> 'name',
      nullif(e -> 'problem' ->> 'rating', '')::int,
      coalesce((select array_agg(x #>> '{}') from jsonb_array_elements(e -> 'problem' -> 'tags') x), '{}'),
      to_timestamp((e ->> 'creationTimeSeconds')::bigint)
    )
    on conflict (account_id, contest_id, problem_index) do nothing;

    -- mirror the problem into the shared problems table
    insert into public.problems (source, external_id, title, url, rating)
    values (
      'codeforces',
      (e -> 'problem' ->> 'contestId') || (e -> 'problem' ->> 'index'),
      e -> 'problem' ->> 'name',
      'https://codeforces.com/problemset/problem/'
        || (e -> 'problem' ->> 'contestId') || '/' || (e -> 'problem' ->> 'index'),
      nullif(e -> 'problem' ->> 'rating', '')::int
    )
    on conflict (source, external_id) do update set rating = excluded.rating
    returning id into v_problem_id;

    if v_problem_id is null then
      select id into v_problem_id from public.problems
      where source = 'codeforces'
        and external_id = (e -> 'problem' ->> 'contestId') || (e -> 'problem' ->> 'index');
    end if;

    -- tag→topic mapping (partial by design)
    insert into public.problem_topics (problem_id, topic_id)
    select v_problem_id, t.id
    from public.topics t
    where t.slug in (
      select distinct public.cf_map_tag(x #>> '{}')
      from jsonb_array_elements(e -> 'problem' -> 'tags') x
    )
    on conflict do nothing;

    -- verified completion wins over manual
    insert into public.problem_completions (user_id, problem_id, source, verified_at)
    values (v_user, v_problem_id, 'codeforces', now())
    on conflict (user_id, problem_id) do update
      set source = 'codeforces', verified_at = now()
      where public.problem_completions.source = 'manual';
  end loop;

  -- paginate: CF returns at most `count` rows per call
  v_count := jsonb_array_length(p_result);
  if v_count >= 2000 then
    perform public.cf_enqueue_fetch(p_account, 'status', p_from + 2000);
  end if;
end;
$$;

-- Cron: refresh stale accounts (max 5 per run to stay within rate limits)
create or replace function public.cf_enqueue_stale_syncs()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not pg_try_advisory_lock(hashtext('icpc_cf_stale')) then
    return;
  end if;

  perform public.cf_enqueue_account(a.id)
  from (
    select id from public.codeforces_accounts
    where sync_status in ('idle', 'ok', 'failed', 'queued')
      and (last_synced_at is null or last_synced_at < now() - interval '12 hours')
      and not exists (
        select 1 from public.cf_sync_requests r
        where r.account_id = codeforces_accounts.id and r.processed = false
          and r.created_at > now() - interval '30 minutes'
      )
    order by last_synced_at nulls first
    limit 5
  ) a;

  perform pg_advisory_unlock(hashtext('icpc_cf_stale'));
end;
$$;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table public.codeforces_accounts enable row level security;

create policy "Own CF account or admin"
  on public.codeforces_accounts for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

alter table public.codeforces_snapshots enable row level security;

create policy "Own snapshot or admin"
  on public.codeforces_snapshots for select to authenticated
  using (
    exists (select 1 from public.codeforces_accounts a
            where a.id = account_id and a.user_id = auth.uid())
    or public.is_admin()
  );

alter table public.codeforces_rating_history enable row level security;

create policy "Own rating history or admin"
  on public.codeforces_rating_history for select to authenticated
  using (
    exists (select 1 from public.codeforces_accounts a
            where a.id = account_id and a.user_id = auth.uid())
    or public.is_admin()
  );

alter table public.codeforces_solved enable row level security;

create policy "Own solved problems or admin"
  on public.codeforces_solved for select to authenticated
  using (
    exists (select 1 from public.codeforces_accounts a
            where a.id = account_id and a.user_id = auth.uid())
    or public.is_admin()
  );
