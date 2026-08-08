-- ==========================================================
-- PERSONAL CABINET v10.1 — ЕДИНЫЙ РЕМОНТНЫЙ SQL
-- Запустите в проекте Supabase ЛИЧНОГО КАБИНЕТА.
-- Скрипт можно запускать повторно.
-- Он НЕ удаляет ваши доходы, расходы, книги, фильмы и другие данные.
-- ==========================================================

create extension if not exists pgcrypto;

create or replace function public.pf_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- Проверяем старые обязательные таблицы ----------
-- Если эти таблицы отсутствуют, сначала нужен первоначальный supabase.sql.
-- Обычно они у вас уже есть.

-- ---------- Настройки из разделов книги/сон/темы ----------
alter table public.pf_settings
  add column if not exists yearly_book_goal integer not null default 24,
  add column if not exists daily_reading_goal_minutes integer not null default 20,
  add column if not exists sleep_goal_hours numeric(4,1) not null default 8.0,
  add column if not exists theme text not null default 'violet';

-- ---------- ГЛАВНОЕ ИСПРАВЛЕНИЕ ДОХОДОВ ----------
alter table public.pf_incomes
  add column if not exists income_method text default 'other';

alter table public.pf_incomes
  drop constraint if exists pf_incomes_income_method_check;

alter table public.pf_incomes
  add constraint pf_incomes_income_method_check
  check (income_method in ('card','cash','other'));

-- Возвращаем/проверяем RLS для доходов.
alter table public.pf_incomes enable row level security;

drop policy if exists pf_incomes_select_own on public.pf_incomes;
drop policy if exists pf_incomes_insert_own on public.pf_incomes;
drop policy if exists pf_incomes_update_own on public.pf_incomes;
drop policy if exists pf_incomes_delete_own on public.pf_incomes;

create policy pf_incomes_select_own
on public.pf_incomes for select to authenticated
using (auth.uid() = user_id);

create policy pf_incomes_insert_own
on public.pf_incomes for insert to authenticated
with check (auth.uid() = user_id);

create policy pf_incomes_update_own
on public.pf_incomes for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy pf_incomes_delete_own
on public.pf_incomes for delete to authenticated
using (auth.uid() = user_id);

-- ---------- Формат книг ----------
alter table public.pf_books
  add column if not exists book_format text default 'other';

alter table public.pf_books
  drop constraint if exists pf_books_book_format_check;

alter table public.pf_books
  add constraint pf_books_book_format_check
  check (book_format in ('paper','ebook','audio','other'));

-- ---------- Впечатления о кино ----------
alter table public.pf_media
  add column if not exists impression text;



-- ---------- Новые разделы Life OS ----------
-- v10 Life OS: цели, проекты, месяц, еженедельные обзоры, Inbox,
-- энергия, колесо жизни, развитие и достижения.
-- Запустите ОДИН РАЗ в Supabase проекта личного кабинета.
-- Скрипт безопасно можно запускать повторно.

create extension if not exists pgcrypto;

create or replace function public.pf_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.pf_goals (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  title text not null, category text not null default 'other' check (category in ('finance','work','growth','home','health','other')),
  target_value numeric not null default 100 check (target_value >= 0), current_value numeric not null default 0 check (current_value >= 0),
  unit text, target_date date, status text not null default 'active' check (status in ('active','paused','done')), notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.pf_projects (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  title text not null, area text not null default 'other' check (area in ('work','tutoring','content','home','personal','other')),
  status text not null default 'planned' check (status in ('planned','active','paused','done')), progress integer not null default 0 check (progress between 0 and 100),
  deadline date, notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.pf_tasks add column if not exists project_id uuid references public.pf_projects(id) on delete set null;
create index if not exists pf_tasks_project_idx on public.pf_tasks(project_id);

create table if not exists public.pf_project_steps (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.pf_projects(id) on delete cascade, title text not null, completed boolean not null default false,
  sort_order integer not null default 0, created_at timestamptz not null default now()
);
create table if not exists public.pf_month_plans (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  month date not null, focus text, priority1 text, priority2 text, priority3 text, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_id, month)
);
create table if not exists public.pf_month_events (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  title text not null, event_date date not null, event_type text not null default 'event' check (event_type in ('event','payment','purchase','birthday','deadline','other')),
  amount numeric, created_at timestamptz not null default now()
);
create table if not exists public.pf_weekly_reviews (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null, wins text, challenges text, drained text, next_focus text, score integer not null default 8 check (score between 1 and 10),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_id, week_start)
);
create table if not exists public.pf_inbox (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  text text not null, item_type text not null default 'idea' check (item_type in ('idea','task','purchase','content','other')),
  status text not null default 'inbox' check (status in ('inbox','processed')), processed_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.pf_energy (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  day date not null, energy integer not null check (energy between 1 and 5), stress integer not null check (stress between 1 and 5),
  wellbeing integer not null check (wellbeing between 1 and 5), note text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_id, day)
);
create table if not exists public.pf_courses (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  title text not null, provider text, status text not null default 'wishlist' check (status in ('wishlist','active','paused','finished')),
  total_units integer not null default 0 check (total_units >= 0), completed_units integer not null default 0 check (completed_units >= 0),
  url text, notes text, started_on date, finished_on date, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.pf_achievements (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  title text not null, achieved_on date not null default current_date, category text not null default 'other' check (category in ('finance','work','growth','personal','other')),
  note text, created_at timestamptz not null default now()
);
create table if not exists public.pf_life_wheel (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  month date not null, area text not null check (area in ('finance','work','growth','rest','health','home','relationships','creativity')),
  score integer not null check (score between 1 and 10), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_id, month, area)
);

create index if not exists pf_goals_user_status_idx on public.pf_goals(user_id,status);
create index if not exists pf_projects_user_status_idx on public.pf_projects(user_id,status);
create index if not exists pf_project_steps_project_idx on public.pf_project_steps(project_id);
create index if not exists pf_month_events_user_date_idx on public.pf_month_events(user_id,event_date);
create index if not exists pf_inbox_user_status_idx on public.pf_inbox(user_id,status);
create index if not exists pf_energy_user_day_idx on public.pf_energy(user_id,day desc);
create index if not exists pf_courses_user_status_idx on public.pf_courses(user_id,status);
create index if not exists pf_achievements_user_date_idx on public.pf_achievements(user_id,achieved_on desc);

do $$
declare t text;
begin
  foreach t in array array['pf_goals','pf_projects','pf_month_plans','pf_weekly_reviews','pf_energy','pf_courses','pf_life_wheel']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.pf_set_updated_at()', t || '_updated_at', t);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['pf_goals','pf_projects','pf_project_steps','pf_month_plans','pf_month_events','pf_weekly_reviews','pf_inbox','pf_energy','pf_courses','pf_achievements','pf_life_wheel']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);
    execute format('create policy %I on public.%I for select to authenticated using (auth.uid() = user_id)', t || '_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (auth.uid() = user_id)', t || '_insert_own', t);
    execute format('create policy %I on public.%I for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)', t || '_update_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using (auth.uid() = user_id)', t || '_delete_own', t);
  end loop;
end $$;
