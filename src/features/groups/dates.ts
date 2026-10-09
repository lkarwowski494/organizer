/**
 * Data bezwzględna do tekstów czytanych później albo przez innych (audyt 2, U-41: w wiadomości „jutro” znaczy u adresata
 * co innego): „czwartek, 8 października”, z rokiem, gdy inny niż bieżący. Czas Europe/Warsaw (config.TIME_ZONE).
 */
import { localNow } from '../../domain/local-time';
import type { CivilDate } from '../../domain/civil-date';
import { formatLongDate } from '../../domain/format';

export function absoluteDay(ms: number, today: CivilDate): string {
  const day = formatLongDate(localNow(ms), today);
  return `${day.charAt(0).toLocaleLowerCase('pl')}${day.slice(1)}`;
}
