-- Audyt 2 (8.10.2026): zaproszenia. Testy: supabase/tests/join_codes_v2.test.sql.
--  * Jeden aktywny kod na grupę i rolę — decyzja właściciela z 8.10.2026 (PW-41 A): „Zaproś” pokazuje bieżący ważny kod
--    (nowy tylko, gdy ważnego nie ma), „Nowy kod” tworzy kolejny i unieważnia poprzedni tej roli.
--  * Kolizja skrótu z dawnym kodem grupy: losujemy ponownie (M-71, B-8; dotąd błąd 23505).
--  * Osoba usunięta z grupy wraca tylko z zaproszenia wystawionego po usunięciu (PW-6 A, D152) — błąd invite_removed.
--  * Imię wpisane przy powrocie do grupy zastępuje dawne (M-226, R-25).
--  * D140 odwrócona (8.10.2026): cudze nieudane próby nie blokują poprawnego kodu; limit prób tylko na konto, a kod po
--    private.join_fails_per_code() nieudanych próbach na ID grupy przestaje działać (zgadywanie ograniczone na cały czas
--    życia kodu).

-- ───────────────────────── Limity prób (D140 odwrócona, D93) ─────────────────────────
-- Każda nieudana próba na ID grupy to jeden strzał w aktywne kody tej grupy (najwyżej dwa: członka i admina, PW-41 A).
-- Kod, który od utworzenia zebrał 100 nieudanych prób na swoje ID grupy, jest unieważniany (zapraszający tworzy nowy
-- jednym dotknięciem), więc szansa odgadnięcia danego kodu w całym jego życiu ≤ 100 / 10^6 = 0,01%, a któregoś z dwóch
-- ≤ 0,02% (rachunek, szczebel 1; dotąd ≤ 480 / 10^6 = 0,048% na kod, ADR 0020). Koszt zepsucia komuś kodu: 100 nieudanych
-- prób = 20 kont × 1 h przy limicie 5 prób na konto na godzinę (private.join_fails_per_user(), bez zmian) — a skutkiem jest
-- tylko prośba o nowy kod, nie blokada dołączania wszystkim (jak przy limicie 20 prób na ID grupy na godzinę).
-- config.invites.JOIN_FAILS_PER_CODE (test kontraktowy). Wybór projektowy w granicach rachunku wyżej.
create function private.join_fails_per_code() returns int language sql immutable as $$ select 100 $$;

-- Kod w jawnej postaci, żeby „Zaproś” mógł pokazać bieżący kod (także na drugim telefonie). Skrót „ID:kod” zostaje kluczem
-- przyjęcia jak dotąd. Bezpieczeństwo bez zmian: kodów jest 10^6, więc sam skrót SHA-256 bez sekretu i tak nie chronił
-- kodu przy wycieku bazy (audyt 2, B-20) — chroni go tylko czas ważności i limit prób. Kolumny nie ma w uprawnieniach
-- SELECT (migracja invites) — czyta ją wyłącznie funkcja niżej. Długich tokenów (stare linki) nie zapisujemy.
alter table public.invites add column code text;

-- Wspólne wejście „Zaproś” i „Nowy kod”. Uprawnienia jak private.insert_invite, sprawdzone przed odczytem bieżącego kodu
-- (inaczej admin dostałby kod admina wystawiony przez ownera).
create function private.issue_join_code(gid uuid, inv_role text, renew boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_role text := coalesce(inv_role, 'member');
  jid text;
  v_code text;
  r public.invites;
begin
  if coalesce(private.my_role(gid), '') not in ('owner', 'admin') then raise exception 'forbidden' using errcode = 'P0001'; end if;
  if (select kind from public.groups where id = gid) <> 'shared' then raise exception 'forbidden:personal_group' using errcode = 'P0001'; end if;
  if v_role not in ('admin', 'member') then raise exception 'invalid_value:role' using errcode = 'P0001'; end if;
  if v_role = 'admin' and coalesce(private.my_role(gid), '') <> 'owner' then raise exception 'forbidden:role' using errcode = 'P0001'; end if;
  -- Blokada grupy: dwa równoczesne „Zaproś” nie utworzą dwóch aktywnych kodów tej samej roli.
  select join_id into jid from public.groups where id = gid for update;
  if not renew then
    select * into r from public.invites i
      where i.group_id = gid and i.kind = 'code' and i.role = v_role and i.code is not null
        and i.revoked_at is null and i.expires_at > now() and i.uses < i.max_uses
      order by i.created_at desc limit 1;
    if r.id is not null then
      return jsonb_build_object('invite_id', r.id, 'join_id', jid, 'code', r.code, 'expires_at', r.expires_at, 'max_uses', r.max_uses);
    end if;
  end if;
  -- Nowy kod unieważnia wszystkie poprzednie tej roli (także sprzed tej migracji, bez zapisanego kodu): jeden aktywny.
  update public.invites set revoked_at = now() where group_id = gid and kind = 'code' and role = v_role and revoked_at is null;
  -- Skrót „ID:kod” jest unikalny w całej tabeli, także dla dawnych kodów grupy: przy kolizji losujemy ponownie. Przy 3000
  -- dawnych kodów kolizja to 0,3% na próbę, więc 10 prób z rzędu bez wolnego kodu praktycznie się nie zdarzy (~10^-25),
  -- a pętla ma koniec.
  for attempt in 1 .. 10 loop
    v_code := private.random_digits(private.join_code_digits());
    begin
      r := private.insert_invite(gid, v_role, private.join_code_ttl_hours(), private.invite_max_uses_limit(), jid || ':' || v_code, 'code');
      update public.invites set code = v_code where id = r.id;
      return jsonb_build_object('invite_id', r.id, 'join_id', jid, 'code', v_code, 'expires_at', r.expires_at, 'max_uses', r.max_uses);
    exception when unique_violation then
      if attempt = 10 then raise; end if;
    end;
  end loop;
end $$;

-- Zastępuje wersję z 20261008250000_join_codes.sql: bieżący ważny kod tej roli albo nowy.
create or replace function private.create_join_code(gid uuid, inv_role text) returns jsonb
language sql security definer set search_path = '' as $$ select private.issue_join_code(gid, inv_role, false) $$;

/** „Nowy kod” (owner/admin): nowy kod tej roli; poprzedni przestaje działać. */
create function public.renew_join_code(group_id uuid, role text default 'member') returns jsonb
language sql security invoker set search_path = '' as $$ select private.issue_join_code(group_id, role, true) $$;

-- ───────────────────────── Przyjęcie zaproszenia ─────────────────────────
-- Zastępuje wersję z 20261008300000_owner_decisions.sql. Zmiany (reszta bez zmian):
--  * PW-6 A, D152: osoba usunięta z grupy przez kogoś innego (group_members.removed_at, migracja 20261008360000) wraca
--    tylko z zaproszenia wystawionego po usunięciu — inne kończą się 'invite_removed' (przed innymi błędami zaproszenia, żeby
--    komunikat mówił, co zrobić). Samodzielne wyjście — jak dotąd.
--  * R-25: przy powrocie imię z żądania, jeśli podane (dotąd zostawało dawne).
create or replace function private.accept_invite(token text, display_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  h bytea := private.token_hash(token);
  inv public.invites;
  m public.group_members;
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
  -- Już jestem aktywnym członkiem: przyjęcie jest bezskutkowe (nie zużywa użycia, nie zmienia roli).
  if m.member_id is not null and m.deleted_at is null then
    return jsonb_build_object('group_id', inv.group_id, 'member_id', m.member_id, 'already_member', true);
  end if;
  if inv.uses >= inv.max_uses then raise exception 'invite_used_up' using errcode = 'P0001'; end if;
  if private.valid_invite(h) is null then raise exception 'invite_invalid' using errcode = 'P0001'; end if;

  perform set_config('organizer.invite_hash', encode(h, 'hex'), true);
  if m.member_id is null then
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

-- Zastępuje wersję z 20261008280000_audit_fixes.sql. Zmiany: (1) D140 odwrócona — bez limitu na ID grupy (20 cudzych
-- nieudanych prób blokowało na godzinę także poprawny kod); w zamian kod unieważniany po join_fails_per_code() nieudanych
-- próbach na jego ID grupy od utworzenia (wyżej); limit na konto bez zmian; (2) 'invite_removed' przechodzi na zewnątrz
-- (komunikat „poproś o nowe zaproszenie”) — dostaje go tylko ktoś, kto zna ważne ID i kod, więc nie zdradza istnienia grupy.
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
  return jsonb_build_object('error', case when err in ('invite_expired', 'invite_revoked', 'invite_used_up', 'invite_removed') then err else 'invite_invalid' end);
end $$;

-- Limit prób na ID grupy zastąpiony limitem na kod (wyżej); config.invites.JOIN_FAILS_PER_GROUP usunięty razem z nim.
drop function private.join_fails_per_group();

revoke all on all functions in schema private from public, anon;
grant execute on function private.rrule_ok(text) to authenticated;
revoke all on function public.renew_join_code(uuid, text) from public, anon;
grant execute on function public.renew_join_code(uuid, text), private.issue_join_code(uuid, text, boolean) to authenticated;
