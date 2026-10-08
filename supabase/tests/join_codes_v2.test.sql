-- Zaproszenia po audycie 2 (migracja 20261008362000_join_codes_v2): jeden aktywny kod na grupę i rolę (PW-41 A), „Nowy kod”,
-- ponowne losowanie przy kolizji (B-8), powrót osoby usuniętej tylko z nowego zaproszenia (PW-6 A), imię przy powrocie (R-25),
-- limit nieudanych prób na kod zamiast blokady ID grupy (D140 odwrócona).
begin;
select plan(34);

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-0000000000d1', 'o@x.test'),
  ('00000000-0000-7000-8000-0000000000d2', 'a@x.test'),
  ('00000000-0000-7000-8000-0000000000d3', 'm@x.test'),
  ('00000000-0000-7000-8000-0000000000d4', 'x@x.test');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.p(client text, op jsonb) returns text language plpgsql as $$
declare s int := coalesce(nullif(current_setting('jc.seq_' || replace(client, '-', ''), true), ''), '0')::int + 1;
begin
  perform set_config('jc.seq_' || replace(client, '-', ''), s::text, true);
  return coalesce(public.sync_push(client::uuid, 1, jsonb_build_array(op || jsonb_build_object('seq', s))) -> 'results' -> 0 ->> 'code', 'ok');
end $$;
create table pg_temp.c (k text primary key, v jsonb);
grant all on pg_temp.c to authenticated;
grant execute on all functions in schema pg_temp to authenticated;
create function pg_temp.code(k text) returns text language sql as $$ select v ->> 'code' from pg_temp.c where c.k = code.k $$;
create function pg_temp.jid() returns text language sql security definer as $$ select join_id from public.groups where id = 'f0f40000-0000-7000-8000-000000000001' $$;
grant execute on all functions in schema pg_temp to authenticated;

-- G: D1 owner (h1), D2 admin (h2), D3 member (h3).
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d1');
set local role authenticated;
select public.create_group('f0f40000-0000-7000-8000-000000000001', 'G', 'f0f40000-0000-7000-8000-0000000000a1', 'Ola');
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('f0f40000-0000-7000-8000-0000000000a2', 'f0f40000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000d2', 'Adam', 'admin'),
  ('f0f40000-0000-7000-8000-0000000000a3', 'f0f40000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000d3', 'Marta', 'member');

-- ───────── Jeden aktywny kod na grupę i rolę (PW-41 A) ─────────
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d1');
set local role authenticated;
insert into pg_temp.c values ('a', public.create_join_code('f0f40000-0000-7000-8000-000000000001'));
insert into pg_temp.c values ('a2', public.create_join_code('f0f40000-0000-7000-8000-000000000001'));
select is((select v ->> 'invite_id' from pg_temp.c where k = 'a2'), (select v ->> 'invite_id' from pg_temp.c where k = 'a'), '1: drugie „Zaproś” pokazuje ten sam ważny kod');
select is(pg_temp.code('a2'), pg_temp.code('a'), '2: z tym samym kodem');
insert into pg_temp.c values ('b', public.create_join_code('f0f40000-0000-7000-8000-000000000001', 'admin'));
select isnt((select v ->> 'invite_id' from pg_temp.c where k = 'b'), (select v ->> 'invite_id' from pg_temp.c where k = 'a'), '3: kod admina osobno');
select throws_ok($$ select code from public.invites $$, '42501', null, '4: kodu w jawnej postaci nie czyta się z tabeli');
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d2');
set local role authenticated;
select is(public.create_join_code('f0f40000-0000-7000-8000-000000000001') ->> 'code', pg_temp.code('a'), '5: admin dostaje bieżący kod członka');
select throws_ok($$ select public.create_join_code('f0f40000-0000-7000-8000-000000000001', 'admin') $$, 'P0001', 'forbidden:role', '6: admin nie dostaje kodu admina');
select throws_ok($$ select public.renew_join_code('f0f40000-0000-7000-8000-000000000001', 'admin') $$, 'P0001', 'forbidden:role', '7: ani nowego');
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d3');
set local role authenticated;
select throws_ok($$ select public.create_join_code('f0f40000-0000-7000-8000-000000000001') $$, 'P0001', 'forbidden', '8: członek nie zaprasza');
select throws_ok($$ select public.renew_join_code('f0f40000-0000-7000-8000-000000000001') $$, 'P0001', 'forbidden', '9: ani nie tworzy nowego kodu');
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d1');
set local role authenticated;
select throws_ok($$ select public.renew_join_code('00000000-0000-7000-8000-0000000000d1') $$, 'P0001', 'forbidden:personal_group', '10: grupa osobista bez kodów');
select throws_ok($$ select public.renew_join_code('f0f40000-0000-7000-8000-000000000001', 'owner') $$, 'P0001', 'invalid_value:role', '11: rola spoza zaproszeń');
-- „Nowy kod”: poprzedni tej roli przestaje działać, kod admina zostaje.
insert into pg_temp.c values ('n', public.renew_join_code('f0f40000-0000-7000-8000-000000000001'));
select isnt(pg_temp.code('n'), null, '12: nowy kod');
select isnt((select v ->> 'invite_id' from pg_temp.c where k = 'n'), (select v ->> 'invite_id' from pg_temp.c where k = 'a'), '13: inne zaproszenie');
reset role;
select isnt((select revoked_at from public.invites where id = (select (v ->> 'invite_id')::uuid from pg_temp.c where k = 'a')), null, '14: poprzedni kod członka unieważniony');
select is((select revoked_at from public.invites where id = (select (v ->> 'invite_id')::uuid from pg_temp.c where k = 'b')), null, '15: kod admina bez zmian');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d4');
set local role authenticated;
select is(public.join_group(pg_temp.jid(), pg_temp.code('a'), 'X') ->> 'error', 'invite_revoked', '16: stary kod nie działa');
reset role;
-- Wygasły bieżący kod: „Zaproś” tworzy nowy.
update public.invites set expires_at = now() - interval '1 second' where id = (select (v ->> 'invite_id')::uuid from pg_temp.c where k = 'n');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d1');
set local role authenticated;
insert into pg_temp.c values ('e', public.create_join_code('f0f40000-0000-7000-8000-000000000001'));
select isnt((select v ->> 'invite_id' from pg_temp.c where k = 'e'), (select v ->> 'invite_id' from pg_temp.c where k = 'n'), '17: po wygaśnięciu — nowy kod');
reset role;
select is((select count(*)::int from public.invites where group_id = 'f0f40000-0000-7000-8000-000000000001' and kind = 'code' and role = 'member' and revoked_at is null), 1, '18: jeden nieunieważniony kod członka');

-- ───────── Powrót osoby usuniętej (PW-6 A) i imię przy powrocie (R-25) ─────────
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d1');
set local role authenticated;
create temp table tok as select public.create_invite('f0f40000-0000-7000-8000-000000000001') ->> 't' t, public.create_invite('f0f40000-0000-7000-8000-000000000001') ->> 'token' owner_tok;
grant select on tok to authenticated;
select is(pg_temp.p('c1000000-0000-7000-8000-000000000001', '{"kind":"delete","entity":"group_members","id":"f0f40000-0000-7000-8000-0000000000a3"}'), 'ok', '19: owner usuwa D3');
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d3');
set local role authenticated;
select throws_ok($$ select public.accept_invite((select owner_tok from tok)) $$, 'P0001', 'invite_removed', '20: link sprzed usunięcia — nie');
select is(public.join_group(pg_temp.jid(), pg_temp.code('e'), 'Marta') ->> 'error', 'invite_removed', '21: kod sprzed usunięcia — nie (komunikat dla tej osoby)');
reset role;
select is((select count(*)::int from private.join_attempts where user_id = '00000000-0000-7000-8000-0000000000d3'), 1, '22: nieudana próba liczy się do limitu');
-- Test działa w jednej transakcji (now() stoi w miejscu): usunięcie „minutę temu”, nowe zaproszenie — teraz.
alter table public.group_members disable trigger group_members_t_removal;
update public.group_members set removed_at = now() - interval '1 minute' where member_id = 'f0f40000-0000-7000-8000-0000000000a3';
alter table public.group_members enable trigger group_members_t_removal;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d1');
set local role authenticated;
insert into pg_temp.c values ('r', public.renew_join_code('f0f40000-0000-7000-8000-000000000001'));
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d3');
set local role authenticated;
select is(public.join_group(pg_temp.jid(), pg_temp.code('r'), ' Marta N. ') ->> 'already_member', 'false', '23: nowy kod po usunięciu — wraca');
reset role;
select is((select display_name from public.group_members where member_id = 'f0f40000-0000-7000-8000-0000000000a3'), 'Marta N.', '24: z imieniem wpisanym przy powrocie');
select is((select removed_at from public.group_members where member_id = 'f0f40000-0000-7000-8000-0000000000a3'), null, '25: ślad usunięcia znika');
-- Samodzielne wyjście i powrót bez imienia: dawne imię zostaje; stare zaproszenia działają jak dotąd.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d3');
set local role authenticated;
select is(pg_temp.p('c3000000-0000-7000-8000-000000000003', '{"kind":"delete","entity":"group_members","id":"f0f40000-0000-7000-8000-0000000000a3"}'), 'ok', '26: D3 wychodzi sama');
select is(public.accept_invite((select owner_tok from tok), '  ') ->> 'already_member', 'false', '27: po wyjściu wraca linkiem sprzed wyjścia');
reset role;
select is((select display_name from public.group_members where member_id = 'f0f40000-0000-7000-8000-0000000000a3'), 'Marta N.', '28: bez imienia w żądaniu — dawne imię');

-- ───────── D140 odwrócona: limit na kod zamiast blokady ID grupy ─────────
delete from private.join_attempts;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d1');
set local role authenticated;
insert into pg_temp.c values ('t', public.renew_join_code('f0f40000-0000-7000-8000-000000000001'));
reset role;
-- Próby sprzed utworzenia kodu się nie liczą; nowych 99 cudzych nieudanych — kod jeszcze działa.
insert into private.join_attempts (user_id, join_id, at) select gen_random_uuid(), pg_temp.jid(), now() - interval '2 hours' from generate_series(1, 150);
insert into private.join_attempts (user_id, join_id) select gen_random_uuid(), pg_temp.jid() from generate_series(1, private.join_fails_per_code() - 1);
select is((select revoked_at from public.invites where id = (select (v ->> 'invite_id')::uuid from pg_temp.c where k = 't')), null, '29: 99 nieudanych prób — kod działa');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d4');
set local role authenticated;
select is(public.join_group(pg_temp.jid(), '000000', 'X') ->> 'error', 'invite_invalid', '30: setna nieudana próba');
reset role;
select isnt((select revoked_at from public.invites where id = (select (v ->> 'invite_id')::uuid from pg_temp.c where k = 't')), null, '31: kod po limicie prób unieważniony');
select isnt((select revoked_at from public.invites where id = (select (v ->> 'invite_id')::uuid from pg_temp.c where k = 'b')), null, '32: także kod admina tej grupy (każda próba to strzał w oba kody)');

-- Losowanie podstawione: najpierw kod zajęty przez dawne (unieważnione) zaproszenie grupy, potem wolny.
create table pg_temp.rd (calls int);
insert into pg_temp.rd values (0);
insert into public.invites (group_id, token_hash, role, created_by, expires_at, max_uses, kind, revoked_at)
  values ('f0f40000-0000-7000-8000-000000000001', private.token_hash(pg_temp.jid() || ':111111'), 'member', 'f0f40000-0000-7000-8000-0000000000a1', now() - interval '2 days', 50, 'code', now() - interval '2 days');
create or replace function private.random_digits(n int) returns text language plpgsql volatile set search_path = '' as $$
declare k int;
begin
  update pg_temp.rd set calls = calls + 1 returning calls into k;
  return case when k = 1 then '111111' else '222222' end;
end $$;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d1');
set local role authenticated;
select is(public.renew_join_code('f0f40000-0000-7000-8000-000000000001') ->> 'code', '222222', '33: przy kolizji losujemy ponownie (dotąd błąd 23505)');
reset role;
create or replace function private.random_digits(n int) returns text language sql volatile set search_path = '' as $$ select '111111' $$;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d1');
set local role authenticated;
select throws_ok($$ select public.renew_join_code('f0f40000-0000-7000-8000-000000000001') $$, '23505', null, '34: 10 kolizji z rzędu — błąd zamiast pętli bez końca');
reset role;

select * from finish();
rollback;
