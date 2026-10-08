-- Audyt 2 (8.10.2026), członkostwo w grupach. Testy: supabase/tests/member_names_roles.test.sql.
--  * Imiona bez znaków sterujących i kierunkowych (M-187, B-18).
--  * Kto zmienia imię i kolor osoby z kontem — decyzja właściciela z 8.10.2026 (PW-54 A).
--  * Profil bez konta tylko jako dziecko (M-188, B-19).
--  * Usunięcie osoby z grupy da się cofnąć przez 30 dni (owner/admin) — decyzje z 8.10.2026: PW-35 A, D165 (rozszerzona).
--  * Powtórzone utworzenie grupy (odpowiedź serwera zginęła) to sukces (M-227, R-27).

-- ───────────────────────── Imiona bez znaków sterujących i kierunkowych (B-18) ─────────────────────────
-- Imię członka widać u innych i trafia do treści powiadomień („… przekazuje Ci”). Usuwamy z niego:
--  * znaki sterujące, kategoria Cc: „0000..001F ; Cc” i „007F..009F ; Cc”
--    (https://www.unicode.org/Public/UCD/latest/ucd/extracted/DerivedGeneralCategory.txt), m.in. nowy wiersz i tabulator;
--    U+0000 i tak nie zmieści się w typie text;
--  * separatory wiersza i akapitu, „2028 ; Zl” i „2029 ; Zp” (ten sam plik) — łamią wiersz jak nowa linia;
--  * znaki kierunkowe Bidi_Control: „061C”, „200E..200F”, „202A..202E”, „2066..2069”
--    (https://www.unicode.org/Public/UCD/latest/ucd/PropList.txt), np. U+202E (RLO) odwraca kolejność dalszego tekstu.
--    UAX #9, 2.2 (https://www.unicode.org/reports/tr9/): „They are to be avoided wherever possible, because of security
--    concerns.”
-- Znaki kierunkowe usuwamy, a sterujące i separatory zamieniamy na spację („Ola<nowy wiersz>Kowalska” → „Ola Kowalska”),
-- na końcu obcinamy spacje z brzegów. Czyścimy zamiast odrzucać: imię wklejone z niewidocznym znakiem (np. LRM
-- z komunikatora) zapisuje się bez niego, zamiast trafić do „Odrzuconych zmian”. Odrzucone warianty: cała kategoria Cf
-- (usunęłaby łącznik U+200D z emoji rodziny i znaczniki U+E0020–E007F flag regionów — UTS #51,
-- https://www.unicode.org/reports/tr51/, definicje ED-16 i ED-14a); odrzucanie zapisu ograniczeniem CHECK (stare telefony
-- z wklejonym znakiem dostawałyby odrzucenie bez wyjaśnienia). W tym pliku znaki tylko jako sekwencje \uXXXX (ASCII).
create function private.clean_name(s text) returns text language sql immutable set search_path = '' as $$
  select btrim(regexp_replace(regexp_replace(s, '[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]', '', 'g'),
                              '[\u0001-\u001f\u007f-\u009f\u2028\u2029]+', ' ', 'g'))
$$;

create function private.clean_display_name() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.display_name := private.clean_name(new.display_name);
  return new;
end $$;

-- „a_”: przed strażnikiem i stemplem wersji (wyzwalacze BEFORE idą alfabetycznie), więc oba widzą już czyste imię.
create trigger group_members_a_clean_name before insert or update of display_name on public.group_members
  for each row execute function private.clean_display_name();
create trigger profiles_a_clean_name before insert or update of display_name on public.profiles
  for each row execute function private.clean_display_name();

-- Istniejące imiona: to samo czyszczenie (zapis podbija wersję grupy, więc telefony pobiorą poprawione imię). Imię złożone
-- wyłącznie z takich znaków dostaje zastępcze „Ja” (jak konto bez imienia w migracji core) — kolumna wymaga 1–100 znaków.
-- Grupy w koszu przyjmują ten zapis (organizer.trash_ok, jak przy usuwaniu konta).
do $$
begin
  perform set_config('organizer.trash_ok', 'on', true);
  update public.group_members set display_name = coalesce(nullif(private.clean_name(display_name), ''), 'Ja')
    where display_name is distinct from private.clean_name(display_name);
  update public.profiles set display_name = private.clean_name(display_name)
    where display_name is distinct from private.clean_name(display_name);
  perform set_config('organizer.trash_ok', '', true);
end $$;

-- ───────────────────────── Usunięcie z grupy (PW-6 A, D152, D165) ─────────────────────────
-- removed_at: kiedy osobę z kontem usunął ktoś inny (owner/admin) — nie przy samodzielnym wyjściu ani sprzątaniu serwera
-- (usunięcie konta). Ustawia i zeruje wyłącznie wyzwalacz niżej (klient nie ma uprawnień do kolumny). Korzystają z niej:
-- przyjęcie zaproszenia (osoba usunięta wraca tylko z zaproszenia wystawionego później, PW-6 A / D152), przywrócenie przez
-- owner/admin w ciągu private.tombstone_days() (D165) i wyzwalacz wyjścia z grupy (zaproszenia usuniętej osoby przestają
-- działać, migracja 20261008361000). Telefon dostaje ją z wierszem (pod kosz osób — D151, później).
alter table public.group_members add column removed_at timestamptz;

create function private.group_members_removal() returns trigger
language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    new.removed_at := null;
  elsif old.deleted_at is null and new.deleted_at is not null then
    new.removed_at := case when new.user_id is not null and actor is not null and actor <> new.user_id then new.deleted_at end;
  elsif old.deleted_at is not null and new.deleted_at is null then
    new.removed_at := null;
  else
    new.removed_at := old.removed_at;
  end if;
  return new;
end $$;

-- „t_”: po stemplu wersji (group_members_stamp), który ustawia ostateczny znacznik usunięcia (clock_timestamp, audyt
-- 8.10.2026 #7) — removed_at to dokładnie ta chwila. Strażnik czyta tylko starą wartość (old.removed_at).
create trigger group_members_t_removal before insert or update on public.group_members
  for each row execute function private.group_members_removal();

-- ───────────────────────── Strażnik członkostw ─────────────────────────
-- Zastępuje wersję z 20261008300000_owner_decisions.sql. Zmiany (reszta bez zmian):
--  * profil bez konta tylko z rolą child — przy dodaniu i przy zmianie roli (B-19);
--  * imię i kolor osoby z kontem zmienia tylko ona sama albo owner; admin — profile bez konta i siebie (PW-54 A);
--  * usuniętą osobę przywraca owner/admin w ciągu private.tombstone_days() od usunięcia (pasek „Cofnij”, później kosz osób —
--    PW-35 A, D165); konto, które samo wyszło, wraca tylko przez zaproszenie jak dotąd (#5, D152); profil dziecka po tym
--    czasie — 'deleted:expired'.
create or replace function private.group_members_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  -- coalesce: brak roli (osoba spoza grupy) to '' — „NULL not in (…)” daje NULL i przepuszczałby warunek odmowy.
  actor_role text := coalesce(private.my_role(new.group_id), '');
  me uuid := (select auth.uid());
  is_self boolean := tg_op = 'UPDATE' and old.user_id is not null and old.user_id = me;
  inv public.invites;
begin
  if me is null then return new; end if;
  -- Przekazanie własności (private.transfer_ownership): jedyna droga nadania roli owner.
  if current_setting('organizer.ownership_transfer', true) = new.group_id::text then return new; end if;

  -- Dołączenie przez zaproszenie: flagę ustawia wyłącznie private.accept_invite; nawet ustawiona ręcznie
  -- nic nie daje bez ważnego tokenu (sprawdzanego tu ponownie) dla tej grupy i tej roli.
  if nullif(current_setting('organizer.invite_hash', true), '') is not null then
    inv := private.valid_invite(decode(current_setting('organizer.invite_hash', true), 'hex'));
    if inv.id is not null and new.group_id = inv.group_id and new.user_id = me and new.deleted_at is null
       and (new.role = inv.role or (tg_op = 'UPDATE' and old.role = 'child' and new.role = 'child'))
       and (tg_op = 'INSERT' or old.user_id = me) then
      return new;
    end if;
  end if;

  if tg_op = 'INSERT' then
    if new.role = 'owner' and new.user_id = me
       and not exists (select 1 from public.group_members m where m.group_id = new.group_id) then
      return new;
    end if;
    if actor_role not in ('owner', 'admin') then raise exception 'forbidden' using errcode = 'P0001'; end if;
    if new.user_id is not null then raise exception 'forbidden:user_requires_invite' using errcode = 'P0001'; end if;
    -- Audyt 2 (B-19): profil bez konta to dziecko (D10) — „admin” albo „członek” bez konta niczego by nie zrobił.
    if new.role <> 'child' then raise exception 'forbidden:role' using errcode = 'P0001'; end if;
    return new;
  end if;

  if new.user_id is distinct from old.user_id then raise exception 'immutable_column:user_id' using errcode = 'P0001'; end if;
  if new.member_id is distinct from old.member_id then raise exception 'immutable_column:member_id' using errcode = 'P0001'; end if;
  -- Audyt 8.10.2026 (#5): konto, które samo wyszło, wraca do grupy wyłącznie samo, przez zaproszenie (zgoda tej osoby).
  -- Osobę usuniętą przez kogoś przywraca owner/admin (prawa jak przy usunięciu — niżej) w ciągu tombstone_days() (D165).
  if old.deleted_at is not null and new.deleted_at is null then
    if old.user_id is not null and (old.removed_at is null or old.removed_at <= now() - make_interval(days => private.tombstone_days())) then
      raise exception 'forbidden:user_requires_invite' using errcode = 'P0001';
    end if;
    if old.user_id is null and old.deleted_at <= now() - make_interval(days => private.tombstone_days()) then
      raise exception 'deleted:expired' using errcode = 'P0001';
    end if;
  end if;

  if new.role is distinct from old.role or new.deleted_at is distinct from old.deleted_at then
    if is_self and old.deleted_at is null and new.deleted_at is not null and new.role = old.role and old.role <> 'owner' then
      null; -- wyjście z grupy (każdy poza ownerem; owner najpierw przekazuje grupę — Etap 1, usuwanie konta)
    elsif actor_role = 'owner' then
      if old.role = 'owner' and old.user_id = me then
        raise exception 'forbidden:owner_cannot_demote_self' using errcode = 'P0001';
      end if;
      if new.role = 'owner' then raise exception 'forbidden:role' using errcode = 'P0001'; end if;
    elsif actor_role = 'admin' then
      if old.role in ('owner', 'admin') or new.role in ('owner', 'admin') then
        raise exception 'forbidden:role' using errcode = 'P0001';
      end if;
    else
      raise exception 'forbidden:role' using errcode = 'P0001';
    end if;
  end if;
  -- Audyt 2 (B-19): profil bez konta zostaje dzieckiem.
  if new.role is distinct from old.role and new.user_id is null and new.role <> 'child' then
    raise exception 'forbidden:role' using errcode = 'P0001';
  end if;

  -- Decyzja właściciela z 8.10.2026 (PW-54 A, audyt 2 B-18): imię i kolor osoby z kontem zmienia tylko ona sama albo
  -- owner; admin — tylko profile bez konta (dzieci) i siebie. Dotąd admin zmieniał też imię ownera i innych adminów.
  if (new.display_name, new.color) is distinct from (old.display_name, old.color)
     and not is_self and actor_role <> 'owner' and not (actor_role = 'admin' and old.user_id is null) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- ───────────────────────── Powtórzone utworzenie grupy (R-27) ─────────────────────────
-- Zastępuje wersję z 20261006120000_core.sql. Gdy odpowiedź serwera zginęła, telefon ponawia z tymi samymi
-- identyfikatorami (NewGroupScreen): grupa już jest, nie w koszu, a ja jestem jej właścicielem — sukces bez zmian, jak
-- komenda create_group w apply_op. Cudza (albo usunięta) grupa o tym id: błąd jak dotąd (duplicate key, 23505).
create or replace function private.create_group_with_owner(gid uuid, gname text, gkind text, owner_member uuid, owner_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if exists (select 1 from public.groups g join public.group_members m on m.group_id = g.id
             where g.id = gid and g.kind = gkind and g.deleted_at is null
               and m.user_id = uid and m.role = 'owner' and m.deleted_at is null) then
    return;
  end if;
  insert into public.groups (id, name, kind) values (gid, gname, gkind);
  insert into public.group_members (member_id, group_id, user_id, display_name, role)
    values (owner_member, gid, uid, owner_name, 'owner');
end $$;

revoke all on all functions in schema private from public, anon;
grant execute on function private.rrule_ok(text) to authenticated;
