-- Przed migracją 20261010010000_date_ranges (audyt 3, N-1, N-2): na produkcji mogą już leżeć wiersze, które telefon
-- wyłożyłyby na dacie spoza zakresu, i klucze kolejności dowolnej długości. Migracje muszą je naprawić, nie paść.
insert into public.tasks (id, group_id, list_id, title, deadline_mode, due_date, due_time, start_date, completed_at, sort_key) values
  ('f0f00000-0000-7000-8000-0000000004e1', 'f0f00000-0000-7000-8000-000000000001', 'f0f00000-0000-7000-8000-0000000000c1', 'Zły termin', 'own', 'infinity', '24:00', '0044-03-15 BC', '-infinity', repeat('z', 5000)),
  ('f0f00000-0000-7000-8000-0000000004e2', 'f0f00000-0000-7000-8000-000000000001', 'f0f00000-0000-7000-8000-0000000000c1', 'Daleki termin', 'own', '5000000-01-01', null, null, 'infinity', 'a0');
insert into public.events (id, group_id, title, start_date, start_time, end_time) values
  ('f0f00000-0000-7000-8000-0000000001e1', 'f0f00000-0000-7000-8000-000000000001', 'Zły start', '-infinity', '23:30', '24:00');
update public.group_members set week_a = 'infinity' where member_id = 'f0f00000-0000-7000-8000-0000000000b1';
-- Wersja przed naprawą (upgrade-check.sql sprawdza, że naprawa ją podbiła).
create schema upgrade_probe;
create table upgrade_probe.before as select id, version from public.tasks where id = 'f0f00000-0000-7000-8000-0000000004e2';
