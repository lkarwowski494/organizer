-- Zakupy na liście zakupów (migracja 20261008160000_shopping_trip, D73) i ich przekazanie (D70).
begin;
select plan(14);

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-0000000000e1', 'a@x.test'),
  ('00000000-0000-7000-8000-0000000000e2', 'm@x.test'),
  ('00000000-0000-7000-8000-0000000000e3', 'o@x.test');

create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.push(client text, seq int, op jsonb) returns text language sql as $$
  select coalesce(public.sync_push(client::uuid, 1, jsonb_build_array(op || jsonb_build_object('seq', seq))) -> 'results' -> 0 ->> 'code', 'ok')
$$;
grant execute on function pg_temp.as_user(text), pg_temp.push(text, int, jsonb) to authenticated;

-- Rodzina: Łukasz (owner, A), Magdalena (member, M), O (member), Tymek (dziecko bez konta).
select pg_temp.as_user('00000000-0000-7000-8000-0000000000e1');
set local role authenticated;
select public.create_group('77770000-0000-7000-8000-000000000001', 'Rodzina', '77770000-0000-7000-8000-0000000000a1', 'Łukasz');
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('77770000-0000-7000-8000-0000000000a2', '77770000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000e2', 'Magdalena', 'member'),
  ('77770000-0000-7000-8000-0000000000a3', '77770000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000e3', 'O', 'member'),
  ('77770000-0000-7000-8000-0000000000a5', '77770000-0000-7000-8000-000000000001', null, 'Tymek', 'child');

select pg_temp.as_user('00000000-0000-7000-8000-0000000000e1');
set local role authenticated;

-- 1–6: pola zakupów.
select is(pg_temp.push('77770000-0000-7000-8000-00000000c0e1', 1, '{"kind":"create","entity":"lists","id":"77770000-0000-7000-8000-0000000000c1","group_id":"77770000-0000-7000-8000-000000000001","set":{"kind":"shopping","name":"Biedronka","due_date":"2026-10-08","due_time":"17:00","responsible_member_id":"77770000-0000-7000-8000-0000000000a1"}}'), 'ok', '1: lista zakupów z dniem, godziną i osobą');
select is((select due_date::text || ' ' || due_time::text || ' ' || responsible_member_id::text from public.lists where id = '77770000-0000-7000-8000-0000000000c1'),
  '2026-10-08 17:00:00 77770000-0000-7000-8000-0000000000a1', '2: pola zapisane');
select is(pg_temp.push('77770000-0000-7000-8000-00000000c0e1', 2, '{"kind":"create","entity":"lists","id":"77770000-0000-7000-8000-0000000000c2","group_id":"77770000-0000-7000-8000-000000000001","set":{"kind":"tasks","name":"Dom","due_date":"2026-10-08"}}'), 'invalid:23514', '3: lista zadań nie ma zakupów');
select is(pg_temp.push('77770000-0000-7000-8000-00000000c0e1', 3, '{"kind":"patch","entity":"lists","id":"77770000-0000-7000-8000-0000000000c1","set":{"due_date":null}}'), 'invalid:23514', '4: godzina bez dnia odrzucona');
select is(pg_temp.push('77770000-0000-7000-8000-00000000c0e1', 4, '{"kind":"patch","entity":"lists","id":"77770000-0000-7000-8000-0000000000c1","set":{"responsible_member_id":"77770000-0000-7000-8000-0000000000a5"}}'), 'invalid_member', '5: dziecko nie robi zakupów');
select is(pg_temp.push('77770000-0000-7000-8000-00000000c0e1', 5, '{"kind":"create","entity":"lists","id":"77770000-0000-7000-8000-0000000000c3","group_id":"77770000-0000-7000-8000-000000000001","set":{"kind":"shopping","name":"Tajne","visibility":"private"}}'), 'ok', '6: lista prywatna');
select is(pg_temp.push('77770000-0000-7000-8000-00000000c0e1', 6, '{"kind":"patch","entity":"lists","id":"77770000-0000-7000-8000-0000000000c3","set":{"responsible_member_id":"77770000-0000-7000-8000-0000000000a2"}}'), 'invalid_member', '7: osoba, która nie widzi listy, nie robi z niej zakupów');

-- 8–12: przekazanie zakupów.
select is(pg_temp.push('77770000-0000-7000-8000-00000000c0e1', 7, '{"kind":"create","entity":"handoffs","id":"77770000-0000-7000-8000-0000000007f1","group_id":"77770000-0000-7000-8000-000000000001","set":{"entity":"lists","entity_id":"77770000-0000-7000-8000-0000000000c1","to_member":"77770000-0000-7000-8000-0000000000a2"}}'), 'ok', '8: przekazanie moich zakupów');
select is(pg_temp.push('77770000-0000-7000-8000-00000000c0e1', 8, '{"kind":"create","entity":"handoffs","id":"77770000-0000-7000-8000-0000000007f2","group_id":"77770000-0000-7000-8000-000000000001","set":{"entity":"lists","entity_id":"77770000-0000-7000-8000-0000000000c3","to_member":"77770000-0000-7000-8000-0000000000a2"}}'), 'forbidden:not_responsible', '9: zakupów bez mojej osoby nie przekazuję');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000e2');
select is(pg_temp.push('77770000-0000-7000-8000-00000000c0e2', 1, '{"kind":"patch","entity":"handoffs","id":"77770000-0000-7000-8000-0000000007f1","set":{"status":"accepted"}}'), 'ok', '10: Magdalena przyjmuje');
select is((select responsible_member_id::text from public.lists where id = '77770000-0000-7000-8000-0000000000c1'), '77770000-0000-7000-8000-0000000000a2', '11: zakupy przechodzą na nią');

-- 12–14: zakupy zrobione czyszczą pola; kolumny w synchronizacji.
select is(pg_temp.push('77770000-0000-7000-8000-00000000c0e2', 2, '{"kind":"patch","entity":"lists","id":"77770000-0000-7000-8000-0000000000c1","set":{"due_date":null,"due_time":null,"responsible_member_id":null}}'), 'ok', '12: zakupy zrobione — czyszczenie dnia i osoby');
select is((select coalesce(due_date::text, '-') || coalesce(responsible_member_id::text, '-') from public.lists where id = '77770000-0000-7000-8000-0000000000c1'), '--', '13: pola puste');
select is((select count(*)::int from private.sync_entities where entity = 'lists' and 'responsible_member_id' = any (patch_cols) and 'due_date' = any (insert_cols)), 1, '14: kolumny w białej liście synchronizacji');

select * from finish();
rollback;
