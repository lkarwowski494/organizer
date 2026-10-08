-- Przekazanie zadania powtarzanego = przekazanie obowiązku (migracja 20261008330000_handoff_obligation; decyzja właściciela
-- z 8.10.2026, PW-31; audyt 2, T-5). Identyfikatory kolejnych terminów policzone niezależnie: Python uuid.uuid5(
-- UUID('e21c312a-9090-47c5-9490-c54305c7ddd1'), id + '|next'); skróty SHA-1 — wektory testowe FIPS 180-4 (hashlib).
begin;
select plan(19);

-- 1–4: SHA-1 i id następnego terminu zgodne z niezależną implementacją (i z nextId() na telefonie).
select is(encode(private.sha1(convert_to('abc', 'UTF8')), 'hex'), 'a9993e364706816aba3e25717850c26c9cd0d89d', '1: SHA-1 „abc”');
select is(encode(private.sha1(convert_to(repeat('a', 1000), 'UTF8')), 'hex'), '291e9a6c66994949b57ba5e650361e98fc36b1ba', '2: SHA-1 kilku bloków');
select is(private.uuid_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'python.org'), '886313e1-3b8a-5372-9b90-0c9aee199e5d'::uuid, '3: UUIDv5 (przykład z dokumentacji Pythona)');
select is(private.next_task_id('77770000-0000-7000-8000-0000000004e1'), 'd81b13c9-e6b0-5fc0-82a2-97229c6595bc'::uuid, '4: id następnego terminu jak nextId() na telefonie');

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-0000000000c1', 'a@y.test'),
  ('00000000-0000-7000-8000-0000000000c2', 'm@y.test'),
  ('00000000-0000-7000-8000-0000000000c4', 'o@y.test');

create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.push(client text, seq int, op jsonb) returns text language sql as $$
  select coalesce(public.sync_push(client::uuid, 1, jsonb_build_array(op || jsonb_build_object('seq', seq))) -> 'results' -> 0 ->> 'code', 'ok')
$$;
create function pg_temp.task(client text, seq int, id text, title text, extra jsonb default '{}') returns text language sql as $$
  select pg_temp.push(client, seq, jsonb_build_object('kind', 'create', 'entity', 'tasks', 'id', id, 'group_id', '77770000-0000-7000-8000-000000000001',
    'set', jsonb_build_object('list_id', '77770000-0000-7000-8000-0000000000c1', 'title', title, 'assignee_member_id', '77770000-0000-7000-8000-0000000000a1',
      'deadline_mode', 'own', 'due_date', '2026-10-12', 'repeat', 'FREQ=WEEKLY;BYDAY=MO') || extra))
$$;
create function pg_temp.handoff(client text, seq int, id text, task text) returns text language sql as $$
  select pg_temp.push(client, seq, jsonb_build_object('kind', 'create', 'entity', 'handoffs', 'id', id, 'group_id', '77770000-0000-7000-8000-000000000001',
    'set', jsonb_build_object('entity', 'tasks', 'entity_id', task, 'to_member', '77770000-0000-7000-8000-0000000000a2')))
$$;
create function pg_temp.done(client text, seq int, id text) returns text language sql as $$
  select pg_temp.push(client, seq, jsonb_build_object('kind', 'patch', 'entity', 'tasks', 'id', id, 'set', jsonb_build_object('completed_at', '2026-10-12T08:00:00Z')))
$$;
create function pg_temp.decide(client text, seq int, id text, status text) returns text language sql as $$
  select pg_temp.push(client, seq, jsonb_build_object('kind', 'patch', 'entity', 'handoffs', 'id', id, 'set', jsonb_build_object('status', status)))
$$;
create function pg_temp.who(tid text) returns text language sql as $$ select assignee_member_id::text from public.tasks where id = $1::uuid $$;
grant execute on function pg_temp.as_user(text), pg_temp.push(text, int, jsonb), pg_temp.task(text, int, text, text, jsonb), pg_temp.handoff(text, int, text, text),
  pg_temp.done(text, int, text), pg_temp.decide(text, int, text, text), pg_temp.who(text) to authenticated;

-- Rodzina: Łukasz (owner, A), Magdalena (M), O.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000c1');
set local role authenticated;
select public.create_group('77770000-0000-7000-8000-000000000001', 'Rodzina', '77770000-0000-7000-8000-0000000000a1', 'Łukasz');
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('77770000-0000-7000-8000-0000000000a2', '77770000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000c2', 'Magdalena', 'member'),
  ('77770000-0000-7000-8000-0000000000a4', '77770000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000c4', 'O', 'member');

select pg_temp.as_user('00000000-0000-7000-8000-0000000000c1');
set local role authenticated;
select pg_temp.push('77770000-0000-7000-8000-00000000c0c1', 1, '{"kind":"create","entity":"lists","id":"77770000-0000-7000-8000-0000000000c1","group_id":"77770000-0000-7000-8000-000000000001","set":{"kind":"tasks","name":"Dom"}}') is not null;
-- e1: przekazane, zrobione, następny termin u mnie. e2: zrobione dwa razy, trzeci termin otwarty. e3: minione niezrobione
-- („Tylko tego dnia”) z kopią D133. e4: następny termin przekazany przez kogoś komuś innemu. e5: jednorazowe, zrobione.
select pg_temp.task('77770000-0000-7000-8000-00000000c0c1', 2, '77770000-0000-7000-8000-0000000004e1', 'Śmieci') is not null;
select pg_temp.task('77770000-0000-7000-8000-00000000c0c1', 3, '77770000-0000-7000-8000-0000000004e2', 'Leki') is not null;
select pg_temp.task('77770000-0000-7000-8000-00000000c0c1', 4, '77770000-0000-7000-8000-0000000004e3', 'Kwiaty', '{"rollover":false}') is not null;
select pg_temp.task('77770000-0000-7000-8000-00000000c0c1', 5, '77770000-0000-7000-8000-0000000004e4', 'Pranie') is not null;
select pg_temp.task('77770000-0000-7000-8000-00000000c0c1', 6, '77770000-0000-7000-8000-0000000004e5', 'Paczka', '{"repeat":null}') is not null;
select pg_temp.handoff('77770000-0000-7000-8000-00000000c0c1', 7, '77770000-0000-7000-8000-0000000007e1', '77770000-0000-7000-8000-0000000004e1') is not null;
select pg_temp.handoff('77770000-0000-7000-8000-00000000c0c1', 8, '77770000-0000-7000-8000-0000000007e2', '77770000-0000-7000-8000-0000000004e2') is not null;
select pg_temp.handoff('77770000-0000-7000-8000-00000000c0c1', 9, '77770000-0000-7000-8000-0000000007e3', '77770000-0000-7000-8000-0000000004e3') is not null;
select pg_temp.handoff('77770000-0000-7000-8000-00000000c0c1', 10, '77770000-0000-7000-8000-0000000007e4', '77770000-0000-7000-8000-0000000004e4') is not null;
select pg_temp.handoff('77770000-0000-7000-8000-00000000c0c1', 11, '77770000-0000-7000-8000-0000000007e5', '77770000-0000-7000-8000-0000000004e5') is not null;
-- Odhaczenia i kopie (jak telefon: nextId).
select pg_temp.done('77770000-0000-7000-8000-00000000c0c1', 12, '77770000-0000-7000-8000-0000000004e1') is not null;
select pg_temp.task('77770000-0000-7000-8000-00000000c0c1', 13, 'd81b13c9-e6b0-5fc0-82a2-97229c6595bc', 'Śmieci', '{"due_date":"2026-10-19"}') is not null;
select pg_temp.done('77770000-0000-7000-8000-00000000c0c1', 14, '77770000-0000-7000-8000-0000000004e2') is not null;
select pg_temp.task('77770000-0000-7000-8000-00000000c0c1', 15, '7e7789c2-3e8b-570b-a920-3dfb7e9d628d', 'Leki', '{"due_date":"2026-10-19"}') is not null;
select pg_temp.done('77770000-0000-7000-8000-00000000c0c1', 16, '7e7789c2-3e8b-570b-a920-3dfb7e9d628d') is not null;
select pg_temp.task('77770000-0000-7000-8000-00000000c0c1', 17, '257d4126-9947-5256-9c1a-aac1e85cfc2c', 'Leki', '{"due_date":"2026-10-26"}') is not null;
select pg_temp.task('77770000-0000-7000-8000-00000000c0c1', 18, '8a8a538d-17ed-5265-94be-079732ef13fd', 'Kwiaty', '{"rollover":false,"due_date":"2026-10-19"}') is not null;
select pg_temp.done('77770000-0000-7000-8000-00000000c0c1', 19, '77770000-0000-7000-8000-0000000004e4') is not null;
select pg_temp.task('77770000-0000-7000-8000-00000000c0c1', 20, '533f31f9-8f03-5ccf-804a-1f9baa4ee961', 'Pranie', '{"due_date":"2026-10-19"}') is not null;
select pg_temp.push('77770000-0000-7000-8000-00000000c0c1', 21, '{"kind":"patch","entity":"tasks","id":"533f31f9-8f03-5ccf-804a-1f9baa4ee961","set":{"assignee_member_id":"77770000-0000-7000-8000-0000000000a4"}}') is not null;
select pg_temp.done('77770000-0000-7000-8000-00000000c0c1', 22, '77770000-0000-7000-8000-0000000004e5') is not null;

-- 5–7: zrobiony termin zostaje w historii u nadawcy, obowiązek (następny termin) przechodzi na odbiorcę.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000c2');
select is(pg_temp.decide('77770000-0000-7000-8000-00000000c0c2', 1, '77770000-0000-7000-8000-0000000007e1', 'accepted'), 'ok', '5: odbiorca przyjmuje przekazanie zrobionego terminu');
select is(pg_temp.who('d81b13c9-e6b0-5fc0-82a2-97229c6595bc'), '77770000-0000-7000-8000-0000000000a2', '6: następny termin przechodzi na odbiorcę');
select is(pg_temp.who('77770000-0000-7000-8000-0000000004e1'), '77770000-0000-7000-8000-0000000000a1', '7: zrobiony zostaje u nadawcy (historia bez zmian)');

-- 8–10: dalej w łańcuchu — tylko niezrobione.
select is(pg_temp.decide('77770000-0000-7000-8000-00000000c0c2', 2, '77770000-0000-7000-8000-0000000007e2', 'accepted'), 'ok', '8: łańcuch: dwa zrobione, trzeci otwarty');
select is(pg_temp.who('257d4126-9947-5256-9c1a-aac1e85cfc2c'), '77770000-0000-7000-8000-0000000000a2', '9: otwarty termin przechodzi');
select is(pg_temp.who('7e7789c2-3e8b-570b-a920-3dfb7e9d628d'), '77770000-0000-7000-8000-0000000000a1', '10: zrobione po drodze bez zmian');

-- 11–12: minione niezrobione i jego kopia (D133) — oba niezrobione, oba przechodzą.
select is(pg_temp.decide('77770000-0000-7000-8000-00000000c0c2', 3, '77770000-0000-7000-8000-0000000007e3', 'accepted'), 'ok', '11: minione z kopią D133');
select is(pg_temp.who('77770000-0000-7000-8000-0000000004e3') || '/' || pg_temp.who('8a8a538d-17ed-5265-94be-079732ef13fd'),
  '77770000-0000-7000-8000-0000000000a2/77770000-0000-7000-8000-0000000000a2', '12: przekazane i kopia — u odbiorcy');

-- 13–15: nic do przejęcia (następny już u kogoś innego) — nieaktualne, zostaje oczekujące; nikomu nie zabiera.
select is(pg_temp.decide('77770000-0000-7000-8000-00000000c0c2', 4, '77770000-0000-7000-8000-0000000007e4', 'accepted'), 'stale', '13: następny termin u kogoś innego');
select is(pg_temp.who('533f31f9-8f03-5ccf-804a-1f9baa4ee961'), '77770000-0000-7000-8000-0000000000a4', '14: nikomu nie zabiera');
select is((select status from public.handoffs where id = '77770000-0000-7000-8000-0000000007e4'), 'pending', '15: przekazanie zostaje oczekujące');

-- 16–19: jednorazowe już zrobione — nieaktualne; odbiorca może odrzucić; zrobione nie przechodzi.
select is(pg_temp.decide('77770000-0000-7000-8000-00000000c0c2', 5, '77770000-0000-7000-8000-0000000007e5', 'accepted'), 'stale', '16: jednorazowe zrobione — nie do przyjęcia');
select is(pg_temp.who('77770000-0000-7000-8000-0000000004e5'), '77770000-0000-7000-8000-0000000000a1', '17: zrobione zostaje u nadawcy');
select is(pg_temp.decide('77770000-0000-7000-8000-00000000c0c2', 6, '77770000-0000-7000-8000-0000000007e5', 'declined'), 'ok', '18: odbiorca może je odrzucić');
select is((select status from public.handoffs where id = '77770000-0000-7000-8000-0000000007e5'), 'declined', '19: odrzucone');

select * from finish();
rollback;
