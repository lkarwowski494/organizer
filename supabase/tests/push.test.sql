-- Powiadomienia o przekazaniach (migracja 20261008170000_push, D70, ADR 0015).
begin;
select plan(16);

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-0000000000f1', 'a@x.test'),
  ('00000000-0000-7000-8000-0000000000f2', 'm@x.test'),
  ('00000000-0000-7000-8000-0000000000f3', 'o@x.test');

create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.push(client text, seq int, op jsonb) returns text language sql as $$
  select coalesce(public.sync_push(client::uuid, 1, jsonb_build_array(op || jsonb_build_object('seq', seq))) -> 'results' -> 0 ->> 'code', 'ok')
$$;
grant execute on function pg_temp.as_user(text), pg_temp.push(text, int, jsonb) to authenticated;

select pg_temp.as_user('00000000-0000-7000-8000-0000000000f1');
set local role authenticated;
select public.create_group('88880000-0000-7000-8000-000000000001', 'Rodzina', '88880000-0000-7000-8000-0000000000a1', 'Łukasz');
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('88880000-0000-7000-8000-0000000000a2', '88880000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000f2', 'Magdalena', 'member');

-- 1–5: tokeny.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f2');
set local role authenticated;
select lives_ok($$ select public.register_push_token(repeat('ab', 32), 'production') $$, '1: rejestracja tokenu');
select throws_ok($$ select public.register_push_token('zły', 'production') $$, '23514', null, '2: zły format odrzucony');
select throws_ok($$ select count(*) from public.push_tokens $$, '42501', null, '3: tokenów nie czyta telefon');
select throws_ok($$ select public.handoff_push_claim(gen_random_uuid(), (select auth.uid()), 24) $$, '42501', null, '4: claim tylko dla funkcji');
reset role;
select is((select user_id::text || ' ' || env from public.push_tokens), '00000000-0000-7000-8000-0000000000f2 production', '5: token przypisany do konta');

-- Przekazanie zadania Łukasz → Magdalena.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f1');
set local role authenticated;
select pg_temp.push('88880000-0000-7000-8000-00000000c0f1', 1, '{"kind":"create","entity":"lists","id":"88880000-0000-7000-8000-0000000000c1","group_id":"88880000-0000-7000-8000-000000000001","set":{"kind":"tasks","name":"Dom"}}') is not null;
select pg_temp.push('88880000-0000-7000-8000-00000000c0f1', 2, '{"kind":"create","entity":"tasks","id":"88880000-0000-7000-8000-0000000004d1","group_id":"88880000-0000-7000-8000-000000000001","set":{"list_id":"88880000-0000-7000-8000-0000000000c1","title":"Logopeda","assignee_member_id":"88880000-0000-7000-8000-0000000000a1"}}') is not null;
select pg_temp.push('88880000-0000-7000-8000-00000000c0f1', 3, '{"kind":"create","entity":"handoffs","id":"88880000-0000-7000-8000-0000000007f1","group_id":"88880000-0000-7000-8000-000000000001","set":{"entity":"tasks","entity_id":"88880000-0000-7000-8000-0000000004d1","to_member":"88880000-0000-7000-8000-0000000000a2"}}') is not null;
reset role;
select pg_temp.as_user('');

-- 6–10: claim przy oczekującym.
select is(public.handoff_push_claim('88880000-0000-7000-8000-0000000007f1', '00000000-0000-7000-8000-0000000000f2', 24), null, '6: odbiorca nie woła o powiadomienie o własnym przekazaniu');
select is(public.handoff_push_claim('88880000-0000-7000-8000-0000000007f1', '00000000-0000-7000-8000-0000000000f3', 24), null, '7: osoba spoza przekazania — nic');
select is(public.handoff_push_claim('88880000-0000-7000-8000-0000000007f1', '00000000-0000-7000-8000-0000000000f1', 24),
  jsonb_build_object('title', 'Łukasz przekazuje Ci', 'body', 'Logopeda. Otwórz Organizer, żeby przyjąć albo odrzucić.', 'tokens', jsonb_build_array(jsonb_build_object('token', repeat('ab', 32), 'env', 'production'))),
  '8: nadawca — powiadomienie do odbiorcy z jego tokenami');
select is(public.handoff_push_claim('88880000-0000-7000-8000-0000000007f1', '00000000-0000-7000-8000-0000000000f1', 24), null, '9: drugi raz — nic (wysłane)');
select is((select push_sent_status from public.handoffs where id = '88880000-0000-7000-8000-0000000007f1'), 'pending', '10: zapamiętany stan');

-- 11–13: decyzja.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f2');
set local role authenticated;
select pg_temp.push('88880000-0000-7000-8000-00000000c0f2', 1, '{"kind":"patch","entity":"handoffs","id":"88880000-0000-7000-8000-0000000007f1","set":{"status":"declined"}}') is not null;
select is(pg_temp.push('88880000-0000-7000-8000-00000000c0f2', 2, '{"kind":"patch","entity":"handoffs","id":"88880000-0000-7000-8000-0000000007f1","set":{"push_sent_status":"x"}}'), 'invalid_field:push_sent_status', '11: telefon nie zmienia push_sent_status');
reset role;
select pg_temp.as_user('');
select is(public.handoff_push_claim('88880000-0000-7000-8000-0000000007f1', '00000000-0000-7000-8000-0000000000f2', 24),
  jsonb_build_object('title', 'Magdalena nie przyjmuje', 'body', 'Logopeda', 'tokens', '[]'::jsonb), '12: odrzucenie — do nadawcy (bez tokenów: lista pusta)');
select is(public.handoff_push_claim('88880000-0000-7000-8000-0000000007f1', '00000000-0000-7000-8000-0000000000f1', 24), null, '13: nadawca nie woła o decyzję');

-- 14–16: stare przekazanie, usuwanie tokenów, zmiana konta na telefonie.
update public.handoffs set decided_at = now() - interval '2 days', push_sent_status = null where id = '88880000-0000-7000-8000-0000000007f1';
select is(public.handoff_push_claim('88880000-0000-7000-8000-0000000007f1', '00000000-0000-7000-8000-0000000000f2', 24), null, '14: starsze niż limit — bez powiadomienia');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f1');
set local role authenticated;
select public.register_push_token(upper(repeat('ab', 32)), 'sandbox');
reset role;
select is((select user_id::text || ' ' || env from public.push_tokens), '00000000-0000-7000-8000-0000000000f1 sandbox', '15: token przechodzi na nowe konto');
select public.drop_push_token(repeat('ab', 32));
select is((select count(*)::int from public.push_tokens), 0, '16: odrzucony przez APNs token usunięty');

select * from finish();
rollback;
