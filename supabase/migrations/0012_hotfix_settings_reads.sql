-- ============================================================================
-- 0012 — HOTFIX: settings reads inside plpgsql used invalid aggregates
-- (max(boolean) / max(int[]) do not exist; function bodies are not validated
-- at CREATE time so this only surfaced at runtime). Ships corrected,
-- idempotent definitions of the three affected functions.
-- ============================================================================

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

create or replace function public.regenerate_assignment_reminders()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_offsets int[];
  v_send_deadline boolean;
  o int;
begin
  -- cancel pending when unpublished, archived, or no deadline
  if new.status <> 'published' or new.due_at is null then
    update public.scheduled_reminders set status = 'cancelled'
    where assignment_id = new.id and status = 'scheduled';
    return new;
  end if;

  select reminder_offsets_days, send_deadline_reminder
  into v_offsets, v_send_deadline
  from public.community_settings where id = 1;
  v_offsets := coalesce(v_offsets, array[7,3,1]);
  v_send_deadline := coalesce(v_send_deadline, true);

  update public.scheduled_reminders set status = 'cancelled'
  where assignment_id = new.id and status = 'scheduled';

  foreach o in array v_offsets loop
    if new.due_at - (o || ' days')::interval > now() then
      insert into public.scheduled_reminders (assignment_id, kind, offset_days, remind_at)
      values (new.id, 'advance', o, new.due_at - (o || ' days')::interval);
    end if;
  end loop;

  if v_send_deadline and new.due_at > now() then
    insert into public.scheduled_reminders (assignment_id, kind, offset_days, remind_at)
    values (new.id, 'deadline', 0, new.due_at);
  end if;

  return new;
end;
$$;

-- re-apply the security hardening revoked in 0011 (in case of re-import order)
revoke execute on function public.notify(uuid, text, text, text, text, text, text, text) from public, authenticated, anon;
revoke execute on function public.notify_team(uuid, text, text, text, text, text, text) from public, authenticated, anon;
revoke execute on function public.audit_log(text, text, text, jsonb) from public, authenticated, anon;
revoke execute on function public.post_system_message(uuid, text) from public, authenticated, anon;
revoke execute on function public.refresh_team_state(uuid) from public, authenticated, anon;
revoke execute on function public.handle_new_user() from public, authenticated, anon;
revoke execute on function public.regenerate_assignment_reminders() from public, authenticated, anon;

-- bookkeeping tables must not be API-accessible
revoke all on public.schema_migrations from anon, authenticated;
revoke all on public.cf_sync_requests from anon, authenticated;
