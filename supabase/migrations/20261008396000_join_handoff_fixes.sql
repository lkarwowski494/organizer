-- Audyt 2, paczka P16: poprawki dołączania i przekazań terminu.
--  M-182 (B-13): prawdziwy komentarz o tym, co zdradzają kody błędów join_group (zachowanie bez zmian).
--  M-70: przy limicie grup na konto join_group zwraca limit:groups (komunikat na telefonie) i nie liczy tego jako nieudanej
--        próby kodu.
--  Przekazanie jednego terminu (zgłoszenia P3/P10): osoba odpowiedzialna za termin uwzględnia „nikt konkretny”
--  (event_overrides.responsible_cleared, 20261008320000), a przyjęcie zapisuje wyjątek z identyfikatorem jak na telefonie
--  (UUIDv5, overrideId) — bez wyścigu 23505.
-- Zastępuje: private.join_group (20261008362000_join_codes_v2.sql), private.handoffs_guard (20261008361000_member_departure.sql).
-- Testy: supabase/tests/quotas.test.sql (limit grup), supabase/tests/handoff_override.test.sql.

-- Osoba odpowiedzialna za termin serii: bez wyjątku — osoba serii; wyjątek z osobą — ta osoba; wyjątek „nikt konkretny”
-- (responsible_cleared) — nikt; wyjątek bez osoby i bez zaznaczenia — osoba serii. Ta sama reguła co na telefonie.
create function private.occurrence_responsible(e public.events, d date) returns uuid
language sql stable security definer set search_path = '' as $$
  select case
    when d is null then e.responsible_member_id
    when not exists (select 1 from public.event_overrides o where o.event_id = e.id and o.occurrence_date = d and o.deleted_at is null)
      then e.responsible_member_id
    else (select coalesce(o.responsible_member_id, case when o.responsible_cleared then null else e.responsible_member_id end)
          from public.event_overrides o where o.event_id = e.id and o.occurrence_date = d and o.deleted_at is null) end
$$;

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
  -- Limit grup na konto (M-70): poprawny kod, więc to nie jest nieudana próba.
  if err = 'limit:groups' then return jsonb_build_object('error', err); end if;
  insert into private.join_attempts (user_id, join_id) values (me, jid);
  -- Kody tej grupy, które od utworzenia zebrały limit nieudanych prób, przestają działać. Próby starsze niż doba czyści
  -- daily_maintenance, a kod żyje 24 h (join_code_ttl_hours), więc liczą się wszystkie z jego życia.
  update public.invites i set revoked_at = now()
    from public.groups g
    where g.join_id = jid and i.group_id = g.id and i.kind = 'code' and i.revoked_at is null and i.expires_at > now()
      and (select count(*) from private.join_attempts a where a.join_id = jid and a.at >= i.created_at) >= private.join_fails_per_code();
  -- Na zewnątrz: nieznane ID grupy i zły kod dają ten sam błąd invite_invalid (nie zdradzamy, czy grupa o tym ID istnieje).
  -- Szczegółowe kody (wygasł, unieważniony, wykorzystany, usunięto Cię) dostaje tylko ktoś, kto trafił w prawdziwy kod
  -- tej grupy — wie wtedy, że grupa istnieje albo istniała; to akceptowane, bo kod daje i tak więcej (audyt 2, M-182, B-13).
  return jsonb_build_object('error', case when err in ('invite_expired', 'invite_revoked', 'invite_used_up', 'invite_removed') then err else 'invite_invalid' end);
end $$;

create or replace function private.handoffs_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  me uuid;
  t public.tasks;
  e public.events;
  l public.lists;
  current_responsible uuid;
  tid uuid;
  moved int := 0;
  n int;
begin
  if (select auth.uid()) is null then return new; end if;
  -- Sprzątanie po osobie, która wyszła albo wróciła (private.group_members_departure, migracja 20261008361000).
  if current_setting('organizer.member_cleanup', true) = new.group_id::text then return new; end if;
  me := private.my_member_id(new.group_id);
  if me is null then raise exception 'forbidden' using errcode = 'P0001'; end if;
  if private.my_role(new.group_id) = 'child' then raise exception 'forbidden:child' using errcode = 'P0001'; end if;

  if tg_op = 'INSERT' then
    new.from_member := me;
    new.status := 'pending';
    new.closed := false;
    new.decided_at := null;
    if new.to_member = me then raise exception 'invalid_member' using errcode = 'P0001'; end if;
    if not exists (select 1 from public.group_members m where m.member_id = new.to_member and m.group_id = new.group_id
                   and m.deleted_at is null and m.role <> 'child' and m.user_id is not null) then
      raise exception 'invalid_member' using errcode = 'P0001';
    end if;
    if new.entity = 'tasks' then
      select * into t from public.tasks where id = new.entity_id;
      if t.id is null or t.group_id <> new.group_id or t.deleted_at is not null then raise exception 'invalid_entity' using errcode = 'P0001'; end if;
      if t.assignee_member_id is distinct from me then raise exception 'forbidden:not_responsible' using errcode = 'P0001'; end if;
      if not private.member_can_see_list(new.to_member, t.list_id) then raise exception 'invalid_member' using errcode = 'P0001'; end if;
    elsif new.entity = 'lists' then
      select * into l from public.lists where id = new.entity_id;
      if l.id is null or l.group_id <> new.group_id or l.deleted_at is not null or l.kind <> 'shopping' then
        raise exception 'invalid_entity' using errcode = 'P0001';
      end if;
      if l.responsible_member_id is distinct from me then raise exception 'forbidden:not_responsible' using errcode = 'P0001'; end if;
      if not private.member_can_see_list(new.to_member, l.id) then raise exception 'invalid_member' using errcode = 'P0001'; end if;
    else
      select * into e from public.events where id = new.entity_id;
      if e.id is null or e.group_id <> new.group_id or e.deleted_at is not null then raise exception 'invalid_entity' using errcode = 'P0001'; end if;
      current_responsible := private.occurrence_responsible(e, new.occurrence_date);
      if current_responsible is distinct from me then raise exception 'forbidden:not_responsible' using errcode = 'P0001'; end if;
    end if;
    return new;
  end if;

  if (to_jsonb(new) - array['status', 'closed', 'decided_at', 'version']) is distinct from (to_jsonb(old) - array['status', 'closed', 'decided_at', 'version']) then
    raise exception 'immutable_column' using errcode = 'P0001';
  end if;
  if new.closed is distinct from old.closed and me <> old.from_member then raise exception 'forbidden' using errcode = 'P0001'; end if;
  if new.status is not distinct from old.status then return new; end if;
  if old.status <> 'pending' then raise exception 'invalid_value:status' using errcode = 'P0001'; end if;
  if new.status in ('accepted', 'declined') and me <> old.to_member then raise exception 'forbidden' using errcode = 'P0001'; end if;
  if new.status = 'cancelled' and me <> old.from_member then raise exception 'forbidden' using errcode = 'P0001'; end if;
  new.decided_at := now();

  if new.status = 'accepted' then
    -- Audyt 8.10.2026 (#8): odpowiedzialność nadal u nadawcy? (ta sama reguła co przy tworzeniu)
    if old.entity = 'tasks' then
      select assignee_member_id into current_responsible from public.tasks where id = old.entity_id;
    elsif old.entity = 'lists' then
      select responsible_member_id into current_responsible from public.lists where id = old.entity_id;
    else
      select * into e from public.events where id = old.entity_id;
      current_responsible := private.occurrence_responsible(e, old.occurrence_date);
    end if;
    if current_responsible is distinct from old.from_member then raise exception 'stale' using errcode = 'P0001'; end if;

    if old.entity = 'tasks' then
      -- PW-31: niezrobione terminy łańcucha (ten i kolejne kopie), które wciąż są u nadawcy; zrobionych nie ruszamy.
      -- Łańcuch kończy się na pierwszym id, którego nie ma (kolejne id wynika z poprzedniego, więc cyklu nie ma).
      tid := old.entity_id;
      while tid is not null loop
        update public.tasks set assignee_member_id = old.to_member
          where id = tid and group_id = old.group_id and deleted_at is null and completed_at is null
            and assignee_member_id is not distinct from old.from_member;
        get diagnostics n = row_count;
        moved := moved + n;
        tid := private.next_task_id(tid);
        if not exists (select 1 from public.tasks where id = tid) then tid := null; end if;
      end loop;
      -- Nic do przejęcia (zadanie już zrobione, bez następnego terminu u nadawcy): przekazanie nieaktualne, zostaje
      -- oczekujące — odbiorca może je odrzucić, nadawca anulować (jak przy zmianie osoby, #8).
      if moved = 0 then raise exception 'stale' using errcode = 'P0001'; end if;
    elsif old.entity = 'lists' then
      update public.lists set responsible_member_id = old.to_member where id = old.entity_id and deleted_at is null;
    elsif old.occurrence_date is null then
      update public.events set responsible_member_id = old.to_member where id = old.entity_id and deleted_at is null;
    else
      -- Id jak na telefonie (overrideId, src/domain/views/events.ts): telefon zapisujący ten sam termin naraz trafia w ten
      -- sam wiersz, a nie w błąd 23505; istniejący wiersz (także z kosza) dostaje osobę i traci „nikt konkretny”.
      insert into public.event_overrides (id, event_id, group_id, occurrence_date, responsible_member_id)
        values (private.uuid_v5('507f935e-7343-5bf0-a46c-cedc524fb294'::uuid, old.entity_id::text || '|' || to_char(old.occurrence_date, 'YYYY-MM-DD')),
                old.entity_id, old.group_id, old.occurrence_date, old.to_member)
        on conflict (event_id, occurrence_date) do update
          set responsible_member_id = excluded.responsible_member_id, responsible_cleared = false, deleted_at = null;
    end if;
  end if;
  return new;
end $$;


revoke all on all functions in schema private from public, anon;
grant execute on function private.rrule_ok(text) to authenticated;
grant execute on function private.occurrence_responsible(public.events, date) to authenticated;
