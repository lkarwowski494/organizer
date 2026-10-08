/**
 * Test kontraktowy: liczby egzekwowane przez serwer (funkcje private.* w migracjach SQL) muszą być równe
 * wartościom z src/config — jedynego źródła prawdy. Zmiana w jednym miejscu bez drugiego zatrzymuje CI.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { formatRule, parseRule } from '../../domain/rrule';
import { emptyForm, type EventForm, validateForm } from '../../domain/views/event-form';
import { formatRepeat, nextId, REPEAT_NAMESPACE, type Repeat } from '../../domain/views/task-repeat';
import { strings } from '../../i18n/strings.pl';
import { WEEKDAYS_NOMINATIVE } from '../calendar.pl';
import { config } from '../index';
import { MONTHS_GENITIVE } from '../quickadd.pl';
import { SHOPPING_CATEGORIES } from '../shopping.pl';
import { groupLines } from '../theme';

const dir = join(__dirname, '../../../supabase/migrations');
const sql = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(join(dir, f), 'utf8'))
  .join('\n');

/** Wartość z definicji „create function private.<nazwa>() … as $$ select <liczba> $$”. */
function sqlConstant(name: string): number {
  const re = new RegExp(`create (?:or replace )?function private\\.${name}\\(\\)[^$]*\\$\\$\\s*select\\s+(\\d+)\\s*\\$\\$`, 'gi');
  const found = [...sql.matchAll(re)].map((m) => Number(m[1]));
  if (found.length === 0) throw new Error(`Brak funkcji private.${name}() w migracjach`);
  return found[found.length - 1]!; // obowiązuje ostatnia definicja
}

describe('src/config zgodny z SQL', () => {
  it.each([
    ['max_task_depth', config.MAX_TASK_DEPTH],
    ['push_batch_max', config.sync.PUSH_BATCH_MAX],
    ['pull_limit_max', config.sync.PULL_LIMIT_MAX],
    ['tombstone_days', config.sync.TOMBSTONE_DAYS],
    ['schema_version', config.sync.MIN_SCHEMA_VERSION],
    ['invite_default_ttl_hours', config.invites.DEFAULT_TTL_HOURS],
    ['invite_max_ttl_hours', config.invites.MAX_TTL_HOURS],
    ['invite_default_max_uses', config.invites.DEFAULT_MAX_USES],
    ['invite_max_uses_limit', config.invites.MAX_USES_LIMIT],
    ['client_errors_per_day', config.feedback.ERRORS_PER_DAY],
    ['feedback_per_day', config.feedback.PER_DAY],
    ['feedback_retention_days', config.feedback.RETENTION_DAYS],
    ['staples_max', config.shopping.STAPLES_MAX],
    ['join_id_digits', config.invites.JOIN_ID_DIGITS],
    ['join_code_digits', config.invites.CODE_DIGITS],
    ['join_code_ttl_hours', config.invites.CODE_TTL_HOURS],
    ['join_fails_per_user', config.invites.JOIN_FAILS_PER_USER],
    ['join_fails_per_code', config.invites.JOIN_FAILS_PER_CODE],
    ['staple_max_length', config.shopping.STAPLE_MAX_LENGTH],
    ['event_location_max_length', config.events.LOCATION_MAX_LENGTH],
  ])('private.%s() = %d', (name, value) => {
    expect(sqlConstant(name)).toBe(value);
  });

  it('D140 odwrócona: kod żyje krócej niż ślad prób (doba) i limit na kod daje szansę odgadnięcia ≤ 0,01% (rachunek)', () => {
    // daily_maintenance usuwa próby starsze niż doba — wszystkie próby z życia kodu muszą być jeszcze policzalne.
    expect(config.invites.CODE_TTL_HOURS).toBeLessThanOrEqual(24);
    expect(sql).toContain("delete from private.join_attempts where at < now() - interval '1 day'");
    expect(config.invites.JOIN_FAILS_PER_CODE / 10 ** config.invites.CODE_DIGITS).toBeLessThanOrEqual(0.0001);
  });

  it('długość opinii w SQL = config.feedback.MAX_LENGTH (D80)', () => {
    expect(sql).toContain(`char_length(message) between 1 and ${config.feedback.MAX_LENGTH}`);
    expect(sql).toContain(`left(trim(p_message), ${config.feedback.MAX_LENGTH})`);
  });

  it.each([
    ['groups', 'name', config.lengths.GROUP_NAME],
    ['lists', 'name', config.lengths.LIST_NAME],
    ['tasks', 'title', config.lengths.TASK_TITLE],
  ])('najdłuższa wartość public.%s.%s w SQL = config.lengths (audyt 2, M-228)', (table, column, max) => {
    const block = new RegExp(`create table public\\.${table} \\(([\\s\\S]*?)\\n\\);`, 'i').exec(sql)?.[1] ?? '';
    expect(block).toContain(`${column} text not null check (char_length(${column}) between 1 and ${max})`);
    // Żadna późniejsza migracja nie zmienia tego ograniczenia.
    expect(sql).not.toMatch(new RegExp(`alter table public\\.${table}\\b[^;]*char_length\\(${column}\\)`, 'i'));
  });

  it('najdłuższe imię w SQL = config.profile.NAME_MAX_LENGTH (D100)', () => {
    expect(sql).toContain(`char_length(display_name) between 1 and ${config.profile.NAME_MAX_LENGTH}`);
    expect(sql).toContain(`char_length(display_name) <= ${config.profile.NAME_MAX_LENGTH}`);
  });

  it("podpis usuniętego użytkownika = strings['member.deleted'] (D49)", () => {
    const found = [...sql.matchAll(/function private\.deleted_user_label\(\)[^$]*\$\$\s*select\s+'([^']*)'::text\s*\$\$/gi)];
    expect(found.map((m) => m[1])).toEqual([strings['member.deleted']]);
  });

  it('działy zakupów w SQL = src/config/shopping.pl.ts (D85)', () => {
    const found = [...sql.matchAll(/function private\.shopping_categories\(\)[^$]*\$\$\s*select array\[([^\]]*)\]/gi)].map((m) => m[1]!.split(',').map((x) => x.trim().replace(/'/g, '')));
    expect(found.at(-1)).toEqual(SHOPPING_CATEGORIES.map((c) => c.key));
  });

  it('klucze kolorów grup w SQL = paleta linii (D56)', () => {
    const found = [...sql.matchAll(/function private\.group_colors\(\)[^$]*\$\$\s*select array\[([^\]]*)\]/gi)].map((m) => m[1]!.split(',').map((x) => x.trim().replace(/'/g, '')));
    expect(found.at(-1)).toEqual(groupLines.map((g) => g.key));
  });

  it('dziennik push trzyma wpisy dłużej niż okno powiadomień (D82)', () => {
    expect(sqlConstant('push_log_retention_days') * 24).toBeGreaterThan(config.PUSH_MAX_AGE_H);
  });

  // Audyt 2 (M-138): treści push układa serwer — te same teksty co w aplikacji, jedna data jak formatLongDate.
  it("treści powiadomień push w SQL = strings['push.text.*'] i strings['trip.title']", () => {
    const found = [...sql.matchAll(/function private\.push_texts\(\)[^$]*\$\$\s*select\s+'(\{[^']*\})'::jsonb/gi)].map((m) => JSON.parse(m[1]!) as Record<string, string>);
    const keys = ['handoffPending', 'handoffAccepted', 'handoffDeclined', 'handoffAction', 'assignTask', 'assignTrip', 'assignEvent'] as const;
    expect(found.at(-1)).toEqual({ ...Object.fromEntries(keys.map((k) => [k, strings[`push.text.${k}`]])), trip: strings['trip.title']('') });
  });

  it('data w treści push (private.pl_long_date) — nazwy dni i miesięcy jak w aplikacji, strefa config.TIME_ZONE', () => {
    const body = [...sql.matchAll(/function private\.pl_long_date\(d date\)[^$]*\$\$([\s\S]*?)\$\$/gi)].at(-1)![1]!;
    const arrays = [...body.matchAll(/array\[([^\]]*)\]/g)].map((m) => m[1]!.split(',').map((x) => x.trim().replace(/'/g, '')));
    expect(arrays).toEqual([WEEKDAYS_NOMINATIVE.map((d) => d.charAt(0).toLocaleUpperCase('pl') + d.slice(1)), [...MONTHS_GENITIVE]]);
    expect(body).toContain(`at time zone '${config.TIME_ZONE}'`);
  });

  it('id następnego terminu zadania w SQL = nextId() na telefonie (przyjęcie przekazania łańcucha, PW-31)', () => {
    const found = [...sql.matchAll(/function private\.next_task_id\(id uuid\)[^$]*\$\$\s*select private\.uuid_v5\('([0-9a-f-]{36})'::uuid, id::text \|\| '\|next'\)/gi)].map((m) => m[1]);
    expect(found.at(-1)).toBe(REPEAT_NAMESPACE);
    // Ten sam wektor co pgTAP handoff_obligation (4), policzony niezależnie: Python uuid.uuid5.
    expect(nextId('77770000-0000-7000-8000-0000000004e1')).toBe('d81b13c9-e6b0-5fc0-82a2-97229c6595bc');
  });

  it('brak definicji zgłaszany wprost', () => {
    expect(() => sqlConstant('nie_istnieje')).toThrow('Brak funkcji');
  });

  // PWD-37 (audyt 2): każda reguła, którą zapisuje telefon (zadania i wydarzenia, także BYMONTHDAY=-1), przechodzi
  // CHECK serwera — ostatnia definicja private.rrule_ok i warunek kolumny tasks.repeat.
  it('reguły powtarzania z telefonu przechodzą private.rrule_ok i CHECK tasks.repeat', () => {
    const defs = [...sql.matchAll(/create (?:or replace )?function private\.rrule_ok\(r text\)[\s\S]*?\$\$([\s\S]*?)\$\$/gi)];
    const body = defs.at(-1)![1]!;
    const rule = new RegExp(/r ~ '([^']+)'/.exec(body)![1]!);
    const max = Number(/char_length\(r\) <= (\d+)/.exec(body)![1]);
    const after = new RegExp(/or repeat ~ '(\^AFTER[^']+)'/.exec(sql)![1]!);
    const taskRules: Repeat[] = [
      { kind: 'daily' },
      { kind: 'weekly', days: [0, 1, 2, 3, 4, 5, 6] },
      { kind: 'monthly' },
      { kind: 'monthly', day: 31 },
      { kind: 'monthly', day: -1 },
      { kind: 'after', unit: 'DAILY', interval: 14 },
      { kind: 'after', unit: 'WEEKLY', interval: 99 },
    ];
    for (const r of taskRules) {
      const text = formatRepeat(r);
      expect([text, rule.test(text) || after.test(text)]).toEqual([text, true]);
    }
    const ev = (over: Partial<EventForm>) => {
      const v = validateForm({ ...emptyForm('2026-10-31'), title: 'X', slots: [{ days: [5, 6], start: '18:00', end: '' }], interval: '2', ends: 'until', until: '2027-12-31', ...over });
      if ('error' in v) throw new Error(v.error);
      return formatRule(v.fields[0]!.rule!);
    };
    const eventRules = [ev({ repeat: 'daily' }), ev({ repeat: 'weekly' }), ev({ repeat: 'monthly', monthly: 'day' }), ev({ repeat: 'monthly', monthly: 'last' }), ev({ repeat: 'monthly', monthly: 'lastDay' }), ev({ repeat: 'yearly' })];
    expect(eventRules).toContain('FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=-1');
    for (const text of eventRules) {
      expect([text, rule.test(text) && text.length <= max]).toEqual([text, true]);
      expect(parseRule(text)).toBeTruthy();
    }
  });
});

