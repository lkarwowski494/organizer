-- Powiadomienia push po audycie 2 (migracja 20261008350000_push_fixes): kopie zadań powtarzanych i podział „to i następne”
-- bez fałszywego „przypisuje Ci” (M-28), zwolnienie zaznaczenia po błędzie APNs (M-75), treści i daty (M-138).
-- Identyfikatory kopii policzone niezależnie w Pythonie (uuid.uuid5).
begin;
select plan(41);

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-0000000000a1', 'l@x.test'),
  ('00000000-0000-7000-8000-0000000000a2', 'm@x.test'),
  ('00000000-0000-7000-8000-0000000000a3', 'o@x.test');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.push(client text, seq int, op jsonb) returns text language sql as $$
  select coalesce(public.sync_push(client::uuid, 1, jsonb_build_array(op || jsonb_build_object('seq', seq))) -> 'results' -> 0 ->> 'code', 'ok')
$$;
-- Wpis aktywności o utworzeniu (albo pierwszej zmianie kolumny) sprawy.
create function pg_temp.act(entity_id text, verb text default 'create') returns uuid language sql as $$
  select id from public.activity where entity_id = act.entity_id::uuid and verb = act.verb order by version limit 1
$$;
grant execute on function pg_temp.as_user(text), pg_temp.push(text, int, jsonb) to authenticated;

-- 1–2: id kopii jak nextId na telefonie (private.next_task_id z 20261008330000; SHA-1 i UUIDv5 sprawdza handoff_obligation).
select is(private.next_task_id('cccc0000-0000-7000-8000-0000000004d1'), '3131726b-47cd-530b-8635-592f07fad345'::uuid, '1: id kopii jak nextId na telefonie');
select is(private.event_split_source(gen_random_uuid()), null, '2: nieznane wydarzenie nie jest kopią serii');

-- Grupa: Łukasz (admin), Magdalena i Ola (członkinie z tokenami).
select pg_temp.as_user('00000000-0000-7000-8000-0000000000a1');
set local role authenticated;
select public.create_group('cccc0000-0000-7000-8000-000000000001', 'Rodzina', 'cccc0000-0000-7000-8000-0000000000b1', 'Łukasz');
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('cccc0000-0000-7000-8000-0000000000b2', 'cccc0000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000a2', 'Magdalena', 'member'),
  ('cccc0000-0000-7000-8000-0000000000b3', 'cccc0000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000a3', 'Ola', 'member');
insert into public.push_tokens (token, user_id, env) values
  (repeat('cd', 32), '00000000-0000-7000-8000-0000000000a2', 'production'),
  (repeat('ef', 32), '00000000-0000-7000-8000-0000000000a3', 'production');

-- 12–19: zadania powtarzane (M-28). Kopie jak task-repeat.ts: id = nextId(źródła), osoba ze źródła.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000a1');
set local role authenticated;
select pg_temp.push('cccc0000-0000-7000-8000-00000000c0a1', 1, '{"kind":"create","entity":"lists","id":"cccc0000-0000-7000-8000-0000000000c1","group_id":"cccc0000-0000-7000-8000-000000000001","set":{"kind":"tasks","name":"Dom"}}') is not null;
select is(pg_temp.push('cccc0000-0000-7000-8000-00000000c0a1', 2, '{"kind":"create","entity":"tasks","id":"cccc0000-0000-7000-8000-0000000004d1","group_id":"cccc0000-0000-7000-8000-000000000001","set":{"list_id":"cccc0000-0000-7000-8000-0000000000c1","title":"Wynieś śmieci","assignee_member_id":"cccc0000-0000-7000-8000-0000000000b2","deadline_mode":"own","due_date":"2026-10-07","repeat":"FREQ=WEEKLY;BYDAY=WE"}}'), 'ok', '12: zadanie co tydzień przypisane Magdalenie');
-- Odhaczenie przez Łukasza i następne (jak repeatOps).
select pg_temp.push('cccc0000-0000-7000-8000-00000000c0a1', 3, '{"kind":"patch","entity":"tasks","id":"cccc0000-0000-7000-8000-0000000004d1","set":{"completed_at":"2026-10-07T10:00:00Z"}}') is not null;
select is(pg_temp.push('cccc0000-0000-7000-8000-00000000c0a1', 4, '{"kind":"create","entity":"tasks","id":"3131726b-47cd-530b-8635-592f07fad345","group_id":"cccc0000-0000-7000-8000-000000000001","set":{"list_id":"cccc0000-0000-7000-8000-0000000000c1","title":"Wynieś śmieci","assignee_member_id":"cccc0000-0000-7000-8000-0000000000b2","deadline_mode":"own","due_date":"2026-10-14","repeat":"FREQ=WEEKLY;BYDAY=WE"}}'), 'ok', '13: następny termin');
select is(pg_temp.push('cccc0000-0000-7000-8000-00000000c0a1', 5, '{"kind":"create","entity":"tasks","id":"cccc0000-0000-7000-8000-0000000004d2","group_id":"cccc0000-0000-7000-8000-000000000001","set":{"list_id":"cccc0000-0000-7000-8000-0000000000c1","title":"Wynieś śmieci","assignee_member_id":"cccc0000-0000-7000-8000-0000000000b2"}}'), 'ok', '14: nowe zadanie o tym samym tytule');
-- Podzadanie Magdaleny i jego kopia pod następnym terminem (P5, copyOps: id = nextId(podzadania), bez powtarzania).
select is(pg_temp.push('cccc0000-0000-7000-8000-00000000c0b1', 1, '{"kind":"create","entity":"tasks","id":"cccc0000-0000-7000-8000-0000000004e1","group_id":"cccc0000-0000-7000-8000-000000000001","set":{"list_id":"cccc0000-0000-7000-8000-0000000000c1","parent_id":"cccc0000-0000-7000-8000-0000000004d1","title":"worki","assignee_member_id":"cccc0000-0000-7000-8000-0000000000b2","deadline_mode":"inherit"}}'), 'ok', '14a: podzadanie Magdaleny');
select is(pg_temp.push('cccc0000-0000-7000-8000-00000000c0b1', 2, '{"kind":"create","entity":"tasks","id":"e6e44ef0-d33f-5243-afc5-1c49f69ce0de","group_id":"cccc0000-0000-7000-8000-000000000001","set":{"list_id":"cccc0000-0000-7000-8000-0000000000c1","parent_id":"3131726b-47cd-530b-8635-592f07fad345","title":"worki","assignee_member_id":"cccc0000-0000-7000-8000-0000000000b2","deadline_mode":"inherit"}}'), 'ok', '14b: kopia podzadania pod następnym terminem');
reset role;
-- D133: kopię następnej kopii robi telefon Oli (termin minął niezrobiony).
select pg_temp.as_user('00000000-0000-7000-8000-0000000000a3');
set local role authenticated;
select is(pg_temp.push('cccc0000-0000-7000-8000-00000000c0a3', 1, '{"kind":"create","entity":"tasks","id":"ddd3b400-0594-5a0a-8416-e7df937cb9e6","group_id":"cccc0000-0000-7000-8000-000000000001","set":{"list_id":"cccc0000-0000-7000-8000-0000000000c1","title":"Wynieś śmieci","assignee_member_id":"cccc0000-0000-7000-8000-0000000000b2","deadline_mode":"own","due_date":"2026-10-21","repeat":"FREQ=WEEKLY;BYDAY=WE"}}'), 'ok', '15: D133 — kopia z telefonu Oli');
reset role;
select pg_temp.as_user('');

select is(private.task_repeat_source('ddd3b400-0594-5a0a-8416-e7df937cb9e6'), '3131726b-47cd-530b-8635-592f07fad345'::uuid, '16: źródło kopii kopii');
select is(public.assignment_push_claim(pg_temp.act('3131726b-47cd-530b-8635-592f07fad345'), '00000000-0000-7000-8000-0000000000a1', 24), null, '17: następny termin po odhaczeniu — bez „przypisuje Ci”');
select is(public.assignment_push_claim(pg_temp.act('ddd3b400-0594-5a0a-8416-e7df937cb9e6'), '00000000-0000-7000-8000-0000000000a3', 24), null, '18: kopia D133 z cudzego telefonu — bez „przypisuje Ci”');
select isnt(public.assignment_push_claim(pg_temp.act('cccc0000-0000-7000-8000-0000000004e1'), '00000000-0000-7000-8000-0000000000a1', 24), null, '18a: podzadanie przypisane przy tworzeniu — powiadomienie');
select is(public.assignment_push_claim(pg_temp.act('e6e44ef0-d33f-5243-afc5-1c49f69ce0de'), '00000000-0000-7000-8000-0000000000a1', 24), null, '18b: kopia podzadania pod następnym terminem — bez „przypisuje Ci”');
select is(public.assignment_push_claim(pg_temp.act('cccc0000-0000-7000-8000-0000000004d1'), '00000000-0000-7000-8000-0000000000a1', 24),
  jsonb_build_object('title', 'Łukasz przypisuje Ci zadanie', 'body', 'Wynieś śmieci',
                     'tokens', jsonb_build_array(jsonb_build_object('token', repeat('cd', 32), 'env', 'production')),
                     'key', 'assign|' || pg_temp.act('cccc0000-0000-7000-8000-0000000004d1'),
                     'path', 'task/cccc0000-0000-7000-8000-0000000004d1'),
  '19: przypisanie przy tworzeniu zostaje (z kluczem do zwolnienia i sprawą do otwarcia)');

-- 20–24: zwolnienie zaznaczenia po błędzie APNs (M-75).
select is(public.assignment_push_claim(pg_temp.act('cccc0000-0000-7000-8000-0000000004d2'), '00000000-0000-7000-8000-0000000000a1', 24) ->> 'title', 'Łukasz przypisuje Ci zadanie', '20: zwykłe zadanie o tym samym tytule — powiadomienie');
select is(public.assignment_push_claim(pg_temp.act('cccc0000-0000-7000-8000-0000000004d2'), '00000000-0000-7000-8000-0000000000a1', 24), null, '21: drugi raz — nic');
select public.push_claim_release('assign|' || pg_temp.act('cccc0000-0000-7000-8000-0000000004d2'));
select isnt(public.assignment_push_claim(pg_temp.act('cccc0000-0000-7000-8000-0000000004d2'), '00000000-0000-7000-8000-0000000000a1', 24), null, '22: po zwolnieniu — można wysłać jeszcze raz');
select lives_ok($$ select public.push_claim_release(k) from unnest(array['x', 'assign', 'assign|a|b', 'handoff|nie-uuid|pending', 'handoff|cccc0000-0000-7000-8000-0000000004d2']) k $$, '23: zły klucz — nic, bez błędu');
select is(public.assignment_push_claim(pg_temp.act('cccc0000-0000-7000-8000-0000000004d2'), '00000000-0000-7000-8000-0000000000a1', 24), null, '24: zły klucz niczego nie zwolnił');

-- 25–33: „to i następne” (znacznik podziału z paczki P3 — tu zastąpiony na czas testu).
select pg_temp.as_user('00000000-0000-7000-8000-0000000000a1');
set local role authenticated;
select pg_temp.push('cccc0000-0000-7000-8000-00000000c0a1', 6, '{"kind":"create","entity":"events","id":"cccc0000-0000-7000-8000-0000000001e1","group_id":"cccc0000-0000-7000-8000-000000000001","set":{"title":"Chór","start_date":"2026-10-05","start_time":"18:00","rrule":"FREQ=WEEKLY;BYDAY=MO","responsible_member_id":"cccc0000-0000-7000-8000-0000000000b2"}}') is not null;
select pg_temp.push('cccc0000-0000-7000-8000-00000000c0a1', 7, '{"kind":"create","entity":"event_overrides","id":"cccc0000-0000-7000-8000-0000000001f1","group_id":"cccc0000-0000-7000-8000-000000000001","set":{"event_id":"cccc0000-0000-7000-8000-0000000001e1","occurrence_date":"2026-10-19","responsible_member_id":"cccc0000-0000-7000-8000-0000000000b3"}}') is not null;
-- Podział od 12.10 (jak editEvent: koniec starej serii, nowa seria, wyjątki przeniesione).
select pg_temp.push('cccc0000-0000-7000-8000-00000000c0a1', 8, '{"kind":"patch","entity":"events","id":"cccc0000-0000-7000-8000-0000000001e1","set":{"rrule":"FREQ=WEEKLY;BYDAY=MO;UNTIL=20261011"}}') is not null;
select pg_temp.push('cccc0000-0000-7000-8000-00000000c0a1', 9, '{"kind":"create","entity":"events","id":"cccc0000-0000-7000-8000-0000000001e2","group_id":"cccc0000-0000-7000-8000-000000000001","set":{"title":"Chór","start_date":"2026-10-12","start_time":"18:30","rrule":"FREQ=WEEKLY;BYDAY=MO","responsible_member_id":"cccc0000-0000-7000-8000-0000000000b2"}}') is not null;
select pg_temp.push('cccc0000-0000-7000-8000-00000000c0a1', 10, '{"kind":"delete","entity":"event_overrides","id":"cccc0000-0000-7000-8000-0000000001f1"}') is not null;
select pg_temp.push('cccc0000-0000-7000-8000-00000000c0a1', 11, '{"kind":"create","entity":"event_overrides","id":"cccc0000-0000-7000-8000-0000000001f2","group_id":"cccc0000-0000-7000-8000-000000000001","set":{"event_id":"cccc0000-0000-7000-8000-0000000001e2","occurrence_date":"2026-10-19","responsible_member_id":"cccc0000-0000-7000-8000-0000000000b3"}}') is not null;
-- Nowy wyjątek na nowej serii (bez odpowiednika w starej) i druga nowa seria z inną osobą.
select pg_temp.push('cccc0000-0000-7000-8000-00000000c0a1', 12, '{"kind":"create","entity":"event_overrides","id":"cccc0000-0000-7000-8000-0000000001f3","group_id":"cccc0000-0000-7000-8000-000000000001","set":{"event_id":"cccc0000-0000-7000-8000-0000000001e2","occurrence_date":"2026-10-26","responsible_member_id":"cccc0000-0000-7000-8000-0000000000b3"}}') is not null;
select pg_temp.push('cccc0000-0000-7000-8000-00000000c0a1', 13, '{"kind":"create","entity":"events","id":"cccc0000-0000-7000-8000-0000000001e3","group_id":"cccc0000-0000-7000-8000-000000000001","set":{"title":"Chór","start_date":"2026-10-12","start_time":"19:00","rrule":"FREQ=WEEKLY;BYDAY=MO","responsible_member_id":"cccc0000-0000-7000-8000-0000000000b3"}}') is not null;
reset role;
select pg_temp.as_user('');

-- Podział nierozpoznany (znacznik bez wiedzy o tej serii) — jak dotąd: nowa seria z osobą powiadamia.
create or replace function private.event_split_source(p_event uuid) returns uuid language sql stable set search_path = '' as $$ select null::uuid $$;
select isnt(public.assignment_push_claim(pg_temp.act('cccc0000-0000-7000-8000-0000000001e2'), '00000000-0000-7000-8000-0000000000a1', 24), null, '25: podział nierozpoznany — powiadomienie jak dotąd');
select public.push_claim_release('assign|' || pg_temp.act('cccc0000-0000-7000-8000-0000000001e2'));
create or replace function private.event_split_source(p_event uuid) returns uuid language sql stable set search_path = '' as $$
  select case when p_event in ('cccc0000-0000-7000-8000-0000000001e2', 'cccc0000-0000-7000-8000-0000000001e3') then 'cccc0000-0000-7000-8000-0000000001e1'::uuid end
$$;
select is(public.assignment_push_claim(pg_temp.act('cccc0000-0000-7000-8000-0000000001e2'), '00000000-0000-7000-8000-0000000000a1', 24), null, '26: nowa seria z tą samą osobą — bez „przypisuje Ci”');
select is(public.assignment_push_claim(pg_temp.act('cccc0000-0000-7000-8000-0000000001f2'), '00000000-0000-7000-8000-0000000000a1', 24), null, '27: przeniesiony wyjątek z tą samą osobą — bez „przypisuje Ci”');
select is(public.assignment_push_claim(pg_temp.act('cccc0000-0000-7000-8000-0000000001e3'), '00000000-0000-7000-8000-0000000000a1', 24) - 'tokens' - 'key',
  jsonb_build_object('title', 'Łukasz przypisuje Ci wydarzenie', 'body', 'Chór', 'path', 'event/cccc0000-0000-7000-8000-0000000001e3'), '28: podział z inną osobą — przypisanie (cała seria: sama nazwa, otwiera serię)');
select is(public.assignment_push_claim(pg_temp.act('cccc0000-0000-7000-8000-0000000001f3'), '00000000-0000-7000-8000-0000000000a1', 24) - 'tokens' - 'key' - 'title',
  jsonb_build_object('body', 'Chór (' || private.pl_long_date('2026-10-26') || ')', 'path', 'event/cccc0000-0000-7000-8000-0000000001e2/2026-10-26'), '29: nowy wyjątek na nowej serii — przypisanie z dniem, otwiera ten termin');
select is(private.assignment_carried_over('lists', 'cccc0000-0000-7000-8000-0000000000c1', 'cccc0000-0000-7000-8000-0000000000b2'), false, '30: listy nie są kopiami');
select is(private.assignment_carried_over('event_overrides', gen_random_uuid(), 'cccc0000-0000-7000-8000-0000000000b2'), false, '31: nieznany wyjątek');
select is(private.task_repeat_source(gen_random_uuid()), null, '32: nieznane zadanie');
select is(private.task_repeat_source('cccc0000-0000-7000-8000-0000000004d2'), null, '33: zwykłe zadanie nie jest kopią');

-- 34–41: przekazania — treść jak karta „Do potwierdzenia”, termin serii z nazwą i dniem wyjątku (M-138), zwolnienie (M-75).
select pg_temp.as_user('00000000-0000-7000-8000-0000000000a1');
set local role authenticated;
select pg_temp.push('cccc0000-0000-7000-8000-00000000c0a1', 14, '{"kind":"create","entity":"events","id":"cccc0000-0000-7000-8000-0000000001e4","group_id":"cccc0000-0000-7000-8000-000000000001","set":{"title":"Basen","start_date":"2026-10-07","start_time":"17:00","rrule":"FREQ=WEEKLY;BYDAY=WE","responsible_member_id":"cccc0000-0000-7000-8000-0000000000b1"}}') is not null;
select pg_temp.push('cccc0000-0000-7000-8000-00000000c0a1', 15, '{"kind":"create","entity":"event_overrides","id":"cccc0000-0000-7000-8000-0000000001f4","group_id":"cccc0000-0000-7000-8000-000000000001","set":{"event_id":"cccc0000-0000-7000-8000-0000000001e4","occurrence_date":"2026-10-14","start_date":"2026-10-15","title":"Basen – zawody"}}') is not null;
select pg_temp.push('cccc0000-0000-7000-8000-00000000c0a1', 16, '{"kind":"create","entity":"handoffs","id":"cccc0000-0000-7000-8000-0000000007f1","group_id":"cccc0000-0000-7000-8000-000000000001","set":{"entity":"events","entity_id":"cccc0000-0000-7000-8000-0000000001e4","occurrence_date":"2026-10-14","to_member":"cccc0000-0000-7000-8000-0000000000b2"}}') is not null;
select pg_temp.push('cccc0000-0000-7000-8000-00000000c0a1', 17, '{"kind":"create","entity":"tasks","id":"cccc0000-0000-7000-8000-0000000004d3","group_id":"cccc0000-0000-7000-8000-000000000001","set":{"list_id":"cccc0000-0000-7000-8000-0000000000c1","title":"Logopeda","assignee_member_id":"cccc0000-0000-7000-8000-0000000000b1"}}') is not null;
select pg_temp.push('cccc0000-0000-7000-8000-00000000c0a1', 18, '{"kind":"create","entity":"handoffs","id":"cccc0000-0000-7000-8000-0000000007f2","group_id":"cccc0000-0000-7000-8000-000000000001","set":{"entity":"tasks","entity_id":"cccc0000-0000-7000-8000-0000000004d3","to_member":"cccc0000-0000-7000-8000-0000000000b2"}}') is not null;
reset role;
select pg_temp.as_user('');

select is(public.handoff_push_claim('cccc0000-0000-7000-8000-0000000007f1', '00000000-0000-7000-8000-0000000000a1', 24),
  jsonb_build_object('title', 'Łukasz przekazuje Ci',
                     'body', 'Basen – zawody (' || private.pl_long_date('2026-10-15') || '). Otwórz Organizer, żeby przyjąć albo odrzucić.',
                     'tokens', jsonb_build_array(jsonb_build_object('token', repeat('cd', 32), 'env', 'production')),
                     'key', 'handoff|cccc0000-0000-7000-8000-0000000007f1|pending', 'path', 'today'),
  '34: termin serii — nazwa i dzień z wyjątku, jak karta przekazania');
select is(public.handoff_push_claim('cccc0000-0000-7000-8000-0000000007f2', '00000000-0000-7000-8000-0000000000a1', 24) ->> 'body',
  'Logopeda. Otwórz Organizer, żeby przyjąć albo odrzucić.', '35: zadanie — bez dnia');
select is(public.handoff_push_claim('cccc0000-0000-7000-8000-0000000007f2', '00000000-0000-7000-8000-0000000000a1', 24), null, '36: drugi raz — nic');
select public.push_claim_release('handoff|cccc0000-0000-7000-8000-0000000007f2|accepted');
select is((select push_sent_status from public.handoffs where id = 'cccc0000-0000-7000-8000-0000000007f2'), 'pending', '37: zwolnienie innego stanu nic nie zmienia');
select public.push_claim_release('handoff|cccc0000-0000-7000-8000-0000000007f2|pending');
select is((select push_sent_status from public.handoffs where id = 'cccc0000-0000-7000-8000-0000000007f2'), null, '38: zwolnione — telefon zobaczy, że trzeba ponowić');
select isnt(public.handoff_push_claim('cccc0000-0000-7000-8000-0000000007f2', '00000000-0000-7000-8000-0000000000a1', 24), null, '39: po zwolnieniu — można wysłać jeszcze raz');
-- Decyzja Magdaleny: przyjęcie terminu serii.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000a2');
set local role authenticated;
select pg_temp.push('cccc0000-0000-7000-8000-00000000c0a2', 1, '{"kind":"patch","entity":"handoffs","id":"cccc0000-0000-7000-8000-0000000007f1","set":{"status":"accepted"}}') is not null;
select pg_temp.push('cccc0000-0000-7000-8000-00000000c0a2', 2, '{"kind":"patch","entity":"handoffs","id":"cccc0000-0000-7000-8000-0000000007f2","set":{"status":"declined"}}') is not null;
select throws_ok($$ select public.push_claim_release('assign|x') $$, '42501', null, '40: zwolnienie tylko dla funkcji');
reset role;
select pg_temp.as_user('');
select is(public.handoff_push_claim('cccc0000-0000-7000-8000-0000000007f1', '00000000-0000-7000-8000-0000000000a2', 24) ->> 'title', 'Magdalena przyjmuje', '41: przyjęcie — do nadawcy');
select is(public.handoff_push_claim('cccc0000-0000-7000-8000-0000000007f2', '00000000-0000-7000-8000-0000000000a2', 24) - 'tokens' - 'key',
  jsonb_build_object('title', 'Magdalena nie przyjmuje', 'body', 'Logopeda', 'path', 'today'), '42: odrzucenie — do nadawcy');

-- 43–46: data jak formatLongDate (rok tylko, gdy inny niż bieżący w Warszawie).
select is(private.pl_long_date('2024-02-29'), 'Czwartek, 29 lutego 2024', '43: dzień tygodnia, dzień, miesiąc w dopełniaczu, inny rok');
select is(array[private.pl_long_date('2023-01-01'), private.pl_long_date('2023-01-02'), private.pl_long_date('2025-12-31')],
  array['Niedziela, 1 stycznia 2023', 'Poniedziałek, 2 stycznia 2023', 'Środa, 31 grudnia 2025'], '44: niedziela, poniedziałek, grudzień');
select unalike(private.pl_long_date((now() at time zone 'Europe/Warsaw')::date), '% 2___', '45: bieżący rok — bez roku');
select alike(private.pl_long_date((now() at time zone 'Europe/Warsaw')::date + 400), '% ' || extract(year from (now() at time zone 'Europe/Warsaw')::date + 400)::int, '46: następny rok — z rokiem');

select * from finish();
rollback;
