-- Przejście migracji na bazie z danymi (regresja z 8.10.2026: migracja join_codes przeszła na pustej bazie testowej,
-- a na produkcji padła na istniejących grupach). Po migracjach rdzenia (20261006120200_sync) tworzymy „żywe” dane
-- przez RPC jak telefon: konta, grupy osobiste i wspólną, członków, listy i zadania. Dalsze migracje muszą je przyjąć.
insert into auth.users (id, email) values ('00000000-0000-7000-8000-00000000f0a1', 'a@x.test'), ('00000000-0000-7000-8000-00000000f0a2', 'b@x.test');
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-00000000f0a1', false);
set role authenticated;
select public.create_group('f0f00000-0000-7000-8000-000000000001', 'Rodzina', 'f0f00000-0000-7000-8000-0000000000b1', 'Ala');
select public.sync_push('f0f00000-0000-7000-8000-00000000c0d1', 1, '[
  {"seq":1,"op_id":"f0f00000-0000-7000-8000-0000000000e1","kind":"create","entity":"lists","id":"f0f00000-0000-7000-8000-0000000000c1","group_id":"f0f00000-0000-7000-8000-000000000001","set":{"kind":"tasks","name":"Dom"}},
  {"seq":2,"op_id":"f0f00000-0000-7000-8000-0000000000e2","kind":"create","entity":"lists","id":"f0f00000-0000-7000-8000-0000000000c2","group_id":"f0f00000-0000-7000-8000-000000000001","set":{"kind":"shopping","name":"Zakupy"}},
  {"seq":3,"op_id":"f0f00000-0000-7000-8000-0000000000e3","kind":"create","entity":"tasks","id":"f0f00000-0000-7000-8000-0000000004d1","group_id":"f0f00000-0000-7000-8000-000000000001","set":{"list_id":"f0f00000-0000-7000-8000-0000000000c1","title":"Śmieci"}}
]'::jsonb);
reset role;
select set_config('request.jwt.claim.sub', '', false);
insert into public.group_members (member_id, group_id, user_id, display_name, role)
  values ('f0f00000-0000-7000-8000-0000000000b2', 'f0f00000-0000-7000-8000-000000000001', null, 'Tymek', 'child');
