-- Audyt 3, PK-01, N-13 (A3-06-3): id uczestnika wydarzenia, które telefon wylicza jako UUIDv5(event|member)
-- (participantId, src/domain/views/events.ts), nie daje się zająć z wyprzedzeniem. Dotąd członek grupy mógł założyć
-- uczestnika pod id, które wyliczy telefon innej osoby, wpisując siebie: gdy ktoś potem dodawał właściwą osobę, serwer
-- uznawał to za powtórzenie („ok”), a uczestnikiem zostawał kto inny. Ta sama reguła co dla odpowiedzi i wyjątków
-- terminów (20261008483000_derived_ids, M-72): id w wersji 5 musi wynikać z event_id|member_id; inne id (UUIDv7, dawne
-- losowe — także ze starszych wersji aplikacji) przechodzą bez zmian. Przestrzeń nazw = PARTICIPANT_NAMESPACE
-- (test kontraktowy). Kod odrzucenia: invalid_id. Testy: supabase/tests/server_limits.test.sql.
-- Nowe obiekty: private.event_participants_id_guard(), wyzwalacz event_participants_a_id.

create function private.event_participants_id_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null and private.is_uuid_v5(new.id) and new.id <> private.uuid_v5('d1b68427-56bc-5060-92d6-b370118f2099'::uuid,
       new.event_id::text || '|' || new.member_id::text) then
    raise exception 'invalid_id' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger event_participants_a_id before insert on public.event_participants
  for each row execute function private.event_participants_id_guard();

revoke all on function private.event_participants_id_guard() from public, anon, authenticated;
revoke all on all functions in schema private from public, anon;
