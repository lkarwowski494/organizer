import { MONTHS_NOMINATIVE, WEEKDAYS_ABBREVIATED, WEEKDAYS_NOMINATIVE } from '../calendar.en';

describe('calendar.en (CLDR en ca-gregorian)', () => {
  it('ma 12 miesięcy w mianowniku', () => {
    expect(MONTHS_NOMINATIVE).toHaveLength(12);
    expect(MONTHS_NOMINATIVE[0]).toBe('January');
    expect(MONTHS_NOMINATIVE[11]).toBe('December');
  });

  it('ma 7 dni tygodnia w mianowniku od poniedziałku (isoWeekday 0)', () => {
    expect(WEEKDAYS_NOMINATIVE).toHaveLength(7);
    expect(WEEKDAYS_NOMINATIVE[0]).toBe('Monday');
    expect(WEEKDAYS_NOMINATIVE[6]).toBe('Sunday');
  });

  it('ma 7 skrótów dni tygodnia', () => {
    expect(WEEKDAYS_ABBREVIATED).toHaveLength(7);
    expect(WEEKDAYS_ABBREVIATED[0]).toBe('Mon');
    expect(WEEKDAYS_ABBREVIATED[6]).toBe('Sun');
  });
});
