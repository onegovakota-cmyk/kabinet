-- Обновление: темы кабинета + отдельное поле «Мои впечатления» для кино
-- Запустите в Supabase проекта личного кабинета. Можно запускать повторно.

alter table public.pf_settings
  add column if not exists theme text not null default 'violet';

alter table public.pf_media
  add column if not exists impression text;
