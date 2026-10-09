-- Ciche powiadomienia „odśwież przypomnienia” (D159, migracja 20261008490000_reminder_wake): komu, przerwa między
-- powiadomieniami do urządzenia, zaległe i ponowienie, zwolnienie po błędzie APNs, uprawnienia.
-- W transakcji now() stoi w miejscu, więc upływ przerwy symulujemy cofnięciem sent_at.
begin;
select plan(24);

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-0000000000a1', 'l@x.test'),
  ('00000000-0000-7000-8000-0000000000a2', 'm@x.test'),
  ('00000000-0000-7000-8000-0000000000a3', 'o@x.test');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.toks(j jsonb) returns text language sql as $$
  select coalesce(string_agg(left(x ->> 'token', 4) || ':' || (x ->> 'env'), ',' order by x ->> 'token'), '') from jsonb_array_elements(j -> 'tokens') x
$$;
create function pg_temp.claim(u text, groups uuid[], except_token text, retry boolean default false) returns jsonb language sql as $$
  select public.wake_push_claim(u::uuid, groups, except_token, retry)
$$;

-- Rodzina: Łukasz (telefon aaaa…, iPad bbbb…) i Magdalena (cccc…). Ola (dddd…) tylko w swojej grupie.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000a1');
set local role authenticated;
select public.create_group('eeee0000-0000-7000-8000-000000000001', 'Rodzina', 'eeee0000-0000-7000-8000-0000000000b1', 'Łukasz');
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000a3');
set local role authenticated;
select public.create_group('eeee0000-0000-7000-8000-000000000002', 'Ola', 'eeee0000-0000-7000-8000-0000000000b3', 'Ola');
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('eeee0000-0000-7000-8000-0000000000b2', 'eeee0000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000a2', 'Magdalena', 'member'),
  ('eeee0000-0000-7000-8000-0000000000b4', 'eeee0000-0000-7000-8000-000000000001', null, 'Tymek', 'child');
insert into public.push_tokens (token, user_id, env) values
  (repeat('aa', 32), '00000000-0000-7000-8000-0000000000a1', 'production'),
  (repeat('bb', 32), '00000000-0000-7000-8000-0000000000a1', 'sandbox'),
  (repeat('cc', 32), '00000000-0000-7000-8000-0000000000a2', 'production'),
  (repeat('dd', 32), '00000000-0000-7000-8000-0000000000a3', 'production');

-- 1–3: odrzucenia.
select throws_ok($$ select pg_temp.claim('00000000-0000-7000-8000-0000000000a1', '{}', null) $$, 'P0001', 'bad_request', '1: pusta lista grup');
select throws_ok($$ select pg_temp.claim('00000000-0000-7000-8000-0000000000a1', null, null) $$, 'P0001', 'bad_request', '2: brak listy');
select throws_ok($$ select pg_temp.claim('00000000-0000-7000-8000-0000000000a1', (select array_agg(gen_random_uuid()) from generate_series(1, private.wake_max_groups() + 1)), null) $$,
  'P0001', 'bad_request', '3: więcej grup niż private.wake_max_groups()');

-- 4–7: pierwsza prośba — członkowie moich grup bez tego urządzenia (token wielkimi literami też), cudza grupa pominięta.
select is(pg_temp.toks(pg_temp.claim('00000000-0000-7000-8000-0000000000a1', array['eeee0000-0000-7000-8000-000000000001', 'eeee0000-0000-7000-8000-000000000002']::uuid[], upper(repeat('aa', 32)))),
  'bbbb:sandbox,cccc:production', '4: iPad Łukasza i telefon Magdaleny; bez tego telefonu i bez grupy Oli');
select is((select count(*)::int from private.wake_state where token in (repeat('aa', 32), repeat('dd', 32))), 0, '5: to urządzenie i Ola bez stanu');
select is((select count(*)::int from private.wake_state where dirty), 0, '6: wysłane — bez zaległych');
select is(pg_temp.claim('00000000-0000-7000-8000-0000000000a1', array['eeee0000-0000-7000-8000-000000000001']::uuid[], repeat('aa', 32)) -> 'tokens', '[]'::jsonb, '7: zaraz potem — nic (przerwa)');

-- 8–10: zmiana w przerwie czeka; ponowienie przed końcem przerwy nic nie wysyła.
select is((select count(*)::int from private.wake_state where dirty), 2, '8: oba urządzenia czekają');
select is(pg_temp.claim('00000000-0000-7000-8000-0000000000a2', array['eeee0000-0000-7000-8000-000000000001']::uuid[], repeat('cc', 32)) -> 'retryInSec', to_jsonb(private.wake_min_gap_min() * 60),
  '9: retryInSec = cała przerwa (Magdalena pyta ze swojego telefonu)');
select is(pg_temp.claim('00000000-0000-7000-8000-0000000000a1', array['eeee0000-0000-7000-8000-000000000001']::uuid[], repeat('aa', 32), true) -> 'tokens', '[]'::jsonb, '10: ponowienie w przerwie — nic');

-- 11–13: po przerwie ponowienie wysyła zaległe, a kolejne — już nic.
update private.wake_state set sent_at = now() - make_interval(mins => private.wake_min_gap_min());
select is(pg_temp.toks(pg_temp.claim('00000000-0000-7000-8000-0000000000a1', array['eeee0000-0000-7000-8000-000000000001']::uuid[], repeat('aa', 32), true)),
  'bbbb:sandbox,cccc:production', '11: po przerwie — zaległe');
update private.wake_state set sent_at = now() - make_interval(mins => private.wake_min_gap_min());
select is(pg_temp.claim('00000000-0000-7000-8000-0000000000a1', array['eeee0000-0000-7000-8000-000000000001']::uuid[], repeat('aa', 32), true),
  '{"tokens": [], "retryInSec": null}'::jsonb, '12: ponowienie bez zaległych — nic i nic nie czeka');
select is(pg_temp.toks(pg_temp.claim('00000000-0000-7000-8000-0000000000a1', array['eeee0000-0000-7000-8000-000000000001']::uuid[], null)),
  'aaaa:production,bbbb:sandbox,cccc:production', '13: bez wskazania urządzenia — wszystkie urządzenia grupy');

-- 14–15: błąd APNs zwalnia urządzenie od razu.
select public.wake_push_release(array[upper(repeat('cc', 32))]);
select is((select dirty and sent_at is null from private.wake_state where token = repeat('cc', 32)), true, '14: zwolnione — zaległe bez przerwy');
select is(pg_temp.toks(pg_temp.claim('00000000-0000-7000-8000-0000000000a1', array['eeee0000-0000-7000-8000-000000000001']::uuid[], repeat('aa', 32), true)), 'cccc:production', '15: ponowienie wysyła zwolnione');

-- 16–17: obcy dla grupy nie budzi nikogo i nic nie zaznacza.
update private.wake_state set sent_at = now() - make_interval(mins => private.wake_min_gap_min());
select is(pg_temp.claim('00000000-0000-7000-8000-0000000000a3', array['eeee0000-0000-7000-8000-000000000001']::uuid[], repeat('dd', 32)) -> 'tokens', '[]'::jsonb, '16: Ola spoza Rodziny — nic');
select is((select count(*)::int from private.wake_state where dirty), 0, '17: bez zaznaczeń');

-- 18–19: osoba usunięta z grupy i grupa w koszu — bez powiadomień.
update public.group_members set deleted_at = now() where member_id = 'eeee0000-0000-7000-8000-0000000000b2';
select is(pg_temp.toks(pg_temp.claim('00000000-0000-7000-8000-0000000000a1', array['eeee0000-0000-7000-8000-000000000001']::uuid[], repeat('aa', 32))), 'bbbb:sandbox', '18: Magdalena po odejściu — bez powiadomienia');
update private.wake_state set sent_at = now() - make_interval(mins => private.wake_min_gap_min());
update public.groups set deleted_at = now() where id = 'eeee0000-0000-7000-8000-000000000001';
select is(pg_temp.claim('00000000-0000-7000-8000-0000000000a1', array['eeee0000-0000-7000-8000-000000000001']::uuid[], repeat('aa', 32)) -> 'tokens', '[]'::jsonb, '19: grupa w koszu — nic');

-- 20: token odrzucony przez APNs znika razem ze stanem.
select public.drop_push_token(repeat('bb', 32));
select is((select count(*)::int from private.wake_state where token = repeat('bb', 32)), 0, '20: stan znika z tokenem');

-- 21–24: uprawnienia — tylko service_role (funkcja notify-handoff).
set local role authenticated;
select throws_ok($$ select public.wake_push_claim('00000000-0000-7000-8000-0000000000a1', array[gen_random_uuid()], null, false) $$, '42501', null, '21: zalogowany nie woła claim');
select throws_ok($$ select public.wake_push_release(array['aa']) $$, '42501', null, '22: zalogowany nie zwalnia');
reset role;
set local role anon;
select throws_ok($$ select public.wake_push_claim('00000000-0000-7000-8000-0000000000a1', array[gen_random_uuid()], null, false) $$, '42501', null, '23: anonim nie woła claim');
reset role;
set local role service_role;
select lives_ok($$ select public.wake_push_release(array['aa']) $$, '24: service_role zwalnia');
reset role;

select * from finish();
rollback;
