-- Zgłaszanie błędów i opinii (migracja 20261008190000_feedback, D80).
begin;
select plan(10);

insert into auth.users (id, email) values ('00000000-0000-7000-8000-0000000000c1', 'a@x.test'), ('00000000-0000-7000-8000-0000000000c2', 'b@x.test');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
grant execute on function pg_temp.as_user(text) to authenticated;

select pg_temp.as_user('00000000-0000-7000-8000-0000000000c1');
set local role authenticated;
select lives_ok($$ select public.report_client_error('crash', 'TypeError: x is undefined', 'at f (app.js:1)', 'Task', '1.0 (12)') $$, '1: zgłoszenie błędu');
select throws_ok($$ select count(*) from public.client_errors $$, '42501', null, '2: telefon nie czyta błędów');
select throws_ok($$ select public.report_client_error('inny', 'x', null, null, null) $$, '23514', null, '3: zły rodzaj odrzucony');
select lives_ok($$ select public.report_client_error('diagnostic', 'selfcheck ok', '{"sqlite_version":"3.45.0"}', 'selfcheck', '1.0 (14)') $$, '3b: samosprawdzenie telefonu (D83)');
select lives_ok($$ select public.send_feedback('  Brakuje mi listy stałych zakupów  ', 'Settings', '1.0 (12)') $$, '4: opinia');
select throws_ok($$ select public.send_feedback('   ', null, null) $$, 'P0001', 'invalid_value:message', '5: pusta opinia odrzucona');
select throws_ok($$ select count(*) from public.app_feedback $$, '42501', null, '6: telefon nie czyta opinii');
-- Limit dzienny błędów: ponad limit po cichu nic.
select public.report_client_error('error', 'e' || g, null, null, null) from generate_series(1, 60) g;
reset role;
select is((select count(*)::int from public.client_errors where user_id = '00000000-0000-7000-8000-0000000000c1'), 50, '7: najwyżej 50 zgłoszeń dziennie na osobę');
select is((select message from public.app_feedback), 'Brakuje mi listy stałych zakupów', '8: opinia przycięta ze spacji');
-- Retencja: stare wpisy znikają przy następnym zapisie.
update public.client_errors set created_at = now() - interval '91 days';
select pg_temp.as_user('00000000-0000-7000-8000-0000000000c2');
set local role authenticated;
select public.report_client_error('error', 'nowy', null, null, null);
reset role;
select is((select count(*)::int from public.client_errors), 1, '9: wpisy starsze niż 90 dni usunięte');

select * from finish();
rollback;
