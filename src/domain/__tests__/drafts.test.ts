import * as fc from 'fast-check';

import { config } from '../../config';
import { changedFields, decodeDraft, encodeDraft } from '../drafts';

type F = { title: string; days: number[]; who: string | null };
const FIELDS = ['title', 'days', 'who'] as const;
const DAY = 86_400_000;

describe('szkic formularza (D179, audyt 2 M-123)', () => {
  it('tylko zmienione pola (porównanie wartości, także tablic)', () => {
    const a: F = { title: 'Basen', days: [0, 2], who: null };
    expect(changedFields(a, { ...a })).toEqual({});
    expect(changedFields(a, { ...a, days: [0, 2] })).toEqual({});
    expect(changedFields(a, { ...a, title: 'Basen Tymka', who: 'tymek' })).toEqual({ title: 'Basen Tymka', who: 'tymek' });
    expect(changedFields(a, { ...a, days: [0] })).toEqual({ days: [0] });
  });

  it('zapis i odczyt; bez zmian — brak szkicu', () => {
    expect(encodeDraft({}, 1)).toBeNull();
    const raw = encodeDraft<F>({ title: 'X', who: null }, 1000)!;
    expect(decodeDraft<F>(raw, FIELDS, 1000)).toEqual({ at: 1000, changes: { title: 'X', who: null } });
  });

  it(`szkic starszy niż ${config.forms.DRAFT_MAX_DAYS} dni przepada`, () => {
    const raw = encodeDraft<F>({ title: 'X' }, 0)!;
    expect(decodeDraft<F>(raw, FIELDS, config.forms.DRAFT_MAX_DAYS * DAY)).not.toBeNull();
    expect(decodeDraft<F>(raw, FIELDS, config.forms.DRAFT_MAX_DAYS * DAY + 1)).toBeNull();
  });

  it.each([null, '', 'nie json', '7', 'null', '{"changes":{"title":"x"}}', '{"at":1}', '{"at":1,"changes":null}', '{"at":"1","changes":{}}', '{"at":1,"changes":{"inne":1}}'])(
    'zły albo obcy zapis %j = brak szkicu',
    (raw) => expect(decodeDraft<F>(raw, FIELDS, 1)).toBeNull(),
  );

  it('znacznik danych, na których szkic powstał (audyt 3, N-31) — zapisany i odczytany; obcy typ pomijany', () => {
    const raw = encodeDraft<F>({ title: 'X' }, 1, 'plan-1')!;
    expect(decodeDraft<F>(raw, FIELDS, 1)).toEqual({ at: 1, changes: { title: 'X' }, stamp: 'plan-1' });
    expect(decodeDraft<F>('{"at":1,"changes":{"title":"x"},"stamp":5}', FIELDS, 1)).toEqual({ at: 1, changes: { title: 'x' } });
  });

  it('nieznane pola (np. ze starszej wersji formularza) są pomijane', () => {
    expect(decodeDraft<F>('{"at":1,"changes":{"title":"x","old":2}}', FIELDS, 1)).toEqual({ at: 1, changes: { title: 'x' } });
  });

  it('własność: szkic nałożony na wartości z otwarcia daje stan formularza', () => {
    const form = fc.record({ title: fc.string(), days: fc.array(fc.integer({ min: 0, max: 6 })), who: fc.option(fc.string()) });
    fc.assert(
      fc.property(form, form, (a, b) => {
        const raw = encodeDraft(changedFields(a, b), 5);
        const d = decodeDraft<F>(raw, FIELDS, 5);
        expect({ ...a, ...(d?.changes ?? {}) }).toEqual(b);
      }),
    );
  });
});
