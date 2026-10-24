-- ============================================================================
-- 0011 — ANNOUNCEMENTS, SUPPORT, ADMIN RPCs, DASHBOARDS, STORAGE, CRON
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Announcements
-- ----------------------------------------------------------------------------
create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  priority text not null default 'normal' check (priority in ('normal', 'important', 'critical')),
  audience text not null default 'all' check (audience in ('all', 'teams', 'students')),
  audience_ids uuid[] not null default '{}',   -- team ids when audience = 'teams'
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  expires_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_announcements_published on public.announcements (status, published_at desc);

create trigger trg_announcements_updated_at
  before update on public.announcements
  for each row execute function public.set_updated_at();

create or replace function public.notify_announcement_published()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.status = 'published' and old.status is distinct from 'published' then
    if new.audience = 'all' then
      perform public.notify(p.id, 'announcement', new.title, left(new.body, 300),
        '/announcements', 'announcement', new.id::text)
      from public.profiles p
      where p.status = 'active' and p.role in ('student', 'mentor');
    elsif new.audience = 'teams' then
      perform public.notify_team(t.id, 'announcement', new.title, left(new.body, 300),
        '/announcements', 'announcement', new.id::text)
      from public.teams t
      where t.id = any (new.audience_ids) and t.status not in ('rejected', 'cancelled', 'archived');
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_announcement_published
  after update on public.announcements
  for each row execute function public.notify_announcement_published();

-- ----------------------------------------------------------------------------
-- Support requests
-- ----------------------------------------------------------------------------
create table public.support_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  subject text not null,
  category text not null default 'other',
  description text not null,
  attachment_url text,
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  assigned_to uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_support_status on public.support_requests (status, created_at);

create trigger trg_support_requests_updated_at
  before update on public.support_requests
  for each row execute function public.set_updated_at();

create table public.support_replies (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.support_requests (id) on delete cascade,
  author_id uuid not null references public.profiles (id),
  body text not null,
  internal boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_support_replies_request on public.support_replies (request_id);

-- Notify admins on new support requests
create or replace function public.notify_support_created()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  perform public.notify(p.id, 'support', 'New support request',
    left(new.subject, 200), '/admin/support', 'support_request', new.id::text)
  from public.profiles p where p.role = 'admin' and p.status = 'active';
  return new;
end;
$$;

create trigger trg_support_created
  after insert on public.support_requests
  for each row execute function public.notify_support_created();

-- ----------------------------------------------------------------------------
-- Admin account RPCs (audited)
-- ----------------------------------------------------------------------------
create or replace function public.admin_set_profile_status(
  p_user_id uuid,
  p_status text,
  p_note text default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access required';
  end if;
  if p_status not in ('pending_approval', 'active', 'suspended', 'deactivated') then
    raise exception 'Invalid status';
  end if;

  perform set_config('icpc.trusted_write', 'on', true);
  update public.profiles
  set status = p_status, review_note = p_note, reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_user_id;

  if p_status = 'active' then
    perform public.notify(p_user_id, 'system', 'Account approved',
      'Your account has been approved. Welcome to the ICPC SGU Community platform!',
      '/dashboard');
  end if;

  perform public.audit_log('profile.status_changed', 'profile', p_user_id::text,
    jsonb_build_object('status', p_status, 'note', p_note));
end;
$$;

create or replace function public.admin_bulk_approve(p_user_ids uuid[])
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  u uuid;
  v_count int := 0;
begin
  foreach u in array coalesce(p_user_ids, '{}') loop
    perform public.admin_set_profile_status(u, 'active', null);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Only existing admins may grant/revoke admin privileges (audited).
create or replace function public.admin_set_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access required';
  end if;
  if p_role not in ('student', 'admin', 'mentor') then
    raise exception 'Invalid role';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot change your own role';
  end if;

  perform set_config('icpc.trusted_write', 'on', true);
  update public.profiles set role = p_role where id = p_user_id;

  perform public.audit_log('profile.role_changed', 'profile', p_user_id::text,
    jsonb_build_object('role', p_role));
  perform public.notify(p_user_id, 'system', 'Your role was updated',
    'Your platform role is now: ' || p_role || '.', null);
end;
$$;

-- ----------------------------------------------------------------------------
-- Student dashboard (single round-trip bundle, own data only)
-- ----------------------------------------------------------------------------
create or replace function public.student_dashboard_data()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_team uuid;
  v_result jsonb;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  select tm.team_id into v_team from public.team_members tm
  where tm.student_id = v_user and tm.status = 'active' limit 1;

  select jsonb_build_object(
    'team', (
      select jsonb_build_object(
        'id', t.id, 'name', t.name, 'status', t.status, 'capacity', t.capacity,
        'is_leader', (t.leader_id = v_user),
        'members', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', tm2.student_id,
            'name', p2.full_name_en,
            'avatar_url', p2.avatar_url,
            'status', tm2.status,
            'is_leader', (t.leader_id = tm2.student_id)
          ) order by (t.leader_id = tm2.student_id) desc), '[]'::jsonb)
          from public.team_members tm2
          join public.profiles p2 on p2.id = tm2.student_id
          where tm2.team_id = t.id and tm2.status in ('active', 'pending_confirmation')
        )
      )
      from public.teams t where t.id = v_team
    ),
    'pending_invitations', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', i.id, 'team_name', t.name, 'message', i.message, 'created_at', i.created_at
      )), '[]'::jsonb)
      from public.team_invitations i
      join public.teams t on t.id = i.team_id
      where i.invitee_id = v_user and i.status = 'pending'
    ),
    'unread_messages', (
      select coalesce(count(m.id), 0)
      from public.messages m
      join public.team_conversations tc on tc.id = m.conversation_id
      left join public.conversation_read_states crs
        on crs.conversation_id = tc.id and crs.user_id = v_user
      where tc.team_id = v_team
        and m.created_at > coalesce(crs.last_read_at, to_timestamp(0))
        and m.sender_id is distinct from v_user
    ),
    'unread_notifications', (
      select count(*) from public.notifications
      where recipient_id = v_user and read_at is null
    ),
    'current_week', (
      select jsonb_build_object('id', w.id, 'week_number', w.week_number, 'title', w.title)
      from public.training_weeks w
      where w.status = 'published' and coalesce(w.publish_at, w.created_at) <= now()
        and current_date between coalesce(w.start_date, current_date) and coalesce(w.end_date, current_date)
      order by w.week_number limit 1
    ),
    'recent_weeks', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', w.id, 'week_number', w.week_number, 'title', w.title
      ) order by w.published_note desc), '[]'::jsonb)
      from (
        select w.id, w.week_number, w.title, coalesce(w.publish_at, w.created_at) as published_note
        from public.training_weeks w
        where w.status = 'published' and coalesce(w.publish_at, w.created_at) <= now()
        order by coalesce(w.publish_at, w.created_at) desc limit 3
      ) w
    ),
    'upcoming_assignments', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'title', a.title, 'due_at', to_jsonb(a.due_at), 'mode', a.mode,
        'submitted', exists (
          select 1 from public.assignment_submissions s
          where s.assignment_id = a.id
            and (s.student_id = v_user
                 or s.team_id in (select team_id from public.team_members tm3
                                  where tm3.student_id = v_user and tm3.status = 'active'))
        )
      ) order by a.due_at nulls last), '[]'::jsonb)
      from (
        select * from public.assignments
        where status = 'published'
          and (due_at is null or due_at > now() - interval '2 days')
        order by due_at nulls last limit 5
      ) a
    ),
    'upcoming_contests', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'title', c.title, 'starts_at', to_jsonb(c.starts_at), 'ends_at', to_jsonb(c.ends_at)
      ) order by c.starts_at), '[]'::jsonb)
      from (
        select * from public.virtual_contests
        where status = 'scheduled' and ends_at > now()
        order by starts_at limit 5
      ) c
    ),
    'next_bookings', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', b.id, 'topic', b.topic, 'starts_at', to_jsonb(b.starts_at), 'status', b.status
      ) order by b.starts_at), '[]'::jsonb)
      from (
        select * from public.mentor_bookings
        where student_id = v_user and status in ('pending', 'confirmed') and starts_at > now() - interval '1 day'
        order by starts_at limit 3
      ) b
    ),
    'attendance_summary', (
      select jsonb_build_object(
        'total', count(*),
        'present', count(*) filter (where status = 'present'),
        'late', count(*) filter (where status = 'late'),
        'absent', count(*) filter (where status = 'absent'),
        'excused', count(*) filter (where status = 'excused')
      )
      from public.attendance_records ar
      join public.training_sessions ts on ts.id = ar.session_id
      where ar.student_id = v_user and ts.starts_at < now()
    ),
    'codeforces', (
      select jsonb_build_object(
        'handle', a.handle, 'verified', a.verified, 'sync_status', a.sync_status,
        'last_synced_at', to_jsonb(a.last_synced_at),
        'rating', s.rating, 'max_rating', s.max_rating, 'rank', s.rank,
        'contests_count', s.contests_count,
        'solved_count', (select count(*) from public.codeforces_solved cs where cs.account_id = a.id),
        'recent_contest', (
          select jsonb_build_object('name', h.contest_name, 'rank', to_jsonb(h.rank),
                                    'new_rating', to_jsonb(h.new_rating), 'delta', to_jsonb(h.new_rating - h.old_rating))
          from public.codeforces_rating_history h
          where h.account_id = a.id
          order by h.rating_update_at desc limit 1
        )
      )
      from public.codeforces_accounts a
      left join public.codeforces_snapshots s on s.account_id = a.id
      where a.user_id = v_user
    ),
    'announcements', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', an.id, 'title', an.title, 'priority', an.priority, 'published_at', to_jsonb(an.published_at)
      ) order by an.published_at desc), '[]'::jsonb)
      from (
        select * from public.announcements
        where status = 'published'
          and (expires_at is null or expires_at > now())
          and (audience in ('all', 'students')
               or (audience = 'teams' and v_team = any (audience_ids)))
        order by published_at desc limit 5
      ) an
    ),
    'profile_completion', (
      select jsonb_build_object(
        'completed', p.profile_completed_at is not null,
        'percent', (
          (case when p.full_name_en is not null and length(trim(p.full_name_en)) >= 3 then 1 else 0 end)
          + (case when p.university_id is not null then 1 else 0 end)
          + (case when p.phone is not null then 1 else 0 end)
          + (case when p.academic_year is not null then 1 else 0 end)
          + (case when p.programming_experience is not null then 1 else 0 end)
          + (case when p.preferred_language is not null then 1 else 0 end)
        ) * 100 / 6
      )
      from public.profiles p where p.id = v_user
    )
  ) into v_result;

  return v_result;
end;
$$;

-- ----------------------------------------------------------------------------
-- Admin dashboard aggregate stats (all computed from real data)
-- ----------------------------------------------------------------------------
create or replace function public.admin_dashboard_stats()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access required';
  end if;

  return jsonb_build_object(
    'students_total', (select count(*) from public.profiles where role = 'student'),
    'students_active', (select count(*) from public.profiles where role = 'student' and status = 'active'),
    'students_pending', (select count(*) from public.profiles where role = 'student' and status = 'pending_approval'),
    'students_suspended', (select count(*) from public.profiles where role = 'student' and status = 'suspended'),
    'teams_total', (select count(*) from public.teams where status not in ('rejected', 'cancelled', 'archived')),
    'teams_complete', (select count(*) from public.teams where status = 'complete'),
    'teams_incomplete', (select count(*) from public.teams where status in ('looking_for_members', 'active')),
    'teams_pending_review', (select count(*) from public.teams where status = 'pending_admin_review'),
    'seeking_teammates', (
      select count(*) from public.team_members tm
      join public.teams t on t.id = tm.team_id
      where t.registration_type = 'individual' and t.status = 'looking_for_members'
        and tm.student_id = t.created_by and tm.status = 'active'
    ),
    'weeks_published', (select count(*) from public.training_weeks where status = 'published'),
    'sheets_published', (select count(*) from public.problem_sheets where status = 'published'),
    'assignments_open', (
      select count(*) from public.assignments
      where status = 'published' and (due_at is null or due_at > now())
    ),
    'assignments_overdue', (
      select count(*) from public.assignments
      where status = 'published' and due_at is not null and due_at < now()
    ),
    'contests_upcoming', (
      select count(*) from public.virtual_contests
      where status = 'scheduled' and starts_at > now()
    ),
    'bookings_upcoming', (
      select count(*) from public.mentor_bookings
      where status in ('pending', 'confirmed') and starts_at > now()
    ),
    'bookings_pending', (select count(*) from public.mentor_bookings where status = 'pending'),
    'support_open', (
      select count(*) from public.support_requests where status in ('open', 'in_progress')
    ),
    'cf_linked', (select count(*) from public.codeforces_accounts),
    'cf_verified', (select count(*) from public.codeforces_accounts where verified),
    'cf_sync_failed', (
      select count(*) from public.codeforces_accounts
      where sync_status = 'failed'
        and updated_at > now() - interval '24 hours'
    ),
    'registrations_30d', (
      select coalesce(jsonb_agg(jsonb_build_object('date', d::text, 'count', c)), '[]'::jsonb)
      from (
        select d::date, (
          select count(*) from public.profiles p
          where p.created_at::date = d::date and p.role = 'student'
        ) as c
        from generate_series(current_date - interval '29 days', current_date, interval '1 day') d
      ) s
    ),
    'rating_distribution', (
      select coalesce(jsonb_agg(jsonb_build_object('bucket', bucket, 'count', c) order by bucket), '[]'::jsonb)
      from (
        select width_bucket(coalesce(s.rating, 0), 0, 3000, 6) as bucket, count(*) as c
        from public.codeforces_snapshots s
        group by 1
      ) b
    ),
    'attendance_rate', (
      select case when count(*) = 0 then null
             else round(count(*) filter (where ar.status in ('present', 'late')) * 100.0 / count(*), 1) end
      from public.attendance_records ar
      join public.training_sessions ts on ts.id = ar.session_id
      where ts.starts_at > now() - interval '30 days'
    ),
    'recent_audits', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'action', a.action, 'entity_type', a.entity_type,
        'actor', a.actor_id, 'created_at', to_jsonb(a.created_at)
      ) order by a.id desc), '[]'::jsonb)
      from (select * from public.audit_logs order by id desc limit 10) a
    )
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- Topic / skill analytics for admins
-- ----------------------------------------------------------------------------
create or replace function public.admin_topic_analytics()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access required';
  end if;

  return jsonb_build_object(
    'topics', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'slug', t.slug,
        'name', t.name,
        'problems', (select count(*) from public.problem_topics pt where pt.topic_id = t.id),
        'completions', (
          select count(*) from public.problem_completions pc
          join public.problem_topics pt on pt.problem_id = pc.problem_id
          where pt.topic_id = t.id
        ),
        'students_completed', (
          select count(distinct pc.user_id) from public.problem_completions pc
          join public.problem_topics pt on pt.problem_id = pc.problem_id
          where pt.topic_id = t.id
        )
      ) order by t.sort_order), '[]'::jsonb)
      from public.topics t where t.active
    ),
    'sheets', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'title', s.title,
        'problems', (select count(*) from public.problem_sheet_items i where i.sheet_id = s.id),
        'avg_completion', (
          select round(avg(x.ratio), 4) from (
            select
              (select count(*) from public.problem_completions pc
               where pc.problem_id in (
                 select i2.problem_id from public.problem_sheet_items i2 where i2.sheet_id = s.id
               ) and pc.user_id = u.id)::numeric
              / greatest((select count(*) from public.problem_sheet_items i3 where i3.sheet_id = s.id), 1) as ratio
            from public.profiles u
            where u.status = 'active' and u.role = 'student'
          ) x
        )
      )), '[]'::jsonb)
      from public.problem_sheets s where s.status = 'published'
    )
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- Storage buckets + policies
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values
  ('avatars', 'avatars', true),
  ('training-resources', 'training-resources', false),
  ('assignment-files', 'assignment-files', false)
on conflict (id) do nothing;

-- avatars: public read, own-folder write
create policy "Public read avatars"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "Own avatar upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Own avatar update"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Own avatar delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- training-resources: readable when referenced by a published week
create policy "Published training files readable"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'training-resources'
    and (
      public.is_admin()
      or exists (
        select 1 from public.training_resources tr
        join public.training_weeks w on w.id = tr.week_id
        where tr.storage_path = name
          and tr.visible
          and w.status = 'published'
          and coalesce(w.publish_at, w.created_at) <= now()
      )
    )
  );

create policy "Admins upload training files"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'training-resources' and public.is_admin());

create policy "Admins update training files"
  on storage.objects for update to authenticated
  using (bucket_id = 'training-resources' and public.is_admin());

create policy "Admins delete training files"
  on storage.objects for delete to authenticated
  using (bucket_id = 'training-resources' and public.is_admin());

-- assignment-files: own prefix or admin (prefix convention: {user_id}/...)
create policy "Own assignment files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'assignment-files'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = auth.uid()::text
    )
  );

create policy "Own assignment file upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'assignment-files' and (storage.foldername(name))[1] = auth.uid()::text);

-- ----------------------------------------------------------------------------
-- RLS: announcements + support
-- ----------------------------------------------------------------------------
alter table public.announcements enable row level security;

create policy "Published announcements visible; admins all"
  on public.announcements for select to authenticated
  using (
    public.is_admin()
    or (
      status = 'published'
      and (expires_at is null or expires_at > now())
      and (
        audience = 'all'
        or (audience = 'students')
        or (audience = 'teams' and exists (
              select 1 from public.team_members tm
              where tm.team_id = any (announcements.audience_ids)
                and tm.student_id = auth.uid() and tm.status = 'active'
            ))
      )
    )
  );

create policy "Admins manage announcements"
  on public.announcements for insert to authenticated
  with check (public.is_admin());

create policy "Admins update announcements"
  on public.announcements for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins delete announcements"
  on public.announcements for delete to authenticated
  using (public.is_admin());

alter table public.support_requests enable row level security;

create policy "Own support requests; admins and assignee all"
  on public.support_requests for select to authenticated
  using (
    student_id = auth.uid()
    or public.is_admin()
    or assigned_to = auth.uid()
  );

create policy "Students create support requests"
  on public.support_requests for insert to authenticated
  with check (student_id = auth.uid());

create policy "Admins update support requests"
  on public.support_requests for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

alter table public.support_replies enable row level security;

create policy "Replies visible to request participants"
  on public.support_replies for select to authenticated
  using (
    public.is_admin()
    or (
      not internal
      and exists (
        select 1 from public.support_requests sr
        where sr.id = request_id and sr.student_id = auth.uid()
      )
    )
    or exists (
      select 1 from public.support_requests sr
      where sr.id = request_id and sr.assigned_to = auth.uid()
    )
  );

create policy "Participants reply"
  on public.support_replies for insert to authenticated
  with check (
    author_id = auth.uid()
    and (
      (internal = false and exists (
        select 1 from public.support_requests sr
        where sr.id = request_id and sr.student_id = auth.uid()
      ))
      or public.is_admin()
    )
  );

-- ----------------------------------------------------------------------------
-- pg_cron schedules (named schedules are idempotent — re-applying updates)
-- ----------------------------------------------------------------------------
select cron.schedule(
  'icpc-process-reminders',
  '*/5 * * * *',
  $$select public.process_due_reminders();$$
);

select cron.schedule(
  'icpc-cf-process-responses',
  '*/5 * * * *',
  $$select public.cf_process_responses();$$
);

select cron.schedule(
  'icpc-cf-stale-syncs',
  '*/15 * * * *',
  $$select public.cf_enqueue_stale_syncs();$$
);

select cron.schedule(
  'icpc-mentorship-reminders',
  '*/10 * * * *',
  $$select public.process_mentorship_reminders();$$
);

-- ----------------------------------------------------------------------------
-- Security hardening: internal SECURITY DEFINER helpers must NOT be callable
-- through the public REST/RPC endpoint. Privileged RPCs (admin_*, respond_*,
-- etc.) remain callable but verify permissions internally.
-- ----------------------------------------------------------------------------
revoke execute on function public.notify(uuid, text, text, text, text, text, text, text) from public, authenticated, anon;
revoke execute on function public.notify_team(uuid, text, text, text, text, text, text) from public, authenticated, anon;
revoke execute on function public.audit_log(text, text, text, jsonb) from public, authenticated, anon;
revoke execute on function public.post_system_message(uuid, text) from public, authenticated, anon;
revoke execute on function public.refresh_team_state(uuid) from public, authenticated, anon;
revoke execute on function public.assert_student_joinable(uuid, uuid) from public, authenticated, anon;
revoke execute on function public.cf_enqueue_fetch(uuid, text, int) from public, authenticated, anon;
revoke execute on function public.cf_enqueue_account(uuid) from public, authenticated, anon;
revoke execute on function public.cf_handle_info(uuid, jsonb) from public, authenticated, anon;
revoke execute on function public.cf_handle_rating(uuid, jsonb) from public, authenticated, anon;
revoke execute on function public.cf_handle_status(uuid, jsonb, int) from public, authenticated, anon;
revoke execute on function public.cf_process_responses() from public, authenticated, anon;
revoke execute on function public.cf_enqueue_stale_syncs() from public, authenticated, anon;
revoke execute on function public.process_due_reminders() from public, authenticated, anon;
revoke execute on function public.process_mentorship_reminders() from public, authenticated, anon;
revoke execute on function public.check_team_capacity() from public, authenticated, anon;
revoke execute on function public.set_updated_at() from public, authenticated, anon;
revoke execute on function public.recompute_profile_completion() from public, authenticated, anon;
revoke execute on function public.guard_profile_update() from public, authenticated, anon;
revoke execute on function public.guard_message_update() from public, authenticated, anon;
revoke execute on function public.check_prereq_cycle() from public, authenticated, anon;
revoke execute on function public.handle_new_user() from public, authenticated, anon;
revoke execute on function public.regenerate_assignment_reminders() from public, authenticated, anon;
revoke execute on function public.notify_week_published() from public, authenticated, anon;
revoke execute on function public.notify_sheet_published() from public, authenticated, anon;
revoke execute on function public.notify_contest_lifecycle() from public, authenticated, anon;
revoke execute on function public.notify_announcement_published() from public, authenticated, anon;
revoke execute on function public.notify_support_created() from public, authenticated, anon;
