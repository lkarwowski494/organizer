-- Plan lekcji: który tydzień jest A (decyzja właściciela D171, audyt 2 M-15). Dotąd litery A/B liczyły się od bieżącego
-- tygodnia przy każdym otwarciu planu, a przełącznik „Ten tydzień to B” przesuwał wczytane lekcje o tydzień. Teraz przy
-- osobie zapisuje się poniedziałek jakiegoś tygodnia A (src/domain/views/timetable.ts); parzystość tygodnia liczy telefon
-- z różnicy dni. Testy: supabase/tests/member_week_a.test.sql.
-- Zgodność: build 21 kolumny nie zna — nie wysyła jej, a w pobranych wierszach dodatkowe pole mu nie przeszkadza.
-- Nowe obiekty: kolumna public.group_members.week_a, GRANT update (week_a), wpis w private.sync_entities (patch_cols),
-- funkcja i wyzwalacz private.group_members_week_a_guard. Strażnika group_members_guard nie zmieniamy.

alter table public.group_members add column week_a date
  constraint group_members_week_a_monday check (week_a is null or extract(isodow from week_a) = 1);

grant update (week_a) on public.group_members to authenticated;
update private.sync_entities set patch_cols = patch_cols || '{week_a}' where entity = 'group_members';

-- Kotwicę ustawia dorosły z grupy (plan lekcji zmieniają ci sami, którzy zmieniają wydarzenia); dziecko — nie, także
-- swoją (ekran planu jest dla dziecka niedostępny). Osobny wyzwalacz tylko na tę kolumnę.
create function private.group_members_week_a_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then return new; end if;
  if coalesce(private.my_role(new.group_id), 'child') = 'child' then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger group_members_week_a_guard before update of week_a on public.group_members
  for each row when (new.week_a is distinct from old.week_a) execute function private.group_members_week_a_guard();

revoke all on all functions in schema private from public, anon;
