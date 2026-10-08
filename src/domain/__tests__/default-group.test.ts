import { LAST_USED, startGroup } from '../views/default-group';

describe('grupa domyślna nowego wpisu (decyzja właściciela 8.10.2026, M-24, PW-37)', () => {
  const groups = [{ id: 'u-me' }, { id: 'gf' }, { id: 'gk' }];

  it('konkretna grupa z ustawienia; „Ostatnio użyta” — ostatnia ważna; inaczej pierwsza (osobista)', () => {
    expect(startGroup(groups, 'gk', 'gf')).toBe('gk');
    expect(startGroup(groups, LAST_USED, 'gf')).toBe('gf');
    expect(startGroup(groups, null, 'gf')).toBe('gf');
    // Ustawionej grupy już nie ma (albo nie mogę w niej tworzyć) — jak „Ostatnio użyta”.
    expect(startGroup(groups, 'stara', 'gk')).toBe('gk');
    expect(startGroup(groups, LAST_USED, 'stara')).toBe('u-me');
    expect(startGroup(groups, null, null)).toBe('u-me');
    expect(startGroup([], null, null)).toBeNull();
  });
});
