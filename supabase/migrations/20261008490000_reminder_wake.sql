-- Ciche powiadomienia „odśwież przypomnienia” (D159, decyzja właściciela 8.10.2026; audyt 2, M-102 / PW-22).
-- Telefon po wysłaniu zmian, które mogą zmienić czyjeś przypomnienia, prosi funkcję notify-handoff (JWT użytkownika,
-- jak przy przekazaniach — D41: bez nowych funkcji bez uwierzytelnienia) o obudzenie członków grup. KOMU wysłać
-- decyduje baza (wake_push_claim), funkcja tylko dostarcza do APNs (apns-push-type: background, bez treści spraw).
-- Apple: „The system treats background notifications as low priority … don't try to send more than two or three per
-- hour” (https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app), więc
-- na urządzenie najwyżej jedno co private.wake_min_gap_min() minut; zmiana w przerwie zostaje zapamiętana (dirty)
-- i wychodzi przy następnej prośbie po upływie przerwy (ponowienie z telefonu: retryInSec).
-- Build 21 nie woła tych funkcji i nie ma trybu tła — nic się dla niego nie zmienia.

-- Najmniejszy odstęp (minuty) = config.wake.MIN_GAP_MIN; najwięcej grup w prośbie = config.wake.MAX_GROUPS (test kontraktowy).
create function private.wake_min_gap_min() returns int language sql immutable set search_path = '' as $$ select 20 $$;
create function private.wake_max_groups() returns int language sql immutable set search_path = '' as $$ select 20 $$;

-- Stan budzenia urządzenia: kiedy ostatnio wysłano i czy od tamtej pory czeka zmiana. Znika z tokenem (wylogowanie,
-- token odrzucony przez APNs, usunięcie konta — kaskada z push_tokens).
create table private.wake_state (
  token text primary key references public.push_tokens (token) on delete cascade,
  sent_at timestamptz,
  dirty boolean not null default false
);
revoke all on private.wake_state from public, anon, authenticated;

/**
 * Komu wysłać ciche powiadomienie. Woła tylko funkcja notify-handoff (service_role) w imieniu zalogowanego `p_user`:
 *  - grupy: tylko te z `p_groups`, w których pytający jest członkiem (grupa poza koszem); inne pomijane bez błędu;
 *  - odbiorcy: urządzenia członków tych grup z kontem (także inne urządzenia pytającego), bez `p_except` (to urządzenie);
 *  - zwykła prośba zaznacza u odbiorców zmianę (dirty); ponowienie (`p_retry`) tylko wysyła zaległe;
 *  - wysyłka: zaznaczone urządzenia, którym od ostatniej minęła przerwa — zaznaczenie znika od razu (blokada wiersza:
 *    dwa wywołania naraz nie wyślą dwa razy);
 *  - retryInSec: za ile sekund najbliższe zaległe urządzenie będzie mogło dostać powiadomienie (null — nic nie czeka).
 * Odrzucenie: bad_request — pusta lista albo więcej niż private.wake_max_groups() grup.
 */
create function private.wake_push_claim(p_user uuid, p_groups uuid[], p_except text, p_retry boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  gap interval := make_interval(mins => private.wake_min_gap_min());
  mine uuid[];
  tokens jsonb;
  wait int;
begin
  if p_groups is null or cardinality(p_groups) = 0 or cardinality(p_groups) > private.wake_max_groups() then
    raise exception 'bad_request' using errcode = 'P0001';
  end if;
  select coalesce(array_agg(distinct m.group_id), '{}') into mine
    from public.group_members m join public.groups g on g.id = m.group_id and g.deleted_at is null
   where m.user_id = p_user and m.deleted_at is null and m.group_id = any (p_groups);
  if not p_retry then
    insert into private.wake_state (token, dirty)
    select p.token, true from public.push_tokens p
     where p.token is distinct from lower(p_except)
       and exists (select 1 from public.group_members m where m.user_id = p.user_id and m.deleted_at is null and m.group_id = any (mine))
    on conflict (token) do update set dirty = true;
  end if;
  with due as (
    update private.wake_state w set dirty = false, sent_at = now()
      from public.push_tokens p
     where w.token = p.token and w.dirty and (w.sent_at is null or w.sent_at <= now() - gap)
       and p.token is distinct from lower(p_except)
       and exists (select 1 from public.group_members m where m.user_id = p.user_id and m.deleted_at is null and m.group_id = any (mine))
    returning p.token, p.env)
  select coalesce(jsonb_agg(jsonb_build_object('token', token, 'env', env) order by token), '[]'::jsonb) into tokens from due;
  select ceil(extract(epoch from min(w.sent_at + gap - now())))::int into wait
    from private.wake_state w join public.push_tokens p on p.token = w.token
   where w.dirty and p.token is distinct from lower(p_except)
     and exists (select 1 from public.group_members m where m.user_id = p.user_id and m.deleted_at is null and m.group_id = any (mine));
  return jsonb_build_object('tokens', tokens, 'retryInSec', wait);
end $$;

/**
 * APNs nie przyjął cichego powiadomienia (500/503/429, sieć): urządzenie wraca do zaległych bez przerwy — następna
 * prośba (ponowienie z telefonu) wyśle je znowu.
 */
create function private.wake_push_release(p_tokens text[]) returns void
language sql security definer set search_path = '' as $$
  update private.wake_state set dirty = true, sent_at = null where token = any (select lower(t) from unnest(p_tokens) t)
$$;

-- Wejście z PostgREST (tylko klucz tajny): schemat private nie jest wystawiony, więc nakładki w public.
create function public.wake_push_claim(p_user uuid, p_groups uuid[], p_except text, p_retry boolean) returns jsonb
language sql security definer set search_path = '' as $$ select private.wake_push_claim(p_user, p_groups, p_except, p_retry) $$;
create function public.wake_push_release(p_tokens text[]) returns void
language sql security definer set search_path = '' as $$ select private.wake_push_release(p_tokens) $$;

revoke all on function public.wake_push_claim(uuid, uuid[], text, boolean), public.wake_push_release(text[]) from public, anon, authenticated;
grant execute on function public.wake_push_claim(uuid, uuid[], text, boolean), public.wake_push_release(text[]) to service_role;

revoke all on function private.wake_push_claim(uuid, uuid[], text, boolean), private.wake_push_release(text[]),
  private.wake_min_gap_min(), private.wake_max_groups() from public, anon, authenticated;
