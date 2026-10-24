-- ============================================================================
-- 0009 — TRAINING SESSIONS AND ATTENDANCE
-- ============================================================================

create table public.training_sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  meeting_url text,
  week_id uuid references public.training_weeks (id) on delete set null,
  mentor_id uuid references public.profiles (id),
  resources jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at <= ends_at)
);

create index idx_training_sessions_starts on public.training_sessions (starts_at);

create trigger trg_training_sessions_updated_at
  before update on public.training_sessions
  for each row execute function public.set_updated_at();

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.training_sessions (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  status text not null check (status in ('present', 'absent', 'late', 'excused')),
  note text,
  recorded_by uuid references public.profiles (id),
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, student_id)
);

create index idx_attendance_student on public.attendance_records (student_id);

create trigger trg_attendance_updated_at
  before update on public.attendance_records
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Batch attendance recording with audit trail and change notifications
-- ----------------------------------------------------------------------------
create or replace function public.admin_set_attendance(
  p_session_id uuid,
  p_entries jsonb
)
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  e jsonb;
  v_count int := 0;
  v_old text;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required';
  end if;

  if not exists (select 1 from public.training_sessions where id = p_session_id) then
    raise exception 'Session not found';
  end if;

  for e in select * from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) loop
    if (e ->> 'status') not in ('present', 'absent', 'late', 'excused') then
      raise exception 'Invalid attendance status: %', e ->> 'status';
    end if;

    select status into v_old from public.attendance_records
    where session_id = p_session_id and student_id = (e ->> 'student_id')::uuid;

    insert into public.attendance_records (session_id, student_id, status, note, recorded_by)
    values (p_session_id, (e ->> 'student_id')::uuid, e ->> 'status', e ->> 'note', auth.uid())
    on conflict (session_id, student_id) do update
      set status = excluded.status,
          note = excluded.note,
          recorded_by = excluded.recorded_by,
          updated_at = now();

    if v_old is null or v_old is distinct from (e ->> 'status') then
      perform public.notify((e ->> 'student_id')::uuid, 'attendance', 'Attendance updated',
        'Your attendance was recorded as ' || (e ->> 'status') || '.',
        '/attendance', 'training_session', p_session_id::text);
    end if;

    v_count := v_count + 1;
  end loop;

  perform public.audit_log('attendance.set', 'training_session', p_session_id::text,
    jsonb_build_object('entries', v_count));
  return v_count;
end;
$$;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table public.training_sessions enable row level security;

create policy "Sessions visible to authenticated users"
  on public.training_sessions for select to authenticated
  using (true);

create policy "Admins manage sessions"
  on public.training_sessions for insert to authenticated
  with check (public.is_admin());

create policy "Admins update sessions"
  on public.training_sessions for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins delete sessions"
  on public.training_sessions for delete to authenticated
  using (public.is_admin());

alter table public.attendance_records enable row level security;

create policy "Own attendance visible; admins all"
  on public.attendance_records for select to authenticated
  using (student_id = auth.uid() or public.is_admin());
