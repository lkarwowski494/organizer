/**
 * Kiedy testy na prawdziwym Postgresie biegną (audyt 2, M-155): z PGHOST — tak; bez PGHOST — pomijane (zwykłe `npm test`
 * na komputerze bez bazy). W `npm run test:db` i w db.yml jest CI_DB=1: wtedy brak PGHOST to błąd konfiguracji, a nie
 * zielony przebieg z „pominiętymi” testami.
 */
export function dbEnabled(env: { [k: string]: string | undefined } = process.env): boolean {
  if (env.PGHOST) return true;
  if (env.CI_DB === '1') throw new Error('CI_DB=1, ale brak PGHOST — testy bazy nie mogą być pominięte');
  return false;
}

/** `describe` dla testów bazy: pomijany tylko poza CI_DB=1 (dbEnabled). */
export const dbDescribe: jest.Describe = dbEnabled() ? describe : describe.skip;
