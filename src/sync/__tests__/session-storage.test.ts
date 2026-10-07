import * as fc from 'fast-check';

import { CHUNK, chunkedSecureStorage, type SecureStoreLike } from '../session-storage';

function memory(): SecureStoreLike & { map: Map<string, string>; opts: object[] } {
  const map = new Map<string, string>();
  const opts: object[] = [];
  return {
    map,
    opts,
    getItemAsync: async (k, o) => (opts.push(o!), map.get(k) ?? null),
    setItemAsync: async (k, v, o) => {
      opts.push(o!);
      if (v.length > 2048) throw new Error('za duże');
      map.set(k, v);
    },
    deleteItemAsync: async (k, o) => (opts.push(o!), void map.delete(k)),
  };
}

const OPTS = { keychainAccessible: 'x' };

describe('sesja w pęku kluczy, w kawałkach', () => {
  it('zapis, odczyt, nadpisanie krótszym, usunięcie', async () => {
    const m = memory();
    const s = chunkedSecureStorage(m, OPTS);
    const long = 'a'.repeat(CHUNK * 2 + 5);
    expect(await s.getItem('sb-ref-auth-token')).toBeNull();
    await s.setItem('sb-ref-auth-token', long);
    expect(m.map.size).toBe(4);
    expect(await s.getItem('sb-ref-auth-token')).toBe(long);
    await s.setItem('sb-ref-auth-token', 'krótki');
    expect(m.map.size).toBe(2);
    expect(await s.getItem('sb-ref-auth-token')).toBe('krótki');
    await s.setItem('sb-ref-auth-token', '');
    expect(await s.getItem('sb-ref-auth-token')).toBe('');
    await s.removeItem('sb-ref-auth-token');
    expect(m.map.size).toBe(0);
    expect(m.opts.every((o) => o === OPTS)).toBe(true);
  });

  it('niedozwolone znaki w kluczu zamienione; przerwany zapis czytany jak brak sesji', async () => {
    const m = memory();
    const s = chunkedSecureStorage(m, OPTS);
    await s.setItem('a b/c', 'x'.repeat(CHUNK + 1));
    expect([...m.map.keys()].sort()).toEqual(['a_b_c.0', 'a_b_c.1', 'a_b_c.n']);
    m.map.delete('a_b_c.1');
    expect(await s.getItem('a b/c')).toBeNull();
  });

  it('własność: dowolny tekst wraca bez zmian, żaden kawałek nie przekracza limitu', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 6000 }), async (v) => {
        const s = chunkedSecureStorage(memory(), OPTS);
        await s.setItem('k', v);
        expect(await s.getItem('k')).toBe(v);
      }),
      { numRuns: 50 },
    );
  });
});
