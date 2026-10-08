-- Potwierdzanie obecności (migracja 20261008270000_event_rsvps, D124): za siebie, dorosły za dziecko bez konta,
-- widoczność w grupie, niezmienne klucze, czyszczenie kosza.
begin;
select plan(14);

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-0000000000e1', 'a@x.test'),
  ('00000000-0000-7000-8000-0000000000e2', 'b@x.test'),
  ('00000000-0000-7000-8000-0000000000e3', 'c@x.test'),
  ('00000000-0000-7000-8000-0000000000e4', 'z@x.test');

create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.push(client text, seq int, op jsonb) returns text language sql as $$
  select coalesce(public.sync_push(client::uuid, 1, jsonb_build_array(op || jsonb_build_object('seq', seq))) -> 'results' -> 0 ->> 'code', 'ok')
$$;
create function pg_temp.rsvp(id text, member text, answer text) returns jsonb language sql as $$
  select jsonb_build_object('kind', 'create', 'entity', 'event_rsvps', 'id', '66660000-0000-7000-8000-0000000007' || id,
    'group_id', '66660000-0000-7000-8000-000000000001',
    'set', jsonb_build_object('event_id', '66660000-0000-7000-8000-0000000001e1', 'occurrence_date', '2026-10-12', 'member_id', '66660000-0000-7000-8000-0000000000' || member, 'answer', answer))
$$;
grant execute on function pg_temp.as_user(text), pg_temp.push(text, int, jsonb), pg_temp.rsvp(text, text, text) to authenticated;

select pg_temp.as_user('00000000-0000-7000-8000-0000000000e1');
set local role authenticated;
select public.create_group('66660000-0000-7000-8000-000000000001', 'Rodzina', '66660000-0000-7000-8000-0000000000a1', 'A');
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('66660000-0000-7000-8000-0000000000a2', '66660000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000e2', 'B', 'member'),
  ('66660000-0000-7000-8000-0000000000a3', '66660000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000e3', 'C', 'child'),
  ('66660000-0000-7000-8000-0000000000a5', '66660000-0000-7000-8000-000000000001', null, 'Tymek', 'child');

select pg_temp.as_user('00000000-0000-7000-8000-0000000000e1');
set local role authenticated;
select pg_temp.push('66660000-0000-7000-8000-00000000c0e1', 1, '{"kind":"create","entity":"events","id":"66660000-0000-7000-8000-0000000001e1","group_id":"66660000-0000-7000-8000-000000000001","set":{"title":"Basen","start_date":"2026-10-05","start_time":"18:00","rrule":"FREQ=WEEKLY;BYDAY=MO"}}') is not null;

-- 1–4: za siebie i za dziecko bez konta.
select is(pg_temp.push('66660000-0000-7000-8000-00000000c0e1', 2, pg_temp.rsvp('01', 'a1', 'yes')), 'ok', '1: odpowiadam za siebie');
select is((select answered_by::text from public.event_rsvps where id = '66660000-0000-7000-8000-000000000701'), '66660000-0000-7000-8000-0000000000a1', '2: kto odpowiedział — ustawia serwer');
select is(pg_temp.push('66660000-0000-7000-8000-00000000c0e1', 3, pg_temp.rsvp('05', 'a5', 'no')), 'ok', '3: dorosły za dziecko bez konta');
select is(pg_temp.push('66660000-0000-7000-8000-00000000c0e1', 4, pg_temp.rsvp('02', 'a2', 'yes')), 'forbidden:not_self', '4: nie za innego dorosłego');

-- 5–7: dziecko z kontem.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000e3');
select is(pg_temp.push('66660000-0000-7000-8000-00000000c0e3', 1, pg_temp.rsvp('03', 'a3', 'maybe')), 'ok', '5: dziecko z kontem odpowiada samo');
select is(pg_temp.push('66660000-0000-7000-8000-00000000c0e3', 2, pg_temp.rsvp('06', 'a5', 'yes')), 'forbidden:not_self', '6: dziecko nie odpowiada za dziecko');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000e1');
select is(pg_temp.push('66660000-0000-7000-8000-00000000c0e1', 5, pg_temp.rsvp('04', 'a3', 'no')), 'forbidden:not_self', '7: dorosły nie za dziecko z kontem');

-- 8–10: zmiana odpowiedzi, niezmienne klucze, zła wartość.
select is(pg_temp.push('66660000-0000-7000-8000-00000000c0e1', 6, '{"kind":"patch","entity":"event_rsvps","id":"66660000-0000-7000-8000-000000000705","set":{"answer":"maybe"}}'), 'ok', '8: zmiana odpowiedzi');
select is(pg_temp.push('66660000-0000-7000-8000-00000000c0e1', 7, '{"kind":"patch","entity":"event_rsvps","id":"66660000-0000-7000-8000-000000000705","set":{"member_id":"66660000-0000-7000-8000-0000000000a2"}}') <> 'ok', true, '9: osoby nie da się zmienić');
select isnt(pg_temp.push('66660000-0000-7000-8000-00000000c0e1', 8, pg_temp.rsvp('07', 'a1', 'perhaps')), 'ok', '10: tylko yes / no / maybe');

-- 11–12: widoczność.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000e2');
select is((select count(*)::int from public.event_rsvps), 3, '11: grupa widzi odpowiedzi');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000e4');
select is((select count(*)::int from public.event_rsvps), 0, '12: obcy nie widzi');

-- 13–14: czyszczenie kosza: wydarzenie z odpowiedziami znika razem z nimi; twarde usunięcie grupy.
reset role;
select pg_temp.as_user('');
update public.events set deleted_at = now() - interval '31 days' where id = '66660000-0000-7000-8000-0000000001e1';
select lives_ok($$ select private.purge_tombstones() $$, '13: czyszczenie kosza nie przerywa się');
select is((select count(*)::int from public.events where id = '66660000-0000-7000-8000-0000000001e1') + (select count(*)::int from public.event_rsvps), 0, '14: wydarzenie i odpowiedzi usunięte');

select * from finish();
rollback;
