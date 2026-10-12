-- Audyt 3, N-17: ciche powiadomienie po usunięciu z grupy, wyjściu z grupy i przeniesieniu grupy do kosza. Dotąd
-- private.wake_push_claim liczyła członków PO zmianie, więc właśnie ci, których przypomnienia muszą zniknąć (usunięta
-- osoba, wszyscy przy grupie w koszu, osoba wychodząca i jej inne urządzenia), nie byli budzeni i telefon przypominał
-- o sprawach grupy do config.reminders.DAYS_AHEAD dni, aż ktoś otworzył aplikację.
-- Teraz przez private.wake_left_grace_min() minut od usunięcia (znacznik deleted_at stawia serwer — stamp_version,
-- set_group_trash) członkostwo i grupa w koszu dalej się liczą: do pytającego i do odbiorców. Budzenie nie niesie
-- treści spraw, a obudzony telefon po pobraniu traci dostęp i planuje przypomnienia od nowa.
-- Zastępuje wersję z 20261008490000_reminder_wake.sql; bez zmian: odrzucenie bad_request, przerwa między
-- powiadomieniami, zaległe i ponowienie, pominięcie urządzenia pytającego, uprawnienia (tylko service_role).
-- Build 21 nie woła tej funkcji.

-- = config.wake.LEFT_GRACE_MIN (test kontraktowy).
create function private.wake_left_grace_min() returns int language sql immutable set search_path = '' as $$ select 60 $$;
revoke all on function private.wake_left_grace_min() from public, anon, authenticated;

/**
 * Komu wysłać ciche powiadomienie. Woła tylko funkcja notify-handoff (service_role) w imieniu zalogowanego `p_user`:
 *  - grupy: tylko te z `p_groups`, w których pytający jest członkiem albo przestał nim być najwyżej
 *    private.wake_left_grace_min() minut temu (grupa poza koszem albo w koszu od najwyżej tylu minut); inne pomijane;
 *  - odbiorcy: urządzenia członków tych grup z kontem (także inne urządzenia pytającego) i osób usuniętych z nich
 *    w tym samym oknie, bez `p_except` (to urządzenie);
 *  - zwykła prośba zaznacza u odbiorców zmianę (dirty); ponowienie (`p_retry`) tylko wysyła zaległe;
 *  - wysyłka: zaznaczone urządzenia, którym od ostatniej minęła przerwa — zaznaczenie znika od razu (blokada wiersza:
 *    dwa wywołania naraz nie wyślą dwa razy);
 *  - retryInSec: za ile sekund najbliższe zaległe urządzenie będzie mogło dostać powiadomienie (null — nic nie czeka).
 * Odrzucenie: bad_request — pusta lista albo więcej niż private.wake_max_groups() grup.
 */
create or replace function private.wake_push_claim(p_user uuid, p_groups uuid[], p_except text, p_retry boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  gap interval := make_interval(mins => private.wake_min_gap_min());
  since timestamptz := now() - make_interval(mins => private.wake_left_grace_min());
  mine uuid[];
  users uuid[];
  tokens jsonb;
  wait int;
begin
  if p_groups is null or cardinality(p_groups) = 0 or cardinality(p_groups) > private.wake_max_groups() then
    raise exception 'bad_request' using errcode = 'P0001';
  end if;
  select coalesce(array_agg(distinct m.group_id), '{}') into mine
    from public.group_members m join public.groups g on g.id = m.group_id and (g.deleted_at is null or g.deleted_at > since)
   where m.user_id = p_user and (m.deleted_at is null or m.deleted_at > since) and m.group_id = any (p_groups);
  select coalesce(array_agg(distinct m.user_id), '{}') into users
    from public.group_members m
   where m.group_id = any (mine) and m.user_id is not null and (m.deleted_at is null or m.deleted_at > since);
  if not p_retry then
    insert into private.wake_state (token, dirty)
    select p.token, true from public.push_tokens p
     where p.token is distinct from lower(p_except) and p.user_id = any (users)
    on conflict (token) do update set dirty = true;
  end if;
  with due as (
    update private.wake_state w set dirty = false, sent_at = now()
      from public.push_tokens p
     where w.token = p.token and w.dirty and (w.sent_at is null or w.sent_at <= now() - gap)
       and p.token is distinct from lower(p_except) and p.user_id = any (users)
    returning p.token, p.env)
  select coalesce(jsonb_agg(jsonb_build_object('token', token, 'env', env) order by token), '[]'::jsonb) into tokens from due;
  select ceil(extract(epoch from min(w.sent_at + gap - now())))::int into wait
    from private.wake_state w join public.push_tokens p on p.token = w.token
   where w.dirty and p.token is distinct from lower(p_except) and p.user_id = any (users);
  return jsonb_build_object('tokens', tokens, 'retryInSec', wait);
end $$;

revoke all on function private.wake_push_claim(uuid, uuid[], text, boolean) from public, anon, authenticated;
