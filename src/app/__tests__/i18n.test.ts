import { getLanguage, setLanguage, strings, subscribeLanguage } from '../../i18n';

describe('i18n dynamic runtime switching', () => {
  afterEach(() => {
    setLanguage('pl');
  });

  it('domyślnie zwraca język polski', () => {
    setLanguage('pl');
    expect(getLanguage()).toBe('pl');
    expect(strings['app.loading']).toBe('Wczytywanie…');
    expect(strings['settings.language']).toBe('Język');
    expect(strings['sync.pending'](1)).toContain('zmiana czeka');
  });

  it('dynamicznie przełącza na język angielski i aktualizuje proxy', () => {
    setLanguage('en');
    expect(getLanguage()).toBe('en');
    expect(strings['app.loading']).toBe('Loading…');
    expect(strings['settings.language']).toBe('Language');
    expect(strings['sync.pending'](1)).toBe('1 change waiting');
    expect(strings['sync.pending'](5)).toBe('5 changes waiting');
    expect(strings['paywall.planYearly']).toBe('Yearly (Best Value)');
  });

  it('powiadamia subskrybentów o zmianie języka', () => {
    const received: string[] = [];
    const unsub = subscribeLanguage((lang) => received.push(lang));

    setLanguage('en');
    setLanguage('en'); // ponowne to samo nie woła listenera
    setLanguage('pl');

    unsub();
    setLanguage('en');

    expect(received).toEqual(['en', 'pl']);
  });
});
