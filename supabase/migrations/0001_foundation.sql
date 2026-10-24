-- ============================================================================
-- 0001 — FOUNDATION
-- Extensions, community settings, profiles, audit logs, notifications,
-- helper functions, auth.users → profiles trigger.
-- ============================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ----------------------------------------------------------------------------
-- Community settings (singleton row, id = 1)
-- ----------------------------------------------------------------------------
create table public.community_settings (
  id smallint primary key check (id = 1),
  community_name text not null default 'ICPC SGU Community',
  university_name text not null default 'El-Saleheya El-Gadida University',
  tagline text not null default 'Think ... Code ... Conquer!',
  timezone text not null default 'Africa/Cairo',
  program_label text not null default 'Level 1',
  intake_label text not null default '2026',
  team_size int not null default 3 check (team_size between 2 and 5),
  approval_required boolean not null default true,
  registration_open boolean not null default true,
  academic_years text[] not null default array['First Year','Second Year','Third Year','Fourth Year','Fifth Year','Graduated'],
  programming_languages text[] not null default array['C++','C','Java','Python'],
  reminder_offsets_days int[] not null default array[7,3,1],
  send_deadline_reminder boolean not null default true,
  default_penalty_minutes int not null default 20,
  min_cf_sync_interval_minutes int not null default 30,
  updated_at timestamptz not null default now()
);

insert into public.community_settings (id) values (1) on conflict do nothing;

-- ----------------------------------------------------------------------------
-- updated_at helper
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- Profiles
-- ----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'student' check (role in ('student', 'admin', 'mentor')),
  status text not null default 'pending_approval'
    check (status in ('pending_verification', 'pending_approval', 'active', 'suspended', 'deactivated')),

  -- identity
  full_name_en text not null default '',
  full_name_ar text,
  university_id text unique,
  avatar_url text,
  university_email text,
  personal_email text,
  phone text,
  whatsapp text,

  -- academic
  academic_year text,
  faculty text,

  -- programming background
  programming_experience text check (programming_experience in ('none', 'beginner', 'intermediate', 'advanced')),
  preferred_language text default 'C++',
  previous_cp_experience boolean not null default false,
  availability text[] not null default '{}',

  -- external profiles
  codeforces_handle text,
  github_url text,
  linkedin_url text,
  other_profile_urls text[] not null default '{}',

  bio text,

  -- privacy (admins always see everything)
  show_contact boolean not null default false,
  show_university_id boolean not null default false,

  -- registration review
  review_note text,
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,

  profile_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_profiles_role on public.profiles (role);
create index idx_profiles_status on public.profiles (status);
create index idx_profiles_academic_year on public.profiles (academic_year);

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Profile completion: recompute whenever relevant fields change.
create or replace function public.recompute_profile_completion()
returns trigger
language plpgsql
as $$
begin
  if new.full_name_en is null or length(trim(new.full_name_en)) < 3
     or new.university_id is null or new.phone is null
     or new.academic_year is null or new.programming_experience is null
     or new.preferred_language is null then
    new.profile_completed_at := null;
  elsif new.profile_completed_at is null then
    new.profile_completed_at := now();
  end if;
  return new;
end;
$$;

create trigger trg_profiles_completion
  before update on public.profiles
  for each row execute function public.recompute_profile_completion();

-- Profiles are created automatically when an auth user is created.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_approval boolean;
  v_status text;
begin
  select approval_required into v_approval
  from public.community_settings where id = 1;
  v_approval := coalesce(v_approval, true);

  v_status := case when v_approval then 'pending_approval' else 'active' end;

  insert into public.profiles (id, full_name_en, role, status, personal_email, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name_en', split_part(new.email, '@', 1)),
    'student',
    v_status,
    new.email,
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  insert into public.notification_preferences (user_id) values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- Helper functions (used by RLS policies and RPCs)
-- ----------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and status = 'active'
  );
$$;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'active'
  );
$$;

create or replace function public.is_active_student()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'student' and status = 'active'
  );
$$;

-- Audit logging helper — callable only from trusted (definer) code paths.
create or replace function public.audit_log(
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_metadata jsonb default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb));
end;
$$;

-- ----------------------------------------------------------------------------
-- Audit logs (append-only)
-- ----------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index idx_audit_logs_created on public.audit_logs (created_at desc);
create index idx_audit_logs_entity on public.audit_logs (entity_type, entity_id);

-- ----------------------------------------------------------------------------
-- Notifications + preferences
-- ----------------------------------------------------------------------------
create table public.notifications (
  id bigint generated always as identity primary key,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text,
  entity_type text,
  entity_id text,
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index uq_notifications_dedupe
  on public.notifications (recipient_id, dedupe_key)
  where dedupe_key is not null;

create index idx_notifications_recipient on public.notifications (recipient_id, created_at desc);

create table public.notification_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  email_enabled boolean not null default false,
  email_kinds text[] not null default '{}',   -- empty = all kinds when email_enabled
  muted_kinds text[] not null default '{}',   -- suppress in-app + email for these kinds
  updated_at timestamptz not null default now()
);

create trigger trg_notif_prefs_updated_at
  before update on public.notification_preferences
  for each row execute function public.set_updated_at();

-- Trusted notification insert with preference + dedupe handling.
create or replace function public.notify(
  p_recipient uuid,
  p_kind text,
  p_title text,
  p_body text default null,
  p_link text default null,
  p_entity_type text default null,
  p_entity_id text default null,
  p_dedupe text default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_muted text[];
  v_email boolean;
begin
  if p_recipient is null or p_recipient = auth.uid() then
    return; -- never notify null or the actor themself
  end if;

  select muted_kinds into v_muted from public.notification_preferences
  where user_id = p_recipient;
  if v_muted is not null and p_kind = any (v_muted) then
    return;
  end if;

  insert into public.notifications (recipient_id, kind, title, body, link, entity_type, entity_id, dedupe_key)
  values (p_recipient, p_kind, p_title, p_body, p_link, p_entity_type, p_entity_id, p_dedupe)
  on conflict (recipient_id, dedupe_key) where dedupe_key is not null do nothing;
end;
$$;

-- ----------------------------------------------------------------------------
-- RLS: community_settings
-- ----------------------------------------------------------------------------
alter table public.community_settings enable row level security;

create policy "Authenticated read settings"
  on public.community_settings for select to authenticated
  using (true);

create policy "Admins update settings"
  on public.community_settings for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- RLS: profiles — own row or admin. Other students use profiles_public view.
-- ----------------------------------------------------------------------------
alter table public.profiles enable row level security;

create policy "Read own profile or admin"
  on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());

create policy "Update own profile"
  on public.profiles for update to authenticated
  using (id = auth.uid() and public.is_active_user())
  with check (id = auth.uid());

-- Guard: students can never change role/status/review fields on their own row.
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_admin() then
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
      new.codeforces_handle := old.codeforces_handle; -- managed by CF integration only
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_profiles_guard
  before update on public.profiles
  for each row execute function public.guard_profile_update();

-- Public (safe-columns) view of active students/mentors for browsing and
-- team matching. Excludes phones, emails, university IDs. The view is owned
-- by the migration role and therefore bypasses profiles RLS by design.
create or replace view public.profiles_public as
select
  p.id,
  p.full_name_en,
  p.full_name_ar,
  p.avatar_url,
  p.academic_year,
  p.faculty,
  p.programming_experience,
  p.preferred_language,
  p.previous_cp_experience,
  p.availability,
  p.codeforces_handle,
  p.github_url,
  p.linkedin_url,
  p.other_profile_urls,
  p.bio,
  p.show_contact,
  p.created_at
from public.profiles p
where p.status = 'active' and p.role in ('student', 'mentor');

grant select on public.profiles_public to authenticated;
revoke select on public.profiles_public from anon;

-- ----------------------------------------------------------------------------
-- RLS: audit_logs — admin-only reads, no client writes/updates/deletes.
-- ----------------------------------------------------------------------------
alter table public.audit_logs enable row level security;

create policy "Admins read audit logs"
  on public.audit_logs for select to authenticated
  using (public.is_admin());

-- ----------------------------------------------------------------------------
-- RLS: notifications + preferences
-- ----------------------------------------------------------------------------
alter table public.notifications enable row level security;

create policy "Read own notifications"
  on public.notifications for select to authenticated
  using (recipient_id = auth.uid());

create policy "Mark own notifications read"
  on public.notifications for update to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

alter table public.notification_preferences enable row level security;

create policy "Read own notification prefs"
  on public.notification_preferences for select to authenticated
  using (user_id = auth.uid());

create policy "Insert own notification prefs"
  on public.notification_preferences for insert to authenticated
  with check (user_id = auth.uid());

create policy "Update own notification prefs"
  on public.notification_preferences for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Realtime
do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
