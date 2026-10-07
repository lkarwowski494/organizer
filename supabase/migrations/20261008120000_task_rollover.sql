-- Rolowanie zadań (D61, decyzja właściciela z 7.10.2026, ADR 0009): niezrobione zadanie z terminem przechodzi na
-- kolejne dni („zaległe”, termin bez zmian), chyba że ma „Tylko tego dnia” (rollover = false) — wtedy mija jak
-- wydarzenie. Wygasanie liczy telefon (to widok, nie zmiana danych); serwer tylko przechowuje ustawienie.
alter table public.tasks add column rollover boolean not null default true;

grant insert (rollover), update (rollover) on public.tasks to authenticated;

update private.sync_entities
   set insert_cols = insert_cols || '{rollover}', patch_cols = patch_cols || '{rollover}'
 where entity = 'tasks';
