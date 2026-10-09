-- Audyt 2 (P17, P-75): bez „Zakupy: Zakupy” w powiadomieniach — przedrostek pomijany, gdy nazwa listy już zaczyna się
-- od słowa „Zakupy” (ta sama reguła co strings['trip.title'] w src/i18n/strings.pl.ts; test kontraktowy i pgTAP).
-- Obie funkcje zastępują wersje z 20261008350000_push_fixes.sql (ostatnie definicje) — zmienia się tylko treść
-- zakupów; wszystkie warunki, klucze i ścieżki zostają.

create function private.trip_title(p_name text) returns text
language sql immutable set search_path = '' as $$
  select case when p_name ~* '^zakupy([^[:alnum:]_]|$)' then p_name else (private.push_texts() ->> 'trip') || p_name end
$$;

create or replace function private.assignment_push_claim(p_activity uuid, p_user uuid, p_max_age_h int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a public.activity;
  col text;
  target_member uuid;
  target uuid;
  actor_name text;
  txt jsonb := private.push_texts();
  title text;
  body text;
  path text;
begin
  select * into a from public.activity where id = p_activity;
  if a.id is null or a.created_at < now() - make_interval(hours => p_max_age_h) then return null; end if;
  col := case a.entity when 'tasks' then 'assignee_member_id' when 'lists' then 'responsible_member_id'
                       when 'events' then 'responsible_member_id' when 'event_overrides' then 'responsible_member_id' end;
  if col is null or not (a.changes ? col) then return null; end if;
  target_member := nullif(a.changes -> col ->> 1, '')::uuid;
  if target_member is null then return null; end if;
  if not exists (select 1 from public.group_members where member_id = a.actor_member_id and user_id = p_user) then return null; end if;
  select user_id into target from public.group_members where member_id = target_member and deleted_at is null;
  if target is null or target = p_user then return null; end if;
  -- Audyt 8.10.2026 (#3): treść powiadomienia (tytuł zadania, nazwa listy) tylko dla osoby, która widzi listę.
  if a.entity = 'tasks' and not exists (select 1 from public.tasks t where t.id = a.entity_id
                                         and private.member_can_see_list(target_member, t.list_id)) then
    return null;
  end if;
  if a.entity = 'lists' and not private.member_can_see_list(target_member, a.entity_id) then return null; end if;
  -- Audyt 2 (M-28): kopia zadania powtarzanego i podział „to i następne” — osoba z poprzedniego stanu, nie przypisanie.
  if a.verb = 'create' and private.assignment_carried_over(a.entity, a.entity_id, target_member) then return null; end if;
  if exists (select 1 from public.push_mutes where user_id = target and group_id = a.group_id) then return null; end if;
  insert into private.push_log (key) values ('assign|' || a.id) on conflict do nothing;
  if not found then return null; end if;
  select display_name into actor_name from public.group_members where member_id = a.actor_member_id;
  if a.entity = 'tasks' then
    title := coalesce(actor_name, '') || ' ' || (txt ->> 'assignTask');
    body := (select t.title from public.tasks t where t.id = a.entity_id);
    path := 'task/' || a.entity_id;
  elsif a.entity = 'lists' then
    title := coalesce(actor_name, '') || ' ' || (txt ->> 'assignTrip');
    body := private.trip_title((select l.name from public.lists l where l.id = a.entity_id));
    path := 'list/' || a.entity_id;
  elsif a.entity = 'events' then
    -- Cała seria: sama nazwa (otwiera najbliższy termin); jednorazowe: nazwa i dzień.
    title := coalesce(actor_name, '') || ' ' || (txt ->> 'assignEvent');
    select e.title || case when e.rrule is null then ' (' || private.pl_long_date(e.start_date) || ')' else '' end,
           'event/' || e.id || case when e.rrule is null then '/' || to_char(e.start_date, 'YYYY-MM-DD') else '' end
      into body, path from public.events e where e.id = a.entity_id;
  else
    -- Jeden termin serii (wyjątek): nazwa (zmieniona albo z serii) i dzień tego terminu (przeniesiony albo z reguły).
    title := coalesce(actor_name, '') || ' ' || (txt ->> 'assignEvent');
    select coalesce(o.title, e.title) || ' (' || private.pl_long_date(coalesce(o.start_date, o.occurrence_date)) || ')',
           'event/' || o.event_id || '/' || to_char(o.occurrence_date, 'YYYY-MM-DD')
      into body, path from public.event_overrides o join public.events e on e.id = o.event_id where o.id = a.entity_id;
  end if;
  return jsonb_build_object(
    'title', title,
    'body', coalesce(body, ''),
    'tokens', coalesce((select jsonb_agg(jsonb_build_object('token', p.token, 'env', p.env) order by p.token) from public.push_tokens p where p.user_id = target), '[]'::jsonb),
    'key', 'assign|' || a.id,
    'path', coalesce(path, 'today'));
end $$;

-- ───────────────────────── Przekazania ─────────────────────────
-- Zastępuje wersję z 20261008280000_audit_fixes.sql (wszystkie dotychczasowe warunki zostają). Nowe: termin serii
-- z nazwą i dniem z wyjątku (jak karta „Do potwierdzenia”), treści z private.push_texts(), „key” do zwolnienia.
create or replace function private.handoff_push_claim(p_handoff uuid, p_user uuid, p_max_age_h int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  h public.handoffs;
  caller uuid;
  target_member uuid;
  target uuid;
  other_name text;
  item text;
  day date;
  txt jsonb := private.push_texts();
  title text;
  body text;
begin
  select * into h from public.handoffs where id = p_handoff for update;
  if h.id is null or h.status = 'cancelled' or h.push_sent_status is not distinct from h.status
     or coalesce(h.decided_at, h.created_at) < now() - make_interval(hours => p_max_age_h) then
    return null;
  end if;
  caller := case when h.status = 'pending' then h.from_member else h.to_member end;
  if not exists (select 1 from public.group_members where member_id = caller and user_id = p_user) then return null; end if;
  target_member := case when h.status = 'pending' then h.to_member else h.from_member end;
  -- Audyt 8.10.2026 (#3): lista mogła od tamtej pory stać się ukryta dla adresata.
  if h.entity = 'tasks' and not exists (select 1 from public.tasks t where t.id = h.entity_id
                                         and private.member_can_see_list(target_member, t.list_id)) then
    return null;
  end if;
  if h.entity = 'lists' and not private.member_can_see_list(target_member, h.entity_id) then return null; end if;
  select user_id into target from public.group_members where member_id = target_member and deleted_at is null;
  select display_name into other_name from public.group_members where member_id = caller;
  if h.entity = 'tasks' then
    item := (select t.title from public.tasks t where t.id = h.entity_id);
  elsif h.entity = 'events' then
    -- Audyt 2 (N-28): termin serii — nazwa i dzień z wyjątku (przeniesiony, przemianowany), jak w aplikacji.
    select coalesce(o.title, e.title), coalesce(o.start_date, h.occurrence_date) into item, day
      from public.events e
      left join public.event_overrides o on o.event_id = e.id and o.occurrence_date = h.occurrence_date and o.deleted_at is null
     where e.id = h.entity_id;
  else
    item := private.trip_title((select l.name from public.lists l where l.id = h.entity_id));
  end if;
  if day is not null then item := item || ' (' || private.pl_long_date(day) || ')'; end if;
  title := coalesce(other_name, '') || ' '
        || (txt ->> case h.status when 'pending' then 'handoffPending' when 'accepted' then 'handoffAccepted' else 'handoffDeclined' end);
  body := case h.status when 'pending' then coalesce(item, '') || '. ' || (txt ->> 'handoffAction') else coalesce(item, '') end;
  update public.handoffs set push_sent_status = h.status where id = h.id;
  return jsonb_build_object(
    'title', title,
    'body', body,
    'tokens', coalesce((select jsonb_agg(jsonb_build_object('token', p.token, 'env', p.env) order by p.token) from public.push_tokens p where p.user_id = target), '[]'::jsonb),
    'key', 'handoff|' || h.id || '|' || h.status,
    -- Przekazanie czeka na decyzję albo jej wynik — skrzynka „Do potwierdzenia” na „Moich sprawach”.
    'path', 'today');
end $$;

revoke all on function private.trip_title(text) from public, anon, authenticated;
