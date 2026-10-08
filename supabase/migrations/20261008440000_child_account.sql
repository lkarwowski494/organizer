-- Audyt 2 (8.10.2026): dziecko z własnym kontem. Testy: supabase/tests/child_account.test.sql.
-- Decyzja właściciela z 8.10.2026 (PW-14 B, D155): dziecko dostaje konto przez połączenie ISTNIEJĄCEGO profilu dziecka
-- z kontem — zostają plan lekcji, zadania, obecność i historia (ten sam member_id). Do tego zasady dziecka z kontem:
--  * „Połącz z kontem”: owner albo admin tworzy jednorazowy kod przypięty do profilu (bez konta, rola child). Dziecko
--    loguje się (w becie tylko Apple, D177) i dołącza tym kodem jak każdym innym (ID grupy + kod, join_group — ten sam
--    limit prób i ta sama ochrona przed zgadywaniem, D140 odwrócona) i staje się tym samym member_id z rolą child.
--    Jeden aktywny kod na profil (jak jeden na grupę i rolę, PW-41 A / D167): „Nowy kod” unieważnia poprzedni.
--  * dziecko nie wychodzi samo z grupy (forbidden:child) — wypisuje je owner albo admin;
--  * rolę zmienia tylko owner (dotąd admin zmieniał member ↔ child; audyt 2, R-14) — D138 „rolę dziecka zmienia admin”
--    zastąpione tą decyzją;
--  * telefon dziecka dostaje sygnał nowego dostępu przy połączeniu (jak przy dołączeniu), więc od razu pobiera grupę.
-- Reszta zasad dziecka z kontem już obowiązuje: tylko odhacza (D34, tasks_guard), nie zmienia list ani zakupów
-- (lists_guard), nie przekazuje (handoffs_guard), obecność tylko za siebie (event_rsvps_guard) — testy w tym samym pliku.
-- Osoba usunięta z grupy wraca tylko z zaproszenia wystawionego po usunięciu (PW-6 A, D152) — także tą drogą.

-- ───────────────────────── Kod przypięty do profilu dziecka ─────────────────────────
-- member_id: profil, z którym kod łączy konto. Taki kod ma rolę child, jest kodem do ID grupy (kind 'code') i działa raz.
-- Zwykłe zaproszenia nadal tylko admin/member — nie da się zaprosić „nowego” dziecka obok istniejącego profilu (PW-14 B,
-- odrzucone A).
alter table public.invites add column member_id uuid references public.group_members (member_id);
alter table public.invites drop constraint invites_role_check;
alter table public.invites add constraint invites_role_check check (
  (member_id is null and role in ('admin', 'member')) or (member_id is not null and role = 'child' and kind = 'code'));
create index invites_member_idx on public.invites (member_id) where member_id is not null;

-- Zgadywanie: kod dziecka to zwykły kod do ID grupy, więc liczy się do limitów join_group (5 nieudanych prób na konto na
-- godzinę, unieważnienie po private.join_fails_per_code() nieudanych próbach na ID grupy od utworzenia). Szansa
-- odgadnięcia danego kodu w całym jego życiu ≤ 100 / 10^6 = 0,01% (rachunek z migracji 20261008362000); przy k aktywnych
-- kodach grupy któregokolwiek ≤ k × 0,01% (k = 2 + liczba profili dzieci z wystawionym kodem; kod dziecka działa raz
-- i zwykle jest użyty od razu).
create function private.issue_child_code(mid uuid, renew boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m public.group_members;
  jid text;
  v_code text;
  r public.invites;
begin
  select * into m from public.group_members where member_id = mid;
  -- Nieznany profil i cudza grupa: ten sam błąd (nie zdradzamy, czy profil istnieje).
  if coalesce(private.my_role(m.group_id), '') not in ('owner', 'admin') then raise exception 'forbidden' using errcode = 'P0001'; end if;
  if (select kind from public.groups where id = m.group_id) <> 'shared' then raise exception 'forbidden:personal_group' using errcode = 'P0001'; end if;
  -- Tylko żywy profil dziecka bez konta (dorosłego z kontem nie łączymy, profil już połączony ma konto).
  if m.deleted_at is not null or m.user_id is not null or m.role <> 'child' then raise exception 'invalid_member' using errcode = 'P0001'; end if;
  -- Blokada grupy: dwa równoczesne „Połącz z kontem” nie utworzą dwóch aktywnych kodów tego profilu.
  select join_id into jid from public.groups where id = m.group_id for update;
  if not renew then
    select * into r from public.invites i
      where i.member_id = mid and i.code is not null and i.revoked_at is null and i.expires_at > now() and i.uses < i.max_uses
      order by i.created_at desc limit 1;
    if r.id is not null then
      return jsonb_build_object('invite_id', r.id, 'join_id', jid, 'code', r.code, 'expires_at', r.expires_at, 'max_uses', r.max_uses, 'member_id', mid);
    end if;
  end if;
  update public.invites set revoked_at = now() where member_id = mid and revoked_at is null;
  -- Kolizja skrótu „ID:kod” z dawnym kodem grupy: losujemy ponownie (jak private.issue_join_code).
  for attempt in 1 .. 10 loop
    v_code := private.random_digits(private.join_code_digits());
    begin
      insert into public.invites (group_id, token_hash, role, created_by, expires_at, max_uses, kind, member_id, code)
        values (m.group_id, private.token_hash(jid || ':' || v_code), 'child', private.my_member_id(m.group_id),
                now() + make_interval(hours => private.join_code_ttl_hours()), 1, 'code', mid, v_code)
        returning * into r;
      return jsonb_build_object('invite_id', r.id, 'join_id', jid, 'code', v_code, 'expires_at', r.expires_at, 'max_uses', r.max_uses, 'member_id', mid);
    exception when unique_violation then
      if attempt = 10 then raise; end if;
    end;
  end loop;
end $$;

/** „Połącz z kontem” (owner/admin): bieżący ważny kod tego profilu dziecka albo nowy. */
create function public.create_child_code(member_id uuid) returns jsonb
language sql security invoker set search_path = '' as $$ select private.issue_child_code(member_id, false) $$;
/** „Nowy kod” przy profilu dziecka: poprzedni przestaje działać. */
create function public.renew_child_code(member_id uuid) returns jsonb
language sql security invoker set search_path = '' as $$ select private.issue_child_code(member_id, true) $$;

-- ───────────────────────── Przyjęcie zaproszenia ─────────────────────────
-- Zastępuje wersję z 20261008362000_join_codes_v2.sql. Zmiany (reszta bez zmian): kod przypięty do profilu dziecka
-- (invites.member_id) łączy konto z tym profilem zamiast tworzyć nowy wiersz członka:
--  * konto, które jest albo było w tej grupie, nie łączy się z profilem ('invite_child_account') — np. rodzic wpisał kod
--    dziecka na swoim telefonie; kod się nie zużywa;
--  * profil usunięty albo już połączony z kontem: kod nie działa ('invite_revoked' — poproś o nowy);
--  * imię wpisane przy dołączaniu zastępuje imię profilu (jak przy powrocie, R-25).
create or replace function private.accept_invite(token text, display_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  h bytea := private.token_hash(token);
  inv public.invites;
  m public.group_members;
  target public.group_members;
  given text := nullif(btrim(display_name), '');
  name text := coalesce(given, (select p.display_name from public.profiles p where p.user_id = me), 'Ja');
begin
  if me is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  -- Blokada wiersza zaproszenia: równoczesne przyjęcia nie przekroczą limitu użyć.
  select * into inv from public.invites where token_hash = h for update;
  if inv.id is null then raise exception 'invite_invalid' using errcode = 'P0001'; end if;
  -- Kod do ID grupy tylko przez join_group (limit prób, D93); długi token tylko tą drogą.
  if (inv.kind = 'code') <> (coalesce(current_setting('organizer.join_code', true), '') = '1') then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;
  select * into m from public.group_members where group_id = inv.group_id and user_id = me;
  if m.member_id is not null and m.deleted_at is not null and m.removed_at is not null and inv.created_at <= m.removed_at then
    raise exception 'invite_removed' using errcode = 'P0001';
  end if;
  if inv.revoked_at is not null then raise exception 'invite_revoked' using errcode = 'P0001'; end if;
  if inv.expires_at <= now() then raise exception 'invite_expired' using errcode = 'P0001'; end if;
  if inv.member_id is not null and m.member_id is not null then raise exception 'invite_child_account' using errcode = 'P0001'; end if;
  -- Już jestem aktywnym członkiem: przyjęcie jest bezskutkowe (nie zużywa użycia, nie zmienia roli).
  if m.member_id is not null and m.deleted_at is null then
    return jsonb_build_object('group_id', inv.group_id, 'member_id', m.member_id, 'already_member', true);
  end if;
  if inv.uses >= inv.max_uses then raise exception 'invite_used_up' using errcode = 'P0001'; end if;
  if private.valid_invite(h) is null then raise exception 'invite_invalid' using errcode = 'P0001'; end if;

  if inv.member_id is not null then
    select * into target from public.group_members where member_id = inv.member_id for update;
    if target.group_id <> inv.group_id or target.deleted_at is not null or target.user_id is not null or target.role <> 'child' then
      raise exception 'invite_revoked' using errcode = 'P0001';
    end if;
  end if;

  perform set_config('organizer.invite_hash', encode(h, 'hex'), true);
  if inv.member_id is not null then
    -- PW-14 B: konto dziecka przejmuje profil — ten sam member_id, więc plan lekcji, zadania i obecność zostają.
    update public.group_members set user_id = me, display_name = coalesce(left(given, 100), target.display_name)
      where member_id = target.member_id returning * into m;
  elsif m.member_id is null then
    insert into public.group_members (member_id, group_id, user_id, display_name, role)
      values (gen_random_uuid(), inv.group_id, me, left(name, 100), inv.role)
      returning * into m;
  else
    -- Powrót po wyjściu z grupy: ten sam member_id, więc stare przypisania i historia wracają do tej osoby.
    -- D138: dziecko zostaje dzieckiem (zaproszenie nie podnosi roli). R-25: imię z żądania, jeśli podane.
    update public.group_members set deleted_at = null, role = case when m.role = 'child' then 'child' else inv.role end,
      display_name = coalesce(left(given, 100), m.display_name)
      where member_id = m.member_id returning * into m;
  end if;
  perform set_config('organizer.invite_hash', '', true);
  update public.invites set uses = uses + 1 where id = inv.id;
  return jsonb_build_object('group_id', inv.group_id, 'member_id', m.member_id, 'already_member', false);
end $$;

-- Zastępuje wersję z 20261008362000_join_codes_v2.sql. Jedyna zmiana: 'invite_child_account' przechodzi na zewnątrz
-- (komunikat „wpisz kod na telefonie dziecka”) — dostaje go tylko ktoś, kto zna ważne ID i kod, więc nie zdradza grupy.
create or replace function private.join_group(p_join_id text, p_code text, p_display_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  jid text := regexp_replace(coalesce(p_join_id, ''), '\D', '', 'g');
  code text := regexp_replace(coalesce(p_code, ''), '\D', '', 'g');
  res jsonb;
  err text;
begin
  if me is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtext('organizer.join_user'), hashtext(me::text));
  perform pg_advisory_xact_lock(hashtext('organizer.join_id'), hashtext(jid));
  if (select count(*) from private.join_attempts where user_id = me and at > now() - interval '1 hour') >= private.join_fails_per_user() then
    return jsonb_build_object('error', 'rate_limited');
  end if;
  -- Tylko bieżące ID grupy (po zmianie ID stare nie prowadzi nigdzie).
  if not exists (select 1 from public.groups where join_id = jid and deleted_at is null) then
    err := 'invite_invalid';
  else
    begin
      perform set_config('organizer.join_code', '1', true);
      res := private.accept_invite(jid || ':' || code, p_display_name);
      perform set_config('organizer.join_code', '', true);
    exception when sqlstate 'P0001' then
      err := sqlerrm;
    end;
  end if;
  if err is null then return res; end if;
  insert into private.join_attempts (user_id, join_id) values (me, jid);
  -- Kody tej grupy, które od utworzenia zebrały limit nieudanych prób, przestają działać. Próby starsze niż doba czyści
  -- daily_maintenance, a kod żyje 24 h (join_code_ttl_hours), więc liczą się wszystkie z jego życia.
  update public.invites i set revoked_at = now()
    from public.groups g
    where g.join_id = jid and i.group_id = g.id and i.kind = 'code' and i.revoked_at is null and i.expires_at > now()
      and (select count(*) from private.join_attempts a where a.join_id = jid and a.at >= i.created_at) >= private.join_fails_per_code();
  -- Na zewnątrz jeden kod błędu: nie zdradzamy, czy istnieje grupa o tym ID.
  return jsonb_build_object('error', case when err in ('invite_expired', 'invite_revoked', 'invite_used_up', 'invite_removed', 'invite_child_account') then err else 'invite_invalid' end);
end $$;

-- ───────────────────────── Strażnik członkostw ─────────────────────────
-- Zastępuje wersję z 20261008360000_member_names_roles.sql. Zmiany (reszta bez zmian):
--  * połączenie profilu dziecka z kontem: jedyna droga zmiany user_id, tylko z ważnym kodem tego profilu (accept_invite);
--  * dziecko nie wychodzi samo z grupy (PW-14 B) — 'forbidden:child'; usunięcie konta nie przechodzi przez ten warunek
--    (wyzwalacz usunięcia działa bez auth.uid(), jak dotąd);
--  * rolę zmienia tylko owner (PW-14 B, audyt 2 R-14) — admin dostaje 'forbidden:role'; usuwanie i przywracanie
--    członków i dzieci przez admina bez zmian.
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
    if inv.id is not null and new.group_id = inv.group_id and new.user_id = me and new.deleted_at is null then
      if inv.member_id is null
         and (new.role = inv.role or (tg_op = 'UPDATE' and old.role = 'child' and new.role = 'child'))
         and (tg_op = 'INSERT' or old.user_id = me) then
        return new;
      end if;
      -- PW-14 B: kod profilu dziecka — ten profil (bez konta, żywy) dostaje moje konto i zostaje dzieckiem.
      if inv.member_id is not null and tg_op = 'UPDATE' and old.member_id = inv.member_id and old.user_id is null
         and old.deleted_at is null and old.role = 'child' and new.role = 'child' then
        return new;
      end if;
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
      -- Wyjście z grupy (każdy poza ownerem — owner najpierw przekazuje grupę — i poza dzieckiem: PW-14 B, dziecko
      -- wypisuje owner albo admin).
      if old.role = 'child' then raise exception 'forbidden:child' using errcode = 'P0001'; end if;
    elsif actor_role = 'owner' then
      if old.role = 'owner' and old.user_id = me then
        raise exception 'forbidden:owner_cannot_demote_self' using errcode = 'P0001';
      end if;
      if new.role = 'owner' then raise exception 'forbidden:role' using errcode = 'P0001'; end if;
    elsif actor_role = 'admin' then
      -- PW-14 B: rolę zmienia tylko owner; admin usuwa i przywraca członków i dzieci.
      if new.role is distinct from old.role or old.role in ('owner', 'admin') then
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

-- ───────────────────────── Sygnał dostępu przy połączeniu profilu ─────────────────────────
-- Zastępuje wersję z 20261006120000_core.sql. Jedyna zmiana: profil dziecka połączony z kontem (user_id z NULL na konto)
-- to nowy dostęp tego konta — telefon dziecka dostaje sygnał i pobiera grupę, jak po dołączeniu.
create or replace function private.group_members_access_event() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is null then return null; end if;
  if tg_op = 'INSERT' or (old.deleted_at is not null and new.deleted_at is null) or (old.user_id is null and new.deleted_at is null) then
    insert into private.access_events (user_id, group_id, kind) values (new.user_id, new.group_id, 'group_granted');
  elsif old.deleted_at is null and new.deleted_at is not null then
    insert into private.access_events (user_id, group_id, kind) values (new.user_id, new.group_id, 'group_revoked');
  else
    return null;
  end if;
  perform realtime.send(jsonb_build_object('access', true), 'poke', 'user:' || new.user_id, true);
  return null;
end $$;

revoke all on all functions in schema private from public, anon;
grant execute on function private.rrule_ok(text) to authenticated;
revoke all on function public.create_child_code(uuid), public.renew_child_code(uuid) from public, anon;
grant execute on function public.create_child_code(uuid), public.renew_child_code(uuid), private.issue_child_code(uuid, boolean) to authenticated;
