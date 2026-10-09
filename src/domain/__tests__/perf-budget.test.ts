/**
 * Budżet czasu widoków (audyt 3, N-6, N-16; progi w config.perf): plan przypomnień, Moje sprawy i Kalendarz nie mogą
 * znowu kosztować proporcjonalnie do całej historii rodziny. Czas procesora tego procesu (process.cpuUsage), mediana
 * z 5 przebiegów po rozgrzewce — mniej czuły na inne procesy testów niż zegar.
 */
import { config } from '../../config';
import { addDays, formatIsoDate } from '../civil-date';
import { localNow, localToMs } from '../local-time';
import { calendarMonth } from '../views';
import { eventsByDate } from '../views/events';
import { myDays } from '../views/my-days';
import { planReminders } from '../views/reminders';
import { familyTables, FAMILY_TODAY as TODAY, FAMILY_USER as ME } from './support/family-data';

function cpuMs(fn: () => unknown): number {
  fn();
  const ts: number[] = [];
  for (let i = 0; i < 5; i++) {
    const start = process.cpuUsage();
    fn();
    const d = process.cpuUsage(start);
    ts.push((d.user + d.system) / 1000);
  }
  return ts.sort((a, b) => a - b)[2]!;
}

describe(`budżet czasu: rodzina po ${config.perf.FAMILY_YEARS} latach`, () => {
  const t = familyTables(config.perf.FAMILY_YEARS);
  const localDate = (s: string) => formatIsoDate(localNow(Date.parse(s)));
  const label = { trip: (s: string) => s, morningTitle: 'Dziś', more: (n: number) => `i ${n}`, summary: (n: number) => `${n}` };

  it('dane mają historię (inaczej budżet niczego nie mierzy)', () => {
    expect(Object.keys(t.tasks!).length).toBeGreaterThan(9000);
    expect(planReminders(t, ME, TODAY, localToMs({ ...TODAY, hh: 9, mm: 0 }), { leadMin: 30, morning: '08:00' }, { days: 14, max: 64, toMs: localToMs, localDate, label }).length).toBe(64);
  });

  it('plan przypomnień na 14 dni', () => {
    const ms = cpuMs(() => planReminders(t, ME, TODAY, localToMs({ ...TODAY, hh: 9, mm: 0 }), { leadMin: 30, morning: '08:00' }, { days: config.reminders.DAYS_AHEAD, max: config.reminders.MAX_SCHEDULED, toMs: localToMs, localDate, label }));
    expect(ms).toBeLessThan(config.perf.PLAN_REMINDERS_MS);
  });

  it('Moje sprawy — miesiąc', () => {
    expect(cpuMs(() => myDays(t, ME, TODAY, 'month', TODAY, localDate))).toBeLessThan(config.perf.MY_DAYS_MONTH_MS);
  });

  it('Kalendarz — miesiąc i wydarzenia siatki', () => {
    const ms = cpuMs(() => {
      calendarMonth(t, ME, TODAY.y, TODAY.m, { today: TODAY, localDate });
      eventsByDate(t, ME, addDays(TODAY, -14), addDays(TODAY, 28));
    });
    expect(ms).toBeLessThan(config.perf.CALENDAR_MONTH_MS);
  });
});
