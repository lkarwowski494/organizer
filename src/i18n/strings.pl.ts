/**
 * Wszystkie teksty interfejsu w jednym miejscu (D30).
 * Klucze w notacji kropkowej, żeby ewentualne przejście na i18next było mechaniczne.
 */
import { plural } from '../domain/plural';

export const strings = {
  'app.name': 'Organizer',
  'app.placeholder': 'Organizer — szkielet aplikacji (Etap 0)',
  /** Podpis członka po usunięciu konta (D49); serwer wpisuje ten sam tekst (private.deleted_user_label, test kontraktowy). */
  'member.deleted': 'Usunięty użytkownik',
  'sync.pending': (n: number) =>
    `${n} ${plural(n, { one: 'zmiana czeka', few: 'zmiany czekają', many: 'zmian czeka' })}`,
} as const;
