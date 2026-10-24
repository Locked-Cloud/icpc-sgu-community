-- ============================================================================
-- 0015 — HOTFIX: RLS infinite recursion + FK on-delete hygiene
--
-- team_members' SELECT policy queried team_members (to expose teammates),
-- so ANY other policy evaluating membership (messages INSERT/SELECT) caused
-- "infinite recursion detected in policy". Fixed by moving the membership
-- checks into SECURITY DEFINER helper functions (they run as the function
-- owner and therefore do not re-enter the caller's RLS).
--
-- Also: profile FKs without ON DELETE rules blocked user deletion
-- (teams.leader_id, teams.created_by, profiles.reviewed_by,
-- mentor_bookings.cancelled_by) — now SET NULL.
-- ============================================================================

-- definer helpers (no recursion: definer functions bypass invoker RLS)
create or replace function public.is_team_member(p_team uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.team_members
    where team_id = p_team
      and student_id = auth.uid()
      and status in ('active', 'pending_confirmation')
  );
$$;

create or replace function public.can_access_conversation(p_conversation uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.team_conversations tc
    where tc.id = p_conversation
      and public.is_active_team_member(tc.team_id)
  ) or public.is_admin();
$$;

-- team_members: teammates via helper instead of self-subquery
drop policy if exists "Members see own team membership; admins all; browsable teams public"
  on public.team_members;

create policy "Members see own team membership; admins all; browsable teams public"
  on public.team_members for select to authenticated
  using (
    public.is_admin()
    or student_id = auth.uid()
    or public.is_team_member(team_id)
    or exists (
      select 1 from public.teams t
      where t.id = team_members.team_id and t.status = 'looking_for_members'
    )
  );

-- messages: membership via helper (no team_members subquery)
drop policy if exists "Team members and admins read messages"
  on public.messages;

create policy "Team members and admins read messages"
  on public.messages for select to authenticated
  using (public.can_access_conversation(messages.conversation_id));

drop policy if exists "Active team members send messages"
  on public.messages;

create or replace function public.is_active_conversation_member(p_conversation uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.team_conversations tc
    join public.team_members tm on tm.team_id = tc.team_id
    where tc.id = p_conversation
      and tm.student_id = auth.uid()
      and tm.status = 'active'
  );
$$;

create policy "Active team members send messages"
  on public.messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and kind = 'user'
    and char_length(btrim(body)) > 0
    and public.is_active_conversation_member(conversation_id)
  );

-- conversation read state: membership via helper
drop policy if exists "Conversation access"
  on public.team_conversations;

create policy "Conversation access"
  on public.team_conversations for select to authenticated
  using (public.can_access_conversation(team_conversations.id));

-- FK hygiene: allow user deletion without orphan references
alter table public.teams drop constraint if exists teams_leader_id_fkey;
alter table public.teams add constraint teams_leader_id_fkey
  foreign key (leader_id) references public.profiles (id) on delete set null;

alter table public.teams drop constraint if exists teams_created_by_fkey;
alter table public.teams alter column created_by drop not null;
alter table public.teams add constraint teams_created_by_fkey
  foreign key (created_by) references public.profiles (id) on delete set null;

alter table public.teams drop constraint if exists teams_approved_by_fkey;
alter table public.teams add constraint teams_approved_by_fkey
  foreign key (approved_by) references public.profiles (id) on delete set null;

alter table public.profiles drop constraint if exists profiles_reviewed_by_fkey;
alter table public.profiles add constraint profiles_reviewed_by_fkey
  foreign key (reviewed_by) references public.profiles (id) on delete set null;

alter table public.mentor_bookings drop constraint if exists mentor_bookings_cancelled_by_fkey;
alter table public.mentor_bookings alter column cancelled_by drop not null;
alter table public.mentor_bookings add constraint mentor_bookings_cancelled_by_fkey
  foreign key (cancelled_by) references public.profiles (id) on delete set null;

-- policy helpers must remain callable by authenticated (policies run as the
-- invoking user) — they are read-only boolean checks and safe to expose
grant execute on function public.is_team_member(uuid) to authenticated;
grant execute on function public.can_access_conversation(uuid) to authenticated;
grant execute on function public.is_active_conversation_member(uuid) to authenticated;
revoke execute on function public.is_team_member(uuid) from anon;
revoke execute on function public.can_access_conversation(uuid) from anon;
revoke execute on function public.is_active_conversation_member(uuid) from anon;
