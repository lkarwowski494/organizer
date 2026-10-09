-- Audyt 3, paczka PK-10: zaproszenia i dołączanie. Testy: supabase/tests/invites_membership.test.sql.
--  * N-38 (A3-08-1): „Zaproś” po usunięciu kogoś z grupy daje nowy kod — bieżący kod tej roli tylko wtedy, gdy powstał po
--    ostatnim usunięciu osoby (dotąd usunięta osoba, której wysłano „nowe” zaproszenie, dostawała ten sam kod i błąd
--    invite_removed). Starszy ważny kod działa dalej dla innych (np. babcia ma go od wczoraj) — „Nowy kod” unieważnia
--    wszystkie kody tej roli jak dotąd.
--  * N-39 (A3-08-2, A3-06-5), decyzja Q7 A: kod roli należy do grupy (jeden wspólny kod, widzą go owner i admin). Odejście,
--    usunięcie albo utrata roli admina nie unieważnia kodów ról, tylko zaproszenia osobiste tej osoby: kody profili dzieci,
--    które wystawiła, i dawne linki z tokenem (każdy był tylko jej). Wcześniej usunięcie admina unieważniało kod rozesłany
--    przez właściciela, a admin, który sam wyszedł albo stracił rolę, zostawiał działające kody dzieci i linki.
--    Usunięcie konta nadal unieważnia wszystkie zaproszenia, które ta osoba wystawiła (polityka prywatności;
--    private.delete_account_data i private.delete_account_trash bez zmian).
--  * N-157 (A3-08-7): odpowiedź „już jesteś w tej grupie” podaje moją rolę i rolę kodu (role, invite_role), żeby telefon
--    powiedział, że kod administratora nie zmienia roli członka.
--  * N-158 (A3-08-8): aktywny członek, który wpisze stary (unieważniony albo wygasły) kod swojej grupy, dostaje
--    „już jesteś w tej grupie” zamiast błędu i nie traci próby z limitu.
--  * N-90 (A3-05-6): dołączenie (nowa osoba, powrót, połączenie profilu dziecka), przekazanie własności i nocne sprzątanie,
--    które zmieniło wiersze, wysyłają sygnał grupie (Realtime, sam numer wersji) — pozostali widzą zmianę od razu.
-- Zastępuje: private.issue_join_code (20261008362000_join_codes_v2), private.accept_invite (20261008440000_child_account),
-- private.group_members_departure (20261008361000_member_departure), private.transfer_ownership (20261008090000_groups_edit),
-- private.purge_group (20261008570000_my_scopes_trips). Nowe: private.group_members_role_invites + wyzwalacz
-- group_members_y_role_invites. create or replace zachowuje uprawnienia.

-- ───────────────────────── „Zaproś” i „Nowy kod” (N-38) ─────────────────────────
create or replace function private.issue_join_code(gid uuid, inv_role text, renew boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_role text := coalesce(inv_role, 'member');
  jid text;
  v_code text;
  r public.invites;
  last_removal timestamptz;
begin
  if coalesce(private.my_role(gid), '') not in ('owner', 'admin') then raise exception 'forbidden' using errcode = 'P0001'; end if;
  if (select kind from public.groups where id = gid) <> 'shared' then raise exception 'forbidden:personal_group' using errcode = 'P0001'; end if;
  if v_role not in ('admin', 'member') then raise exception 'invalid_value:role' using errcode = 'P0001'; end if;
  if v_role = 'admin' and coalesce(private.my_role(gid), '') <> 'owner' then raise exception 'forbidden:role' using errcode = 'P0001'; end if;
  -- Blokada grupy: dwa równoczesne „Zaproś” nie utworzą dwóch nowych kodów tej samej roli.
  select join_id into jid from public.groups where id = gid for update;
  if not renew then
    -- N-38: osoba usunięta z grupy wraca tylko kodem wystawionym po usunięciu (accept_invite: invite_removed), więc
    -- „Zaproś” pokazuje bieżący kod tylko, gdy jest od niego młodszy (removed_at mają tylko osoby z kontem).
    select max(m.removed_at) into last_removal from public.group_members m
      where m.group_id = gid and m.deleted_at is not null and m.removed_at is not null;
    select * into r from public.invites i
      where i.group_id = gid and i.kind = 'code' and i.role = v_role and i.code is not null
        and i.revoked_at is null and i.expires_at > now() and i.uses < i.max_uses
        and (last_removal is null or i.created_at > last_removal)
      order by i.created_at desc limit 1;
    if r.id is not null then
      return jsonb_build_object('invite_id', r.id, 'join_id', jid, 'code', r.code, 'expires_at', r.expires_at, 'max_uses', r.max_uses);
    end if;
  end if;
  -- „Nowy kod” unieważnia wszystkie poprzednie tej roli: jeden aktywny. „Zaproś” zostawia ważny kod sprzed usunięcia
  -- osoby (działa dla innych; najwyżej doba, join_code_ttl_hours), a unieważnia — jak dotąd — wygasłe, wykorzystane
  -- i te, których nie da się pokazać (sprzed zapisu jawnego kodu). Zgadywanie: limit nieudanych prób liczy się na kod, więc szansa trafienia
  -- któregoś z k aktywnych kodów grupy ≤ k × 100 / 10^6 (rachunek z 20261008362000; k rośnie o 1 na usunięcie w ciągu doby).
  update public.invites set revoked_at = now()
    where group_id = gid and kind = 'code' and role = v_role and revoked_at is null
      and (renew or code is null or expires_at <= now() or uses >= max_uses);
  -- Skrót „ID:kod” jest unikalny w całej tabeli, także dla dawnych kodów grupy: przy kolizji losujemy ponownie (jak dotąd).
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

-- ───────────────────────── Przyjęcie zaproszenia (N-157, N-158, N-90) ─────────────────────────
-- Zmiany względem 20261008440000_child_account (reszta bez zmian):
--  * aktywny członek dostaje already_member przed sprawdzeniem ważności kodu (N-158) — poza kodem profilu dziecka, który
--    zostaje błędem invite_child_account (wpisany na telefonie rodzica);
--  * odpowiedź podaje role (moja rola w grupie) i invite_role (rola kodu) (N-157);
--  * po dołączeniu sygnał grupie (N-90) — po wstawieniu członka jestem w grupie, więc private.poke_groups go wyśle.
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
  -- Już jestem aktywnym członkiem: przyjęcie jest bezskutkowe (nie zużywa użycia, nie zmienia roli), także starym kodem
  -- (N-158). Kod profilu dziecka — niżej (invite_child_account).
  if inv.member_id is null and m.member_id is not null and m.deleted_at is null then
    return jsonb_build_object('group_id', inv.group_id, 'member_id', m.member_id, 'already_member', true, 'role', m.role, 'invite_role', inv.role);
  end if;
  if inv.revoked_at is not null then raise exception 'invite_revoked' using errcode = 'P0001'; end if;
  if inv.expires_at <= now() then raise exception 'invite_expired' using errcode = 'P0001'; end if;
  if inv.member_id is not null and m.member_id is not null then raise exception 'invite_child_account' using errcode = 'P0001'; end if;
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
  -- N-90: pozostali członkowie widzą nową osobę od razu (sygnał bez treści, numer wersji grupy).
  perform private.poke_groups(array[inv.group_id]);
  return jsonb_build_object('group_id', inv.group_id, 'member_id', m.member_id, 'already_member', false, 'role', m.role, 'invite_role', inv.role);
end $$;

-- ───────────────────────── Odejście z grupy (N-39, Q7 A) ─────────────────────────
-- Zaproszenia osobiste: kod profilu dziecka (member_id) i dawny link z tokenem (kind 'token') — tych nie widzi nikt poza
-- wystawiającym. Kod roli (kind 'code' bez member_id) jest wspólny dla grupy i zostaje.
create or replace function private.group_members_departure() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    perform set_config('organizer.member_cleanup', new.group_id::text, true);
    update public.handoffs set status = 'cancelled', decided_at = now()
      where group_id = new.group_id and status = 'pending' and (from_member = new.member_id or to_member = new.member_id);
    update public.lists set deleted_at = new.deleted_at
      where group_id = new.group_id and owner_member_id = new.member_id and visibility = 'private' and deleted_at is null;
    perform set_config('organizer.member_cleanup', '', true);
    -- Q7 A: przy każdym odejściu (wyjście albo usunięcie przez kogoś innego) tylko zaproszenia osobiste.
    update public.invites set revoked_at = now()
      where created_by = new.member_id and revoked_at is null and (member_id is not null or kind <> 'code');
  elsif old.deleted_at is not null and new.deleted_at is null then
    perform set_config('organizer.member_cleanup', new.group_id::text, true);
    -- Listy prywatne zmienia tylko ich właściciel, a po wyjściu nikt ich nie widzi: wszystko, co trafiło do kosza od chwili
    -- wyjścia, trafiło tam z powodu wyjścia (wcześniej usunięte przez tę osobę zostają w koszu).
    update public.lists set deleted_at = null
      where group_id = new.group_id and owner_member_id = new.member_id and visibility = 'private' and deleted_at >= old.deleted_at;
    perform set_config('organizer.member_cleanup', '', true);
  end if;
  return null;
end $$;

-- Utrata roli zapraszającego (admin albo owner → member/child): jej zaproszenia osobiste przestają działać, jak przy
-- odejściu (Q7 A) — zaprosić i połączyć profil dziecka może już tylko owner albo admin.
create function private.group_members_role_invites() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.role in ('owner', 'admin') and new.role not in ('owner', 'admin') then
    update public.invites set revoked_at = now()
      where created_by = new.member_id and revoked_at is null and (member_id is not null or kind <> 'code');
  end if;
  return null;
end $$;

create trigger group_members_y_role_invites after update of role on public.group_members
  for each row execute function private.group_members_role_invites();

-- ───────────────────────── Przekazanie własności (N-90) ─────────────────────────
-- Jedyna zmiana względem 20261008090000_groups_edit: sygnał grupie na końcu (nowy właściciel widzi rolę od razu).
create or replace function private.transfer_ownership(gid uuid, to_member uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.my_member_id(gid); t public.group_members;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  perform 1 from public.groups where id = gid and deleted_at is null for update;
  if not found or coalesce(private.my_role(gid), '') <> 'owner' then raise exception 'forbidden' using errcode = 'P0001'; end if;
  select * into t from public.group_members where member_id = to_member and group_id = gid and deleted_at is null;
  -- Nowy właściciel: dorosły z kontem (jak przy przejęciu grupy po usunięciu konta, D49).
  if t.member_id is null or t.user_id is null or t.role not in ('admin', 'member') then
    raise exception 'invalid_member' using errcode = 'P0001';
  end if;
  perform set_config('organizer.ownership_transfer', gid::text, true);
  update public.group_members set role = 'owner' where member_id = to_member;
  update public.group_members set role = 'admin' where member_id = me;
  perform set_config('organizer.ownership_transfer', '', true);
  perform private.poke_groups(array[gid]);
end $$;

-- ───────────────────────── Nocne sprzątanie (N-90) ─────────────────────────
-- Jedyna zmiana względem 20261008570000_my_scopes_trips: gdy sprzątanie podbiło wersję grupy (odpięte zadania, nowa epoka
-- purged_version po usunięciu nagrobków), sygnał grupie — telefony pobierają zmianę od razu, nie po powrocie do aplikacji.
-- Najwyżej jeden sygnał na grupę na noc. Wołający to serwer (pg_cron, bez konta), więc realtime.send wprost, jak
-- private.set_group_trash (private.poke_groups wymaga konta członka).
create or replace function private.purge_group(g uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  horizon timestamptz := now() - make_interval(days => private.tombstone_days());
  act_horizon timestamptz := now() - make_interval(days => private.activity_days());
  handoff_horizon timestamptz := now() - make_interval(days => private.handoff_days());
  trip_horizon timestamptz := now() - make_interval(days => private.trip_days());
  n int := 0;
  k int;
  v bigint;
  top bigint := 0;
  acts int := 0;
  handoffs int := 0;
  unpinned int := 0;
  ev uuid[];
  ser uuid[];
  ids uuid[];
  lst uuid[];
  v_before bigint;
  v_after bigint;
begin
  select version into v_before from public.groups where id = g for update;
  perform set_config('organizer.trash_ok', 'on', true);

  -- M-62: historia starsza niż activity_days().
  with d as (delete from public.activity a where a.group_id = g and a.created_at < act_horizon returning a.version)
    select count(*), coalesce(max(d.version), 0) into k, v from d;
  acts := acts + k; top := greatest(top, v);
  -- M-68: rozstrzygnięte przekazania po handoff_days() od decyzji.
  with d as (delete from public.handoffs h where h.group_id = g and h.status <> 'pending' and h.decided_at < handoff_horizon
             returning h.version)
    select count(*), coalesce(max(d.version), 0) into k, v from d;
  handoffs := k; top := greatest(top, v);
  -- PWD-11 A: zrobione zakupy starsze niż trip_days() i cofnięte (usunięte) po terminie w koszu.
  with d as (delete from public.shopping_trips s where s.group_id = g and (s.done_at < trip_horizon or s.deleted_at < horizon)
             returning s.version)
    select count(*), coalesce(max(d.version), 0) into k, v from d;
  n := n + k; top := greatest(top, v);

  -- Wydarzenia po terminie w koszu (D182). Przypięte zadania (żywe i w koszu) zostają: odpinamy je, a zadanie z terminem
  -- „jak spotkanie” dostaje datę tego terminu (przeniesionego wyjątkiem — datę po przeniesieniu) jako własny termin.
  select coalesce(array_agg(e.id), '{}') into ev from public.events e where e.group_id = g and e.deleted_at < horizon;
  if cardinality(ev) > 0 then
    update public.tasks t set
      deadline_mode = case when t.deadline_mode = 'event' then 'own' else t.deadline_mode end,
      due_date = case when t.deadline_mode = 'event'
                      then coalesce((select o.start_date from public.event_overrides o
                                     where o.event_id = t.event_id and o.occurrence_date = t.occurrence_date
                                       and o.deleted_at is null and not o.cancelled), t.occurrence_date)
                      else t.due_date end,
      event_id = null, occurrence_date = null
    where t.group_id = g and t.event_id = any (ev);
    get diagnostics unpinned = row_count;
  end if;

  -- Definicje stałych zadań do usunięcia: po terminie w koszu, na wydarzeniu albo liście po terminie w koszu. Kopie
  -- (zwykłe zadania) zostają — tracą tylko wskazanie definicji, której już nie ma.
  select coalesce(array_agg(s.id), '{}') into ser from public.event_task_series s
    where s.group_id = g and (s.deleted_at < horizon or s.event_id = any (ev)
      or exists (select 1 from public.lists l where l.id = s.list_id and l.deleted_at < horizon));
  if cardinality(ser) > 0 then
    update public.tasks set series_id = null where group_id = g and series_id = any (ser);
  end if;

  -- Zadania: tylko takie, pod którymi nie ma wiersza, który zostaje (klucz obcy parent_id zawsze przejdzie).
  with recursive keep as (
    select t.id, t.parent_id from public.tasks t
    where t.group_id = g and (t.deleted_at is null or t.deleted_at >= horizon)
    union
    select x.id, x.parent_id from public.tasks x join keep on x.id = keep.parent_id
  )
  select coalesce(array_agg(t.id), '{}') into ids from public.tasks t
  where t.group_id = g and t.deleted_at < horizon and t.id not in (select keep.id from keep);
  if cardinality(ids) > 0 then
    with d as (delete from public.activity a where a.entity = 'tasks' and a.entity_id = any (ids) returning a.version)
      select coalesce(max(d.version), 0) into v from d;
    top := greatest(top, v);
    with d as (delete from public.tasks where id = any (ids) returning version)
      select count(*), coalesce(max(d.version), 0) into k, v from d;
    n := n + k; top := greatest(top, v);
  end if;

  -- Wpisy dostępu do list (historia wpisu: entity_id = osoba, zakres = lista).
  with d as (delete from public.object_members o where o.group_id = g and o.deleted_at < horizon returning o.scope_id, o.member_id, o.version),
       h as (delete from public.activity a using d where a.entity = 'object_members' and a.entity_id = d.member_id and a.scope_id = d.scope_id
             returning a.version)
    select (select count(*) from d), greatest((select coalesce(max(version), 0) from d), (select coalesce(max(version), 0) from h)) into k, v;
  n := n + k; top := greatest(top, v);

  if cardinality(ser) > 0 then
    with d as (delete from public.activity a where a.entity = 'event_task_series' and a.entity_id = any (ser) returning a.version)
      select coalesce(max(d.version), 0) into v from d;
    top := greatest(top, v);
    with d as (delete from public.event_task_series where id = any (ser) returning version)
      select count(*), coalesce(max(d.version), 0) into k, v from d;
    n := n + k; top := greatest(top, v);
  end if;

  -- Listy: po terminie w koszu i bez zadań (zadania listy trafiają do kosza razem z nią, lists_cascade).
  select coalesce(array_agg(l.id), '{}') into lst from public.lists l
    where l.group_id = g and l.deleted_at < horizon
      and not exists (select 1 from public.tasks t where t.list_id = l.id)
      and not exists (select 1 from public.event_task_series s where s.list_id = l.id);
  if cardinality(lst) > 0 then
    with d as (delete from public.activity a where (a.entity = 'lists' and a.entity_id = any (lst)) or a.scope_id = any (lst)
               returning a.version)
      select coalesce(max(d.version), 0) into v from d;
    top := greatest(top, v);
    with d as (delete from public.lists where id = any (lst) returning version)
      select count(*), coalesce(max(d.version), 0) into k, v from d;
    n := n + k; top := greatest(top, v);
  end if;

  -- Wyjątki terminów, odpowiedzi (D124) i uczestnicy: usunięte albo przy wydarzeniu po terminie w koszu.
  with d as (delete from public.event_overrides o where o.group_id = g and (o.deleted_at < horizon or o.event_id = any (ev))
             returning o.id, o.version),
       h as (delete from public.activity a using d where a.entity = 'event_overrides' and a.entity_id = d.id returning a.version)
    select (select count(*) from d), greatest((select coalesce(max(version), 0) from d), (select coalesce(max(version), 0) from h)) into k, v;
  n := n + k; top := greatest(top, v);
  with d as (delete from public.event_rsvps r where r.group_id = g and (r.deleted_at < horizon or r.event_id = any (ev))
             returning r.id, r.version),
       h as (delete from public.activity a using d where a.entity = 'event_rsvps' and a.entity_id = d.id returning a.version)
    select (select count(*) from d), greatest((select coalesce(max(version), 0) from d), (select coalesce(max(version), 0) from h)) into k, v;
  n := n + k; top := greatest(top, v);
  with d as (delete from public.event_participants p where p.group_id = g and (p.deleted_at < horizon or p.event_id = any (ev))
             returning p.id, p.version),
       h as (delete from public.activity a using d where a.entity = 'event_participants' and a.entity_id = d.id returning a.version)
    select (select count(*) from d), greatest((select coalesce(max(version), 0) from d), (select coalesce(max(version), 0) from h)) into k, v;
  n := n + k; top := greatest(top, v);

  if cardinality(ev) > 0 then
    with d as (delete from public.activity a where a.entity = 'events' and a.entity_id = any (ev) returning a.version)
      select coalesce(max(d.version), 0) into v from d;
    top := greatest(top, v);
    -- Seria podzielona „to i następne” wskazuje źródło (split_from, ON DELETE SET NULL) — zostaje bez wskazania.
    with d as (delete from public.events where id = any (ev) returning version)
      select count(*), coalesce(max(d.version), 0) into k, v from d;
    n := n + k; top := greatest(top, v);
  end if;

  if top > 0 then update public.groups set purged_version = greatest(purged_version, top) where id = g; end if;
  perform set_config('organizer.trash_ok', '', true);
  select version into v_after from public.groups where id = g;
  if v_after > v_before then
    perform realtime.send(jsonb_build_object('v', v_after), 'poke', 'group:' || g, true);
  end if;
  return jsonb_build_object('tombstones', n, 'activity', acts, 'handoffs', handoffs, 'unpinned', unpinned);
end $$;
