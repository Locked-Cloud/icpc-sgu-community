-- ============================================================================
-- 0008 — VIRTUAL CONTESTS
-- Scoring (ICPC mode): rank by solved desc → penalty asc → last acceptance
-- asc → name asc. Penalty = Σ over solved problems of (accept minute +
-- (wrong attempts on that problem) × contest penalty minutes). Points mode:
-- score desc → penalty asc → last acceptance asc → name asc.
-- ============================================================================

create table public.virtual_contests (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  registration_deadline timestamptz,
  participation text not null default 'team' check (participation in ('team', 'individual')),
  scoring_mode text not null default 'icpc' check (scoring_mode in ('icpc', 'points')),
  penalty_minutes int not null default 20 check (penalty_minutes >= 0),
  rules text,
  external_url text,
  announcement text,
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'completed', 'cancelled', 'archived')),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at < ends_at)
);

create index idx_contests_status on public.virtual_contests (status);
create index idx_contests_times on public.virtual_contests (starts_at);

create trigger trg_contests_updated_at
  before update on public.virtual_contests
  for each row execute function public.set_updated_at();

create table public.contest_problems (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.virtual_contests (id) on delete cascade,
  code text not null,
  title text,
  url text,
  points numeric,
  difficulty text,
  topic_slugs text[] not null default '{}',
  sort_order int not null default 0,
  unique (contest_id, code)
);

create table public.contest_registrations (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.virtual_contests (id) on delete cascade,
  team_id uuid references public.teams (id),
  student_id uuid references public.profiles (id),
  registered_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  check (num_nonnulls(team_id, student_id) = 1)
);

create unique index uq_contest_registrations_team
  on public.contest_registrations (contest_id, team_id)
  where team_id is not null;
create unique index uq_contest_registrations_student
  on public.contest_registrations (contest_id, student_id)
  where student_id is not null;

create table public.contest_results (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.virtual_contests (id) on delete cascade,
  team_id uuid references public.teams (id),
  student_id uuid references public.profiles (id),
  solved_count int not null default 0,
  total_score numeric not null default 0,
  penalty_minutes int not null default 0,
  source text not null default 'manual' check (source in ('manual', 'csv', 'api')),
  entered_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(team_id, student_id) = 1)
);

create unique index uq_contest_results_team
  on public.contest_results (contest_id, team_id)
  where team_id is not null;
create unique index uq_contest_results_student
  on public.contest_results (contest_id, student_id)
  where student_id is not null;

create trigger trg_contest_results_updated_at
  before update on public.contest_results
  for each row execute function public.set_updated_at();

create table public.contest_problem_results (
  id bigint generated always as identity primary key,
  result_id uuid not null references public.contest_results (id) on delete cascade,
  problem_code text not null,
  solved boolean not null default false,
  attempts int not null default 1 check (attempts >= 0),
  solve_time_minutes int check (solve_time_minutes is null or solve_time_minutes >= 0),
  points numeric,
  unique (result_id, problem_code)
);

-- ----------------------------------------------------------------------------
-- Registration
-- ----------------------------------------------------------------------------
create or replace function public.register_for_contest(p_contest_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  c public.virtual_contests%rowtype;
  v_team uuid;
  v_leader uuid;
begin
  if not public.is_active_user() then
    raise exception 'Account is not active';
  end if;

  select * into c from public.virtual_contests where id = p_contest_id for update;
  if c.id is null or c.status <> 'scheduled' then
    raise exception 'Contest is not open for registration';
  end if;
  if c.registration_deadline is not null and now() > c.registration_deadline then
    raise exception 'Registration deadline has passed';
  end if;
  if now() > c.starts_at then
    raise exception 'Contest has already started';
  end if;

  if c.participation = 'individual' then
    insert into public.contest_registrations (contest_id, student_id, registered_by)
    values (c.id, auth.uid(), auth.uid());
    perform public.notify(auth.uid(), 'contest', 'Registration confirmed',
      'Your registration for "' || c.title || '" is confirmed.',
      '/contests/' || c.id::text, 'contest', c.id::text);
  else
    select tm.team_id, t.leader_id into v_team, v_leader
    from public.team_members tm
    join public.teams t on t.id = tm.team_id
    where tm.student_id = auth.uid() and tm.status = 'active'
      and t.status in ('complete', 'active')
    limit 1;

    if v_team is null then
      raise exception 'You need an active team to register for this contest';
    end if;

    insert into public.contest_registrations (contest_id, team_id, registered_by)
    values (c.id, v_team, auth.uid());

    perform public.notify_team(v_team, 'contest', 'Contest registration confirmed',
      'Your team is registered for "' || c.title || '".',
      '/contests/' || c.id::text, 'contest', c.id::text);
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- Result entry (manual row or batch/CSV import)
-- ----------------------------------------------------------------------------
create or replace function public.admin_upsert_contest_result_row(
  p_contest_id uuid,
  p_team_id uuid default null,
  p_student_id uuid default null,
  p_problems jsonb default '[]',
  p_source text default 'manual'
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  c public.virtual_contests%rowtype;
  v_id uuid;
  v_solved int;
  v_score numeric;
  v_penalty int;
  e jsonb;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required';
  end if;
  if p_team_id is not null and p_student_id is not null then
    raise exception 'A result belongs to either a team or an individual, not both';
  end if;

  select * into c from public.virtual_contests where id = p_contest_id;
  if c.id is null then
    raise exception 'Contest not found';
  end if;

  -- validate problem rows against the contest problem set
  for e in select * from jsonb_array_elements(coalesce(p_problems, '[]'::jsonb)) loop
    if not exists (
      select 1 from public.contest_problems cp
      where cp.contest_id = p_contest_id and cp.code = e ->> 'code'
    ) then
      raise exception 'Unknown problem code: %', e ->> 'code';
    end if;
    if coalesce((e ->> 'solved')::boolean, false) and (e ->> 'solve_time_minutes') is null then
      raise exception 'Solved problem % requires a solve time', e ->> 'code';
    end if;
    if (e ->> 'attempts') is not null and (e ->> 'attempts')::int < 0 then
      raise exception 'Attempts cannot be negative for %', e ->> 'code';
    end if;
  end loop;

  insert into public.contest_results (contest_id, team_id, student_id, source, entered_by)
  values (p_contest_id, p_team_id, p_student_id, p_source, auth.uid())
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    update public.contest_results
    set source = p_source, entered_by = auth.uid()
    where contest_id = p_contest_id
      and ((p_team_id is not null and team_id = p_team_id)
        or (p_student_id is not null and student_id = p_student_id))
    returning id into v_id;
  end if;

  delete from public.contest_problem_results where result_id = v_id;

  insert into public.contest_problem_results (result_id, problem_code, solved, attempts, solve_time_minutes, points)
  select v_id, e ->> 'code',
         coalesce((e ->> 'solved')::boolean, false),
         coalesce((e ->> 'attempts')::int, 1),
         nullif(e ->> 'solve_time_minutes', '')::int,
         nullif(e ->> 'points', '')::numeric
  from jsonb_array_elements(coalesce(p_problems, '[]'::jsonb)) e;

  -- store aggregates for reporting (standings RPC recomputes authoritatively)
  select count(*)::int into v_solved
  from public.contest_problem_results
  where result_id = v_id and solved;

  select coalesce(sum(points), 0) into v_score
  from public.contest_problem_results
  where result_id = v_id and solved;

  select coalesce(sum(
    case when solved then coalesce(solve_time_minutes, 0) + greatest(coalesce(attempts, 1) - 1, 0) * c.penalty_minutes
         else 0 end
  ), 0)::int into v_penalty
  from public.contest_problem_results
  where result_id = v_id;

  update public.contest_results
  set solved_count = v_solved, total_score = v_score, penalty_minutes = v_penalty
  where id = v_id;

  perform public.audit_log('contest.result_upsert', 'contest', p_contest_id::text,
    jsonb_build_object('team', p_team_id, 'student', p_student_id, 'source', p_source));

  return v_id;
end;
$$;

create or replace function public.admin_import_contest_results(
  p_contest_id uuid,
  p_rows jsonb
)
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  e jsonb;
  v_count int := 0;
begin
  for e in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    perform public.admin_upsert_contest_result_row(
      p_contest_id,
      nullif(e ->> 'team_id', '')::uuid,
      nullif(e ->> 'student_id', '')::uuid,
      e -> 'problems',
      coalesce(nullif(e ->> 'source', ''), 'csv')
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ----------------------------------------------------------------------------
-- Standings (computed from stored results only — nothing invented)
-- ----------------------------------------------------------------------------
create or replace function public.contest_standings(p_contest_id uuid)
returns table (
  rank int,
  participant_label text,
  team_id uuid,
  student_id uuid,
  solved int,
  total_score numeric,
  penalty_minutes int,
  last_solve_minute int,
  problems jsonb
)
language sql
stable
security definer set search_path = public
as $$
  with c as (
    select * from public.virtual_contests where id = p_contest_id
  ),
  results as (
    select cr.id, cr.team_id, cr.student_id,
      (select count(*)::int from public.contest_problem_results p
        where p.result_id = cr.id and p.solved) as solved_cnt,
      (select coalesce(sum(p.points), 0) from public.contest_problem_results p
        where p.result_id = cr.id and p.solved) as score_sum,
      (select coalesce(sum(
          case when p.solved
            then coalesce(p.solve_time_minutes, 0) + greatest(coalesce(p.attempts, 1) - 1, 0) * c.penalty_minutes
            else 0 end), 0)::int
        from public.contest_problem_results p, c
        where p.result_id = cr.id) as penalty_calc,
      (select coalesce(max(p.solve_time_minutes), 0)::int
        from public.contest_problem_results p
        where p.result_id = cr.id and p.solved) as last_solve,
      (select coalesce(jsonb_agg(jsonb_build_object(
          'code', p.problem_code,
          'solved', p.solved,
          'attempts', p.attempts,
          'solve_time_minutes', p.solve_time_minutes,
          'points', p.points
        ) order by p.problem_code), '[]'::jsonb)
        from public.contest_problem_results p
        where p.result_id = cr.id) as problems_json
    from public.contest_results cr
    where cr.contest_id = p_contest_id
  ),
  labeled as (
    select r.*, coalesce(t.name, pr.full_name_en, 'Participant') as label
    from results r
    left join public.teams t on t.id = r.team_id
    left join public.profiles pr on pr.id = r.student_id
  ),
  ordered as (
    select l.*,
      case
        when (select scoring_mode from c) = 'icpc' then
          row_number() over (order by l.solved_cnt desc, l.penalty_calc asc, l.last_solve asc, l.label asc)
        else
          row_number() over (order by l.score_sum desc, l.penalty_calc asc, l.last_solve asc, l.label asc)
      end::int as rnk
    from labeled l
  )
  select o.rnk, o.label, o.team_id, o.student_id,
         o.solved_cnt, o.score_sum, o.penalty_calc, o.last_solve, o.problems_json
  from ordered o
  order by o.rnk;
$$;

-- ----------------------------------------------------------------------------
-- Lifecycle notifications
-- ----------------------------------------------------------------------------
create or replace function public.notify_contest_lifecycle()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.status = 'scheduled' and old.status = 'draft' then
    perform public.notify(p.id, 'contest', 'New contest announced',
      '"' || new.title || '" has been announced. Registration is open.',
      '/contests/' || new.id::text, 'contest', new.id::text)
    from public.profiles p
    where p.status = 'active' and p.role = 'student';
  end if;
  if new.status = 'completed' and old.status is distinct from 'completed' then
    perform public.notify(r.student_id, 'contest', 'Contest results published',
      'Results for "' || new.title || '" are now available.',
      '/contests/' || new.id::text, 'contest', new.id::text)
    from (
      select student_id from public.contest_registrations
      where contest_id = new.id and student_id is not null
      union
      select tm.student_id
      from public.contest_registrations cr
      join public.team_members tm on tm.team_id = cr.team_id
      where cr.contest_id = new.id and tm.status = 'active'
    ) r;
  end if;
  return new;
end;
$$;

create trigger trg_contest_lifecycle
  after update on public.virtual_contests
  for each row execute function public.notify_contest_lifecycle();

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table public.virtual_contests enable row level security;

create policy "Non-draft contests visible; admins all"
  on public.virtual_contests for select to authenticated
  using (status <> 'draft' or public.is_admin());

create policy "Admins manage contests"
  on public.virtual_contests for insert to authenticated
  with check (public.is_admin());

create policy "Admins update contests"
  on public.virtual_contests for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins delete contests"
  on public.virtual_contests for delete to authenticated
  using (public.is_admin());

alter table public.contest_problems enable row level security;

create policy "Problems of visible contests"
  on public.contest_problems for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.virtual_contests c
      where c.id = contest_id
        and (c.status <> 'draft' and (c.status <> 'archived'))
    )
  );

create policy "Admins manage contest problems"
  on public.contest_problems for insert to authenticated
  with check (public.is_admin());

create policy "Admins update contest problems"
  on public.contest_problems for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins delete contest problems"
  on public.contest_problems for delete to authenticated
  using (public.is_admin());

alter table public.contest_registrations enable row level security;

create policy "Registrations visible to participants and admins"
  on public.contest_registrations for select to authenticated
  using (
    public.is_admin()
    or student_id = auth.uid()
    or registered_by = auth.uid()
    or (
      team_id is not null
      and exists (
        select 1 from public.team_members tm
        where tm.team_id = contest_registrations.team_id
          and tm.student_id = auth.uid() and tm.status = 'active'
      )
    )
  );

alter table public.contest_results enable row level security;

create policy "Results visible when completed or running; admins all"
  on public.contest_results for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.virtual_contests c
      where c.id = contest_id and c.status in ('completed', 'running')
    )
  );

alter table public.contest_problem_results enable row level security;

create policy "Problem results visible with their result row"
  on public.contest_problem_results for select to authenticated
  using (
    exists (
      select 1 from public.contest_results cr
      where cr.id = result_id
        and (
          public.is_admin()
          or cr.student_id = auth.uid()
          or exists (
            select 1 from public.virtual_contests c
            where c.id = cr.contest_id and c.status in ('completed', 'running')
          )
        )
    )
  );
