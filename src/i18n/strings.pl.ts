/**
 * Wszystkie teksty interfejsu w jednym miejscu (D30).
 * Klucze w notacji kropkowej, żeby ewentualne przejście na i18next było mechaniczne.
 */
import { plural } from '../domain/plural';

export const strings = {
  'app.name': 'Organizer',
  'app.placeholder': 'Organizer — szkielet aplikacji (Etap 0)',
  'sync.pending': (n: number) =>
    `${n} ${plural(n, { one: 'zmiana czeka', few: 'zmiany czekają', many: 'zmian czeka' })}`,
} as const;
