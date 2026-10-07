/**
 * Schemat lokalnej bazy telefonu. Pliki migracji (tu: lista SQL) są źródłem prawdy (D25); numer wersji
 * w PRAGMA user_version. Każda migracja to osobny krok — nigdy nie edytujemy wydanej migracji, tylko
 * dopisujemy następną (test migracji ze wszystkich wersji: src/data/__tests__/migrations.test.ts).
 *
 * Tabele lustrzane serwera trzymają cały wiersz w `data` (JSON jako tekst) plus kolumny potrzebne do
 * zapytań i czyszczenia (group_id, scope_id), liczone w kodzie przy zapisie.
 */
import type { DbAdapter } from './adapter';

const V1_TABLES = ['groups', 'group_members', 'lists', 'object_members', 'tasks', 'activity'] as const;
/** Wydarzenia (migracja serwera 20261008100000_events). */
const V2_TABLES = ['events', 'event_participants', 'event_overrides'] as const;
/** Stałe zadania serii (migracja serwera 20261008130000_event_task_series). */
const V3_TABLES = ['event_task_series'] as const;
/** Przekazania odpowiedzialności (migracja serwera 20261008150000_handoffs). */
const V4_TABLES = ['handoffs'] as const;
export const ENTITY_TABLES = [...V1_TABLES, ...V2_TABLES, ...V3_TABLES, ...V4_TABLES] as const;

const mirror = (t: string) => `
create table ${t} (
  key text primary key not null,
  group_id text not null,
  scope_id text,
  version integer not null default 0,
  data text not null
);
create index ${t}_group_idx on ${t} (group_id);
create index ${t}_scope_idx on ${t} (scope_id);`;

export const MIGRATIONS: readonly { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
${V1_TABLES.map(mirror).join('\n')}
create table pending_ops (
  seq integer primary key not null,
  op_id text not null unique,
  op text not null
);
create table rejected_ops (
  seq integer primary key not null,
  code text not null,
  op text not null,
  rejected_at integer not null
);
create table sync_state (
  key text primary key not null,
  value text not null
);`,
  },
  { version: 2, sql: V2_TABLES.map(mirror).join('\n') },
  { version: 3, sql: V3_TABLES.map(mirror).join('\n') },
  { version: 4, sql: V4_TABLES.map(mirror).join('\n') },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

export function migrate(db: DbAdapter): number {
  const [{ user_version: current }] = db.all<{ user_version: number }>('pragma user_version') as [{ user_version: number }];
  if (current > SCHEMA_VERSION) {
    // Baza z nowszej wersji aplikacji (np. po cofnięciu buildu) — nie dotykamy jej, żeby nic nie zniszczyć.
    throw new Error(`local_schema_newer:${current}`);
  }
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.exec(`pragma user_version = ${m.version}`);
    });
  }
  return SCHEMA_VERSION;
}
