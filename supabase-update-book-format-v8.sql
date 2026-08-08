-- v8: формат книги
-- Запустите один раз в Supabase проекта личного кабинета.

alter table public.pf_books
  add column if not exists book_format text default 'other';

alter table public.pf_books
  drop constraint if exists pf_books_book_format_check;

alter table public.pf_books
  add constraint pf_books_book_format_check
  check (book_format in ('paper', 'ebook', 'audio', 'other'));

comment on column public.pf_books.book_format is
  'paper = бумажная книга, ebook = электронная книга, audio = аудиокнига, other = формат не указан';
