-- Обновление личного кабинета: книги, кино, настроение и сон
-- Запустите этот файл ОДИН РАЗ в Supabase → SQL Editor → New query → Run.
-- Скрипт безопасно можно запускать повторно: используются IF NOT EXISTS и пересоздание политик.

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

alter table public.pf_settings
  add column if not exists yearly_book_goal integer not null default 24,
  add column if not exists daily_reading_goal_minutes integer not null default 20,
  add column if not exists sleep_goal_hours numeric(4,1) not null default 8.0,
  add column if not exists theme text not null default 'violet';

create table if not exists public.pf_books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  author text,
  status text not null default 'wishlist' check (status in ('reading','wishlist','finished','paused')),
  cover_url text,
  total_pages integer not null default 0 check (total_pages >= 0),
  current_page integer not null default 0 check (current_page >= 0),
  rating integer not null default 0 check (rating between 0 and 5),
  favorite boolean not null default false,
  owned boolean not null default false,
  started_on date,
  finished_on date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pf_reading_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid not null references public.pf_books(id) on delete cascade,
  read_on date not null default current_date,
  page_after integer not null default 0 check (page_after >= 0),
  pages_read integer not null default 0 check (pages_read >= 0),
  minutes integer not null default 0 check (minutes >= 0),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists pf_reading_logs_user_date_idx on public.pf_reading_logs(user_id, read_on desc);
create index if not exists pf_books_user_status_idx on public.pf_books(user_id, status);

create table if not exists public.pf_media (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  media_type text not null default 'movie' check (media_type in ('movie','series')),
  status text not null default 'wishlist' check (status in ('wishlist','watching','watched','dropped')),
  cover_url text,
  release_year integer check (release_year is null or release_year between 1880 and 2200),
  rating numeric(3,1) not null default 0 check (rating between 0 and 10),
  favorite boolean not null default false,
  season_current integer not null default 0 check (season_current >= 0),
  seasons_total integer not null default 0 check (seasons_total >= 0),
  episode_current integer not null default 0 check (episode_current >= 0),
  episodes_total integer not null default 0 check (episodes_total >= 0),
  watched_on date,
  notes text,
  impression text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.pf_media add column if not exists impression text;

create index if not exists pf_media_user_status_idx on public.pf_media(user_id, status);

create table if not exists public.pf_moods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  mood integer not null check (mood between 1 and 5),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, day)
);

create table if not exists public.pf_sleep (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  bed_time time not null,
  wake_time time not null,
  duration_minutes integer not null check (duration_minutes between 0 and 1440),
  quality integer not null default 3 check (quality between 1 and 5),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, day)
);

drop trigger if exists pf_books_updated_at on public.pf_books;
create trigger pf_books_updated_at before update on public.pf_books
for each row execute function public.pf_set_updated_at();

drop trigger if exists pf_media_updated_at on public.pf_media;
create trigger pf_media_updated_at before update on public.pf_media
for each row execute function public.pf_set_updated_at();

drop trigger if exists pf_moods_updated_at on public.pf_moods;
create trigger pf_moods_updated_at before update on public.pf_moods
for each row execute function public.pf_set_updated_at();

drop trigger if exists pf_sleep_updated_at on public.pf_sleep;
create trigger pf_sleep_updated_at before update on public.pf_sleep
for each row execute function public.pf_set_updated_at();

alter table public.pf_books enable row level security;
alter table public.pf_reading_logs enable row level security;
alter table public.pf_media enable row level security;
alter table public.pf_moods enable row level security;
alter table public.pf_sleep enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['pf_books','pf_reading_logs','pf_media','pf_moods','pf_sleep']
  loop
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

create or replace function public.pf_record_reading_session(
  p_book_id uuid,
  p_new_page integer,
  p_minutes integer,
  p_read_on date,
  p_note text default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_old_page integer;
  v_total integer;
  v_status text;
  v_pages integer;
  v_day date := coalesce(p_read_on, current_date);
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if p_new_page is null or p_new_page < 0 then raise exception 'Page must be non-negative'; end if;
  if p_minutes is null or p_minutes < 0 then raise exception 'Minutes must be non-negative'; end if;

  select current_page, total_pages, status
    into v_old_page, v_total, v_status
  from public.pf_books
  where id = p_book_id and user_id = v_user
  for update;

  if not found then raise exception 'Book not found'; end if;
  if p_new_page < v_old_page then
    raise exception 'New page cannot be lower than current page. Edit the book to correct progress.';
  end if;
  if v_total > 0 and p_new_page > v_total then
    raise exception 'New page cannot exceed total pages.';
  end if;

  v_pages := greatest(p_new_page - v_old_page, 0);

  insert into public.pf_reading_logs(user_id, book_id, read_on, page_after, pages_read, minutes, note)
  values (v_user, p_book_id, v_day, p_new_page, v_pages, p_minutes, nullif(trim(p_note), ''));

  update public.pf_books
  set current_page = p_new_page,
      status = case
        when v_total > 0 and p_new_page >= v_total then 'finished'
        when v_status = 'wishlist' then 'reading'
        else v_status
      end,
      started_on = case
        when started_on is null and p_new_page > 0 then v_day
        else started_on
      end,
      finished_on = case
        when v_total > 0 and p_new_page >= v_total then coalesce(finished_on, v_day)
        else finished_on
      end
  where id = p_book_id and user_id = v_user;
end;
$$;

grant execute on function public.pf_record_reading_session(uuid, integer, integer, date, text) to authenticated;
