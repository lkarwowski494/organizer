/**
 * Liczby w SQL poza funkcjami private.*() (audyt 2, M-154 / D-23, B-29 pkt 4): ograniczenia kolumn (długości tytułów,
 * notatek, pól zgłoszeń, tokenu push), obcięcia w RPC zgłoszeń, retencje dziennika powiadomień i historii pg_cron oraz
 * granice reguły RRULE muszą być równe src/config. Czyta je z bazy po migracjach (pg_constraint, pg_proc), więc nie
 * zależy od tego, w której migracji liczba się pojawiła. Wymaga bazy z migracjami (scripts/db/test-db.sh); bez PGHOST
 * test jest pomijany (z CI_DB=1 — błąd, db-gate.ts).
 */
import { Client } from 'pg';

import { config } from '../../src/config';
import { dbDescribe } from './db-gate';

const d = dbDescribe;
const DB = process.env.PGDATABASE ?? 'organizer_test';

d('src/config ↔ liczby w ograniczeniach i funkcjach SQL', () => {
  const db = new Client({ database: DB });
  beforeAll(() => db.connect());
  afterAll(() => db.end());

  const check = async (table: string, name: string) =>
    (await db.query<{ def: string }>("select pg_get_constraintdef(oid) as def from pg_constraint where conrelid = $1::regclass and conname = $2", [`public.${table}`, name])).rows[0]?.def ?? '';
  const src = async (fn: string) => (await db.query<{ src: string }>("select string_agg(prosrc, ' ') as src from pg_proc where pronamespace = 'private'::regnamespace and proname = $1", [fn])).rows[0]?.src ?? '';
  const pub = async (fn: string) => (await db.query<{ src: string }>("select prosrc as src from pg_proc where pronamespace = 'public'::regnamespace and proname = $1", [fn])).rows[0]?.src ?? '';
  const max = (def: string) => [...def.matchAll(/<= (\d+)/g)].map((m) => Number(m[1]));

  it.each([
    ['groups', 'groups_name_check', config.lengths.GROUP_NAME],
    ['lists', 'lists_name_check', config.lengths.LIST_NAME],
    ['tasks', 'tasks_title_check', config.lengths.TASK_TITLE],
    ['event_task_series', 'event_task_series_title_check', config.lengths.TASK_TITLE],
    ['events', 'events_title_check', config.lengths.EVENT_TITLE],
    ['event_overrides', 'event_overrides_title_check', config.lengths.EVENT_TITLE],
    ['tasks', 'tasks_note_check', config.lengths.NOTE],
    ['events', 'events_note_check', config.lengths.NOTE],
    ['group_members', 'group_members_display_name_check', config.profile.NAME_MAX_LENGTH],
    ['profiles', 'profiles_display_name_check', config.profile.NAME_MAX_LENGTH],
    ['client_errors', 'client_errors_message_check', config.feedback.ERROR_MESSAGE_MAX],
    ['client_errors', 'client_errors_stack_check', config.feedback.ERROR_STACK_MAX],
    ['client_errors', 'client_errors_screen_check', config.feedback.SCREEN_MAX],
    ['client_errors', 'client_errors_app_version_check', config.feedback.VERSION_MAX],
    ['app_feedback', 'app_feedback_message_check', config.feedback.MAX_LENGTH],
    ['app_feedback', 'app_feedback_screen_check', config.feedback.SCREEN_MAX],
    ['app_feedback', 'app_feedback_app_version_check', config.feedback.VERSION_MAX],
  ] as const)('%s.%s ≤ %d', async (table, name, want) => {
    expect(max(await check(table, name))).toEqual([want]);
  });

  it('token push: cyfry szesnastkowe, długość PUSH_TOKEN_MIN–PUSH_TOKEN_MAX', async () => {
    expect(await check('push_tokens', 'push_tokens_token_check')).toContain(`{${config.lengths.PUSH_TOKEN_MIN},${config.lengths.PUSH_TOKEN_MAX}}`);
  });

  it('report_client_error i send_feedback obcinają pola do tych samych długości', async () => {
    const f = config.feedback;
    expect(await pub('report_client_error')).toContain(`left(coalesce(p_message, ''), ${f.ERROR_MESSAGE_MAX}), left(p_stack, ${f.ERROR_STACK_MAX}), left(p_screen, ${f.SCREEN_MAX}), left(p_app_version, ${f.VERSION_MAX})`);
    expect(await pub('send_feedback')).toContain(`left(trim(p_message), ${f.MAX_LENGTH}), left(p_screen, ${f.SCREEN_MAX}), left(p_app_version, ${f.VERSION_MAX})`);
  });

  it('retencje: dziennik powiadomień i historia pg_cron', async () => {
    const one = async (fn: string) => Number((await db.query<{ v: number }>(`select private.${fn}() as v`)).rows[0]!.v);
    expect(await one('push_log_retention_days')).toBe(config.retention.PUSH_LOG_DAYS);
    expect(await one('cron_history_days')).toBe(config.retention.CRON_HISTORY_DAYS);
    expect(config.retention.PUSH_LOG_DAYS * 24).toBeGreaterThan(config.PUSH_MAX_AGE_H);
  });

  it('RRULE: najdłuższy zapis, INTERVAL i COUNT jak w src/config (i na granicach przyjęte, za nimi nie)', async () => {
    const s = await src('rrule_ok');
    expect(s).toContain(`char_length(r) > ${config.rrule.MAX_LENGTH}`);
    expect(s).toContain(`between 1 and ${config.rrule.INTERVAL_MAX}`);
    expect(s).toContain(`between 1 and ${config.rrule.COUNT_MAX}`);
    const ok = async (r: string) => (await db.query<{ ok: boolean }>('select private.rrule_ok($1) as ok', [r])).rows[0]!.ok;
    expect(await ok(`FREQ=DAILY;INTERVAL=${config.rrule.INTERVAL_MAX}`)).toBe(true);
    expect(await ok(`FREQ=DAILY;INTERVAL=${config.rrule.INTERVAL_MAX + 1}`)).toBe(false);
    expect(await ok(`FREQ=DAILY;COUNT=${config.rrule.COUNT_MAX}`)).toBe(true);
    expect(await ok(`FREQ=DAILY;COUNT=${config.rrule.COUNT_MAX + 1}`)).toBe(false);
  });
});
