-- Decyzje właściciela po audycie (ADR 0035, 8.10.2026): D136 (całodniowy pojedynczy termin serii), D138 (dziecko wraca
-- przez zaproszenie jako dziecko), D139 (lista poszerzona do „cała grupa” trafia na telefony) oraz rodzaj wydarzenia
-- (events.kind: zwykłe / lekcja planu / rutyna — D126–D128). Testy: supabase/tests/owner_decisions.test.sql.

-- ───────────────────────── D138: dziecko wraca jako dziecko ─────────────────────────
-- Zastępuje wersję z 20261008250000_join_codes.sql (przyjęcie zaproszenia; join_group woła tę samą funkcję, więc obie
-- drogi — link i ID + kod — działają tak samo). Powrót do istniejącego wiersza z rolą child zachowuje child; rolę
-- zmienia potem tylko owner/admin (strażnik członkostw). Nowe konto i powrót dorosłego — rola z zaproszenia, jak dotąd.
create or replace function private.accept_invite(token text, display_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  h bytea := private.token_hash(token);
  inv public.invites;
  m public.group_members;
  name text := coalesce(nullif(btrim(display_name), ''), (select p.display_name from public.profiles p where p.user_id = me), 'Ja');
begin
  if me is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  -- Blokada wiersza zaproszenia: równoczesne przyjęcia nie przekroczą limitu użyć.
  select * into inv from public.invites where token_hash = h for update;
  if inv.id is null then raise exception 'invite_invalid' using errcode = 'P0001'; end if;
  -- Kod do ID grupy tylko przez join_group (limit prób, D93); długi token tylko tą drogą.
  if (inv.kind = 'code') <> (coalesce(current_setting('organizer.join_code', true), '') = '1') then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;
  if inv.revoked_at is not null then raise exception 'invite_revoked' using errcode = 'P0001'; end if;
  if inv.expires_at <= now() then raise exception 'invite_expired' using errcode = 'P0001'; end if;
  select * into m from public.group_members where group_id = inv.group_id and user_id = me;
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
    -- D138: dziecko zostaje dzieckiem (zaproszenie nie podnosi roli).
    update public.group_members set deleted_at = null, role = case when m.role = 'child' then 'child' else inv.role end
      where member_id = m.member_id returning * into m;
  end if;
  perform set_config('organizer.invite_hash', '', true);
  update public.invites set uses = uses + 1 where id = inv.id;
  return jsonb_build_object('group_id', inv.group_id, 'member_id', m.member_id, 'already_member', false);
end $$;

-- Zastępuje wersję z 20261008280000_audit_fixes.sql. Jedyna zmiana: gałąź zaproszenia przepuszcza też powrót dziecka
-- z rolą child (D138) — poza nią przywrócenie konta jest odrzucane (audyt 8.10.2026, #5).
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
    if new.role = 'owner' then raise exception 'forbidden:role' using errcode = 'P0001'; end if;
    return new;
  end if;

  if new.user_id is distinct from old.user_id then raise exception 'immutable_column:user_id' using errcode = 'P0001'; end if;
  if new.member_id is distinct from old.member_id then raise exception 'immutable_column:member_id' using errcode = 'P0001'; end if;
  -- Audyt 8.10.2026 (#5): konto wraca do grupy wyłącznie samo, przez zaproszenie (zgoda tej osoby).
  if old.deleted_at is not null and new.deleted_at is null and old.user_id is not null then
    raise exception 'forbidden:user_requires_invite' using errcode = 'P0001';
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

  if (new.display_name, new.color) is distinct from (old.display_name, old.color)
     and actor_role not in ('owner', 'admin') and not is_self then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- ───────────────────────── D139: lista poszerzona do „cała grupa” ─────────────────────────
-- Po zmianie widoczności z restricted/private na group osoby, które dotąd nie widziały listy, dostawały tylko wiersz
-- listy: jej zadania, definicje stałych zadań, wpisy dostępu i historia miały stare wersje (≤ kursor), a sync_pull
-- podaje w „scopes” tylko listy ukryte, więc telefon nie wołał sync_fetch_scope. Wybór: podbić wersje tych wierszy
-- w tej samej transakcji — zwykłe pobranie grupy (wersja > kursor, RLS już je pokazuje) dowozi je bez zmian w telefonie.
-- To samo naprawia telefon właściciela i osób z listy dozwolonych: lista znika z „scopes”, więc telefon czyści jej
-- wiersze lokalnie (utracony zakres) i dostaje je z powrotem w tej samej odpowiedzi.
-- Odrzucona alternatywa: zdarzenie dostępu (scope_granted) dla każdego członka i „scopes” także dla list poszerzonych —
-- wymagałoby zmiany telefonu (fetchScopes bierze tylko listy z „scopes”, które z definicji są ukryte).
-- Podbicie bez szumu: zapis bez zmiany kolumn nie tworzy wpisu aktywności (log_activity pomija samą wersję); wpisy
-- aktywności (bez wyzwalaczy) dostają nowy numer wprost. Wpisy dostępu tylko aktywne i aktywnych członków — reszta jest
-- bez znaczenia przy liście „group”, a strażnik odrzuciłby zapis dawnego członka.
create function private.lists_widen_bump() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.visibility <> 'group' and new.visibility = 'group' then
    update public.tasks set version = version where list_id = new.id;
    update public.event_task_series set version = version where list_id = new.id;
    update public.object_members om set version = om.version
      where om.scope_entity = 'lists' and om.scope_id = new.id and om.deleted_at is null
        and exists (select 1 from public.group_members m where m.member_id = om.member_id and m.deleted_at is null);
    update public.activity set version = private.bump_group_version(group_id) where scope_id = new.id;
  end if;
  return null;
end $$;

create trigger lists_f_widen_bump after update of visibility on public.lists
  for each row execute function private.lists_widen_bump();

-- ───────────────────────── D136: całodniowy pojedynczy termin serii ─────────────────────────
-- all_day = true: ten termin jest całodniowy — telefon pomija start_time i end_time wyjątku (i serii). Godziny zostają
-- w wierszu (ograniczenie event_overrides_end_after_start dotyczy tylko ich wzajemnego porządku, więc nie koliduje),
-- dzięki czemu zdjęcie znacznika przywraca poprzednie godziny.
alter table public.event_overrides add column all_day boolean not null default false;
grant insert (all_day), update (all_day) on public.event_overrides to authenticated;
update private.sync_entities
   set insert_cols = insert_cols || '{all_day}', patch_cols = patch_cols || '{all_day}'
 where entity = 'event_overrides';

-- ───────────────────────── Rodzaj wydarzenia (D126–D128) ─────────────────────────
-- event = zwykłe wydarzenie, lesson = lekcja planu zajęć, routine = rutyna (RoutineScreen) — zwykłe wydarzenie też może
-- mieć stałe zadania serii, więc rodzaju nie da się wywnioskować. Ustawiany tylko przy tworzeniu (lekcja zostaje lekcją):
-- GRANT insert i insert_cols, bez update i patch_cols. Istniejące wiersze: 'event' (wartość domyślna).
alter table public.events add column kind text not null default 'event' check (kind in ('event', 'lesson', 'routine'));
grant insert (kind) on public.events to authenticated;
update private.sync_entities set insert_cols = insert_cols || '{kind}' where entity = 'events';

revoke all on all functions in schema private from public, anon;
grant execute on function private.rrule_ok(text) to authenticated;
