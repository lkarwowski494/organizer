-- Powtarzanie zadań (D76, decyzja właściciela z 7.10.2026, ADR 0016). Zapis reguły w tasks.repeat (telefon:
-- src/domain/views/task-repeat.ts): RRULE z tego samego podzbioru co wydarzenia (private.rrule_ok) albo
-- „AFTER=DAILY|WEEKLY;INTERVAL=n” (od wykonania, D23). Następne zadanie tworzy telefon przy odhaczeniu, ze stałym id.
alter table public.tasks add column repeat text
  check (repeat is null or private.rrule_ok(repeat) or repeat ~ '^AFTER=(DAILY|WEEKLY);INTERVAL=[1-9][0-9]?$');
-- Powtarzanie liczy się od terminu, więc bez terminu go nie ma.
alter table public.tasks add constraint tasks_repeat_needs_due check (repeat is null or due_date is not null);

grant insert (repeat), update (repeat) on public.tasks to authenticated;
update private.sync_entities
   set insert_cols = insert_cols || '{repeat}', patch_cols = patch_cols || '{repeat}'
 where entity = 'tasks';
