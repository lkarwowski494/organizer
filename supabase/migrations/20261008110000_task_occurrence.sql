-- Zadania podpięte do wystąpienia wydarzenia (D13, ADR 0008): zadanie wskazuje serię (event_id) i datę wystąpienia
-- według reguły (occurrence_date — ten sam klucz co event_overrides). Tryb terminu 'event' = termin z wystąpienia
-- (także po przeniesieniu); 'own' przy zachowanym podpięciu = własny termin (np. zakup najpóźniej w sobotę).
-- Odwołanie i usunięcie spotkania nie rusza zadań — telefon pyta, co z nimi zrobić (D14), a podpięcie do
-- nieistniejącego wystąpienia telefon pokazuje jako „spotkanie odwołane” (nic nie ginie, R1).

alter table public.tasks
  add column event_id uuid references public.events (id),
  add column occurrence_date date,
  add constraint tasks_occurrence_pair check ((event_id is null) = (occurrence_date is null)),
  drop constraint tasks_deadline_mode_check,
  add constraint tasks_deadline_mode_check check (deadline_mode in ('none', 'own', 'inherit', 'event')),
  add constraint tasks_event_mode_needs_event check (deadline_mode <> 'event' or event_id is not null);
create index tasks_event_idx on public.tasks (event_id);

grant insert (event_id, occurrence_date), update (event_id, occurrence_date) on public.tasks to authenticated;

update private.sync_entities
   set insert_cols = insert_cols || '{event_id,occurrence_date}', patch_cols = patch_cols || '{event_id,occurrence_date}'
 where entity = 'tasks';

-- Spotkanie z tej samej grupy i nieusunięte (przy podpinaniu). Osobny wyzwalacz, żeby nie powielać strażnika zadań.
create function private.tasks_event_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare e public.events;
begin
  if new.event_id is null or new.event_id is not distinct from (case when tg_op = 'UPDATE' then old.event_id end) then return new; end if;
  select * into e from public.events where id = new.event_id;
  if e.id is null or e.group_id <> new.group_id then raise exception 'invalid_event' using errcode = 'P0001'; end if;
  if e.deleted_at is not null then raise exception 'deleted:event' using errcode = 'P0001'; end if;
  return new;
end $$;

create trigger tasks_a_guard_event before insert or update on public.tasks
  for each row execute function private.tasks_event_guard();

revoke all on all functions in schema private from public, anon;
