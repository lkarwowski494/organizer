-- Zaproszenia linkiem (migracja 20261007090000_invites) i poprawki strażnika członkostw.
begin;
select plan(34);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-7000-8000-00000000000a', 'a@x.test', '{"display_name":"Ala"}'),
  ('00000000-0000-7000-8000-00000000000b', 'b@x.test', '{"display_name":"Bartek"}'),
  ('00000000-0000-7000-8000-00000000000c', 'c@x.test', '{"display_name":"Celina"}'),
  ('00000000-0000-7000-8000-00000000000d', 'd@x.test', '{}');

create temp table t (k text primary key, v jsonb) on commit drop;
grant all on t to authenticated;

select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-00000000000a', true);
set local role authenticated;
select public.create_group('88888888-0000-7000-8000-000000000001', 'Rodzina', '88888888-0000-7000-8000-0000000000a1', 'Ala');

-- 1–8: tworzenie i walidacja.
insert into t values ('i1', public.create_invite('88888888-0000-7000-8000-000000000001'));
select ok(length((select v ->> 'token' from t where k = 'i1')) = 64, '1: token 64 znaki (2 × UUID bez kresek)');
select is((select (v ->> 'max_uses')::int from t where k = 'i1'), 10, '2: domyślny limit użyć (config)');
select ok((select (v ->> 'expires_at')::timestamptz from t where k = 'i1') between now() + interval '167 hours' and now() + interval '169 hours', '3: domyślna ważność 7 dni (config)');
reset role;
select ok(not exists (select 1 from public.invites where encode(token_hash, 'escape') like '%' || (select v ->> 'token' from t where k = 'i1') || '%'), '4: w bazie nie ma jawnego tokenu');
select is((select token_hash from public.invites where id = (select (v ->> 'invite_id')::uuid from t where k = 'i1')), sha256(convert_to((select v ->> 'token' from t where k = 'i1'), 'UTF8')), '5: w bazie jest SHA-256 tokenu');
set local role authenticated;
select throws_ok($$ select public.create_invite('88888888-0000-7000-8000-000000000001', 'member', 721) $$, 'P0001', 'invalid_value:ttl', '6: ważność ponad limit');
select throws_ok($$ select public.create_invite('88888888-0000-7000-8000-000000000001', 'member', null, 51) $$, 'P0001', 'invalid_value:max_uses', '7: limit użyć ponad maksimum');
select throws_ok($$ select public.create_invite('88888888-0000-7000-8000-000000000001', 'owner') $$, 'P0001', 'invalid_value:role', '8: nie zaprasza się ownera');
select throws_ok($$ select public.create_invite('00000000-0000-7000-8000-00000000000a') $$, 'P0001', 'forbidden:personal_group', '9: grupy osobistej nie udostępnia się');
select throws_ok($$ select public.create_invite(gen_random_uuid()) $$, 'P0001', 'forbidden', '10: cudza / nieistniejąca grupa');
select throws_ok($$ insert into public.invites (group_id, token_hash, created_by, expires_at, max_uses) values ('88888888-0000-7000-8000-000000000001', '\x00', '88888888-0000-7000-8000-0000000000a1', now() + interval '1 day', 1) $$, '42501', null, '11: brak bezpośredniego zapisu do invites');
select ok((select count(*) from public.invites) = 1, '12: owner widzi swoje zaproszenia');
insert into t values ('one', public.create_invite('88888888-0000-7000-8000-000000000001', 'member', 1, 1));
insert into t values ('adm', public.create_invite('88888888-0000-7000-8000-000000000001', 'admin'));

-- 13–20: przyjęcie przez B.
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-00000000000b', true);
select is((select count(*)::int from public.invites), 0, '13: zwykły użytkownik nie widzi zaproszeń');
select throws_ok($$ select public.accept_invite('zly-token') $$, 'P0001', 'invite_invalid', '14: zły token');
insert into t values ('b', public.accept_invite((select v ->> 'token' from t where k = 'i1')));
select is((select v ->> 'already_member' from t where k = 'b'), 'false', '15: B dołącza');
select is((select role from public.group_members where user_id = '00000000-0000-7000-8000-00000000000b' and group_id = '88888888-0000-7000-8000-000000000001'), 'member', '16: z rolą z zaproszenia');
select is((select display_name from public.group_members where user_id = '00000000-0000-7000-8000-00000000000b' and group_id = '88888888-0000-7000-8000-000000000001'), 'Bartek', '17: z imieniem z profilu');
select is((public.accept_invite((select v ->> 'token' from t where k = 'i1')) ->> 'already_member'), 'true', '18: ponowne przyjęcie bez skutku');
reset role;
select is((select uses from public.invites where id = (select (v ->> 'invite_id')::uuid from t where k = 'i1')), 1, '19: ponowne przyjęcie nie zużywa użycia');
select is((select count(*)::int from private.access_events where user_id = '00000000-0000-7000-8000-00000000000b' and group_id = '88888888-0000-7000-8000-000000000001' and kind = 'group_granted'), 1, '20: zdarzenie dostępu');

-- 21–22: B nie podrobi zaproszenia flagą bez tokenu.
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-00000000000b', true);
set local role authenticated;
select set_config('organizer.invite_hash', encode(sha256('falszywy'), 'hex'), true);
select throws_ok($$ update public.group_members set role = 'admin' where user_id = '00000000-0000-7000-8000-00000000000b' and group_id = '88888888-0000-7000-8000-000000000001' $$, 'P0001', 'forbidden:role', '21: flaga bez ważnego tokenu nic nie daje');
select set_config('organizer.invite_hash', '', true);

-- 22–24: limit użyć, wyjście i powrót (ten sam member_id).
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-00000000000c', true);
select is((public.accept_invite((select v ->> 'token' from t where k = 'one')) ->> 'already_member'), 'false', '22: C zużywa zaproszenie jednorazowe');
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-00000000000d', true);
select throws_ok($$ select public.accept_invite((select v ->> 'token' from t where k = 'one')) $$, 'P0001', 'invite_used_up', '23: drugi raz nie zadziała');
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-00000000000b', true);
insert into t values ('bmember', to_jsonb((select member_id from public.group_members where user_id = '00000000-0000-7000-8000-00000000000b' and group_id = '88888888-0000-7000-8000-000000000001')));
update public.group_members set deleted_at = now() where user_id = '00000000-0000-7000-8000-00000000000b' and group_id = '88888888-0000-7000-8000-000000000001';
select is((public.accept_invite((select v ->> 'token' from t where k = 'i1')) ->> 'member_id'), (select v #>> '{}' from t where k = 'bmember'), '24: po powrocie ten sam member_id');

-- 25–27: admin z zaproszenia i wyjście admina (regresja: admin nie mógł wyjść).
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-00000000000d', true);
select is((public.accept_invite((select v ->> 'token' from t where k = 'adm')) ->> 'already_member'), 'false', '25: D dołącza jako admin');
select lives_ok($$ select public.create_invite('88888888-0000-7000-8000-000000000001') $$, '26: admin tworzy zaproszenia');
select throws_ok($$ select public.create_invite('88888888-0000-7000-8000-000000000001', 'admin') $$, 'P0001', 'forbidden:role', '27: admin nie zaprasza adminów');
select lives_ok($$ update public.group_members set deleted_at = now() where user_id = '00000000-0000-7000-8000-00000000000d' and group_id = '88888888-0000-7000-8000-000000000001' $$, '28: admin może wyjść z grupy');

-- 29–31: odwołanie i wygaśnięcie.
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-00000000000a', true);
select lives_ok($$ select public.revoke_invite((select (v ->> 'invite_id')::uuid from t where k = 'i1')) $$, '29: owner odwołuje');
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-00000000000d', true);
select throws_ok($$ select public.accept_invite((select v ->> 'token' from t where k = 'i1')) $$, 'P0001', 'invite_revoked', '30: odwołane nie działa');
select throws_ok($$ select public.revoke_invite((select (v ->> 'invite_id')::uuid from t where k = 'adm')) $$, 'P0001', 'not_found', '31: obcy nie odwołuje');
reset role;
update public.invites set expires_at = now() - interval '1 second' where id = (select (v ->> 'invite_id')::uuid from t where k = 'adm');
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-00000000000d', true);
set local role authenticated;
select throws_ok($$ select public.accept_invite((select v ->> 'token' from t where k = 'adm')) $$, 'P0001', 'invite_expired', '32: wygasłe nie działa');

-- 33–34: owner nie nadaje drugiego ownera; anon nie przyjmuje.
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-00000000000a', true);
select throws_ok($$ update public.group_members set role = 'owner' where user_id = '00000000-0000-7000-8000-00000000000b' and group_id = '88888888-0000-7000-8000-000000000001' $$, 'P0001', 'forbidden:role', '33: drugi owner zabroniony');
reset role;
set local role anon;
select throws_ok($$ select public.accept_invite('x') $$, '42501', null, '34: anon nie przyjmuje zaproszeń');

select * from finish();
rollback;
