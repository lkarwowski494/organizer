-- Kanały prywatne Realtime: sygnał słyszy tylko adresat (migracja 20261007120000_realtime_auth).
begin;
select plan(8);

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-0000000000e1', 'a@x.test'),
  ('00000000-0000-7000-8000-0000000000e2', 'b@x.test');
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-0000000000e1', true);
set local role authenticated;
select public.create_group('55550000-0000-7000-8000-000000000001', 'G', '55550000-0000-7000-8000-0000000000a1', 'A');
reset role;
select set_config('request.jwt.claim.sub', '', true);
insert into realtime.messages (topic, extension, event, payload, private) values
  ('user:00000000-0000-7000-8000-0000000000e1', 'broadcast', 'poke', '{"t": 1}', true),
  ('user:00000000-0000-7000-8000-0000000000e2', 'broadcast', 'poke', '{"t": 1}', true),
  ('group:55550000-0000-7000-8000-000000000001', 'broadcast', 'poke', '{"t": 1}', true),
  ('group:55550000-0000-7000-8000-000000000001', 'presence', 'x', '{"t": 1}', true);

select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-0000000000e1', true), set_config('realtime.topic', 'user:00000000-0000-7000-8000-0000000000e1', true);
set local role authenticated;
select is((select count(*)::int from realtime.messages where payload ? 't'), 1, '1: własny kanał użytkownika');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-0000000000e1', true), set_config('realtime.topic', 'user:00000000-0000-7000-8000-0000000000e2', true);
set local role authenticated;
select is((select count(*)::int from realtime.messages where payload ? 't'), 0, '2: cudzy kanał użytkownika — nic');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-0000000000e1', true), set_config('realtime.topic', 'group:55550000-0000-7000-8000-000000000001', true);
set local role authenticated;
select is((select count(*)::int from realtime.messages where payload ? 't'), 1, '3: kanał mojej grupy (tylko broadcast)');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-0000000000e2', true), set_config('realtime.topic', 'group:55550000-0000-7000-8000-000000000001', true);
set local role authenticated;
select is((select count(*)::int from realtime.messages where payload ? 't'), 0, '4: kanał cudzej grupy — nic');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-0000000000e2', true), set_config('realtime.topic', 'user:00000000-0000-7000-8000-0000000000e2', true);
set local role authenticated;
select is((select count(*)::int from realtime.messages where payload ? 't'), 1, '5: drugi użytkownik słyszy swój kanał');
reset role;
-- Po wyjściu z grupy kanał grupy milknie (zmiana w kontekście serwera).
select set_config('request.jwt.claim.sub', '', true);
update public.group_members set deleted_at = now() where member_id = '55550000-0000-7000-8000-0000000000a1';
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-0000000000e1', true), set_config('realtime.topic', 'group:55550000-0000-7000-8000-000000000001', true);
set local role authenticated;
select is((select count(*)::int from realtime.messages where payload ? 't'), 0, '6: po wyjściu z grupy — nic');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-0000000000e1', true), set_config('realtime.topic', '', true);
set local role authenticated;
select is((select count(*)::int from realtime.messages where payload ? 't'), 0, '7: bez tematu — nic');
reset role;
set local role authenticated;
select throws_ok($$ insert into realtime.messages (topic, event, payload) values ('user:x', 'poke', '{}') $$, '42501', null, '8: klient nie nadaje');
reset role;

select * from finish();
rollback;
