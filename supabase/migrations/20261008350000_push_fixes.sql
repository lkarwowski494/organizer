-- Audyt 2 (8.10.2026), powiadomienia push:
--  - M-28 (N-6, T-24, E-13): kopia zadania powtarzanego (D76, D133) i nowa seria albo wyjątek z „to i następne” nie są
--    przypisaniem — osoba przechodzi z poprzedniego stanu sprawy, więc bez „X przypisuje Ci…”;
--  - M-75 (N-15): zaznaczenie „wysłane” zwalnia funkcja notify-handoff, gdy APNs nic nie przyjął (ponowienie z telefonu);
--  - M-138 (U-43, N-28, U-53): treści w jednym miejscu (private.push_texts, zgodne ze strings.pl.ts — test kontraktowy),
--    data jak na karcie „Do potwierdzenia” („Środa, 14 października”), przekazanie terminu serii z jego nazwą i dniem;
--  - PWD-16 (decyzja właściciela 8.10.2026): „path” — co otwiera dotknięcie powiadomienia (jak linki głębokie aplikacji,
--    src/domain/notification-target.ts): task/<id>, list/<id>, event/<id>[/<data>], today (skrzynka przekazań).
-- Telefony z buildem 21 wołają te same funkcje z tymi samymi argumentami; dochodzą tylko pola „key” i „path”.

-- ───────────────────────── UUIDv5 w SQL (identyfikator kopii zadania powtarzanego) ─────────────────────────
-- SHA-1 wg FIPS 180-4 (https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.180-4.pdf, 5.1.1 dopełnienie, 6.1.2 obliczenie),
-- jak src/domain/ids.ts — tylko do UUIDv5 (RFC 9562, 5.5), nie do zabezpieczeń. Bez rozszerzeń (pgcrypto, uuid-ossp
-- leżą w Supabase w schemacie extensions, lokalnie w public — funkcja ma działać tak samo wszędzie).
create function private.sha1(msg bytea) returns bytea
language plpgsql immutable strict parallel safe set search_path = '' as $$
declare
  m constant bigint := 4294967295; -- 2^32 − 1: słowa 32-bitowe na bigint
  h0 bigint := 1732584193;         -- 67452301
  h1 bigint := 4023233417;         -- efcdab89
  h2 bigint := 2562383102;         -- 98badcfe
  h3 bigint := 271733878;          -- 10325476
  h4 bigint := 3285377520;         -- c3d2e1f0
  data bytea := msg || '\x80'::bytea;
  w bigint[];
  a bigint; b bigint; c bigint; d bigint; e bigint; f bigint; k bigint; t bigint;
  off int; i int; j int;
begin
  -- Bajt 0x80, zera do 56 mod 64, długość w bitach (64 bity, big-endian).
  data := data || decode(repeat('00', (120 - length(data) % 64) % 64), 'hex') || int8send(length(msg)::bigint * 8);
  for off in 0 .. length(data) - 1 by 64 loop
    w := array_fill(0::bigint, array[80], array[0]);
    for i in 0 .. 15 loop
      j := off + i * 4;
      w[i] := (get_byte(data, j)::bigint << 24) | (get_byte(data, j + 1) << 16) | (get_byte(data, j + 2) << 8) | get_byte(data, j + 3);
    end loop;
    for i in 16 .. 79 loop
      t := w[i - 3] # w[i - 8] # w[i - 14] # w[i - 16];
      w[i] := ((t << 1) | (t >> 31)) & m;
    end loop;
    a := h0; b := h1; c := h2; d := h3; e := h4;
    for i in 0 .. 79 loop
      if i < 20 then f := (b & c) | ((b # m) & d); k := 1518500249;      -- 5a827999
      elsif i < 40 then f := b # c # d; k := 1859775393;                 -- 6ed9eba1
      elsif i < 60 then f := (b & c) | (b & d) | (c & d); k := 2400959708; -- 8f1bbcdc
      else f := b # c # d; k := 3395469782;                               -- ca62c1d6
      end if;
      t := ((((a << 5) | (a >> 27)) & m) + f + e + k + w[i]) & m;
      e := d; d := c; c := ((b << 30) | (b >> 2)) & m; b := a; a := t;
    end loop;
    h0 := (h0 + a) & m; h1 := (h1 + b) & m; h2 := (h2 + c) & m; h3 := (h3 + d) & m; h4 := (h4 + e) & m;
  end loop;
  return substring(int8send(h0) from 5) || substring(int8send(h1) from 5) || substring(int8send(h2) from 5)
      || substring(int8send(h3) from 5) || substring(int8send(h4) from 5);
end $$;

-- UUIDv5 (RFC 9562, 5.5): SHA-1 z przestrzeni nazw i nazwy (UTF-8), wersja 5, wariant RFC — jak uuidv5 w src/domain/ids.ts.
create function private.uuidv5(ns uuid, name text) returns uuid
language sql immutable strict parallel safe set search_path = '' as $$
  select encode(set_byte(set_byte(h, 6, (get_byte(h, 6) & 15) | 80), 8, (get_byte(h, 8) & 63) | 128), 'hex')::uuid
  from (select substring(private.sha1(uuid_send(ns) || convert_to(name, 'UTF8')) from 1 for 16) as h) x
$$;

-- REPEAT_NAMESPACE z src/domain/views/task-repeat.ts (test kontraktowy sql.contract.test.ts).
create function private.repeat_namespace() returns uuid
language sql immutable set search_path = '' as $$ select 'e21c312a-9090-47c5-9490-c54305c7ddd1'::uuid $$;

/**
 * Zadanie, którego kopią jest p_task (D76: id następnego = uuidv5(REPEAT_NAMESPACE, '<id>|next'), task-repeat.ts nextId),
 * albo null. Kandydaci z tej samej grupy i listy — najpierw z tym samym tytułem, potem ostatnio zmienione (źródło
 * kopii zwykle przed chwilą odhaczono); jeden kandydat to jedno SHA-1, ułamek milisekundy.
 */
create function private.task_repeat_source(p_task uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  c public.tasks;
  s uuid;
begin
  select * into c from public.tasks where id = p_task;
  if c.id is null then return null; end if;
  for s in select t.id from public.tasks t
            where t.group_id = c.group_id and t.list_id = c.list_id and t.id <> c.id
            order by (t.title = c.title) desc, t.version desc limit 200 loop
    if private.uuidv5(private.repeat_namespace(), s::text || '|next') = p_task then return s; end if;
  end loop;
  return null;
end $$;

-- Znacznik podziału „to i następne” (paczka P3): seria, którą kontynuuje wydarzenie p_event, albo null. Do czasu,
-- aż P3 ustali, jak serwer rozpozna nową serię z podziału (np. kolumna events.split_from albo RPC podziału), żadna
-- seria nie jest rozpoznana — powiadomienia o wydarzeniach działają jak dotąd. Tworzona tylko, gdy jeszcze jej nie ma
-- (migracja P3 może ją zdefiniować wcześniej albo później przez create or replace).
do $$
begin
  if to_regprocedure('private.event_split_source(uuid)') is null then
    execute $f$
      create function private.event_split_source(p_event uuid) returns uuid
      language sql stable set search_path = '' as $b$ select null::uuid $b$
    $f$;
  end if;
end $$;

/**
 * Czy utworzenie p_id (wpis aktywności „create”) tylko przenosi osobę p_member z poprzedniego stanu sprawy:
 *  - zadanie: kopia zadania powtarzanego (osoba zawsze ze źródła albo żadna, task-repeat.ts repeatOps);
 *  - wydarzenie: nowa seria z „to i następne”, a poprzednia miała tę samą osobę odpowiedzialną (inna osoba = przypisanie);
 *  - wyjątek od serii: kopia wyjątku poprzedniej serii z tego samego dnia i z tą samą osobą.
 */
create function private.assignment_carried_over(p_entity text, p_id uuid, p_member uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  src uuid;
begin
  if p_entity = 'tasks' then
    return private.task_repeat_source(p_id) is not null;
  elsif p_entity = 'events' then
    src := private.event_split_source(p_id);
    return src is not null and exists (select 1 from public.events e where e.id = src and e.responsible_member_id = p_member);
  elsif p_entity = 'event_overrides' then
    select private.event_split_source(o.event_id) into src from public.event_overrides o where o.id = p_id;
    return src is not null and exists (select 1 from public.event_overrides o join public.event_overrides p
                                         on p.event_id = src and p.occurrence_date = o.occurrence_date
                                       where o.id = p_id and p.responsible_member_id = p_member);
  end if;
  return false;
end $$;

-- ───────────────────────── Treści (M-138) ─────────────────────────
-- Te same teksty co strings['push.text.*'] i strings['trip.title'] w src/i18n/strings.pl.ts (test kontraktowy).
-- Tytuł: imię nadawcy i tekst („Ala przekazuje Ci”), treść: sprawa z dniem jak na karcie przekazania.
create function private.push_texts() returns jsonb
language sql immutable set search_path = '' as $$
  select '{"handoffPending":"przekazuje Ci","handoffAccepted":"przyjmuje","handoffDeclined":"nie przyjmuje","handoffAction":"Otwórz Organizer, żeby przyjąć albo odrzucić.","assignTask":"przypisuje Ci zadanie","assignTrip":"prosi Cię o zakupy","assignEvent":"przypisuje Ci wydarzenie","trip":"Zakupy: "}'::jsonb
$$;

-- Data jak formatLongDate (src/domain/format.ts): „Środa, 14 października”, z rokiem, gdy inny niż bieżący
-- w Europe/Warsaw (config.TIME_ZONE). Nazwy z CLDR 48.2.3 pl jak src/config/calendar.pl.ts i quickadd.pl.ts (test
-- kontraktowy) — tablice zamiast to_char('TMDay'), bo to_char zależy od ustawień lc_time serwera.
create function private.pl_long_date(d date) returns text
language sql stable set search_path = '' as $$
  select (array['Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota', 'Niedziela'])[extract(isodow from d)::int]
      || ', ' || extract(day from d)::int || ' '
      || (array['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'])[extract(month from d)::int]
      || case when extract(year from d) = extract(year from (now() at time zone 'Europe/Warsaw')) then '' else ' ' || extract(year from d)::int end
$$;

-- ───────────────────────── Przypisania ─────────────────────────
-- Zastępuje wersję z 20261008280000_audit_fixes.sql (wszystkie dotychczasowe warunki zostają). Nowe: utworzenie, które
-- tylko przenosi osobę (M-28), nic nie wysyła; treści z private.push_texts(); „key” do zwolnienia przy błędzie APNs.
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
    body := (txt ->> 'trip') || (select l.name from public.lists l where l.id = a.entity_id);
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
    item := (txt ->> 'trip') || (select l.name from public.lists l where l.id = h.entity_id);
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

/**
 * M-75 (N-15): APNs nie przyjął powiadomienia u żadnego urządzenia (500/503/429, ExpiredProviderToken, sieć) — funkcja
 * notify-handoff zwalnia zaznaczenie z claim, więc ponowienie z telefonu (przy następnym uruchomieniu albo powrocie do
 * aplikacji) może wysłać jeszcze raz. Zaznaczenie zostaje przy claim, a nie dopiero po wysyłce: funkcja w starej wersji
 * (bez zwalniania) dalej powiadamia najwyżej raz, a dwa wywołania naraz nie wyślą dwóch powiadomień.
 * Klucz z odpowiedzi claim: 'assign|<id wpisu aktywności>' albo 'handoff|<id przekazania>|<stan>'.
 */
create function public.push_claim_release(p_key text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  part text[] := string_to_array(p_key, '|');
begin
  if part[1] = 'assign' and cardinality(part) = 2 then
    delete from private.push_log where key = p_key;
  elsif part[1] = 'handoff' and cardinality(part) = 3 and part[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    update public.handoffs set push_sent_status = null where id = part[2]::uuid and push_sent_status = part[3];
  end if;
end $$;
revoke all on function public.push_claim_release(text) from public, anon, authenticated;
grant execute on function public.push_claim_release(text) to service_role;

revoke all on all functions in schema private from public, anon;
grant execute on function private.rrule_ok(text) to authenticated;
