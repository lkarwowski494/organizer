-- Dołączanie jak w Zoom (D92–D94, decyzja właściciela z 8.10.2026, ADR 0020): grupa ma stały „ID grupy” (9 cyfr),
-- a zaproszenie to 6-cyfrowy kod ważny 24 h dla wielu osób. Dołącza się wpisując ID i kod albo linkiem.
--  - Kod to zwykłe zaproszenie (public.invites): w bazie leży skrót SHA-256 tekstu „ID:kod”, więc zmiana ID grupy
--    unieważnia wszystkie jej kody, a przyjęcie idzie tą samą drogą co dotąd (private.accept_invite, strażnik członkostw).
--  - Zgadywanie: 10^6 kodów; po private.join_fails_per_user() nieudanych próbach osoby i private.join_fails_per_group()
--    na ID grupy w ciągu godziny kolejne są odrzucane. Rachunek (ADR 0020): przy limicie grupy 20/h przez 24 h
--    to najwyżej 480 prób na kod, czyli szansa trafienia ≤ 480 / 10^6 = 0,048% na jeden ważny kod.
--  - Stare zaproszenia (64 znaki) działają jak dotąd.

create function private.join_id_digits() returns int language sql immutable as $$ select 9 $$;
create function private.join_code_digits() returns int language sql immutable as $$ select 6 $$;
create function private.join_code_ttl_hours() returns int language sql immutable as $$ select 24 $$;
create function private.join_fails_per_user() returns int language sql immutable as $$ select 5 $$;
create function private.join_fails_per_group() returns int language sql immutable as $$ select 20 $$;

-- Losowa liczba z [0, 10^n) z 122 losowych bitów gen_random_uuid (pg_strong_random); przesunięcie modulo przy
-- 2^60 / 10^9 jest pomijalne (< 10^-9).
create function private.random_digits(n int) returns text language sql volatile set search_path = '' as $$
  select lpad((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 15))::bit(60)::bigint % (10::bigint ^ n)::bigint)::text, n, '0')
$$;

alter table public.groups add column join_id text unique check (join_id ~ '^[1-9][0-9]{8}$');

-- Nowe ID (pierwsza cyfra 1–9, żeby nie ginęło zero na początku przy dyktowaniu); powtórka przy kolizji.
create function private.new_join_id() returns text language plpgsql volatile set search_path = '' as $$
declare v text;
begin
  loop
    v := (1 + (private.random_digits(1)::int % 9))::text || private.random_digits(private.join_id_digits() - 1);
    exit when not exists (select 1 from public.groups where join_id = v);
  end loop;
  return v;
end $$;

-- Istniejące grupy wspólne dostają ID przed włączeniem strażnika (strażnik blokuje zmianę ID zwykłą edycją).
update public.groups set join_id = private.new_join_id() where kind = 'shared' and join_id is null;

create function private.groups_join_id() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.join_id := case when new.kind = 'shared' then private.new_join_id() end;
  elsif new.join_id is distinct from old.join_id and coalesce(current_setting('organizer.rotate_join_id', true), '') <> '1' then
    raise exception 'immutable_column:join_id' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger groups_a_join_id before insert or update on public.groups for each row execute function private.groups_join_id();


-- Rodzaj zaproszenia: długi token (link/wiadomość) albo kod do ID grupy. Kod przyjmuje wyłącznie join_group (z limitem
-- prób) — inaczej „ID:kod” podany jako token do accept_invite omijałby limit zgadywania.
alter table public.invites add column kind text not null default 'token' check (kind in ('token', 'code'));

-- Wspólna część tworzenia zaproszenia (z private.create_invite) z podanym tokenem.
create function private.insert_invite(gid uuid, inv_role text, ttl_hours int, uses int, token text, inv_kind text) returns public.invites
language plpgsql security definer set search_path = '' as $$
declare r public.invites;
begin
  if coalesce(private.my_role(gid), '') not in ('owner', 'admin') then raise exception 'forbidden' using errcode = 'P0001'; end if;
  if (select kind from public.groups where id = gid) <> 'shared' then raise exception 'forbidden:personal_group' using errcode = 'P0001'; end if;
  if coalesce(inv_role, 'member') not in ('admin', 'member') then raise exception 'invalid_value:role' using errcode = 'P0001'; end if;
  if inv_role = 'admin' and coalesce(private.my_role(gid), '') <> 'owner' then raise exception 'forbidden:role' using errcode = 'P0001'; end if;
  insert into public.invites (group_id, token_hash, role, created_by, expires_at, max_uses, kind)
  values (gid, private.token_hash(token), coalesce(inv_role, 'member'), private.my_member_id(gid), now() + make_interval(hours => ttl_hours), uses, inv_kind)
  returning * into r;
  return r;
end $$;

/** Nowy kod dla grupy (owner/admin): 6 cyfr, 24 h, do invite_max_uses_limit() osób. Zwraca ID grupy i kod jeden raz. */
create function private.create_join_code(gid uuid, inv_role text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  jid text := (select join_id from public.groups where id = gid);
  code text := private.random_digits(private.join_code_digits());
  r public.invites;
begin
  r := private.insert_invite(gid, inv_role, private.join_code_ttl_hours(), private.invite_max_uses_limit(), jid || ':' || code, 'code');
  return jsonb_build_object('invite_id', r.id, 'join_id', jid, 'code', code, 'expires_at', r.expires_at, 'max_uses', r.max_uses);
end $$;

-- Przyjęcie zaproszenia: jak w 20261007090000_invites, plus rozdział dróg dla tokenu i kodu.
create or replace function private.accept_invite(token text, display_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  h bytea := private.token_hash(token);
  inv public.invites;
  m public.group_members;
  name text := coalesce(nullif(btrim(display_name), ''), (select p.display_name from public.profiles p where p.user_id = me), 'Ja');
begin
  if me is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  -- Blokada wiersza zaproszenia: równoczesne przyjęcia nie przekroczą limitu użyć.
  select * into inv from public.invites where token_hash = h for update;
  if inv.id is null then raise exception 'invite_invalid' using errcode = 'P0001'; end if;
  -- Kod do ID grupy tylko przez join_group (limit prób, D93); długi token tylko tą drogą.
  if (inv.kind = 'code') <> (coalesce(current_setting('organizer.join_code', true), '') = '1') then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;
  if inv.revoked_at is not null then raise exception 'invite_revoked' using errcode = 'P0001'; end if;
  if inv.expires_at <= now() then raise exception 'invite_expired' using errcode = 'P0001'; end if;
  select * into m from public.group_members where group_id = inv.group_id and user_id = me;
  -- Już jestem aktywnym członkiem: przyjęcie jest bezskutkowe (nie zużywa użycia, nie zmienia roli).
  if m.member_id is not null and m.deleted_at is null then
    return jsonb_build_object('group_id', inv.group_id, 'member_id', m.member_id, 'already_member', true);
  end if;
  if inv.uses >= inv.max_uses then raise exception 'invite_used_up' using errcode = 'P0001'; end if;
  if private.valid_invite(h) is null then raise exception 'invite_invalid' using errcode = 'P0001'; end if;

  perform set_config('organizer.invite_hash', encode(h, 'hex'), true);
  if m.member_id is null then
    insert into public.group_members (member_id, group_id, user_id, display_name, role)
      values (gen_random_uuid(), inv.group_id, me, left(name, 100), inv.role)
      returning * into m;
  else
    -- Powrót po wyjściu z grupy: ten sam member_id, więc stare przypisania i historia wracają do tej osoby.
    update public.group_members set deleted_at = null, role = inv.role where member_id = m.member_id returning * into m;
  end if;
  perform set_config('organizer.invite_hash', '', true);
  update public.invites set uses = uses + 1 where id = inv.id;
  return jsonb_build_object('group_id', inv.group_id, 'member_id', m.member_id, 'already_member', false);
end $$;

create table private.join_attempts (
  user_id uuid not null,
  join_id text not null,
  at timestamptz not null default now()
);
create index join_attempts_user_idx on private.join_attempts (user_id, at);
create index join_attempts_join_idx on private.join_attempts (join_id, at);

/**
 * Dołączenie ID + kod. Zwraca wynik przyjęcia zaproszenia albo {"error": …} — bez wyjątku, żeby zapis nieudanej
 * próby został w bazie (wyjątek wycofałby go razem z resztą).
 */
create function private.join_group(p_join_id text, p_code text, p_display_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  jid text := regexp_replace(coalesce(p_join_id, ''), '\D', '', 'g');
  code text := regexp_replace(coalesce(p_code, ''), '\D', '', 'g');
  res jsonb;
  err text;
begin
  if me is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if (select count(*) from private.join_attempts where user_id = me and at > now() - interval '1 hour') >= private.join_fails_per_user()
     or (select count(*) from private.join_attempts where join_id = jid and at > now() - interval '1 hour') >= private.join_fails_per_group() then
    return jsonb_build_object('error', 'rate_limited');
  end if;
  -- Tylko bieżące ID grupy (po zmianie ID stare nie prowadzi nigdzie).
  if not exists (select 1 from public.groups where join_id = jid and deleted_at is null) then
    err := 'invite_invalid';
  else
    begin
      perform set_config('organizer.join_code', '1', true);
      res := private.accept_invite(jid || ':' || code, p_display_name);
      perform set_config('organizer.join_code', '', true);
    exception when sqlstate 'P0001' then
      err := sqlerrm;
    end;
  end if;
  if err is null then return res; end if;
  insert into private.join_attempts (user_id, join_id) values (me, jid);
  -- Na zewnątrz jeden kod błędu: nie zdradzamy, czy istnieje grupa o tym ID.
  return jsonb_build_object('error', case when err in ('invite_expired', 'invite_revoked', 'invite_used_up') then err else 'invite_invalid' end);
end $$;

/** Nowe ID grupy (tylko owner): wszystkie kody na stare ID przestają działać. */
create function private.rotate_join_id(gid uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v text := private.new_join_id();
begin
  if coalesce(private.my_role(gid), '') <> 'owner' or (select kind from public.groups where id = gid) <> 'shared' then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  perform set_config('organizer.rotate_join_id', '1', true);
  update public.groups set join_id = v where id = gid;
  perform set_config('organizer.rotate_join_id', '', true);
  update public.invites set revoked_at = now() where group_id = gid and kind = 'code' and revoked_at is null;
  return v;
end $$;

create function public.create_join_code(group_id uuid, role text default 'member') returns jsonb
language sql security invoker set search_path = '' as $$ select private.create_join_code(group_id, role) $$;
create function public.join_group(join_id text, code text, display_name text default null) returns jsonb
language sql security invoker set search_path = '' as $$ select private.join_group(join_id, code, display_name) $$;
create function public.rotate_join_id(group_id uuid) returns text
language sql security invoker set search_path = '' as $$ select private.rotate_join_id(group_id) $$;

-- Sprzątanie: próby starsze niż doba (limity liczą godzinę).
create or replace function private.daily_maintenance() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  tombstones int;
  groups int;
  errors int;
  feedback int;
  pushes int;
  attempts int;
begin
  tombstones := private.purge_tombstones();
  groups := private.purge_deleted_groups();
  delete from public.client_errors where created_at < now() - make_interval(days => private.feedback_retention_days());
  get diagnostics errors = row_count;
  delete from public.app_feedback where created_at < now() - make_interval(days => private.feedback_retention_days());
  get diagnostics feedback = row_count;
  delete from private.push_log where created_at < now() - make_interval(days => private.push_log_retention_days());
  get diagnostics pushes = row_count;
  delete from private.join_attempts where at < now() - interval '1 day';
  get diagnostics attempts = row_count;
  return jsonb_build_object('tombstones', tombstones, 'groups', groups, 'client_errors', errors, 'app_feedback', feedback, 'push_log', pushes, 'join_attempts', attempts);
end $$;

revoke all on all functions in schema private from public, anon;
grant execute on function private.rrule_ok(text) to authenticated;
revoke all on function private.daily_maintenance(), private.cron_history_cleanup() from authenticated;
revoke all on function public.create_join_code(uuid, text), public.join_group(text, text, text), public.rotate_join_id(uuid) from public, anon;
grant execute on function public.create_join_code(uuid, text), public.join_group(text, text, text), public.rotate_join_id(uuid),
  private.create_join_code(uuid, text), private.join_group(text, text, text), private.rotate_join_id(uuid) to authenticated;
