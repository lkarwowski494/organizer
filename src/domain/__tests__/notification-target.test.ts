import { parseTarget, type Target, targetPath } from '../notification-target';

describe('dokąd prowadzi powiadomienie (PWD-16, decyzja właściciela 8.10.2026)', () => {
  it('ścieżka i z powrotem: zadanie, lista zakupów, termin, cała seria, „Moje sprawy”', () => {
    const all: Target[] = [
      { screen: 'task', id: '0199a3b4-0000-7000-8000-0000000004d1' },
      { screen: 'list', id: 'l-zakupy' },
      { screen: 'event', id: 'ev', date: '2026-10-14' },
      { screen: 'event', id: 'ev', date: null },
      { screen: 'today' },
    ];
    expect(all.map(targetPath)).toEqual(['task/0199a3b4-0000-7000-8000-0000000004d1', 'list/l-zakupy', 'event/ev/2026-10-14', 'event/ev', 'today']);
    for (const t of all) expect(parseTarget(targetPath(t))).toEqual(t);
  });

  it('ścieżki z serwera (private.*_push_claim) — te same formy', () => {
    expect(parseTarget('event/cccc0000-0000-7000-8000-0000000001e4/2026-10-14')).toEqual({ screen: 'event', id: 'cccc0000-0000-7000-8000-0000000001e4', date: '2026-10-14' });
    expect(parseTarget('list/cccc0000-0000-7000-8000-0000000000c2')).toEqual({ screen: 'list', id: 'cccc0000-0000-7000-8000-0000000000c2' });
  });

  it('obce albo stare dane — zwykłe otwarcie aplikacji', () => {
    for (const p of [undefined, null, 42, '', 'task/', 'task/a/b', 'event/ev/14.10', 'settings', 'https://x/task/1', 'task/a b']) expect(parseTarget(p)).toBeNull();
  });
});
