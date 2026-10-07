-- Powiadomienia push o przekazaniach (D70: „push + w aplikacji”, ADR 0015; D6: APNs bezpośrednio z Edge Function,
-- ADR 0002). Telefon rejestruje token urządzenia; po wysłaniu przekazania albo decyzji telefon prosi funkcję
-- notify-handoff o powiadomienie. O tym, KOMU i CO wysłać, decyduje baza (handoff_push_claim) — funkcja tylko
-- dostarcza do APNs. Każdy stan przekazania powiadamia najwyżej raz (push_sent_status).

create table public.push_tokens (
  token text primary key check (token ~ '^[0-9a-f]{64,200}$'),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- TestFlight i App Store używają produkcyjnego APNs, build deweloperski — sandbox.
  env text not null check (env in ('sandbox', 'production')),
  updated_at timestamptz not null default now()
);
create index push_tokens_user_idx on public.push_tokens (user_id);
alter table public.push_tokens enable row level security;
-- Tokenów nie czyta nikt poza funkcją (klucz tajny omija RLS); telefon tylko rejestruje i wyrejestrowuje swój.
revoke all on public.push_tokens from anon, authenticated;

create function public.register_push_token(p_token text, p_env text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'unauthorized' using errcode = 'P0001'; end if;
  -- Ten sam telefon po zmianie konta: token przechodzi na nowe konto.
  insert into public.push_tokens (token, user_id, env) values (lower(p_token), (select auth.uid()), p_env)
    on conflict (token) do update set user_id = excluded.user_id, env = excluded.env, updated_at = now();
end $$;

create function public.unregister_push_token(p_token text) returns void
language sql security definer set search_path = '' as $$
  delete from public.push_tokens where token = lower(p_token) and user_id = (select auth.uid())
$$;

revoke all on function public.register_push_token(text, text), public.unregister_push_token(text) from public, anon;
grant execute on function public.register_push_token(text, text), public.unregister_push_token(text) to authenticated;

-- Ostatni stan, o którym poszło powiadomienie (pending = o przekazaniu, accepted/declined = o decyzji).
alter table public.handoffs add column push_sent_status text;

/**
 * Kto dostaje powiadomienie i jaką treść. Wywołuje tylko funkcja notify-handoff (rola service_role) w imieniu
 * zalogowanego `p_user`:
 *  - stan pending: woła nadawca, powiadomienie idzie do odbiorcy;
 *  - accepted / declined: woła odbiorca, powiadomienie idzie do nadawcy;
 *  - cancelled, cudze przekazanie, za stare (config.PUSH_MAX_AGE_H) albo już wysłane: nic (null).
 * Zaznacza wysłanie od razu (blokada wiersza), więc dwa równoległe wywołania nie dadzą dwóch powiadomień.
 */
create function private.handoff_push_claim(p_handoff uuid, p_user uuid, p_max_age_h int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  h public.handoffs;
  caller uuid;
  target uuid;
  other_name text;
  item text;
  title text;
  body text;
begin
  select * into h from public.handoffs where id = p_handoff for update;
  if h.id is null or h.status = 'cancelled' or h.push_sent_status is not distinct from h.status
     or coalesce(h.decided_at, h.created_at) < now() - make_interval(hours => p_max_age_h) then
    return null;
  end if;
  caller := case when h.status = 'pending' then h.from_member else h.to_member end;
  if not exists (select 1 from public.group_members where member_id = caller and user_id = p_user) then return null; end if;
  select user_id into target from public.group_members
    where member_id = case when h.status = 'pending' then h.to_member else h.from_member end and deleted_at is null;
  select display_name into other_name from public.group_members where member_id = caller;
  item := case h.entity
    when 'tasks' then (select t.title from public.tasks t where t.id = h.entity_id)
    when 'events' then (select e.title from public.events e where e.id = h.entity_id)
    else 'Zakupy: ' || (select l.name from public.lists l where l.id = h.entity_id) end;
  if h.occurrence_date is not null then item := item || ' (' || to_char(h.occurrence_date, 'DD.MM') || ')'; end if;
  title := case h.status when 'pending' then other_name || ' przekazuje Ci' when 'accepted' then other_name || ' przyjmuje' else other_name || ' nie przyjmuje' end;
  body := case h.status when 'pending' then coalesce(item, '') || '. Otwórz Organizer, żeby przyjąć albo odrzucić.' else coalesce(item, '') end;
  update public.handoffs set push_sent_status = h.status where id = h.id;
  return jsonb_build_object(
    'title', title,
    'body', body,
    'tokens', coalesce((select jsonb_agg(jsonb_build_object('token', p.token, 'env', p.env) order by p.token) from public.push_tokens p where p.user_id = target), '[]'::jsonb));
end $$;

-- Wejście z PostgREST (tylko klucz tajny): schemat private nie jest wystawiony, więc nakładka w public.
create function public.handoff_push_claim(p_handoff uuid, p_user uuid, p_max_age_h int) returns jsonb
language sql security definer set search_path = '' as $$ select private.handoff_push_claim(p_handoff, p_user, p_max_age_h) $$;

-- APNs odrzucił token (410 Unregistered / 400 BadDeviceToken) — usuwamy.
create function public.drop_push_token(p_token text) returns void
language sql security definer set search_path = '' as $$ delete from public.push_tokens where token = lower(p_token) $$;

revoke all on function public.handoff_push_claim(uuid, uuid, int), public.drop_push_token(text) from public, anon, authenticated;
grant execute on function public.handoff_push_claim(uuid, uuid, int), public.drop_push_token(text) to service_role;

-- push_sent_status zmienia tylko funkcja (bez auth.uid() strażnik przekazań przepuszcza); z telefonu kolumna nie jest
-- zapisywalna (brak w sync_entities i w GRANT), a strażnik i tak odrzuca zmianę czegokolwiek poza status/closed.

revoke all on all functions in schema private from public, anon;
grant execute on function private.rrule_ok(text) to authenticated;
