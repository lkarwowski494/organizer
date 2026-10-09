-- Audyt 3, PK-01, N-98 (A3-06-9): limity liczone z istniejących wierszy (grupy wspólne konta, aktywne zaproszenia grupy,
-- zgłoszenia błędów i opinie konta na dobę) nie dają się przekroczyć równoległymi żądaniami. Dotąd count → insert szło
-- bez blokady (READ COMMITTED): dwa równoległe żądania widziały ten sam stan i oba przechodziły (np. 60 grup przy
-- limicie 50). Teraz najpierw blokada doradcza transakcji na konto (albo grupę) i rodzaj limitu, potem liczenie — drugie
-- żądanie czeka na koniec pierwszego i widzi jego wiersz (każde polecenie w READ COMMITTED bierze nowy obraz danych).
-- Kolejność blokad: dołączanie (join_group) bierze organizer.join_user i organizer.join_id, potem (w wyzwalaczu)
-- organizer.quota — żadna ścieżka nie bierze ich odwrotnie.
-- Zastępuje: private.group_members_quota(), private.invites_quota(), public.report_client_error(...),
-- public.send_feedback(...) (wszystkie z 20261008482000_quotas; poza blokadą bez zmian). Testy: tests/db/concurrency.test.ts.

create or replace function private.group_members_quota() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is null or new.deleted_at is not null then return new; end if;
  if tg_op = 'UPDATE' and old.deleted_at is null and old.user_id is not distinct from new.user_id then return new; end if;
  if (select kind from public.groups where id = new.group_id) <> 'shared' then return new; end if;
  perform pg_advisory_xact_lock(hashtext('organizer.quota:groups'), hashtext(new.user_id::text));
  if (select count(*) from public.group_members m join public.groups g on g.id = m.group_id
      where m.user_id = new.user_id and m.deleted_at is null and g.kind = 'shared' and m.group_id <> new.group_id) >= private.max_shared_groups() then
    raise exception 'limit:groups' using errcode = 'P0001';
  end if;
  return new;
end $$;

create or replace function private.invites_quota() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtext('organizer.quota:invites'), hashtext(new.group_id::text));
  if (select count(*) from public.invites i where i.group_id = new.group_id and i.revoked_at is null
      and i.expires_at > now() and i.uses < i.max_uses) >= private.max_active_invites() then
    raise exception 'limit:invites' using errcode = 'P0001';
  end if;
  return new;
end $$;

create or replace function public.report_client_error(p_kind text, p_message text, p_stack text, p_screen text, p_app_version text) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  if me is null then raise exception 'unauthorized' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtext('organizer.quota:client_errors'), hashtext(me::text));
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
  perform pg_advisory_xact_lock(hashtext('organizer.quota:feedback'), hashtext(me::text));
  if (select count(*) from public.app_feedback where user_id = me and created_at > now() - interval '1 day') >= private.feedback_per_day() then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  insert into public.app_feedback (user_id, message, screen, app_version) values (me, left(trim(p_message), 2000), left(p_screen, 100), left(p_app_version, 40));
end $$;
