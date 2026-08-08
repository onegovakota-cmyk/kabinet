-- v7: способ получения дохода
-- Запустите в Supabase проекта личного кабинета.

alter table public.pf_incomes
  add column if not exists income_method text default 'other';

alter table public.pf_incomes
  drop constraint if exists pf_incomes_income_method_check;

alter table public.pf_incomes
  add constraint pf_incomes_income_method_check
  check (income_method in ('card', 'cash', 'other'));

comment on column public.pf_incomes.income_method is
  'card = на карту, cash = наличными, other = не указано для старых записей';
