-- Audyt 2 (M-180): procedura po odtworzeniu bazy z kopii albo do punktu w czasie (PITR). Po odtworzeniu serwer „cofa
-- się” do chwili kopii, a telefony już wcześniej zdjęły z kolejki zmiany, które serwer potwierdził później (ich numery
-- są wyżej niż private.sync_clients.last_seq z kopii), i mają kursory grup dalej niż wersje grup z kopii. Bez kroku
-- poniżej nowe zmiany na serwerze dostałyby numery wersji, które telefony uznają za już pobrane, i by ich nie zobaczyły.
-- Funkcja przesuwa licznik wersji każdej grupy o `gap` (więcej, niż mogło przybyć od chwili kopii do awarii) i ustawia
-- nową epokę (purged_version = nowa wersja): każdy telefon z kursorem sprzed tej epoki dostaje resync i pobiera grupę
-- od nowa, więc widzi stan serwera. Zmiany z okna utraty (od chwili kopii do awarii) przepadają — opis w ADR 0041.
-- Wywołuje tylko operator (rola postgres w panelu Supabase); aplikacja nie ma do niej dostępu.
create function private.new_epoch_after_restore(gap bigint default 1000000000) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if gap is null or gap < 1 then raise exception 'bad_gap' using errcode = 'P0001'; end if;
  update public.groups set version = version + gap, purged_version = version + gap;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function private.new_epoch_after_restore(bigint) from public, anon, authenticated;
