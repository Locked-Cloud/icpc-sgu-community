-- ============================================================================
-- 0010 — MENTORSHIP AND OFFICE HOURS
-- Booking overlap is prevented by a GiST exclusion constraint (true DB-level
-- concurrency safety) plus rule validation in the booking RPC.
-- ============================================================================

create extension if not exists btree_gist;

create table public.mentors (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles (id) on delete cascade,
  headline text,
  bio text,
  expertise text[] not null default '{}',
  session_types text[] not null default '{}',
  default_duration_minutes int not null default 30 check (default_duration_minutes between 15 and 120),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_mentors_updated_at
  before update on public.mentors
  for each row execute function public.set_updated_at();

create table public.mentor_availability_rules (
  id uuid primary key default gen_random_uuid(),
  mentor_id uuid not null references public.mentors (id) on delete cascade,
  day_of_week int not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  duration_minutes int not null default 30,
  buffer_minutes int not null default 10,
  max_per_day int not null default 4,
  min_notice_hours int not null default 12,
  check (start_time < end_time)
);

create index idx_mentor_rules on public.mentor_availability_rules (mentor_id);

create table public.mentor_blackouts (
  id uuid primary key default gen_random_uuid(),
  mentor_id uuid not null references public.mentors (id) on delete cascade,
  date date not null,
  reason text,
  unique (mentor_id, date)
);

create table public.mentor_bookings (
  id uuid primary key default gen_random_uuid(),
  mentor_id uuid not null references public.mentors (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  topic text not null,
  description text,
  related_topic text,
  related_assignment_id uuid references public.assignments (id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'completed', 'cancelled', 'no_show', 'rescheduled')),
  meeting_url text,
  outcome_notes text,          -- visible to the student
  cancel_reason text,
  cancelled_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at < ends_at),
  exclude using gist (
    mentor_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status in ('pending', 'confirmed'))
);

create index idx_mentor_bookings_student on public.mentor_bookings (student_id, starts_at);
create index idx_mentor_bookings_mentor on public.mentor_bookings (mentor_id, starts_at);

create trigger trg_mentor_bookings_updated_at
  before update on public.mentor_bookings
  for each row execute function public.set_updated_at();

-- Private mentor notes — never visible to students.
create table public.mentor_session_notes (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.mentor_bookings (id) on delete cascade,
  private_notes text,
  recommended_resources jsonb not null default '[]',
  follow_up_sheet_id uuid references public.problem_sheets (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_mentor_notes_updated_at
  before update on public.mentor_session_notes
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Available slots (computed from rules minus blackouts/bookings)
-- ----------------------------------------------------------------------------
create or replace function public.mentor_available_slots(p_mentor_id uuid, p_days int default 14)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  v_slots jsonb := '[]'::jsonb;
  v_min_notice int;
  r record;
  d date;
  v_start timestamptz;
  v_end timestamptz;
  v_count int;
begin
  if not exists (select 1 from public.mentors where id = p_mentor_id and active) then
    return '[]'::jsonb;
  end if;

  for d in
    select generate_series(current_date, current_date + least(greatest(p_days, 1), 30), interval '1 day')::date
  loop
    for r in
      select * from public.mentor_availability_rules
      where mentor_id = p_mentor_id
        and day_of_week = extract(dow from d)::int
    loop
      v_start := (d + r.start_time)::timestamptz;
      v_end := (d + r.end_time)::timestamptz;

      while v_start + (r.duration_minutes || ' minutes')::interval <= v_end loop
        if v_start > now() + (r.min_notice_hours || ' hours')::interval then
          select count(*) into v_count
          from public.mentor_bookings b
          where b.mentor_id = p_mentor_id
            and b.status in ('pending', 'confirmed')
            and b.starts_at::date = d;

          if v_count < r.max_per_day
             and not exists (
               select 1 from public.mentor_blackouts bl
               where bl.mentor_id = p_mentor_id and bl.date = d
             )
             and not exists (
               select 1 from public.mentor_bookings b
               where b.mentor_id = p_mentor_id
                 and b.status in ('pending', 'confirmed')
                 and tstzrange(b.starts_at, b.ends_at) && tstzrange(v_start, v_start + (r.duration_minutes || ' minutes')::interval)
             ) then
            v_slots := v_slots || jsonb_build_object(
              'starts_at', v_start,
              'ends_at', v_start + (r.duration_minutes || ' minutes')::interval,
              'duration_minutes', r.duration_minutes
            );
          end if;
        end if;
        v_start := v_start + ((r.duration_minutes + r.buffer_minutes) || ' minutes')::interval;
      end loop;
    end loop;
  end loop;

  return v_slots;
end;
$$;

-- ----------------------------------------------------------------------------
-- Booking workflow
-- ----------------------------------------------------------------------------
create or replace function public.book_mentor_slot(
  p_mentor_id uuid,
  p_starts_at timestamptz,
  p_topic text,
  p_description text default null,
  p_related_topic text default null,
  p_related_assignment_id uuid default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_id uuid;
  v_duration int;
  v_mentor_profile uuid;
begin
  if not public.is_active_student() then
    raise exception 'Only active students can book sessions';
  end if;
  if btrim(coalesce(p_topic, '')) = '' then
    raise exception 'Please describe your question or topic';
  end if;

  select default_duration_minutes, profile_id into v_duration, v_mentor_profile
  from public.mentors where id = p_mentor_id and active;
  if v_mentor_profile is null then
    raise exception 'Mentor not available';
  end if;

  if exists (
    select 1 from public.mentor_bookings
    where student_id = auth.uid() and status in ('pending', 'confirmed')
      and tstzrange(starts_at, ends_at) && tstzrange(p_starts_at, p_starts_at + (v_duration || ' minutes')::interval)
  ) then
    raise exception 'You already have a booking overlapping this time';
  end if;

  insert into public.mentor_bookings
    (mentor_id, student_id, topic, description, related_topic, related_assignment_id, starts_at, ends_at)
  values
    (p_mentor_id, auth.uid(), p_topic, p_description, p_related_topic, p_related_assignment_id,
     p_starts_at, p_starts_at + (v_duration || ' minutes')::interval)
  returning id into v_id;

  perform public.notify(v_mentor_profile, 'mentorship', 'New mentorship booking',
    (select full_name_en from public.profiles where id = auth.uid())
      || ' booked a session: ' || p_topic,
    '/admin/mentorship', 'mentor_booking', v_id::text);
  perform public.notify(auth.uid(), 'mentorship', 'Booking requested',
    'Your session request was submitted for ' || to_char(p_starts_at, 'YYYY-MM-DD HH24:MI') || ' (UTC). You will be notified once confirmed.',
    '/mentorship', 'mentor_booking', v_id::text);

  return v_id;
end;
$$;

create or replace function public.respond_to_booking(
  p_booking_id uuid,
  p_action text,
  p_meeting_url text default null,
  p_notes text default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  b public.mentor_bookings%rowtype;
  v_student uuid;
  v_mentor_profile uuid;
begin
  select * into b from public.mentor_bookings where id = p_booking_id;
  if b.id is null then
    raise exception 'Booking not found';
  end if;

  select profile_id into v_mentor_profile from public.mentors where id = b.mentor_id;

  if not public.is_admin() and v_mentor_profile is distinct from auth.uid() then
    raise exception 'Only the mentor or an administrator can manage bookings';
  end if;

  if p_action in ('confirm', 'reject', 'complete', 'no_show', 'cancel') then
    update public.mentor_bookings
    set status = case p_action
          when 'confirm' then 'confirmed'
          when 'reject' then 'cancelled'
          when 'cancel' then 'cancelled'
          when 'complete' then 'completed'
          when 'no_show' then 'no_show'
        end,
        meeting_url = coalesce(p_meeting_url, meeting_url),
        outcome_notes = coalesce(p_notes, outcome_notes),
        cancel_reason = case when p_action in ('reject', 'cancel') then coalesce(p_notes, cancel_reason) else cancel_reason end,
        cancelled_by = case when p_action in ('reject', 'cancel') then auth.uid() else cancelled_by end,
        updated_at = now()
    where id = p_booking_id;

    perform public.notify(b.student_id, 'mentorship', 'Booking ' || p_action || 'ed',
      'Your mentorship session (' || b.topic || ') was ' || p_action || 'ed.',
      '/mentorship', 'mentor_booking', p_booking_id::text);
    perform public.audit_log('mentorship.' || p_action, 'mentor_booking', p_booking_id::text, null);
  else
    raise exception 'Invalid action';
  end if;
end;
$$;

create or replace function public.student_cancel_booking(p_booking_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  b public.mentor_bookings%rowtype;
  v_mentor_profile uuid;
begin
  select * into b from public.mentor_bookings where id = p_booking_id;
  if b.id is null or b.student_id <> auth.uid() then
    raise exception 'Booking not found';
  end if;
  if b.status not in ('pending', 'confirmed') then
    raise exception 'Booking can no longer be cancelled';
  end if;
  if b.starts_at < now() + interval '2 hours' then
    raise exception 'Sessions can be cancelled up to 2 hours before the start time';
  end if;

  update public.mentor_bookings
  set status = 'cancelled', cancelled_by = auth.uid(), cancel_reason = 'Cancelled by student'
  where id = p_booking_id;

  select profile_id into v_mentor_profile from public.mentors where id = b.mentor_id;
  perform public.notify(v_mentor_profile, 'mentorship', 'Booking cancelled',
    'A session (' || b.topic || ') was cancelled by the student.',
    '/admin/mentorship', 'mentor_booking', p_booking_id::text);
end;
$$;

-- Private session notes (mentor/admin only)
create or replace function public.save_mentor_session_notes(
  p_booking_id uuid,
  p_private_notes text default null,
  p_recommended_resources jsonb default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only mentors (administrators) can save session notes';
  end if;

  insert into public.mentor_session_notes (booking_id, private_notes, recommended_resources)
  values (p_booking_id, p_private_notes, coalesce(p_recommended_resources, '[]'::jsonb))
  on conflict (booking_id) do update
    set private_notes = excluded.private_notes,
        recommended_resources = excluded.recommended_resources,
        updated_at = now();
end;
$$;

-- ----------------------------------------------------------------------------
-- Session reminders (24h and 1h before start), idempotent via dedupe keys
-- ----------------------------------------------------------------------------
create or replace function public.process_mentorship_reminders()
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  b record;
  v_mentor_profile uuid;
begin
  if not pg_try_advisory_lock(hashtext('icpc_mentor_reminders')) then
    return;
  end if;

  for b in
    select * from public.mentor_bookings
    where status in ('pending', 'confirmed')
      and starts_at > now()
      and starts_at <= now() + interval '24 hours'
  loop
    select profile_id into v_mentor_profile from public.mentors where id = b.mentor_id;

    if b.starts_at <= now() + interval '24 hours'
       and b.starts_at > now() + interval '22 hours' then
      perform public.notify(b.student_id, 'mentorship', 'Session in 24 hours',
        'Your mentorship session ("' || b.topic || '") starts in about 24 hours.',
        '/mentorship', 'mentor_booking', b.id::text, 'mb24-' || b.id::text);
      perform public.notify(v_mentor_profile, 'mentorship', 'Session in 24 hours',
        'Mentorship session "' || b.topic || '" starts in about 24 hours.',
        '/admin/mentorship', 'mentor_booking', b.id::text, 'mb24-' || b.id::text);
    end if;

    if b.starts_at <= now() + interval '1 hour' and b.starts_at > now() + interval '30 minutes' then
      perform public.notify(b.student_id, 'mentorship', 'Session starting soon',
        'Your mentorship session ("' || b.topic || '") starts within the hour.',
        '/mentorship', 'mentor_booking', b.id::text, 'mb1-' || b.id::text);
      perform public.notify(v_mentor_profile, 'mentorship', 'Session starting soon',
        'Mentorship session "' || b.topic || '" starts within the hour.',
        '/admin/mentorship', 'mentor_booking', b.id::text, 'mb1-' || b.id::text);
    end if;
  end loop;

  perform pg_advisory_unlock(hashtext('icpc_mentor_reminders'));
end;
$$;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table public.mentors enable row level security;

create policy "Active mentors visible; admins all"
  on public.mentors for select to authenticated
  using (active or public.is_admin());

create policy "Admins manage mentors"
  on public.mentors for insert to authenticated
  with check (public.is_admin());

create policy "Admins update mentors"
  on public.mentors for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins delete mentors"
  on public.mentors for delete to authenticated
  using (public.is_admin());

alter table public.mentor_availability_rules enable row level security;

create policy "Availability rules visible for booking"
  on public.mentor_availability_rules for select to authenticated
  using (true);

alter table public.mentor_blackouts enable row level security;

create policy "Blackouts visible for booking"
  on public.mentor_blackouts for select to authenticated
  using (true);

alter table public.mentor_bookings enable row level security;

create policy "Own bookings, assigned mentor, admins"
  on public.mentor_bookings for select to authenticated
  using (
    student_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.mentors m
      where m.id = mentor_id and m.profile_id = auth.uid()
    )
  );

alter table public.mentor_session_notes enable row level security;

create policy "Mentor notes are admin-only"
  on public.mentor_session_notes for select to authenticated
  using (public.is_admin());
