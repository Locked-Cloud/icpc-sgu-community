-- ============================================================================
-- 0018 — HOTFIX (2 items found by the live student journey)
--
-- 1) guard_message_update fired inside the trusted RPCs toggle_pin_message
--    and admin_delete_message, rejecting pinned/deleted_at changes
--    ("Only the message body can be edited here"). The guard now yields to
--    the transaction-local icpc.trusted_write flag, exactly like the
--    profiles guard. The direct student UPDATE path (body-only, 15-min
--    window) keeps its restrictions.
--
-- 2) Mentorship shipped with no mentor, leaving the student page empty.
--    The spec says administrators act as mentors in the initial release —
--    this seeds a mentor profile (+ weekend availability) for every active
--    admin without one, so booking works out of the box.
-- ============================================================================

create or replace function public.guard_message_update()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- privileged internal updates (pin/moderation RPCs) set this flag
  if coalesce(current_setting('icpc.trusted_write', true), '') = 'on' then
    return new;
  end if;

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

  perform set_config('icpc.trusted_write', 'on', true);
  update public.messages set pinned = not pinned where id = p_message_id;
  perform set_config('icpc.trusted_write', 'off', true);
end;
$$;

create or replace function public.admin_delete_message(p_message_id bigint)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  perform set_config('icpc.trusted_write', 'on', true);
  update public.messages set deleted_at = now() where id = p_message_id;
  perform set_config('icpc.trusted_write', 'off', true);
  perform public.audit_log('chat.message_deleted', 'message', p_message_id::text, null);
end;
$$;

revoke execute on function public.toggle_pin_message(bigint) from anon;
revoke execute on function public.admin_delete_message(bigint) from anon, authenticated;

-- ── seed admins as mentors with weekend availability ────────────────────────
insert into public.mentors (profile_id, headline, bio, expertise, session_types, default_duration_minutes)
select p.id,
       p.full_name_en || ' — Level 1 mentor',
       'Community mentor for Level 1 training.',
       array['Programming fundamentals', 'Contest practice'],
       array['1:1 help', 'Problem walkthrough'],
       30
from public.profiles p
where p.role = 'admin' and p.status = 'active'
  and not exists (select 1 from public.mentors m where m.profile_id = p.id);

insert into public.mentor_availability_rules
  (mentor_id, day_of_week, start_time, end_time, duration_minutes, buffer_minutes, max_per_day, min_notice_hours)
select m.id, d.dow, '16:00', '20:00', 30, 10, 4, 12
from public.mentors m
cross join (values (5), (6)) as d(dow)   -- Friday & Saturday
where not exists (
  select 1 from public.mentor_availability_rules r
  where r.mentor_id = m.id and r.day_of_week = d.dow
);
