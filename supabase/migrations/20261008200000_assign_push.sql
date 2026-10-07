-- Powiadomienie o przypisaniu (D81, decyzja właściciela z 7.10.2026, ADR 0017): gdy ktoś przypisze mi zadanie albo
-- zakupy. Źródło prawdy to kanał aktywności (private.log_activity zapisuje {kolumna: [stara, nowa]} i autora), więc
-- telefon osoby przypisującej woła funkcję notify-handoff z id wpisu aktywności — baza sprawdza resztę i powiadamia raz.
-- Wyciszenie grupy (push_mutes) dotyczy przypisań; przekazania (D70) czekają na decyzję, więc nie są wyciszane.

create table public.push_mutes (
  user_id uuid not null references auth.users (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, group_id)
);
alter table public.push_mutes enable row level security;
revoke all on public.push_mutes from anon, authenticated;

-- Raz na wpis aktywności (dwa wywołania naraz nie dają dwóch powiadomień).
create table private.push_log (
  key text primary key,
  created_at timestamptz not null default now()
);

create function public.set_push_mute(p_group uuid, p_muted boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  if me is null or private.my_member_id(p_group) is null then raise exception 'forbidden' using errcode = 'P0001'; end if;
  if p_muted then
    insert into public.push_mutes (user_id, group_id) values (me, p_group) on conflict do nothing;
  else
    delete from public.push_mutes where user_id = me and group_id = p_group;
  end if;
end $$;

create function public.my_push_mutes() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(group_id order by group_id), '{}') from public.push_mutes where user_id = (select auth.uid())
$$;

revoke all on function public.set_push_mute(uuid, boolean), public.my_push_mutes() from public, anon;
grant execute on function public.set_push_mute(uuid, boolean), public.my_push_mutes() to authenticated;

/**
 * Komu i co po przypisaniu. Wywołuje tylko funkcja (service_role) w imieniu `p_user` — autora zmiany:
 *  - wpis o zadaniu (assignee_member_id) albo liście zakupów (responsible_member_id) z nową osobą;
 *  - autor wpisu to p_user, nowa osoba ma konto i to nie p_user (przyjęcie przekazania samemu sobie — nic);
 *  - nie starszy niż p_max_age_h, grupa niewyciszona przez odbiorcę, jeszcze nie wysłany.
 */
create function private.assignment_push_claim(p_activity uuid, p_user uuid, p_max_age_h int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a public.activity;
  col text;
  target_member uuid;
  target uuid;
  actor_name text;
  title text;
  body text;
begin
  select * into a from public.activity where id = p_activity;
  if a.id is null or a.created_at < now() - make_interval(hours => p_max_age_h) then return null; end if;
  col := case a.entity when 'tasks' then 'assignee_member_id' when 'lists' then 'responsible_member_id' end;
  if col is null or not (a.changes ? col) then return null; end if;
  target_member := nullif(a.changes -> col ->> 1, '')::uuid;
  if target_member is null then return null; end if;
  if not exists (select 1 from public.group_members where member_id = a.actor_member_id and user_id = p_user) then return null; end if;
  select user_id into target from public.group_members where member_id = target_member and deleted_at is null;
  if target is null or target = p_user then return null; end if;
  if exists (select 1 from public.push_mutes where user_id = target and group_id = a.group_id) then return null; end if;
  insert into private.push_log (key) values ('assign|' || a.id) on conflict do nothing;
  if not found then return null; end if;
  select display_name into actor_name from public.group_members where member_id = a.actor_member_id;
  if a.entity = 'tasks' then
    title := coalesce(actor_name, '') || ' przypisuje Ci zadanie';
    body := (select t.title from public.tasks t where t.id = a.entity_id);
  else
    title := coalesce(actor_name, '') || ' prosi Cię o zakupy';
    body := 'Zakupy: ' || (select l.name from public.lists l where l.id = a.entity_id);
  end if;
  return jsonb_build_object(
    'title', title,
    'body', coalesce(body, ''),
    'tokens', coalesce((select jsonb_agg(jsonb_build_object('token', p.token, 'env', p.env) order by p.token) from public.push_tokens p where p.user_id = target), '[]'::jsonb));
end $$;

create function public.assignment_push_claim(p_activity uuid, p_user uuid, p_max_age_h int) returns jsonb
language sql security definer set search_path = '' as $$ select private.assignment_push_claim(p_activity, p_user, p_max_age_h) $$;
revoke all on function public.assignment_push_claim(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.assignment_push_claim(uuid, uuid, int) to service_role;

revoke all on all functions in schema private from public, anon;
grant execute on function private.rrule_ok(text) to authenticated;
