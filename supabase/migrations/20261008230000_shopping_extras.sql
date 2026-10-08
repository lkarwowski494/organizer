-- Zakupy (D85, D86; ADR 0018): dział pozycji wybrany ręcznie (tasks.category; null = podpowiedź telefonu ze słownika
-- albo z pamięci grupy) i stałe zakupy listy (lists.staples). Klucze działów = src/config/shopping.pl.ts, limity =
-- config.shopping (test kontraktowy). Uprawnienia jak dla reszty pól listy i zadania (lists_guard, tasks_guard).

create function private.shopping_categories() returns text[] language sql immutable as $$
  select array['produce','bakery','dairy','meat','frozen','pantry','sweets','drinks','baby','household','hygiene','pets','other']
$$;
create function private.staples_max() returns int language sql immutable as $$ select 50 $$;
create function private.staple_max_length() returns int language sql immutable as $$ select 200 $$;

-- Każda pozycja niepusta (po obcięciu spacji) i nie dłuższa niż limit.
create function private.staples_ok(s text[]) returns boolean language sql immutable set search_path = '' as $$
  select cardinality(s) <= private.staples_max()
     and not exists (select 1 from unnest(s) x where x is null or char_length(trim(x)) = 0 or char_length(x) > private.staple_max_length())
$$;

alter table public.tasks add column category text;
alter table public.tasks add constraint tasks_category_known check (category is null or category = any (private.shopping_categories()));

alter table public.lists add column staples text[] not null default '{}';
alter table public.lists add constraint lists_staples_ok check (private.staples_ok(staples));
alter table public.lists add constraint lists_staples_only_shopping check (kind = 'shopping' or cardinality(staples) = 0);

grant insert (category), update (category) on public.tasks to authenticated;
grant insert (staples), update (staples) on public.lists to authenticated;
update private.sync_entities set insert_cols = insert_cols || '{category}', patch_cols = patch_cols || '{category}' where entity = 'tasks';
update private.sync_entities set insert_cols = insert_cols || '{staples}', patch_cols = patch_cols || '{staples}' where entity = 'lists';

revoke all on function private.shopping_categories(), private.staples_max(), private.staple_max_length(), private.staples_ok(text[]) from public, anon;
grant execute on function private.shopping_categories(), private.staples_max(), private.staple_max_length(), private.staples_ok(text[]) to authenticated;
