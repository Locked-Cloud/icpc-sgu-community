-- ============================================================================
-- 0007 — TRAINING ROADMAP (milestones, prerequisites, computed progress)
-- Milestone completion is COMPUTED from real records (materials, problems,
-- submissions) with documented rules; admins may only override through an
-- audited RPC.
-- ============================================================================

create table public.roadmap_milestones (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  objectives text[] not null default '{}',
  topic_slugs text[] not null default '{}',
  week_id uuid references public.training_weeks (id) on delete set null,
  sheet_id uuid references public.problem_sheets (id) on delete set null,
  assignment_id uuid references public.assignments (id) on delete set null,
  completion_threshold numeric not null default 0.8
    check (completion_threshold > 0 and completion_threshold <= 1),
  hard_prerequisite boolean not null default false,
  sort_order int not null default 0,
  target_date date,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_roadmap_milestones_order on public.roadmap_milestones (sort_order);

create trigger trg_roadmap_milestones_updated_at
  before update on public.roadmap_milestones
  for each row execute function public.set_updated_at();

create table public.roadmap_prerequisites (
  milestone_id uuid not null references public.roadmap_milestones (id) on delete cascade,
  prerequisite_id uuid not null references public.roadmap_milestones (id) on delete cascade,
  primary key (milestone_id, prerequisite_id),
  check (milestone_id <> prerequisite_id)
);

create table public.milestone_completions (
  user_id uuid not null references public.profiles (id) on delete cascade,
  milestone_id uuid not null references public.roadmap_milestones (id) on delete cascade,
  override boolean not null default false,
  overridden_by uuid references public.profiles (id),
  override_reason text,
  completed_at timestamptz not null default now(),
  primary key (user_id, milestone_id)
);

-- ----------------------------------------------------------------------------
-- Cycle prevention for prerequisites
-- ----------------------------------------------------------------------------
create or replace function public.check_prereq_cycle()
returns trigger
language plpgsql
as $$
begin
  if exists (
    with recursive path as (
      select rp.milestone_id, rp.prerequisite_id
      from public.roadmap_prerequisites rp
      where rp.milestone_id = new.prerequisite_id
      union
      select rp.milestone_id, rp.prerequisite_id
      from public.roadmap_prerequisites rp
      join path p on rp.milestone_id = p.prerequisite_id
    )
    select 1 from path where prerequisite_id = new.milestone_id
  ) then
    raise exception 'Circular prerequisite relationship detected';
  end if;
  return new;
end;
$$;

create trigger trg_prereq_cycle
  before insert on public.roadmap_prerequisites
  for each row execute function public.check_prereq_cycle();

-- ----------------------------------------------------------------------------
-- Computed roadmap progress.
-- Rules (docs/schema.md):
--   week link    → completed visible materials / total ≥ threshold
--   sheet link   → completed problems / total ≥ threshold
--   assignment   → a submission exists for the user (or their team)
--   status       → locked (hard prereq unmet) > completed (all rules or
--                  override) > in_progress (any activity) > not_started
-- ----------------------------------------------------------------------------
create or replace function public.roadmap_progress_for(p_user_id uuid default null)
returns jsonb
language plpgsql
stable
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
  delete from tmp_ms_state;

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

-- Audited admin override of a computed milestone status.
create or replace function public.admin_set_milestone_override(
  p_user_id uuid,
  p_milestone_id uuid,
  p_complete boolean,
  p_reason text default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access required';
  end if;

  if p_complete then
    insert into public.milestone_completions (user_id, milestone_id, override, overridden_by, override_reason)
    values (p_user_id, p_milestone_id, true, auth.uid(), p_reason)
    on conflict (user_id, milestone_id) do update
      set override = true, overridden_by = auth.uid(), override_reason = p_reason, completed_at = now();
  else
    delete from public.milestone_completions
    where user_id = p_user_id and milestone_id = p_milestone_id and override;
  end if;

  perform public.audit_log('roadmap.override', 'roadmap_milestone', p_milestone_id::text,
    jsonb_build_object('user', p_user_id, 'complete', p_complete, 'reason', p_reason));
end;
$$;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table public.roadmap_milestones enable row level security;

create policy "Published milestones visible; admins all"
  on public.roadmap_milestones for select to authenticated
  using (status = 'published' or public.is_admin());

create policy "Admins manage milestones"
  on public.roadmap_milestones for insert to authenticated
  with check (public.is_admin());

create policy "Admins update milestones"
  on public.roadmap_milestones for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins delete milestones"
  on public.roadmap_milestones for delete to authenticated
  using (public.is_admin());

alter table public.roadmap_prerequisites enable row level security;

create policy "Prerequisites visible with milestones"
  on public.roadmap_prerequisites for select to authenticated
  using (
    public.is_admin()
    or (
      exists (select 1 from public.roadmap_milestones m
              where m.id = milestone_id and m.status = 'published')
      and exists (select 1 from public.roadmap_milestones m2
                  where m2.id = prerequisite_id and m2.status = 'published')
    )
  );

create policy "Admins manage prerequisites"
  on public.roadmap_prerequisites for insert to authenticated
  with check (public.is_admin());

create policy "Admins delete prerequisites"
  on public.roadmap_prerequisites for delete to authenticated
  using (public.is_admin());

alter table public.milestone_completions enable row level security;

create policy "Own milestone records or admin"
  on public.milestone_completions for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
