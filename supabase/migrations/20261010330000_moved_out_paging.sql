-- „gone” w porcjach pobierania: przeniesienie, za którym przechodzi kursor, nie może zginąć (symulator synchronizacji,
-- src/domain/__tests__/sync-sim.test.ts, regresja „nowy wiersz był w następnej porcji”). Testy:
-- supabase/tests/moved_out_paging.test.sql.
--
-- Dotąd zadanie trafiało do „gone” tylko wtedy, gdy w chwili pobrania było niewidoczne. Gdy zadanie przeniesiono
-- z listy L do ukrytej H, a potem do innej widocznej L2, porcja obejmująca pierwsze przeniesienie (kursor za nim) nie
-- mówiła nic, bo zadanie znów było widoczne — a jego nowy wiersz (wyższa wersja) przychodził dopiero w następnej
-- porcji. Jeśli przed nią L2 zawężono, wiersz nie przychodził już nigdy, a telefon trzymał na zawsze starą kopię
-- w widocznej liście L (lista L2, której nie widzi, czyści tylko wiersze z list_id = L2).
-- Teraz zadanie jest w „gone” także wtedy, gdy jego bieżący wiersz nie mieści się w tej porcji (wersja > upto): telefon
-- usuwa starą kopię, a nowy wiersz — jeśli zadanie nadal widzi — przychodzi w następnej porcji (klient stosuje „gone”
-- przed wierszami porcji, więc wiersz z tej samej porcji zostaje). Nic nie wycieka: o zadaniu widocznym telefon i tak
-- dostanie cały wiersz.
-- Zastępuje: private.tasks_moved_out (20261008310000_sync_protocol_v2). Sygnatura i uprawnienia bez zmian.
create or replace function private.tasks_moved_out(g uuid, since bigint, upto bigint) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select distinct a.entity_id from public.activity a
  where a.group_id = g and a.version > since and a.version <= upto
    and a.entity = 'tasks' and a.changes ? 'list_id'
    and private.can_see_list((a.changes -> 'list_id' ->> 0)::uuid)
    and not exists (select 1 from public.tasks t where t.id = a.entity_id and t.version <= upto and private.can_see_list(t.list_id))
$$;
