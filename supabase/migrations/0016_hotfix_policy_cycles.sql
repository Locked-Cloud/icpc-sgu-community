-- ============================================================================
-- 0016 — HOTFIX: eliminate remaining RLS policy recursion cycles
--
-- Root causes found live:
--  1) teams policy queried team_members, team_members policy queried teams
--     (looking_for_members clause) → mutual recursion (42P17) breaking teams,
--     team_members, announcements, contest_registrations, assignment_submissions.
--  2) roadmap_progress_for was STABLE but creates a temp table → 0A000 under
--     PostgREST. Now VOLATILE (behavior identical, no inlining only).
--
-- Strategy: every cross-table membership/browsability check in a policy goes
-- through a SECURITY DEFINER helper (runs as owner → does not re-enter the
-- invoker's RLS), mirroring the messages fix in 0015.
-- ============================================================================

-- ── definer helpers ─────────────────────────────────────────────────────────
create or replace function public.is_team_participant(p_team uuid)
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

create or replace function public.team_is_browsable(p_team uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.teams
    where id = p_team and status = 'looking_for_members'
  );
$$;

grant execute on function public.is_team_participant(uuid) to authenticated;
grant execute on function public.team_is_browsable(uuid) to authenticated;
revoke execute on function public.is_team_participant(uuid) from anon;
revoke execute on function public.team_is_browsable(uuid) from anon;

-- ── teams: membership via helper ────────────────────────────────────────────
drop policy if exists "Team members, admins, or browsable teams"
  on public.teams;

create policy "Team members, admins, or browsable teams"
  on public.teams for select to authenticated
  using (
    public.is_admin()
    or public.is_team_participant(teams.id)
    or teams.status = 'looking_for_members'
  );

-- ── team_members: membership + browsability via helpers ─────────────────────
drop policy if exists "Members see own team membership; admins all; browsable teams public"
  on public.team_members;

create policy "Members see own team membership; admins all; browsable teams public"
  on public.team_members for select to authenticated
  using (
    public.is_admin()
    or student_id = auth.uid()
    or public.is_team_member(team_members.team_id)
    or public.team_is_browsable(team_members.team_id)
  );

-- ── announcements: audience check via my_team_id() (definer) ────────────────
drop policy if exists "Published announcements visible; admins all"
  on public.announcements;

create policy "Published announcements visible; admins all"
  on public.announcements for select to authenticated
  using (
    public.is_admin()
    or (
      status = 'published'
      and (expires_at is null or expires_at > now())
      and (
        audience in ('all', 'students')
        or (audience = 'teams' and public.my_team_id() = any (announcements.audience_ids))
      )
    )
  );

-- ── contest_registrations: team check via my_team_id() ──────────────────────
drop policy if exists "Registrations visible to participants and admins"
  on public.contest_registrations;

create policy "Registrations visible to participants and admins"
  on public.contest_registrations for select to authenticated
  using (
    public.is_admin()
    or student_id = auth.uid()
    or registered_by = auth.uid()
    or (team_id is not null and contest_registrations.team_id = public.my_team_id())
  );

-- ── assignment_submissions: team check via my_team_id() ─────────────────────
drop policy if exists "Own or team submissions visible; admins all"
  on public.assignment_submissions;

create policy "Own or team submissions visible; admins all"
  on public.assignment_submissions for select to authenticated
  using (
    public.is_admin()
    or student_id = auth.uid()
    or (team_id is not null and assignment_submissions.team_id = public.my_team_id())
  );

-- ── roadmap RPC: temp table requires VOLATILE ───────────────────────────────
drop function if exists public.roadmap_progress_for(uuid);

create or replace function public.roadmap_progress_for(p_user_id uuid default null)
returns jsonb
language plpgsql
volatile
security definer set search_path = public
as $$
declare
  v_user uuid := coalesce(p_user_id, auth.uid());
  v_result jsonb := '[]'::jsonb;
  r record;
  v_week_total int; v_week_done int;
  v_sheet_total int; v_sheet_done int;
  v_assignment_done boolean;
  v_week_ok boolean; v_sheet_ok boolean; v_assign_ok boolean;
  v_override boolean;
  v_completed boolean;
  v_any_activity boolean;
  v_prereqs_unmet boolean;
  v_locked boolean;
  v_status text;
  v_week_ratio numeric; v_sheet_ratio numeric;
begin
  if v_user is null then
    return '[]'::jsonb;
  end if;
  if p_user_id is not null and p_user_id is distinct from auth.uid() and not public.is_admin() then
    raise exception 'Not allowed to view this roadmap';
  end if;

  create temp table if not exists tmp_ms_state (
    milestone_id uuid primary key,
    completed boolean,
    week_ratio numeric,
    sheet_ratio numeric,
    assignment_done boolean,
    any_activity boolean,
    overridden boolean
  ) on commit drop;
  delete from tmp_ms_state where true;

  for r in
    select m.* from public.roadmap_milestones m
    where m.status = 'published' or public.is_admin()
    order by m.sort_order
  loop
    select count(*), count(mc.id) into v_week_total, v_week_done
    from public.training_resources tr
    left join public.material_completions mc
      on mc.resource_id = tr.id and mc.user_id = v_user
    where tr.week_id = r.week_id and tr.visible;

    select count(*), count(pc.id) into v_sheet_total, v_sheet_done
    from public.problem_sheet_items psi
    left join public.problem_completions pc
      on pc.problem_id = psi.problem_id and pc.user_id = v_user
    where psi.sheet_id = r.sheet_id;

    select exists (
      select 1 from public.assignment_submissions s
      where s.assignment_id = r.assignment_id
        and (s.student_id = v_user
             or s.team_id in (
               select tm.team_id from public.team_members tm
               where tm.student_id = v_user and tm.status = 'active'
             ))
    ) into v_assignment_done;

    select exists (
      select 1 from public.milestone_completions mc
      where mc.user_id = v_user and mc.milestone_id = r.id and mc.override
    ) into v_override;

    v_week_ok := r.week_id is null
      or (v_week_total > 0 and v_week_done::numeric / v_week_total >= r.completion_threshold);
    v_sheet_ok := r.sheet_id is null
      or (v_sheet_total > 0 and v_sheet_done::numeric / v_sheet_total >= r.completion_threshold);
    v_assign_ok := r.assignment_id is null or v_assignment_done;

    v_completed := coalesce(v_override, false) or (v_week_ok and v_sheet_ok and v_assign_ok);
    v_any_activity := (v_week_done > 0) or (v_sheet_done > 0) or coalesce(v_assignment_done, false);

    insert into tmp_ms_state values (
      r.id, v_completed,
      case when v_week_total > 0 then round(v_week_done::numeric / v_week_total, 4) end,
      case when v_sheet_total > 0 then round(v_sheet_done::numeric / v_sheet_total, 4) end,
      coalesce(v_assignment_done, false), v_any_activity, coalesce(v_override, false)
    );
  end loop;

  for r in
    select m.* from public.roadmap_milestones m
    where m.status = 'published' or public.is_admin()
    order by m.sort_order
  loop
    select completed, week_ratio, sheet_ratio, assignment_done, any_activity, overridden
    into v_completed, v_week_ratio, v_sheet_ratio, v_assignment_done, v_any_activity, v_override
    from tmp_ms_state where milestone_id = r.id;

    select exists (
      select 1 from public.roadmap_prerequisites rp
      join tmp_ms_state ts on ts.milestone_id = rp.prerequisite_id
      where rp.milestone_id = r.id and not ts.completed
    ) into v_prereqs_unmet;
    v_prereqs_unmet := coalesce(v_prereqs_unmet, false);
    v_locked := r.hard_prerequisite and v_prereqs_unmet;

    v_status := case
      when v_locked then 'locked'
      when v_completed then 'completed'
      when v_any_activity then 'in_progress'
      else 'not_started'
    end;

    v_result := v_result || jsonb_build_object(
      'id', r.id,
      'title', r.title,
      'description', r.description,
      'objectives', to_jsonb(r.objectives),
      'topic_slugs', to_jsonb(r.topic_slugs),
      'week_id', r.week_id,
      'sheet_id', r.sheet_id,
      'assignment_id', r.assignment_id,
      'completion_threshold', r.completion_threshold,
      'hard_prerequisite', r.hard_prerequisite,
      'sort_order', r.sort_order,
      'target_date', to_jsonb(r.target_date),
      'status', v_status,
      'prereqs_met', not v_prereqs_unmet,
      'prerequisites', (
        select coalesce(jsonb_agg(prerequisite_id), '[]'::jsonb)
        from public.roadmap_prerequisites where milestone_id = r.id
      ),
      'progress', jsonb_build_object(
        'week_ratio', to_jsonb(v_week_ratio),
        'sheet_ratio', to_jsonb(v_sheet_ratio),
        'assignment_done', v_assignment_done
      ),
      'overdue', (r.target_date is not null and r.target_date < current_date and v_status <> 'completed'),
      'is_draft', (r.status <> 'published')
    );
  end loop;

  return v_result;
end;
$$;
