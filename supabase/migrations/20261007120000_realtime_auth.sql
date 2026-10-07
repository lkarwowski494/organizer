-- Etap 1, migracja 7: kto może odbierać sygnały „pobierz zmiany” (poke) z prywatnych kanałów Realtime.
-- Serwer wysyła je realtime.send(..., private => true) na tematy 'user:<uid>' (zmiana dostępu) i
-- 'group:<gid>' (nowa wersja grupy) — migracje core, lists_tasks, sync. Dostęp do kanału prywatnego daje
-- polityka RLS na realtime.messages (https://supabase.com/docs/guides/realtime/authorization:
-- „create RLS policies on the realtime.messages … realtime.topic helper … returns the Channel topic”).
-- Sygnał nie zawiera danych (tylko numer wersji), ale i tak słyszy go wyłącznie adresat.
-- Brak polityki INSERT: klienci niczego nie wysyłają, nadaje tylko baza.
create policy organizer_poke_receive on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    -- Wiersz tylko z tematu kanału, do którego klient dołącza (bez tego dołączenie do własnego kanału
    -- odsłaniałoby przy SELECT wiersze z innych tematów — wykrył to test realtime_auth).
    and realtime.messages.topic = (select realtime.topic())
    and (
      (select realtime.topic()) = 'user:' || (select auth.uid())::text
      or exists (
        select 1 from public.group_members m
        where m.user_id = (select auth.uid()) and m.deleted_at is null
          and 'group:' || m.group_id::text = (select realtime.topic())
      )
    )
  );
