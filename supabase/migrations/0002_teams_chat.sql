-- ============================================================================
-- 0002 — TEAMS, MEMBERSHIP, INVITATIONS, PRIVATE TEAM CHAT
-- Status machine:
--   pending_member_confirmation → pending_admin_review → complete
--   looking_for_members → (filled) → pending_admin_review → complete
--   complete --(member leaves)--> active/looking_for_members
--   rejected / cancelled / archived are terminal-ish states.
-- ============================================================================

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'draft'
    check (status in ('draft', 'pending_member_confirmation', 'looking_for_members',
                      'pending_admin_review', 'approved', 'active', 'complete',
                      'rejected', 'cancelled', 'archived')),
  registration_type text not null default 'individual'
    check (registration_type in ('complete', 'incomplete', 'individual')),
  leader_id uuid references public.profiles (id),
  description text,
  preferred_languages text[] not null default '{}',
  experience_preference text check (experience_preference in ('any', 'beginner', 'intermediate', 'advanced')),
  availability text[] not null default '{}',
  capacity int not null default 3 check (capacity between 2 and 5),
  program text not null default 'level1',
  intake text not null default '2026',
  locked boolean not null default false,
  rejection_reason text,
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index uq_teams_active_name on public.teams (lower(name))
  where status not in ('rejected', 'cancelled', 'archived');
create index idx_teams_status on public.teams (status);
create index idx_teams_leader on public.teams (leader_id);

create trigger trg_teams_updated_at
  before update on public.teams
  for each row execute function public.set_updated_at();

create table public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending_confirmation'
    check (status in ('pending_confirmation', 'active', 'removed', 'left')),
  joined_at timestamptz,
  confirmed_at timestamptz,
  removed_at timestamptz,
  created_at timestamptz not null default now()
);

-- One active team per student.
create unique index uq_team_members_active on public.team_members (student_id)
  where status = 'active';
create index idx_team_members_team on public.team_members (team_id, status);
create index idx_team_members_student on public.team_members (student_id, status);

-- Backstop capacity (authoritative enforcement lives in the locked RPCs).
create or replace function public.check_team_capacity()
returns trigger
language plpgsql
as $$
declare
  v_capacity int;
  v_count int;
begin
  select capacity into v_capacity from public.teams where id = new.team_id;
  select count(*) into v_count from public.team_members
  where team_id = new.team_id and status in ('active', 'pending_confirmation');
  if v_count > v_capacity then
    raise exception 'Team capacity exceeded';
  end if;
  return null;
end;
$$;

create constraint trigger trg_team_capacity
  after insert or update on public.team_members
  for each row execute function public.check_team_capacity();

create table public.team_invitations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  inviter_id uuid not null references public.profiles (id),
  invitee_id uuid not null references public.profiles (id) on delete cascade,
  message text,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'cancelled')),
  responded_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index uq_invitations_pending on public.team_invitations (team_id, invitee_id)
  where status = 'pending';
create index idx_invitations_invitee on public.team_invitations (invitee_id, status);

create table public.team_join_requests (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  message text,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'withdrawn')),
  responded_by uuid references public.profiles (id),
  responded_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index uq_join_requests_pending on public.team_join_requests (team_id, student_id)
  where status = 'pending';
create index idx_join_requests_student on public.team_join_requests (student_id, status);

create table public.team_conversations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null unique references public.teams (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.team_conversations (id) on delete cascade,
  sender_id uuid references public.profiles (id),
  body text not null,
  kind text not null default 'user' check (kind in ('user', 'system')),
  reply_to_id bigint references public.messages (id),
  pinned boolean not null default false,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_messages_conversation on public.messages (conversation_id, created_at desc);
create index idx_messages_reply on public.messages (reply_to_id);

create table public.conversation_read_states (
  conversation_id uuid not null references public.team_conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

-- ----------------------------------------------------------------------------
-- Helpers
-- ----------------------------------------------------------------------------
create or replace function public.my_team_id()
returns uuid
language sql
stable
security definer set search_path = public
as $$
  select tm.team_id
  from public.team_members tm
  where tm.student_id = auth.uid() and tm.status = 'active'
  limit 1;
$$;

create or replace function public.is_active_team_member(p_team_id uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.team_members
    where team_id = p_team_id and student_id = auth.uid() and status = 'active'
  );
$$;

create or replace function public.post_system_message(p_team_id uuid, p_body text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.team_conversations (team_id) values (p_team_id)
  on conflict (team_id) do nothing;

  insert into public.messages (conversation_id, sender_id, body, kind)
  select c.id, null, p_body, 'system'
  from public.team_conversations c where c.team_id = p_team_id;
end;
$$;

-- Recompute team status after membership changes. Caller must hold the team
-- row lock (FOR UPDATE).
create or replace function public.refresh_team_state(p_team_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  t public.teams%rowtype;
  v_active int;
  v_pending int;
  v_total int;
  v_approval boolean;
begin
  select * into t from public.teams where id = p_team_id;
  if not found then return; end if;

  select
    count(*) filter (where status = 'active'),
    count(*) filter (where status = 'pending_confirmation')
  into v_active, v_pending
  from public.team_members where team_id = p_team_id;
  v_total := v_active + v_pending;

  select approval_required into v_approval
  from public.community_settings where id = 1;
  v_approval := coalesce(v_approval, true);

  if v_total = 0 then
    update public.teams set status = 'cancelled' where id = p_team_id;
  elsif v_total < t.capacity then
    if t.status in ('complete', 'approved', 'active', 'pending_admin_review') then
      update public.teams set status = 'looking_for_members' where id = p_team_id;
    end if;
  else
    -- full team
    if v_active >= t.capacity then
      if v_approval and t.status not in ('complete', 'approved') then
        update public.teams set status = 'pending_admin_review' where id = p_team_id;
      elsif not v_approval and t.status not in ('complete', 'approved') then
        update public.teams set status = 'complete', approved_at = now() where id = p_team_id;
      end if;
    end if;
  end if;

  -- leader must be an active member; otherwise promote the earliest active member
  if not exists (
    select 1 from public.team_members tm
    where tm.team_id = p_team_id and tm.student_id = t.leader_id and tm.status = 'active'
  ) then
    update public.teams
    set leader_id = (
      select tm.student_id from public.team_members tm
      where tm.team_id = p_team_id and tm.status = 'active'
      order by tm.confirmed_at nulls last, tm.created_at
      limit 1
    )
    where id = p_team_id;
  end if;
end;
$$;

-- Validate a student can be added to a team (locks nothing; caller holds lock).
create or replace function public.assert_student_joinable(p_student uuid, p_team uuid)
returns void
language plpgsql
as $$
begin
  if p_student = auth.uid() and not public.is_active_user() then
    raise exception 'Your account is not active';
  end if;
  if not exists (select 1 from public.profiles where id = p_student and status = 'active' and role = 'student') then
    raise exception 'Student is not active';
  end if;
  if exists (
    select 1 from public.team_members
    where student_id = p_student and status = 'active'
  ) then
    raise exception 'Student already belongs to an active team';
  end if;
  if exists (
    select 1 from public.team_members tm
    join public.teams t on t.id = tm.team_id
    where tm.student_id = p_student
      and tm.status = 'pending_confirmation'
      and t.status not in ('rejected', 'cancelled', 'archived')
  ) then
    raise exception 'Student already has a pending team confirmation';
  end if;
  if exists (
    select 1 from public.team_members
    where student_id = p_student and team_id = p_team
      and status in ('active', 'pending_confirmation')
  ) then
    raise exception 'Student is already a member of this team';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- create_team
-- ----------------------------------------------------------------------------
create or replace function public.create_team(
  p_name text,
  p_registration_type text,
  p_member_ids uuid[] default '{}',
  p_leader_id uuid default null,
  p_description text default null,
  p_preferred_languages text[] default '{}',
  p_experience_preference text default null,
  p_availability text[] default '{}'
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_capacity int;
  v_team uuid;
  v_leader uuid := coalesce(p_leader_id, v_user);
  v_status text;
  v_name text := btrim(coalesce(p_name, ''));
  m uuid;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if not public.is_active_student() then raise exception 'Only active students can register a team'; end if;

  select coalesce(max(team_size), 3) into v_capacity
  from public.community_settings where id = 1;

  if p_registration_type not in ('complete', 'incomplete', 'individual') then
    raise exception 'Invalid registration type';
  end if;

  -- normalize members (remove dupes and self)
  select array_agg(distinct x) into p_member_ids
  from unnest(coalesce(p_member_ids, '{}')) x where x <> v_user;
  if p_member_ids is null then p_member_ids := '{}'; end if;

  if p_registration_type = 'complete' and array_length(p_member_ids, 1) <> v_capacity - 1 then
    raise exception 'A complete team needs exactly % members including you', v_capacity;
  end if;
  if p_registration_type = 'incomplete' and array_length(p_member_ids, 1) >= v_capacity - 1 then
    raise exception 'Too many members for an incomplete team';
  end if;
  if p_registration_type = 'individual' and array_length(p_member_ids, 1) > 0 then
    raise exception 'Individual registration cannot include other members';
  end if;
  if p_registration_type <> 'individual' and v_name = '' then
    raise exception 'Team name is required';
  end if;
  if p_registration_type = 'individual' and v_name = '' then
    select full_name_en || ' — seeking teammates' into v_name from public.profiles where id = v_user;
  end if;

  perform public.assert_student_joinable(v_user, '00000000-0000-0000-0000-000000000000'::uuid);

  foreach m in array p_member_ids loop
    perform public.assert_student_joinable(m, '00000000-0000-0000-0000-000000000000'::uuid);
  end loop;

  if v_leader is distinct from v_user and not (v_leader = any (p_member_ids)) then
    raise exception 'Leader must be a team member';
  end if;

  v_status := case
    when p_registration_type = 'complete' then 'pending_member_confirmation'
    else 'looking_for_members'
  end;

  insert into public.teams (name, status, registration_type, leader_id, description,
                            preferred_languages, experience_preference, availability,
                            capacity, created_by)
  values (v_name, v_status, p_registration_type, v_leader, p_description,
          coalesce(p_preferred_languages, '{}'), p_experience_preference, coalesce(p_availability, '{}'),
          v_capacity, v_user)
  returning id into v_team;

  insert into public.team_members (team_id, student_id, status, joined_at, confirmed_at)
  values (v_team, v_user, 'active', now(), now());

  foreach m in array p_member_ids loop
    insert into public.team_members (team_id, student_id, status)
    values (v_team, m, 'pending_confirmation');
    perform public.notify(m, 'team_invite',
      'Team registration',
      'You were added to team "' || v_name || '" as a proposed member. Please confirm your participation.',
      '/team', 'team', v_team::text);
  end loop;

  insert into public.team_conversations (team_id) values (v_team);
  perform public.post_system_message(v_team, 'Team "' || v_name || '" created.');
  perform public.refresh_team_state(v_team);
  perform public.audit_log('team.create', 'team', v_team::text,
    jsonb_build_object('name', v_name, 'type', p_registration_type));

  return v_team;
end;
$$;

-- ----------------------------------------------------------------------------
-- confirm_team_membership
-- ----------------------------------------------------------------------------
create or replace function public.confirm_team_membership(p_team_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_name text;
begin
  perform 1 from public.teams where id = p_team_id for update;

  update public.team_members
  set status = 'active', confirmed_at = now(), joined_at = coalesce(joined_at, now())
  where team_id = p_team_id and student_id = v_user and status = 'pending_confirmation';

  if not found then
    raise exception 'No pending membership to confirm';
  end if;

  select name into v_name from public.teams where id = p_team_id;
  perform public.post_system_message(p_team_id,
    (select full_name_en from public.profiles where id = v_user) || ' confirmed team membership.');
  perform public.notify(
    (select leader_id from public.teams where id = p_team_id),
    'team_update', 'Member confirmed',
    (select full_name_en from public.profiles where id = v_user) || ' confirmed membership in "' || v_name || '".',
    '/team', 'team', p_team_id::text);
  perform public.refresh_team_state(p_team_id);
  perform public.audit_log('team.member_confirmed', 'team', p_team_id::text,
    jsonb_build_object('student', v_user));
end;
$$;

-- ----------------------------------------------------------------------------
-- invite_member
-- ----------------------------------------------------------------------------
create or replace function public.invite_member(
  p_team_id uuid,
  p_invitee_id uuid,
  p_message text default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  t public.teams%rowtype;
begin
  select * into t from public.teams where id = p_team_id for update;
  if not found then raise exception 'Team not found'; end if;

  if not (public.is_admin() or (t.leader_id = auth.uid())) then
    raise exception 'Only the team leader or an administrator can invite members';
  end if;
  if t.locked then raise exception 'Team membership is locked'; end if;
  if t.status in ('rejected', 'cancelled', 'archived') then
    raise exception 'Team is not active';
  end if;

  perform public.assert_student_joinable(p_invitee_id, p_team_id);

  if (select count(*) from public.team_members
      where team_id = p_team_id and status in ('active', 'pending_confirmation')) >= t.capacity then
    raise exception 'Team is already full';
  end if;

  insert into public.team_invitations (team_id, inviter_id, invitee_id, message)
  values (p_team_id, auth.uid(), p_invitee_id, p_message);

  perform public.notify(p_invitee_id, 'team_invite', 'Team invitation',
    'You are invited to join team "' || t.name || '".' || coalesce(' ' || p_message, ''),
    '/team', 'team', p_team_id::text);
  perform public.audit_log('team.invite', 'team', p_team_id::text,
    jsonb_build_object('invitee', p_invitee_id));
end;
$$;

-- ----------------------------------------------------------------------------
-- respond_to_invitation
-- ----------------------------------------------------------------------------
create or replace function public.respond_to_invitation(p_invitation_id uuid, p_accept boolean)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  inv team_invitations%rowtype;
  t teams%rowtype;
begin
  select * into inv from public.team_invitations where id = p_invitation_id;
  if not found then raise exception 'Invitation not found'; end if;
  if inv.invitee_id <> auth.uid() then raise exception 'Not your invitation'; end if;
  if inv.status <> 'pending' then raise exception 'Invitation is no longer pending'; end if;

  select * into t from public.teams where id = inv.team_id for update;
  if not found or t.status in ('rejected', 'cancelled', 'archived') or t.locked then
    update public.team_invitations set status = 'cancelled', responded_at = now() where id = p_invitation_id;
    raise exception 'Team is not accepting members';
  end if;

  if not p_accept then
    update public.team_invitations set status = 'rejected', responded_at = now() where id = p_invitation_id;
    perform public.notify(inv.inviter_id, 'team_update', 'Invitation declined',
      'Your invitation was declined.', '/team', 'team', t.id::text);
    return;
  end if;

  perform public.assert_student_joinable(inv.invitee_id, t.id);

  if (select count(*) from public.team_members
      where team_id = t.id and status in ('active', 'pending_confirmation')) >= t.capacity then
    update public.team_invitations set status = 'cancelled', responded_at = now() where id = p_invitation_id;
    raise exception 'Team is already full';
  end if;

  insert into public.team_members (team_id, student_id, status, joined_at, confirmed_at)
  values (t.id, inv.invitee_id, 'active', now(), now());

  update public.team_invitations set status = 'accepted', responded_at = now() where id = p_invitation_id;

  -- withdraw other pending invitations/requests of this student
  update public.team_invitations set status = 'cancelled', responded_at = now()
  where invitee_id = inv.invitee_id and status = 'pending' and id <> p_invitation_id;
  update public.team_join_requests set status = 'withdrawn', responded_at = now()
  where student_id = inv.invitee_id and status = 'pending';

  perform public.post_system_message(t.id,
    (select full_name_en from public.profiles where id = inv.invitee_id) || ' joined the team.');
  perform public.notify(inv.inviter_id, 'team_update', 'Invitation accepted',
    (select full_name_en from public.profiles where id = inv.invitee_id) || ' joined "' || t.name || '".',
    '/team', 'team', t.id::text);
  perform public.refresh_team_state(t.id);
  perform public.audit_log('team.member_joined', 'team', t.id::text,
    jsonb_build_object('student', inv.invitee_id, 'via', 'invitation'));
end;
$$;

-- ----------------------------------------------------------------------------
-- request_to_join / respond_to_join_request
-- ----------------------------------------------------------------------------
create or replace function public.request_to_join(p_team_id uuid, p_message text default null)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  t public.teams%rowtype;
begin
  if not public.is_active_student() then raise exception 'Only active students can request to join'; end if;

  select * into t from public.teams where id = p_team_id for update;
  if not found then raise exception 'Team not found'; end if;
  if t.status <> 'looking_for_members' then raise exception 'Team is not looking for members'; end if;
  if t.locked then raise exception 'Team membership is locked'; end if;

  perform public.assert_student_joinable(auth.uid(), p_team_id);

  if (select count(*) from public.team_members
      where team_id = p_team_id and status in ('active', 'pending_confirmation')) >= t.capacity then
    raise exception 'Team is already full';
  end if;

  insert into public.team_join_requests (team_id, student_id, message)
  values (p_team_id, auth.uid(), p_message);

  perform public.notify(t.leader_id, 'team_join_request', 'Join request',
    (select full_name_en from public.profiles where id = auth.uid()) || ' requested to join "' || t.name || '".',
    '/team', 'team', p_team_id::text);
end;
$$;

create or replace function public.respond_to_join_request(p_request_id uuid, p_accept boolean)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  r public.team_join_requests%rowtype;
  t public.teams%rowtype;
begin
  select * into r from public.team_join_requests where id = p_request_id;
  if not found then raise exception 'Request not found'; end if;
  if r.status <> 'pending' then raise exception 'Request is no longer pending'; end if;

  select * into t from public.teams where id = r.team_id for update;
  if not found or t.locked or t.status in ('rejected', 'cancelled', 'archived') then
    raise exception 'Team is not accepting members';
  end if;

  if not (public.is_admin() or t.leader_id = auth.uid()) then
    raise exception 'Only the team leader or an administrator can respond';
  end if;

  if not p_accept then
    update public.team_join_requests
    set status = 'rejected', responded_by = auth.uid(), responded_at = now()
    where id = p_request_id;
    perform public.notify(r.student_id, 'team_update', 'Join request declined',
      'Your request to join "' || t.name || '" was declined.', '/find-teammates', 'team', t.id::text);
    return;
  end if;

  perform public.assert_student_joinable(r.student_id, t.id);

  if (select count(*) from public.team_members
      where team_id = t.id and status in ('active', 'pending_confirmation')) >= t.capacity then
    raise exception 'Team is already full';
  end if;

  insert into public.team_members (team_id, student_id, status, joined_at, confirmed_at)
  values (t.id, r.student_id, 'active', now(), now());

  update public.team_join_requests
  set status = 'accepted', responded_by = auth.uid(), responded_at = now()
  where id = p_request_id;

  update public.team_invitations set status = 'cancelled', responded_at = now()
  where invitee_id = r.student_id and status = 'pending';
  update public.team_join_requests set status = 'withdrawn', responded_at = now()
  where student_id = r.student_id and status = 'pending' and id <> p_request_id;

  perform public.post_system_message(t.id,
    (select full_name_en from public.profiles where id = r.student_id) || ' joined the team.');
  perform public.notify(r.student_id, 'team_update', 'Join request accepted',
    'You are now a member of "' || t.name || '".', '/team', 'team', t.id::text);
  perform public.refresh_team_state(t.id);
  perform public.audit_log('team.member_joined', 'team', t.id::text,
    jsonb_build_object('student', r.student_id, 'via', 'join_request'));
end;
$$;

-- ----------------------------------------------------------------------------
-- leave_team / remove_team_member
-- ----------------------------------------------------------------------------
create or replace function public.leave_team()
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  tm public.team_members%rowtype;
  t public.teams%rowtype;
begin
  select * into tm from public.team_members
  where student_id = v_user and status in ('active', 'pending_confirmation')
  order by created_at desc limit 1;
  if not found then raise exception 'You are not in a team'; end if;

  select * into t from public.teams where id = tm.team_id for update;
  if t.locked and not public.is_admin() then raise exception 'Team membership is locked'; end if;

  update public.team_members set status = 'left', removed_at = now()
  where id = tm.id;

  perform public.post_system_message(t.id,
    (select full_name_en from public.profiles where id = v_user) || ' left the team.');
  perform public.refresh_team_state(t.id);
  perform public.audit_log('team.member_left', 'team', t.id::text, jsonb_build_object('student', v_user));
end;
$$;

create or replace function public.remove_team_member(p_team_id uuid, p_student_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  t public.teams%rowtype;
begin
  select * into t from public.teams where id = p_team_id for update;
  if not found then raise exception 'Team not found'; end if;
  if not (public.is_admin() or t.leader_id = auth.uid()) then
    raise exception 'Only the team leader or an administrator can remove members';
  end if;
  if p_student_id = t.leader_id and not public.is_admin() then
    raise exception 'The leader cannot be removed; change the leader first or leave the team';
  end if;

  update public.team_members
  set status = 'removed', removed_at = now()
  where team_id = p_team_id and student_id = p_student_id
    and status in ('active', 'pending_confirmation');

  if not found then raise exception 'Member not found'; end if;

  perform public.post_system_message(p_team_id,
    (select full_name_en from public.profiles where id = p_student_id) || ' was removed from the team.');
  perform public.notify(p_student_id, 'team_update', 'Removed from team',
    'You were removed from team "' || t.name || '".', null, 'team', p_team_id::text);
  perform public.refresh_team_state(p_team_id);
  perform public.audit_log('team.member_removed', 'team', p_team_id::text,
    jsonb_build_object('student', p_student_id));
end;
$$;

-- ----------------------------------------------------------------------------
-- set_team_leader
-- ----------------------------------------------------------------------------
create or replace function public.set_team_leader(p_team_id uuid, p_new_leader_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  t public.teams%rowtype;
begin
  select * into t from public.teams where id = p_team_id for update;
  if not found then raise exception 'Team not found'; end if;

  if not (public.is_admin() or t.leader_id = auth.uid()) then
    raise exception 'Only the current leader or an administrator can change the leader';
  end if;
  if not exists (
    select 1 from public.team_members
    where team_id = p_team_id and student_id = p_new_leader_id and status = 'active'
  ) then
    raise exception 'The new leader must be an active member of the team';
  end if;

  update public.teams set leader_id = p_new_leader_id where id = p_team_id;

  perform public.post_system_message(p_team_id,
    (select full_name_en from public.profiles where id = p_new_leader_id) || ' is now the team leader.');
  perform public.notify(p_new_leader_id, 'team_update', 'You are now the team leader',
    'You are now the leader of "' || t.name || '".', '/team', 'team', p_team_id::text);
  perform public.audit_log('team.leader_changed', 'team', p_team_id::text,
    jsonb_build_object('new_leader', p_new_leader_id));
end;
$$;

-- ----------------------------------------------------------------------------
-- admin_team_decision / archive / lock / assign
-- ----------------------------------------------------------------------------
create or replace function public.admin_team_decision(
  p_team_id uuid,
  p_approve boolean,
  p_reason text default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  t public.teams%rowtype;
  v_count int;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;

  select * into t from public.teams where id = p_team_id for update;
  if not found then raise exception 'Team not found'; end if;

  select count(*) into v_count from public.team_members
  where team_id = p_team_id and status = 'active';

  if p_approve then
    update public.teams
    set status = case when v_count >= t.capacity then 'complete' else 'active' end,
        approved_by = auth.uid(), approved_at = now(), rejection_reason = null
    where id = p_team_id;
    perform public.post_system_message(p_team_id, 'Team approved by administration. Welcome aboard!');
    perform public.notify_team(p_team_id, 'team_update', 'Team approved',
      'Team "' || t.name || '" has been approved.', '/team', 'team', p_team_id::text);
  else
    update public.teams
    set status = 'rejected', rejection_reason = p_reason
    where id = p_team_id;
    perform public.post_system_message(p_team_id, 'Team registration was rejected by administration.');
    perform public.notify_team(p_team_id, 'team_update', 'Team registration rejected',
      'Team "' || t.name || '" was rejected.' || coalesce(' Reason: ' || p_reason, ''), '/team', 'team', p_team_id::text);
  end if;

  perform public.audit_log('team.admin_decision', 'team', p_team_id::text,
    jsonb_build_object('approve', p_approve, 'reason', p_reason));
end;
$$;

-- Notify all active members of a team (helper).
create or replace function public.notify_team(
  p_team_id uuid,
  p_kind text,
  p_title text,
  p_body text,
  p_link text default null,
  p_entity_type text default null,
  p_entity_id text default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  perform public.notify(tm.student_id, p_kind, p_title, p_body, p_link, p_entity_type, p_entity_id)
  from public.team_members tm
  where tm.team_id = p_team_id and tm.status = 'active' and tm.student_id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);
end;
$$;

create or replace function public.archive_team(p_team_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  update public.teams set status = 'archived' where id = p_team_id;
  perform public.audit_log('team.archive', 'team', p_team_id::text, null);
end;
$$;

create or replace function public.set_team_membership_lock(p_team_id uuid, p_locked boolean)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  update public.teams set locked = p_locked where id = p_team_id;
  perform public.audit_log('team.lock', 'team', p_team_id::text, jsonb_build_object('locked', p_locked));
end;
$$;

-- ----------------------------------------------------------------------------
-- Chat RPCs
-- ----------------------------------------------------------------------------
create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.conversation_read_states (conversation_id, user_id, last_read_at)
  values (p_conversation_id, auth.uid(), now())
  on conflict (conversation_id, user_id) do update set last_read_at = now();
end;
$$;

create or replace function public.toggle_pin_message(p_message_id bigint)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  m public.messages%rowtype;
  t public.teams%rowtype;
begin
  select * into m from public.messages where id = p_message_id;
  if not found then raise exception 'Message not found'; end if;
  select * into t from public.teams
  where id = (select team_id from public.team_conversations where id = m.conversation_id);

  if not (public.is_admin() or t.leader_id = auth.uid()) then
    raise exception 'Only the team leader or an administrator can pin messages';
  end if;

  update public.messages set pinned = not pinned where id = p_message_id;
end;
$$;

create or replace function public.edit_message(p_message_id bigint, p_body text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.messages
  set body = p_body, edited_at = now()
  where id = p_message_id and sender_id = auth.uid()
    and deleted_at is null
    and created_at > now() - interval '15 minutes';

  if not found then
    raise exception 'Message cannot be edited (only your own messages within 15 minutes)';
  end if;
end;
$$;

create or replace function public.admin_delete_message(p_message_id bigint)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  update public.messages set deleted_at = now() where id = p_message_id;
  perform public.audit_log('chat.message_deleted', 'message', p_message_id::text, null);
end;
$$;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table public.teams enable row level security;

create policy "Team members, admins, or browsable teams"
  on public.teams for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.team_members tm
      where tm.team_id = teams.id and tm.student_id = auth.uid()
        and tm.status in ('active', 'pending_confirmation')
    )
    or (teams.status = 'looking_for_members')
  );

alter table public.team_members enable row level security;

create policy "Members see own team membership; admins all; browsable teams public"
  on public.team_members for select to authenticated
  using (
    public.is_admin()
    or student_id = auth.uid()
    or exists (
      select 1 from public.team_members tm
      where tm.team_id = team_members.team_id and tm.student_id = auth.uid()
        and tm.status in ('active', 'pending_confirmation')
    )
    or exists (
      select 1 from public.teams t
      where t.id = team_members.team_id and t.status = 'looking_for_members'
    )
  );

alter table public.team_invitations enable row level security;

create policy "Invitation participants"
  on public.team_invitations for select to authenticated
  using (
    invitee_id = auth.uid()
    or inviter_id = auth.uid()
    or public.is_admin()
    or public.is_active_team_member(team_id)
  );

alter table public.team_join_requests enable row level security;

create policy "Join request participants"
  on public.team_join_requests for select to authenticated
  using (
    student_id = auth.uid()
    or public.is_admin()
    or public.is_active_team_member(team_id)
  );

alter table public.team_conversations enable row level security;

create policy "Conversation access"
  on public.team_conversations for select to authenticated
  using (
    public.is_admin() or public.is_active_team_member(team_id)
  );

alter table public.messages enable row level security;

create policy "Team members and admins read messages"
  on public.messages for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.team_conversations tc
      join public.team_members tm on tm.team_id = tc.team_id
      where tc.id = messages.conversation_id
        and tm.student_id = auth.uid()
        and tm.status = 'active'
    )
  );

create policy "Active team members send messages"
  on public.messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and kind = 'user'
    and char_length(btrim(body)) > 0
    and exists (
      select 1 from public.team_conversations tc
      join public.team_members tm on tm.team_id = tc.team_id
      where tc.id = conversation_id
        and tm.student_id = auth.uid()
        and tm.status = 'active'
    )
  );

create policy "Sender edits own message"
  on public.messages for update to authenticated
  using (sender_id = auth.uid() and deleted_at is null)
  with check (sender_id = auth.uid());

-- Guard message updates: only body/edited_at may change, within the window.
create or replace function public.guard_message_update()
returns trigger
language plpgsql
as $$
begin
  if new.conversation_id is distinct from old.conversation_id
     or new.sender_id is distinct from old.sender_id
     or new.kind is distinct from old.kind
     or new.pinned is distinct from old.pinned
     or new.deleted_at is distinct from old.deleted_at
     or new.reply_to_id is distinct from old.reply_to_id
     or new.created_at is distinct from old.created_at then
    raise exception 'Only the message body can be edited here';
  end if;
  if old.created_at < now() - interval '15 minutes' then
    raise exception 'Edit window (15 minutes) has expired';
  end if;
  new.edited_at := now();
  return new;
end;
$$;

create trigger trg_messages_guard
  before update on public.messages
  for each row execute function public.guard_message_update();

alter table public.conversation_read_states enable row level security;

create policy "Own read states"
  on public.conversation_read_states for select to authenticated
  using (user_id = auth.uid());

create policy "Upsert own read states"
  on public.conversation_read_states for insert to authenticated
  with check (user_id = auth.uid());

create policy "Update own read states"
  on public.conversation_read_states for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Realtime
do $$
begin
  alter publication supabase_realtime add table public.messages;
  alter publication supabase_realtime add table public.team_invitations;
  alter publication supabase_realtime add table public.team_join_requests;
exception
  when duplicate_object then null;
end $$;
