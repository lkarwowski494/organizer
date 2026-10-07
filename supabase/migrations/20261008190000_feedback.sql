-- Zgłaszanie błędów i opinii z telefonu (D80, decyzja właściciela z 7.10.2026, ADR 0017; O-029).
-- Błędy: aplikacja sama zapisuje komunikat i stos (bez treści list — telefon nie wysyła danych z tabel), wersję
-- i ekran. Opinie: tekst wpisany przez osobę w Ustawieniach. Odczyt tylko w panelu Supabase (klucz tajny / właściciel);
-- telefon nie czyta nic. Limity dzienne na osobę i retencja w private.* (src/config: feedback.*, test kontraktowy).
create function private.client_errors_per_day() returns int language sql immutable as $$ select 50 $$;
create function private.feedback_per_day() returns int language sql immutable as $$ select 20 $$;
create function private.feedback_retention_days() returns int language sql immutable as $$ select 90 $$;

create table public.client_errors (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('crash', 'error')),
  message text not null check (char_length(message) <= 500),
  stack text check (char_length(stack) <= 4000),
  screen text check (char_length(screen) <= 100),
  app_version text check (char_length(app_version) <= 40)
);
create index client_errors_user_day_idx on public.client_errors (user_id, created_at);

create table public.app_feedback (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  message text not null check (char_length(message) between 1 and 2000),
  screen text check (char_length(screen) <= 100),
  app_version text check (char_length(app_version) <= 40)
);
create index app_feedback_user_day_idx on public.app_feedback (user_id, created_at);

alter table public.client_errors enable row level security;
alter table public.app_feedback enable row level security;
revoke all on public.client_errors, public.app_feedback from anon, authenticated;

-- Zapis tylko przez funkcje: limit dzienny (ponad limit — po cichu nic, żeby pętla błędów nie zalała bazy)
-- i sprzątanie starszych niż retencja przy każdym zapisie (bez pg_cron, O-032).
create function public.report_client_error(p_kind text, p_message text, p_stack text, p_screen text, p_app_version text) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  if me is null then raise exception 'unauthorized' using errcode = 'P0001'; end if;
  delete from public.client_errors where created_at < now() - make_interval(days => private.feedback_retention_days());
  if (select count(*) from public.client_errors where user_id = me and created_at > now() - interval '1 day') >= private.client_errors_per_day() then
    return;
  end if;
  insert into public.client_errors (user_id, kind, message, stack, screen, app_version)
    values (me, p_kind, left(coalesce(p_message, ''), 500), left(p_stack, 4000), left(p_screen, 100), left(p_app_version, 40));
end $$;

create function public.send_feedback(p_message text, p_screen text, p_app_version text) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  if me is null then raise exception 'unauthorized' using errcode = 'P0001'; end if;
  if char_length(trim(coalesce(p_message, ''))) = 0 then raise exception 'invalid_value:message' using errcode = 'P0001'; end if;
  delete from public.app_feedback where created_at < now() - make_interval(days => private.feedback_retention_days());
  if (select count(*) from public.app_feedback where user_id = me and created_at > now() - interval '1 day') >= private.feedback_per_day() then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  insert into public.app_feedback (user_id, message, screen, app_version) values (me, left(trim(p_message), 2000), left(p_screen, 100), left(p_app_version, 40));
end $$;

revoke all on function public.report_client_error(text, text, text, text, text), public.send_feedback(text, text, text) from public, anon;
grant execute on function public.report_client_error(text, text, text, text, text), public.send_feedback(text, text, text) to authenticated;
revoke all on all functions in schema private from public, anon;
grant execute on function private.rrule_ok(text) to authenticated;
