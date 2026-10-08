-- Zrobione zakupy w Kalendarzu (decyzja właściciela 8.10.2026, PWD-11 A / audyt 2 M-280): „Zakupy zrobione” czyści
-- termin i osobę (D73), więc zakupy znikały z Kalendarza, a zrobione zadania stoją tam przekreślone (D135). Lista zakupów
-- zapamiętuje teraz ostatnie zrobione zakupy: kiedy je zrobiono (trip_done_at) i na kiedy były zaplanowane
-- (trip_done_date; null — zakupy bez dnia). Kalendarz pokazuje je przekreślone w dniu planu, a bez planu — w dniu
-- zrobienia (src/domain/views/shopping-trip.ts). Wpisuje je telefon tym samym patchem co czyszczenie terminu.
-- Zgodność: build 21 kolumn nie zna — nie wysyła ich (jego „Zakupy zrobione” nie zostawią śladu w Kalendarzu), a w
-- pobranych wierszach dodatkowe pola mu nie przeszkadzają. Testy: supabase/tests/trip_done.test.sql.
-- Nowe obiekty: kolumny public.lists.trip_done_at i trip_done_date, ograniczenie lists_trip_done_only_shopping, GRANT
-- insert/update (trip_done_at, trip_done_date), wpis w private.sync_entities (insert_cols, patch_cols). Funkcji,
-- wyzwalaczy i polityk nie zmieniamy — prawo zmiany jak przy terminie zakupów (RLS list).

alter table public.lists add column trip_done_at timestamptz;
alter table public.lists add column trip_done_date date;
alter table public.lists add constraint lists_trip_done_only_shopping
  check (kind = 'shopping' or (trip_done_at is null and trip_done_date is null));

grant insert (trip_done_at, trip_done_date), update (trip_done_at, trip_done_date) on public.lists to authenticated;
update private.sync_entities
   set insert_cols = insert_cols || '{trip_done_at,trip_done_date}',
       patch_cols = patch_cols || '{trip_done_at,trip_done_date}'
 where entity = 'lists';
