/**
 * Apps4Brew Database Path Protection (SEC-09):
 * Przeniesienie bazy SQLite poza katalog Dokumenty (`Documents/SQLite/` -> `/Library/SQLite`).
 * Katalog Dokumenty jest widoczny dla użytkownika w aplikacji Pliki (dzięki UIFileSharingEnabled),
 * a roboczej bazy SQLite nie wolno narażać na przypadkowe skasowanie lub podmianę.
 * `/Library/SQLite` jest prywatne dla aplikacji i wchodzi do kopii telefonu (iCloud/iTunes).
 */
export function dbDirectory(def?: string | null): string | undefined {
  return def && /\/Documents\/SQLite\/?$/.test(def)
    ? def.replace(/\/Documents\/SQLite\/?$/, '/Library/SQLite')
    : undefined;
}
