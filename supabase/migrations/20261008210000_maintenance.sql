-- Codzienne sprzątanie bazy (O-032, D82): kosz po tombstone_days(), grupy z kosza, dzienniki push i stare zgłoszenia.
-- Harmonogram w samej bazie przez pg_cron (Supabase Cron: https://supabase.com/docs/guides/cron — „we recommend
-- no more than 8 Jobs run concurrently”, „Each Job should run no more than 10 minutes”; mamy dwa krótkie zadania).
-- Historia przebiegów cron.job_run_details nie czyści się sama („The records in the cron.job_run_details table are
-- not cleaned up automatically”, https://supabase.com/docs/guides/cron/quickstart), więc drugie zadanie trzyma 7 dni,
-- jak w przykładzie z tej strony.

create extension if not exists pg_cron;

-- Wpis „wysłano” chroni przed drugim powiadomieniem tylko w oknie PUSH_MAX_AGE_H (24 h, src/config);
-- 7 dni to zapas (test kontraktowy pilnuje, że retencja > okna).
create function private.push_log_retention_days() returns int language sql immutable as $$ select 7 $$;
create function private.cron_history_days() returns int language sql immutable as $$ select 7 $$;

create function private.daily_maintenance() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  tombstones int;
  groups int;
  errors int;
  feedback int;
  pushes int;
begin
  tombstones := private.purge_tombstones();
  groups := private.purge_deleted_groups();
  delete from public.client_errors where created_at < now() - make_interval(days => private.feedback_retention_days());
  get diagnostics errors = row_count;
  delete from public.app_feedback where created_at < now() - make_interval(days => private.feedback_retention_days());
  get diagnostics feedback = row_count;
  delete from private.push_log where created_at < now() - make_interval(days => private.push_log_retention_days());
  get diagnostics pushes = row_count;
  return jsonb_build_object('tombstones', tombstones, 'groups', groups, 'client_errors', errors, 'app_feedback', feedback, 'push_log', pushes);
end $$;

create function private.cron_history_cleanup() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  delete from cron.job_run_details where end_time < now() - make_interval(days => private.cron_history_days());
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function private.push_log_retention_days(), private.cron_history_days(), private.daily_maintenance(),
  private.cron_history_cleanup() from public, anon, authenticated;

-- Godziny w UTC, poza pełną godziną (mniejszy tłok na wspólnej infrastrukturze). cron.schedule z nazwą nadpisuje
-- istniejące zadanie, więc ponowne wgranie nie dubluje harmonogramu.
select cron.schedule('organizer-daily-maintenance', '17 3 * * *', 'select private.daily_maintenance()');
select cron.schedule('organizer-cron-history', '27 3 * * *', 'select private.cron_history_cleanup()');
