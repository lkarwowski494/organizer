-- Miejsce wydarzenia (D115; ADR 0029): adres albo nazwa miejsca, do „Nawiguj” i czasu dojazdu liczonego na telefonie
-- (Mapy Apple, MapKit). Na serwerze tylko tekst — współrzędne i lokalizacja telefonu nie wychodzą z telefonu.
-- Długość = config.events.LOCATION_MAX_LENGTH (test kontraktowy). Uprawnienia jak dla nazwy i notatki (events_guard).

create function private.event_location_max_length() returns int language sql immutable as $$ select 300 $$;

alter table public.events add column location text;
alter table public.events add constraint events_location_length check (location is null or char_length(location) between 1 and private.event_location_max_length());

grant insert (location), update (location) on public.events to authenticated;
update private.sync_entities set insert_cols = insert_cols || '{location}', patch_cols = patch_cols || '{location}' where entity = 'events';

revoke all on function private.event_location_max_length() from public, anon;
grant execute on function private.event_location_max_length() to authenticated;
