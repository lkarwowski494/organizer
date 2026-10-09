/**
 * Liczby w SQL poza funkcjami private.*() (audyt 2, M-154 / D-23, B-29 pkt 4): ograniczenia kolumn (długości tytułów,
 * notatek, pól zgłoszeń, tokenu push), obcięcia w RPC zgłoszeń, retencje dziennika powiadomień i historii pg_cron oraz
 * granice reguły RRULE muszą być równe src/config. Czyta je z bazy po migracjach (pg_constraint, pg_proc), więc nie
 * zależy od tego, w której migracji liczba się pojawiła. Wymaga bazy z migracjami (scripts/db/test-db.sh); bez PGHOST
 * test jest pomijany (z CI_DB=1 — błąd, db-gate.ts).
 */
import { Client } from 'pg';

import { config } from '../../src/config';
import { CHECKED_FIELDS } from '../../src/domain/sync-engine/row-check';
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
    // Audyt 3 (N-2): klucz kolejności.
    ['tasks', 'tasks_sort_key_length', config.lengths.SORT_KEY],
    ['lists', 'lists_sort_key_length', config.lengths.SORT_KEY],
  ] as const)('%s.%s ≤ %d', async (table, name, want) => {
    expect(max(await check(table, name))).toEqual([want]);
  });

  // Audyt 3 (N-1): każde ograniczenie zakresu dat i godzin (*_range, migracja 20261010010000) ma granice z config.dates.
  it('zakres dat i godzin = config.dates', async () => {
    const defs = (await db.query<{ name: string; def: string }>("select conname as name, pg_get_constraintdef(oid) as def from pg_constraint where connamespace = 'public'::regnamespace and conname like '%\\_range' and pg_get_constraintdef(oid) ~ '::(date|time)' order by 1")).rows;
    expect(defs.length).toBe(19);
    const { MIN, MAX } = config.dates;
    const next = new Date(Date.parse(`${MAX}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    for (const { name, def } of defs) {
      const allowed = [`'${MIN}'::date`, `'${MAX}'::date`, "'24:00:00'::time without time zone", `'${MIN} 00:00:00+00'::timestamp with time zone`, `'${next} 00:00:00+00'::timestamp with time zone`];
      const literals = [...def.matchAll(/'[^']*'::[a-z ]+/g)].map((m) => m[0]);
      expect({ name, literals: literals.filter((l) => !allowed.includes(l)) }).toEqual({ name, literals: [] });
    }
  });

  // Audyt 3 (N-1): telefon sprawdza w wierszach z serwera dokładnie te kolumny dat, godzin i chwil, które mają *_range.
  it('kolumny z zakresem dat = pola sprawdzane na telefonie (row-check.ts)', async () => {
    const cols = (await db.query<{ tab: string; col: string; typ: string }>(
      `select c.conrelid::regclass::text as tab, a.attname as col, format_type(a.atttypid, null) as typ
       from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
       where c.connamespace = 'public'::regnamespace and c.conname = (c.conrelid::regclass::text || '_' || a.attname || '_range')
         and format_type(a.atttypid, null) in ('date', 'time without time zone', 'timestamp with time zone') order by 1, 2`,
    )).rows;
    const kind = (t: string) => (t === 'date' ? 'date' : t.startsWith('time ') ? 'time' : 'instant');
    const want: Record<string, Record<string, string[]>> = {};
    for (const c of cols) ((want[c.tab] ??= {})[kind(c.typ)] ??= []).push(c.col);
    const sorted = (f: typeof CHECKED_FIELDS) => Object.fromEntries(Object.entries(f).sort().map(([e, k]) => [e, Object.fromEntries(Object.entries(k!).map(([n, v]) => [n, [...v].sort()]))]));
    expect(sorted(CHECKED_FIELDS)).toEqual(sorted(want));
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
