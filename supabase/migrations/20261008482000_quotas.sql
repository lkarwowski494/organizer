-- Audyt 2, paczka P16: twarde limity na konto (decyzja właściciela z 8.10.2026, D183, PW-44 A; M-70, B-7), limit
-- wywołań funkcji powiadomień (M-185) i zgłoszenia bez sprzątania przy każdym zapisie (M-191). Liczby: src/config
-- quotas.* (test kontraktowy), uzasadnienie przy nich. Testy: supabase/tests/quotas.test.sql.
-- Zastępuje: public.register_push_token (20261008170000), private.claim_client (20261006120200),
-- public.report_client_error i public.send_feedback (20261008190000).

create function private.max_shared_groups() returns int language sql immutable as $$ select 50 $$;
create function private.max_active_invites() returns int language sql immutable as $$ select 20 $$;
create function private.max_push_tokens() returns int language sql immutable as $$ select 10 $$;
create function private.max_sync_clients() returns int language sql immutable as $$ select 20 $$;
create function private.sync_push_per_minute() returns int language sql immutable as $$ select 120 $$;
create function private.notify_per_hour() returns int language sql immutable as $$ select 120 $$;

-- ───────────────────────── Licznik w oknie czasu ─────────────────────────
-- Jeden wiersz na konto i rodzaj (okno stałe: minuta / godzina od pierwszego wywołania w oknie), więc tabela ma najwyżej
-- dwa wiersze na konto. Zwraca false ponad limit (wywołanie się nie liczy).
create table private.rate_counters (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  window_start timestamptz not null,
  n int not null,
  primary key (user_id, kind)
);

create function private.rate_hit(uid uuid, k text, win interval, lim int) returns boolean
language plpgsql security definer set search_path = '' as $$
declare c private.rate_counters; t timestamptz := clock_timestamp();
begin
  insert into private.rate_counters (user_id, kind, window_start, n) values (uid, k, t, 0) on conflict do nothing;
  select * into c from private.rate_counters where user_id = uid and kind = k for update;
  if c.window_start <= t - win then c.window_start := t; c.n := 0; end if;
  if c.n >= lim then return false; end if;
  update private.rate_counters set window_start = c.window_start, n = c.n + 1 where user_id = uid and kind = k;
  return true;
end $$;

-- ───────────────────────── Grupy wspólne ─────────────────────────
-- Członkostwo w grupie wspólnej (także w koszu) ponad limit: tworzenie (create_group) i dołączanie (join_group,
-- accept_invite) kończą się kodem limit:groups. Grupa osobista się nie liczy.
create function private.group_members_quota() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is null or new.deleted_at is not null then return new; end if;
  if tg_op = 'UPDATE' and old.deleted_at is null and old.user_id is not distinct from new.user_id then return new; end if;
  if (select kind from public.groups where id = new.group_id) <> 'shared' then return new; end if;
  if (select count(*) from public.group_members m join public.groups g on g.id = m.group_id
      where m.user_id = new.user_id and m.deleted_at is null and g.kind = 'shared' and m.group_id <> new.group_id) >= private.max_shared_groups() then
    raise exception 'limit:groups' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger group_members_b_quota before insert or update of deleted_at, user_id on public.group_members
  for each row execute function private.group_members_quota();

-- ───────────────────────── Zaproszenia ─────────────────────────
create function private.invites_quota() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.invites i where i.group_id = new.group_id and i.revoked_at is null
      and i.expires_at > now() and i.uses < i.max_uses) >= private.max_active_invites() then
    raise exception 'limit:invites' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger invites_quota before insert on public.invites
  for each row execute function private.invites_quota();

-- ───────────────────────── Tokeny push ─────────────────────────
-- Zastępuje wersję z 20261008170000_push.sql. Ponad limit wypada najdawniej odświeżony token konta (telefon odświeża
-- swój przy każdym uruchomieniu), więc nikt nie dostaje błędu.
create or replace function public.register_push_token(p_token text, p_env text) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  if me is null then raise exception 'unauthorized' using errcode = 'P0001'; end if;
  -- Ten sam telefon po zmianie konta: token przechodzi na nowe konto.
  insert into public.push_tokens (token, user_id, env) values (lower(p_token), me, p_env)
    on conflict (token) do update set user_id = excluded.user_id, env = excluded.env, updated_at = now();
  delete from public.push_tokens where token in (
    select t.token from public.push_tokens t where t.user_id = me
    order by t.updated_at desc, t.token offset private.max_push_tokens());
end $$;

-- ───────────────────────── Instalacje i częstość sync_push ─────────────────────────
-- Zastępuje wersję z 20261006120200_sync.sql. Nowe: (1) nowa instalacja ponad limit usuwa najdawniej używaną instalację
-- konta (z jej zapamiętanymi odrzuceniami); (2) najwyżej sync_push_per_minute() wywołań na konto na minutę — ponad limit
-- 'rate_limited' (telefon traktuje to jak chwilowy błąd serwera i ponawia z opóźnieniem; nic nie zostało zapisane).
create or replace function private.claim_client(cid uuid) returns bigint
language plpgsql security definer set search_path = '' as $$
declare r private.sync_clients; me uuid := (select auth.uid()); fresh int;
begin
  if me is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if not private.rate_hit(me, 'sync_push', interval '1 minute', private.sync_push_per_minute()) then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  insert into private.sync_clients (client_id, user_id) values (cid, me) on conflict do nothing;
  get diagnostics fresh = row_count;
  select * into r from private.sync_clients where client_id = cid for update;
  if r.user_id <> me then raise exception 'client_mismatch' using errcode = 'P0001'; end if;
  if fresh > 0 then
    delete from private.sync_clients where client_id in (
      select c.client_id from private.sync_clients c where c.user_id = me and c.client_id <> cid
      order by c.last_seen_at desc, c.client_id offset private.max_sync_clients() - 1);
  end if;
  return r.last_seq;
end $$;

-- ───────────────────────── Powiadomienia (funkcja notify-handoff) ─────────────────────────
-- Woła tylko funkcja (klucz tajny), przed zapytaniem o odbiorców: false = ponad limit konta na godzinę.
create function public.notify_rate_hit(p_user uuid) returns boolean
language sql security definer set search_path = '' as $$
  select private.rate_hit(p_user, 'notify', interval '1 hour', private.notify_per_hour())
$$;

-- ───────────────────────── Zgłoszenia (M-191) ─────────────────────────
-- Zastępują wersje z 20261008190000_feedback.sql. Jedyna zmiana: bez kasowania starych wierszy całej tabeli przy każdym
-- zapisie (także ponad limit) — retencję robi codzienne sprzątanie (private.purge_logs).
create or replace function public.report_client_error(p_kind text, p_message text, p_stack text, p_screen text, p_app_version text) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  if me is null then raise exception 'unauthorized' using errcode = 'P0001'; end if;
  if (select count(*) from public.client_errors where user_id = me and created_at > now() - interval '1 day') >= private.client_errors_per_day() then
    return;
  end if;
  insert into public.client_errors (user_id, kind, message, stack, screen, app_version)
    values (me, p_kind, left(coalesce(p_message, ''), 500), left(p_stack, 4000), left(p_screen, 100), left(p_app_version, 40));
end $$;

create or replace function public.send_feedback(p_message text, p_screen text, p_app_version text) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  if me is null then raise exception 'unauthorized' using errcode = 'P0001'; end if;
  if char_length(trim(coalesce(p_message, ''))) = 0 then raise exception 'invalid_value:message' using errcode = 'P0001'; end if;
  if (select count(*) from public.app_feedback where user_id = me and created_at > now() - interval '1 day') >= private.feedback_per_day() then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  insert into public.app_feedback (user_id, message, screen, app_version) values (me, left(trim(p_message), 2000), left(p_screen, 100), left(p_app_version, 40));
end $$;

revoke all on function public.notify_rate_hit(uuid) from public, anon, authenticated;
grant execute on function public.notify_rate_hit(uuid) to service_role;
revoke all on all functions in schema private from public, anon;
grant execute on function private.rrule_ok(text) to authenticated;
grant execute on function private.claim_client(uuid) to authenticated;
