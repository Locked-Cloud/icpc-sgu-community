-- ============================================================================
-- 0003 — WEEKLY TRAINING (weeks, resources, material completions)
-- ============================================================================

create table public.training_weeks (
  id uuid primary key default gen_random_uuid(),
  week_number int not null check (week_number > 0),
  title text not null,
  description text,
  objectives text[] not null default '{}',
  topics text[] not null default '{}',
  start_date date,
  end_date date,
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'published', 'archived')),
  publish_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index uq_training_weeks_number on public.training_weeks (week_number)
  where status <> 'archived';

create trigger trg_training_weeks_updated_at
  before update on public.training_weeks
  for each row execute function public.set_updated_at();

create table public.training_resources (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references public.training_weeks (id) on delete cascade,
  title text not null,
  kind text not null check (kind in ('pdf', 'slides', 'document', 'video', 'youtube', 'link', 'problem', 'code', 'practice_sheet')),
  url text,
  storage_path text,
  description text,
  sort_order int not null default 0,
  visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (url is not null or storage_path is not null)
);

create index idx_training_resources_week on public.training_resources (week_id, sort_order);

create trigger trg_training_resources_updated_at
  before update on public.training_resources
  for each row execute function public.set_updated_at();

create table public.material_completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  resource_id uuid not null references public.training_resources (id) on delete cascade,
  completed_at timestamptz not null default now(),
  unique (user_id, resource_id)
);

create index idx_material_completions_user on public.material_completions (user_id);

-- ----------------------------------------------------------------------------
-- Notification on publish
-- ----------------------------------------------------------------------------
create or replace function public.notify_week_published()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.status = 'published' and old.status is distinct from 'published' then
    perform public.notify(p.id, 'training', 'New training week published',
      'Week ' || new.week_number || ': ' || new.title || ' is now available.',
      '/training/' || new.id::text, 'training_week', new.id::text);
  end if;
  return new;
end;
$$;

create trigger trg_week_published
  after update on public.training_weeks
  for each row execute function public.notify_week_published();

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table public.training_weeks enable row level security;

create policy "Published weeks visible; admins see all"
  on public.training_weeks for select to authenticated
  using (
    public.is_admin()
    or (
      status = 'published'
      and coalesce(publish_at, created_at) <= now()
    )
  );

create policy "Admins manage weeks"
  on public.training_weeks for insert to authenticated
  with check (public.is_admin());

create policy "Admins update weeks"
  on public.training_weeks for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins delete weeks"
  on public.training_weeks for delete to authenticated
  using (public.is_admin());

alter table public.training_resources enable row level security;

create policy "Resources of published weeks visible; admins all"
  on public.training_resources for select to authenticated
  using (
    public.is_admin()
    or (
      visible
      and exists (
        select 1 from public.training_weeks w
        where w.id = week_id
          and w.status = 'published'
          and coalesce(w.publish_at, w.created_at) <= now()
      )
    )
  );

create policy "Admins manage resources"
  on public.training_resources for insert to authenticated
  with check (public.is_admin());

create policy "Admins update resources"
  on public.training_resources for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins delete resources"
  on public.training_resources for delete to authenticated
  using (public.is_admin());

alter table public.material_completions enable row level security;

create policy "Own material completions"
  on public.material_completions for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy "Mark own material completed"
  on public.material_completions for insert to authenticated
  with check (user_id = auth.uid());

create policy "Unmark own material completion"
  on public.material_completions for delete to authenticated
  using (user_id = auth.uid());
