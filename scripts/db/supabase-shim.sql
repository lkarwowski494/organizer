-- Nakładka TYLKO do testów lokalnych na zwykłym Postgresie (bez Dockera).
-- Odtwarza minimum tego, co prawdziwy Supabase ma przed naszymi migracjami: role, auth.users,
-- auth.uid(), realtime.messages i realtime.send(). W CI (db.yml) testy idą na prawdziwym Supabase CLI,
-- więc różnice między nakładką a oryginałem wychodzą tam. Źródła zachowania:
--  - auth.uid() czyta claim „sub” z request.jwt.claim.sub albo request.jwt.claims (testy pgTAP Supabase:
--    https://supabase.com/docs/guides/local-development/testing/overview),
--  - realtime.send(payload, event, topic, private) (https://supabase.com/docs/guides/realtime/broadcast).
create extension if not exists pgcrypto;
create extension if not exists pgtap;

do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
                         (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

create schema if not exists realtime;
create table if not exists realtime.messages (
  id bigserial primary key,
  topic text not null,
  extension text not null default 'broadcast',
  event text,
  payload jsonb,
  private boolean default false,
  inserted_at timestamptz not null default now()
);
create or replace function realtime.send(payload jsonb, event text, topic text, private boolean default true)
returns void language sql security definer as $$
  insert into realtime.messages (topic, event, payload, private) values (topic, event, payload, private)
$$;
grant usage on schema realtime to anon, authenticated, service_role;
