import { whatsNew } from '../whats-new';

const E = [
  { fromBuild: 16, items: ['c'] },
  { fromBuild: 14, items: ['a', 'b'] },
];

describe('co nowego (D84)', () => {
  it('aktualizacja: najnowszy wpis nowszy niż obejrzany, nie nowszy niż bieżący build', () => {
    expect(whatsNew(E, 14, 13, true)).toEqual({ show: ['a', 'b'], remember: null });
    expect(whatsNew(E, 15, 13, true)).toEqual({ show: ['a', 'b'], remember: null });
    expect(whatsNew(E, 17, 13, true)).toEqual({ show: ['c'], remember: null });
    expect(whatsNew(E, 14, null, true)).toEqual({ show: ['a', 'b'], remember: null });
  });

  it('już obejrzane albo nic nowego — tylko zapamiętaj bieżący build', () => {
    expect(whatsNew(E, 15, 14, true)).toEqual({ show: null, remember: 15 });
    expect(whatsNew(E, 14, 14, true)).toEqual({ show: null, remember: null });
    expect(whatsNew(E, 13, null, true)).toEqual({ show: null, remember: 13 });
  });

  it('nowa osoba: bez karty, zapamiętaj build; nieznany build — nic', () => {
    expect(whatsNew(E, 14, null, false)).toEqual({ show: null, remember: 14 });
    expect(whatsNew(E, 14, 14, false)).toEqual({ show: null, remember: null });
    expect(whatsNew(E, Number.NaN, null, true)).toEqual({ show: null, remember: null });
  });
});
