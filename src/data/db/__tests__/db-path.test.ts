import { dbDirectory } from '../db-path';

describe('dbDirectory (SEC-09)', () => {
  it('zwraca undefined dla braku ścieżki lub pustej wartości', () => {
    expect(dbDirectory()).toBeUndefined();
    expect(dbDirectory(null)).toBeUndefined();
    expect(dbDirectory('')).toBeUndefined();
  });

  it('zamienia /Documents/SQLite na /Library/SQLite', () => {
    expect(dbDirectory('/var/mobile/Containers/Data/Application/123/Documents/SQLite')).toBe(
      '/var/mobile/Containers/Data/Application/123/Library/SQLite',
    );
  });

  it('zamienia /Documents/SQLite/ z końcowym ukośnikiem na /Library/SQLite', () => {
    expect(dbDirectory('/var/mobile/Containers/Data/Application/123/Documents/SQLite/')).toBe(
      '/var/mobile/Containers/Data/Application/123/Library/SQLite',
    );
  });

  it('zwraca undefined dla ścieżek niezawierających Documents/SQLite', () => {
    expect(dbDirectory('/var/mobile/Containers/Data/Application/123/Library/SQLite')).toBeUndefined();
    expect(dbDirectory('/var/mobile/Documents/Other')).toBeUndefined();
  });
});
