-- Limity na konto (D183, audyt 2, M-70; migracje 20261008392000_quotas i 20261008396000_join_handoff_fixes) oraz
-- zgłoszenia bez sprzątania przy zapisie (M-191).
begin;
select plan(16);

insert into auth.users (id, email) values ('00000000-0000-7000-8000-0000000019a1', 'a19@x.test'), ('00000000-0000-7000-8000-0000000019a2', 'b19@x.test');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
grant execute on function pg_temp.as_user(text) to authenticated;
create function pg_temp.err(q text) returns text language plpgsql as $$
begin execute q; return 'ok'; exception when others then return sqlerrm; end $$;
grant execute on function pg_temp.err(text) to authenticated;
create temp table lim as select private.max_shared_groups() g, private.max_active_invites() i, private.max_push_tokens() t,
  private.max_sync_clients() c, private.sync_push_per_minute() p, private.notify_per_hour() n;
grant select on lim to authenticated;

-- 1–4: grupy wspólne (także w koszu) najwyżej private.max_shared_groups().
select pg_temp.as_user('00000000-0000-7000-8000-0000000019a1');
set local role authenticated;
select count(public.create_group(('19190000-0000-7000-8000-' || lpad(i::text, 12, '0'))::uuid, 'G' || i, gen_random_uuid(), 'A'))
  from generate_series(1, (select g from lim)) i;
select is(pg_temp.err($$ select public.create_group('19190000-0000-7000-8000-100000000000', 'Za dużo', gen_random_uuid(), 'A') $$), 'limit:groups', '1: grupa ponad limit odrzucona');
reset role;
select pg_temp.as_user('');
update public.groups set deleted_at = now() where id = '19190000-0000-7000-8000-000000000001';
select pg_temp.as_user('00000000-0000-7000-8000-0000000019a1');
set local role authenticated;
select is(pg_temp.err($$ select public.create_group('19190000-0000-7000-8000-100000000000', 'Za dużo', gen_random_uuid(), 'A') $$), 'limit:groups', '2: grupa w koszu też się liczy');
-- B zaprasza A do swojej grupy: dołączenie ponad limit to komunikat, nie nieudana próba kodu.
select pg_temp.as_user('00000000-0000-7000-8000-0000000019a2');
select public.create_group('19190000-0000-7000-8000-200000000000', 'B', '19190000-0000-7000-8000-2000000000b1', 'B');
create temp table code as select public.create_join_code('19190000-0000-7000-8000-200000000000') as c;
select pg_temp.as_user('00000000-0000-7000-8000-0000000019a1');
select is(public.join_group((select c ->> 'join_id' from code), (select c ->> 'code' from code)) ->> 'error', 'limit:groups', '3: dołączenie ponad limit — limit:groups');
reset role;
select is((select count(*)::int from private.join_attempts where user_id = '00000000-0000-7000-8000-0000000019a1'), 0, '4: bez wpisu nieudanej próby');

-- 5–6: aktywne zaproszenia grupy najwyżej private.max_active_invites().
select pg_temp.as_user('00000000-0000-7000-8000-0000000019a2');
set local role authenticated;
select count(public.create_invite('19190000-0000-7000-8000-200000000000')) from generate_series(1, (select i from lim) - 1);
select is(pg_temp.err($$ select public.create_invite('19190000-0000-7000-8000-200000000000') $$), 'limit:invites', '5: zaproszenie ponad limit odrzucone');
reset role;
update public.invites set revoked_at = now() where id = (select id from public.invites where group_id = '19190000-0000-7000-8000-200000000000' and revoked_at is null limit 1);
set local role authenticated;
select is(pg_temp.err($$ select public.create_invite('19190000-0000-7000-8000-200000000000') $$), 'ok', '6: unieważnione się nie liczy');

-- 7–8: tokeny push — ponad limit wypada najdawniej odświeżony.
select public.register_push_token(repeat(to_hex(i), 64 / length(to_hex(i)) + 1)::text, 'production') from generate_series(1, (select t from lim)) i;
reset role;
update public.push_tokens set updated_at = now() - interval '1 day' where token = repeat('1', 65);
set local role authenticated;
select public.register_push_token(repeat('e', 64), 'production');
reset role;
select is((select count(*)::int from public.push_tokens where user_id = '00000000-0000-7000-8000-0000000019a2'), private.max_push_tokens(), '7: tokenów najwyżej limit');
select is((select count(*)::int from public.push_tokens where token = repeat('1', 65)), 0, '8: wypadł najdawniej odświeżony');

-- 9–10: instalacje — ponad limit wypada najdawniej używana.
insert into private.sync_clients (client_id, user_id, last_seen_at)
  select ('19190000-0000-7000-8000-3000000000' || lpad(i::text, 2, '0'))::uuid, '00000000-0000-7000-8000-0000000019a2', now() - make_interval(days => i)
  from generate_series(1, private.max_sync_clients()) i;
set local role authenticated;
select public.sync_push('19190000-0000-7000-8000-3000000000ff', 2, '[]');
reset role;
select is((select count(*)::int from private.sync_clients where user_id = '00000000-0000-7000-8000-0000000019a2'), private.max_sync_clients(), '9: instalacji najwyżej limit');
select is((select count(*)::int from private.sync_clients where client_id = ('19190000-0000-7000-8000-3000000000' || private.max_sync_clients())::uuid), 0, '10: wypadła najdawniej używana');

-- 11–12: sync_push najwyżej private.sync_push_per_minute() wywołań na minutę.
set local role authenticated;
select count(public.sync_push('19190000-0000-7000-8000-3000000000ff', 2, '[]')) from generate_series(2, (select p from lim));
select is(pg_temp.err($$ select public.sync_push('19190000-0000-7000-8000-3000000000ff', 2, '[]') $$), 'rate_limited', '11: wywołanie ponad limit — rate_limited');
reset role;
update private.rate_counters set window_start = now() - interval '61 seconds' where user_id = '00000000-0000-7000-8000-0000000019a2' and kind = 'sync_push';
set local role authenticated;
select is(pg_temp.err($$ select public.sync_push('19190000-0000-7000-8000-3000000000ff', 2, '[]') $$), 'ok', '12: po minucie znowu można');

-- 13–14: prośby o powiadomienie — tylko funkcja (klucz tajny), najwyżej private.notify_per_hour() na godzinę.
select ok(not has_function_privilege('authenticated', 'public.notify_rate_hit(uuid)', 'execute'), '13: telefon nie woła licznika powiadomień');
reset role;
select is((select array_agg(public.notify_rate_hit('00000000-0000-7000-8000-0000000019a2')) from generate_series(1, private.notify_per_hour() + 1))[private.notify_per_hour():],
  array[true, false], '14: ponad limit na godzinę — false');

-- 15–16: zgłoszenie błędu nie kasuje cudzych starych wierszy (M-191), limit dzienny bez zmian.
insert into public.client_errors (user_id, kind, message, created_at) values (null, 'error', 'stary', now() - interval '91 days');
set local role authenticated;
select public.report_client_error('error', 'nowy', null, null, null);
reset role;
select is((select count(*)::int from public.client_errors where message = 'stary'), 1, '15: zapis nie sprząta tabeli');
select is((select count(*)::int from public.client_errors where message = 'nowy'), 1, '16: zgłoszenie zapisane');

select * from finish();
rollback;
