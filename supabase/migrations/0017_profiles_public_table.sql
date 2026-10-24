-- ============================================================================
-- 0017 — Replace the SECURITY DEFINER view `profiles_public` with a real,
-- trigger-maintained table.
--
-- Why: Supabase's security linter flags definer views as Critical — the view
-- enforces the *creator's* permissions instead of the querying user's. The
-- sanctioned pattern for exposing safe projections of a protected table is a
-- real table with its own RLS, kept in sync by a trigger.
--
-- Same name and columns as the old view → the frontend keeps working
-- unchanged. Rows exist only for active students/mentors.
-- ============================================================================

drop view if exists public.profiles_public;

create table public.profiles_public (
  id uuid primary key references public.profiles (id) on delete cascade,
  full_name_en text not null default '',
  full_name_ar text,
  avatar_url text,
  academic_year text,
  faculty text,
  programming_experience text,
  preferred_language text,
  previous_cp_experience boolean not null default false,
  availability text[] not null default '{}',
  codeforces_handle text,
  github_url text,
  linkedin_url text,
  other_profile_urls text[] not null default '{}',
  bio text,
  show_contact boolean not null default false,
  show_university_id boolean not null default false,
  created_at timestamptz not null default now()
);

-- backfill current active students/mentors
insert into public.profiles_public (
  id, full_name_en, full_name_ar, avatar_url, academic_year, faculty,
  programming_experience, preferred_language, previous_cp_experience, availability,
  codeforces_handle, github_url, linkedin_url, other_profile_urls, bio,
  show_contact, show_university_id, created_at
)
select
  p.id, p.full_name_en, p.full_name_ar, p.avatar_url, p.academic_year, p.faculty,
  p.programming_experience, p.preferred_language, p.previous_cp_experience, p.availability,
  p.codeforces_handle, p.github_url, p.linkedin_url, p.other_profile_urls, p.bio,
  p.show_contact, p.show_university_id, p.created_at
from public.profiles p
where p.status = 'active' and p.role in ('student', 'mentor')
on conflict (id) do nothing;

-- keep the projection in sync with profiles
create or replace function public.sync_profiles_public()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.profiles_public where id = old.id;
    return old;
  end if;

  if new.status = 'active' and new.role in ('student', 'mentor') then
    insert into public.profiles_public (
      id, full_name_en, full_name_ar, avatar_url, academic_year, faculty,
      programming_experience, preferred_language, previous_cp_experience, availability,
      codeforces_handle, github_url, linkedin_url, other_profile_urls, bio,
      show_contact, show_university_id, created_at
    ) values (
      new.id, new.full_name_en, new.full_name_ar, new.avatar_url, new.academic_year, new.faculty,
      new.programming_experience, new.preferred_language, new.previous_cp_experience, new.availability,
      new.codeforces_handle, new.github_url, new.linkedin_url, new.other_profile_urls, new.bio,
      new.show_contact, new.show_university_id, new.created_at
    )
    on conflict (id) do update set
      full_name_en = excluded.full_name_en,
      full_name_ar = excluded.full_name_ar,
      avatar_url = excluded.avatar_url,
      academic_year = excluded.academic_year,
      faculty = excluded.faculty,
      programming_experience = excluded.programming_experience,
      preferred_language = excluded.preferred_language,
      previous_cp_experience = excluded.previous_cp_experience,
      availability = excluded.availability,
      codeforces_handle = excluded.codeforces_handle,
      github_url = excluded.github_url,
      linkedin_url = excluded.linkedin_url,
      other_profile_urls = excluded.other_profile_urls,
      bio = excluded.bio,
      show_contact = excluded.show_contact,
      show_university_id = excluded.show_university_id;
  else
    delete from public.profiles_public where id = new.id;
  end if;

  return new;
end;
$$;

revoke execute on function public.sync_profiles_public() from public, authenticated, anon;

create trigger trg_profiles_public_sync
  after insert or update or delete on public.profiles
  for each row execute function public.sync_profiles_public();

-- RLS: any authenticated user may browse; anon may not
alter table public.profiles_public enable row level security;

create policy "Authenticated can browse public profiles"
  on public.profiles_public for select to authenticated
  using (true);

-- writes happen only through the definer sync trigger — lock the table down
revoke insert, update, delete on public.profiles_public from authenticated, anon;
