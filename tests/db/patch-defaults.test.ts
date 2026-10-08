/**
 * Test kontraktowy (audyt 2, M-59): config.sync.PATCH_DEFAULTS = wartości domyślne kolumn, które telefon może zmieniać
 * (private.sync_entities.patch_cols), odczytane z prawdziwej bazy po migracjach. „Cofnij” zmiany pola, którego wiersz
 * utworzony na telefonie jeszcze nie ma, wpisuje tę wartość — rozjazd z bazą znów dawałby odrzucenia albo zły stan.
 * Wymaga bazy z migracjami (scripts/db/test-db.sh); bez PGHOST test jest pomijany.
 */
import { Client } from 'pg';

import { config } from '../../src/config';

const enabled = !!process.env.PGHOST;
const d = enabled ? describe : describe.skip;

d('PATCH_DEFAULTS zgodne z bazą', () => {
  const db = new Client({ database: process.env.PGDATABASE ?? 'organizer_test' });
  beforeAll(() => db.connect());
  afterAll(() => db.end());

  it('każda zmienialna kolumna z wartością domyślną ma ją w config (i nic ponadto)', async () => {
    const cols = await db.query<{ entity: string; col: string; def: string }>(`
      select e.entity, c.column_name as col, c.column_default as def
      from private.sync_entities e, unnest(e.patch_cols) pc
      join information_schema.columns c on c.column_name = pc
      where c.table_schema = 'public' and c.table_name = e.entity and c.column_default is not null
      order by 1, 2`);
    const fromDb: Record<string, Record<string, unknown>> = {};
    for (const r of cols.rows) {
      // Wartość wyrażenia domyślnego liczy Postgres (np. '{}'::text[] → []), porównujemy jako JSON.
      const v = await db.query<{ v: unknown }>(`select to_jsonb(${r.def}) as v`);
      (fromDb[r.entity] ??= {})[r.col] = v.rows[0]!.v;
    }
    expect(cols.rows.length).toBeGreaterThan(5);
    expect(fromDb).toEqual(config.sync.PATCH_DEFAULTS);
  });
});
