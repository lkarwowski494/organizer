-- ID grupy + 6-cyfrowy kod (migracja 20261008250000_join_codes, D92–D94).
begin;
select plan(22);

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-0000000000a1', 'o@x.test'),
  ('00000000-0000-7000-8000-0000000000a2', 'b@x.test'),
  ('00000000-0000-7000-8000-0000000000a3', 'c@x.test'),
  ('00000000-0000-7000-8000-0000000000a4', 'd@x.test');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
grant execute on function pg_temp.as_user(text) to authenticated;

select pg_temp.as_user('00000000-0000-7000-8000-0000000000a1');
set local role authenticated;
select public.create_group('cccc0000-0000-7000-8000-000000000001', 'Rodzina', 'cccc0000-0000-7000-8000-0000000000b1', 'Ola');
reset role;
select pg_temp.as_user('');

select ok((select join_id ~ '^[1-9][0-9]{8}$' from public.groups where id = 'cccc0000-0000-7000-8000-000000000001'), '1: wspólna grupa dostaje 9-cyfrowe ID');
select is((select join_id from public.groups where kind = 'personal' and id = '00000000-0000-7000-8000-0000000000a1'), null, '2: grupa osobista bez ID');

select pg_temp.as_user('00000000-0000-7000-8000-0000000000a1');
set local role authenticated;
create temp table jc as select public.create_join_code('cccc0000-0000-7000-8000-000000000001') as r;
select ok((select (r ->> 'code') ~ '^[0-9]{6}$' and r ->> 'join_id' = (select join_id from public.groups where id = 'cccc0000-0000-7000-8000-000000000001') from jc), '3: kod 6 cyfr z ID grupy');
select ok((select (r ->> 'expires_at')::timestamptz between now() + interval '23 hours 59 minutes' and now() + interval '24 hours 1 minute' from jc), '4: ważny 24 h');
select throws_ok($$ update public.groups set join_id = '123456789' where id = 'cccc0000-0000-7000-8000-000000000001' $$, null, null, '5: ID nie zmienia się zwykłą edycją');
reset role;

-- Druga osoba dołącza ID + kodem (spacje i myślniki dozwolone), trzecia też — kod jest dla wielu osób.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000a2');
set local role authenticated;
select is((public.join_group((select regexp_replace(r ->> 'join_id', '(...)(...)(...)', '\1 \2 \3') from jc), (select r ->> 'code' from jc), 'Bartek') ->> 'already_member'), 'false', '6: dołączenie ID + kodem');
select is((public.join_group((select r ->> 'join_id' from jc), (select r ->> 'code' from jc), 'Bartek') ->> 'already_member'), 'true', '7: drugi raz — już jestem w grupie');
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000a3');
set local role authenticated;
select is((public.join_group((select r ->> 'join_id' from jc), (select r ->> 'code' from jc), 'Celina') ->> 'group_id'), 'cccc0000-0000-7000-8000-000000000001', '8: kod działa dla kolejnej osoby');
reset role;
select is((select array_agg(display_name order by display_name) from public.group_members where group_id = 'cccc0000-0000-7000-8000-000000000001'), '{Bartek,Celina,Ola}', '9: obie osoby w grupie jako członkowie');

-- Zły kod: jeden ogólny błąd, próba zapisana; po 5 nieudanych w ciągu godziny — blokada osoby.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000a4');
set local role authenticated;
select is(public.join_group((select r ->> 'join_id' from jc), '000000', 'D') ->> 'error', 'invite_invalid', '10: zły kod');
select is(public.join_group('999999999', '000000', 'D') ->> 'error', 'invite_invalid', '11: nieznane ID — ten sam błąd (nie zdradzamy, czy grupa istnieje)');
select public.join_group('999999999', '000000', 'D') from generate_series(1, 3);
select is(public.join_group((select r ->> 'join_id' from jc), (select r ->> 'code' from jc), 'D') ->> 'error', 'rate_limited', '12: po 5 nieudanych próbach nawet dobry kod czeka godzinę');
reset role;
select is((select count(*)::int from private.join_attempts where user_id = '00000000-0000-7000-8000-0000000000a4'), 5, '13: próby zapisane mimo błędów');
-- Limit grupy: 20 nieudanych na to ID w ciągu godziny blokuje wszystkich.
delete from private.join_attempts;
insert into private.join_attempts (user_id, join_id) select gen_random_uuid(), (select r ->> 'join_id' from jc) from generate_series(1, 20);
select pg_temp.as_user('00000000-0000-7000-8000-0000000000a4');
set local role authenticated;
select is(public.join_group((select r ->> 'join_id' from jc), (select r ->> 'code' from jc), 'D') ->> 'error', 'rate_limited', '14: 20 nieudanych na ID grupy — blokada');
reset role;
update private.join_attempts set at = now() - interval '2 hours';

-- Wygasły kod.
update public.invites set expires_at = now() - interval '1 minute' where token_hash = private.token_hash((select (r ->> 'join_id') || ':' || (r ->> 'code') from jc));
select pg_temp.as_user('00000000-0000-7000-8000-0000000000a4');
set local role authenticated;
select is(public.join_group((select r ->> 'join_id' from jc), (select r ->> 'code' from jc), 'D') ->> 'error', 'invite_expired', '15: kod po 24 h nie działa');
reset role;

-- Nowe ID (owner): stare kody przestają działać; członek nie może zmienić ID ani tworzyć kodów.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000a1');
set local role authenticated;
create temp table jc2 as select public.create_join_code('cccc0000-0000-7000-8000-000000000001') as r;
select ok(public.rotate_join_id('cccc0000-0000-7000-8000-000000000001') <> (select r ->> 'join_id' from jc2), '16: nowe ID grupy');
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000a4');
set local role authenticated;
select is(public.join_group((select r ->> 'join_id' from jc2), (select r ->> 'code' from jc2), 'D') ->> 'error', 'invite_invalid', '17: kod na stare ID nie działa');
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000a2');
set local role authenticated;
select throws_ok($$ select public.create_join_code('cccc0000-0000-7000-8000-000000000001') $$, 'P0001', 'forbidden', '18: członek nie tworzy kodów');
select throws_ok($$ select public.rotate_join_id('cccc0000-0000-7000-8000-000000000001') $$, 'P0001', 'forbidden', '19: członek nie zmienia ID');
select throws_ok($$ select count(*) from private.join_attempts $$, '42501', null, '20: telefon nie czyta prób');
-- „ID:kod” jako token do accept_invite (ominięcie limitu) — odrzucone; długi token nie działa w join_group.
select throws_ok(format($$ select public.accept_invite(%L) $$, (select (j.join_id) || ':' || (r ->> 'code') from jc2, public.groups j where j.id = 'cccc0000-0000-7000-8000-000000000001')), 'P0001', null, '21: kod nie przechodzi drogą tokenu');
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000a1');
set local role authenticated;
create temp table jc3 as select public.create_join_code('cccc0000-0000-7000-8000-000000000001') as r;
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000a4');
set local role authenticated;
select throws_ok(format($$ select public.accept_invite(%L) $$, (select (r ->> 'join_id') || ':' || (r ->> 'code') from jc3)), 'P0001', 'invite_invalid', '22: ważny kod też nie przechodzi drogą tokenu');
reset role;

select * from finish();
rollback;
