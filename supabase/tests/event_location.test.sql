-- Miejsce wydarzenia (D115): kolumna przez synchronizację, ograniczenie długości.
begin;
select plan(5);

select has_column('public', 'events', 'location', 'events.location istnieje');
select ok((select 'location' = any (insert_cols) and 'location' = any (patch_cols) from private.sync_entities where entity = 'events'), 'location w sync_entities');
select is(private.event_location_max_length(), 300, 'limit długości 300');
select ok(exists (select 1 from pg_constraint where conname = 'events_location_length'), 'ograniczenie długości');
select ok(has_column_privilege('authenticated', 'public.events', 'location', 'UPDATE'), 'authenticated może zmieniać location');

select * from finish();
rollback;
