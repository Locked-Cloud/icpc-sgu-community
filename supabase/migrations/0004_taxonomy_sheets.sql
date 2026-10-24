-- ============================================================================
-- 0004 — TOPIC TAXONOMY, PROBLEMS, PROBLEM SHEETS, PROGRESS TRACKING
-- ============================================================================

create table public.topics (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  parent_id uuid references public.topics (id) on delete set null,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Default taxonomy (admins can edit/add later)
insert into public.topics (slug, name, sort_order) values
  ('implementation', 'Implementation', 1),
  ('complexity', 'Complexity Analysis', 2),
  ('arrays-strings', 'Arrays and Strings', 3),
  ('sorting', 'Sorting', 4),
  ('binary-search', 'Binary Search', 5),
  ('greedy', 'Greedy', 6),
  ('two-pointers', 'Two Pointers', 7),
  ('prefix-sums', 'Prefix Sums', 8),
  ('recursion', 'Recursion', 9),
  ('math', 'Math', 10),
  ('number-theory', 'Number Theory', 11),
  ('data-structures', 'Data Structures', 12),
  ('graphs', 'Graphs', 13),
  ('dynamic-programming', 'Dynamic Programming', 14),
  ('strings', 'Strings', 15),
  ('brute-force', 'Brute Force', 16)
on conflict (slug) do nothing;

create table public.problems (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('codeforces', 'atcoder', 'cses', 'other')),
  external_id text not null,           -- e.g. "1850A" for Codeforces
  title text not null,
  url text not null,
  rating int,
  created_at timestamptz not null default now(),
  unique (source, external_id)
);

create index idx_problems_source on public.problems (source, external_id);

create table public.problem_topics (
  problem_id uuid not null references public.problems (id) on delete cascade,
  topic_id uuid not null references public.topics (id) on delete cascade,
  primary key (problem_id, topic_id)
);

create table public.problem_sheets (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  week_id uuid references public.training_weeks (id) on delete set null,
  difficulty text not null default 'mixed' check (difficulty in ('easy', 'medium', 'hard', 'mixed')),
  objectives text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  deadline timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_problem_sheets_status on public.problem_sheets (status);

create trigger trg_problem_sheets_updated_at
  before update on public.problem_sheets
  for each row execute function public.set_updated_at();

create table public.sheet_topics (
  sheet_id uuid not null references public.problem_sheets (id) on delete cascade,
  topic_id uuid not null references public.topics (id) on delete cascade,
  primary key (sheet_id, topic_id)
);

create table public.problem_sheet_items (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid not null references public.problem_sheets (id) on delete cascade,
  problem_id uuid not null references public.problems (id) on delete restrict,
  sort_order int not null default 0,
  required boolean not null default true,
  unique (sheet_id, problem_id)
);

create index idx_sheet_items_sheet on public.problem_sheet_items (sheet_id, sort_order);

create table public.problem_completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  problem_id uuid not null references public.problems (id) on delete cascade,
  source text not null default 'manual' check (source in ('manual', 'codeforces', 'imported')),
  verified_at timestamptz,
  completed_at timestamptz not null default now(),
  unique (user_id, problem_id)
);

create index idx_problem_completions_user on public.problem_completions (user_id);
create index idx_problem_completions_problem on public.problem_completions (problem_id);

-- ----------------------------------------------------------------------------
-- Notification on sheet publish
-- ----------------------------------------------------------------------------
create or replace function public.notify_sheet_published()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.status = 'published' and old.status is distinct from 'published' then
    perform public.notify(p.id, 'sheet', 'New problem sheet published',
      'Problem sheet "' || new.title || '" is now available.',
      '/sheets/' || new.id::text, 'problem_sheet', new.id::text);
  end if;
  return new;
end;
$$;

create trigger trg_sheet_published
  after update on public.problem_sheets
  for each row execute function public.notify_sheet_published();

-- ----------------------------------------------------------------------------
-- Manual completion toggle (verified completions win and cannot be removed
-- manually — managed by the Codeforces sync).
-- ----------------------------------------------------------------------------
create or replace function public.toggle_problem_completion(p_problem_id uuid, p_completed boolean)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_active_user() then
    raise exception 'Account is not active';
  end if;

  if p_completed then
    insert into public.problem_completions (user_id, problem_id, source)
    values (auth.uid(), p_problem_id, 'manual')
    on conflict (user_id, problem_id) do nothing;
  else
    delete from public.problem_completions
    where user_id = auth.uid() and problem_id = p_problem_id
      and source = 'manual';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table public.topics enable row level security;

create policy "Anyone authenticated reads topics"
  on public.topics for select to authenticated
  using (true);

create policy "Admins manage topics"
  on public.topics for insert to authenticated
  with check (public.is_admin());

create policy "Admins update topics"
  on public.topics for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins delete topics"
  on public.topics for delete to authenticated
  using (public.is_admin());

alter table public.problems enable row level security;

create policy "Anyone authenticated reads problems"
  on public.problems for select to authenticated
  using (true);

create policy "Admins manage problems"
  on public.problems for insert to authenticated
  with check (public.is_admin());

create policy "Admins update problems"
  on public.problems for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins delete problems"
  on public.problems for delete to authenticated
  using (public.is_admin());

alter table public.problem_topics enable row level security;

create policy "Anyone authenticated reads problem topics"
  on public.problem_topics for select to authenticated
  using (true);

create policy "Admins manage problem topics"
  on public.problem_topics for insert to authenticated
  with check (public.is_admin());

create policy "Admins delete problem topics"
  on public.problem_topics for delete to authenticated
  using (public.is_admin());

alter table public.problem_sheets enable row level security;

create policy "Published sheets visible; admins all"
  on public.problem_sheets for select to authenticated
  using (status = 'published' or public.is_admin());

create policy "Admins manage sheets"
  on public.problem_sheets for insert to authenticated
  with check (public.is_admin());

create policy "Admins update sheets"
  on public.problem_sheets for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins delete sheets"
  on public.problem_sheets for delete to authenticated
  using (public.is_admin());

alter table public.sheet_topics enable row level security;

create policy "Sheet topics visible with sheet"
  on public.sheet_topics for select to authenticated
  using (
    exists (select 1 from public.problem_sheets s
            where s.id = sheet_id and (s.status = 'published' or public.is_admin()))
  );

create policy "Admins manage sheet topics"
  on public.sheet_topics for insert to authenticated
  with check (public.is_admin());

create policy "Admins delete sheet topics"
  on public.sheet_topics for delete to authenticated
  using (public.is_admin());

alter table public.problem_sheet_items enable row level security;

create policy "Items of published sheets visible; admins all"
  on public.problem_sheet_items for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.problem_sheets s
      where s.id = sheet_id and s.status = 'published'
    )
  );

create policy "Admins manage sheet items"
  on public.problem_sheet_items for insert to authenticated
  with check (public.is_admin());

create policy "Admins update sheet items"
  on public.problem_sheet_items for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins delete sheet items"
  on public.problem_sheet_items for delete to authenticated
  using (public.is_admin());

alter table public.problem_completions enable row level security;

create policy "Own completions visible; admins all"
  on public.problem_completions for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
