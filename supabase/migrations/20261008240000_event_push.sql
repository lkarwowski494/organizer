-- Powiadomienie o osobie odpowiedzialnej za wydarzenie (D88, decyzja właściciela z 8.10.2026, ADR 0018): tak jak
-- przypisanie zadania i zakupów (D81, ADR 0017) — wpis aktywności z nową osobą przy events.responsible_member_id albo
-- event_overrides.responsible_member_id (jeden termin serii). Te same warunki: autor woła, odbiorca z kontem, 24 h,
-- wyciszenie grupy, najwyżej raz.

create or replace function private.assignment_push_claim(p_activity uuid, p_user uuid, p_max_age_h int) returns jsonb
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
  col := case a.entity when 'tasks' then 'assignee_member_id' when 'lists' then 'responsible_member_id'
                       when 'events' then 'responsible_member_id' when 'event_overrides' then 'responsible_member_id' end;
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
  elsif a.entity = 'lists' then
    title := coalesce(actor_name, '') || ' prosi Cię o zakupy';
    body := 'Zakupy: ' || (select l.name from public.lists l where l.id = a.entity_id);
  elsif a.entity = 'events' then
    -- Cała seria albo pojedyncze wydarzenie: nazwa, przy jednorazowym także dzień.
    title := coalesce(actor_name, '') || ': odpowiadasz za wydarzenie';
    body := (select e.title || case when e.rrule is null then ' · ' || to_char(e.start_date, 'DD.MM') else '' end
             from public.events e where e.id = a.entity_id);
  else
    -- Jeden termin serii (wyjątek): nazwa (zmieniona albo z serii) i dzień tego terminu.
    title := coalesce(actor_name, '') || ': odpowiadasz za wydarzenie';
    body := (select coalesce(o.title, e.title) || ' · ' || to_char(coalesce(o.start_date, o.occurrence_date), 'DD.MM')
             from public.event_overrides o join public.events e on e.id = o.event_id where o.id = a.entity_id);
  end if;
  return jsonb_build_object(
    'title', title,
    'body', coalesce(body, ''),
    'tokens', coalesce((select jsonb_agg(jsonb_build_object('token', p.token, 'env', p.env) order by p.token) from public.push_tokens p where p.user_id = target), '[]'::jsonb));
end $$;

