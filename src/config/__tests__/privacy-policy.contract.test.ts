/**
 * Polityka prywatności (audyt 3, N-75, N-76, N-77, N-229) zgodna z aplikacją:
 *  - strona site/privacy/index.html wygenerowana z docs/privacy-policy.md (jedno źródło; scripts/site/privacy-html.cjs),
 *    pod adresem config.privacy.POLICY_URL;
 *  - administrator i kontakt z config.privacy (RODO art. 13 ust. 1 lit. a: „swoją tożsamość i dane kontaktowe”);
 *  - okresy i limity z src/config (ta sama liczba w polityce, aplikacji i SQL);
 *  - każda tabela z migracji opisana w polityce (słownik tabela → fraza) albo wymieniona jako bez danych osób;
 *  - konwencje tekstów z docs/glossary.md (płeć, „administrator”, „podpięte”, apostrof, ścieżki Ustawień).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { plural } from '../../domain/plural';
import { strings } from '../../i18n/strings.pl';
import { config } from '../index';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- skrypt strony jest modułem CommonJS (uruchamiany przez node)
const site = require('../../../scripts/site/privacy-html.cjs') as { build(): string; render(md: string): string };

const root = join(__dirname, '../../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const md = read('docs/privacy-policy.md');
/** Tekst polityki bez notatki dla zespołu, z jedną spacją zamiast łamania wierszy. */
const text = md.replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ');

describe('strona polityki prywatności (N-75)', () => {
  it('site/privacy/index.html = wygenerowana z docs/privacy-policy.md (node scripts/site/privacy-html.cjs --write)', () => {
    expect(read('site/privacy/index.html')).toBe(site.build());
  });
  it('adres w aplikacji wskazuje tę stronę; strona bez skryptów i bez notatek dla zespołu', () => {
    // GitHub Pages repozytorium organizer (.github/workflows/pages.yml) publikuje katalog site/ pod /organizer/.
    expect(new URL(config.privacy.POLICY_URL).pathname).toBe('/organizer/privacy/');
    const html = read('site/privacy/index.html');
    expect(html).not.toMatch(/<script/);
    expect(html).not.toContain('Notatka dla zespołu');
    expect(html).toContain('<h1>Organizer: polityka prywatności</h1>');
  });
  it('renderer: lista zagnieżdżona, pogrubienie, link bez kropki na końcu, znaki HTML', () => {
    const html = site.render('# T\n\n- a **b**\n  ciąg\n  - c https://example.com/x.\n- d < e\n\nakapit\n');
    expect(html).toContain('<ul><li>a <strong>b</strong> ciąg<ul><li>c <a href="https://example.com/x">https://example.com/x</a>.</li></ul>\n</li><li>d &lt; e</li></ul>');
    expect(html).toContain('<p>akapit</p>');
    expect(() => site.render('- a\n    - za głęboko\n')).toThrow('zbyt głęboka lista');
  });
});

describe('administrator danych i kontakt (N-76)', () => {
  it('polityka podaje administratora z config.privacy.CONTROLLER', () => {
    expect(text).toContain(`Administratorem Twoich danych osobowych jest ${config.privacy.CONTROLLER}`);
  });
  /**
   * Kontakt (decyzja właściciela 9.10.2026): build 23 wychodzi bez adresu e-mail (świadomy wyjątek) — CONTACT_EMAIL = null
   * i polityka podaje zdanie przejściowe (kontakt przez „Wyślij uwagę”). Przed App Store adres musi się pojawić; wtedy
   * zdanie przejściowe znika, a polityka podaje dokładnie ten adres. Dwa stany naraz (zdanie przejściowe i adres albo
   * żadne z nich) oblewają test.
   */
  const interim = `do czasu publikacji aplikacji w App Store napisz przez „${strings['feedback.open']}”`;
  const contactProblems = (policy: string, email: string | null): string[] => {
    const addresses: string[] = policy.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? [];
    const problems: string[] = [];
    if (email === null) {
      if (!policy.includes(interim)) problems.push('brak zdania przejściowego');
      if (addresses.length) problems.push(`adres w polityce bez CONTACT_EMAIL: ${addresses.join(', ')}`);
    } else {
      if (policy.includes(interim)) problems.push('zdanie przejściowe obok adresu');
      if (!addresses.includes(email)) problems.push('polityka nie podaje CONTACT_EMAIL');
    }
    return problems;
  };
  it('kontakt: CONTACT_EMAIL = null → zdanie przejściowe z nazwą przycisku z aplikacji i żadnego adresu; potem ten adres', () => {
    expect(contactProblems(text, config.privacy.CONTACT_EMAIL)).toEqual([]);
  });
  it('kontrola testu kontaktu: niespójne stany oblewają', () => {
    const email = 'kontakt@example.com';
    expect(contactProblems(`${interim}.`, null)).toEqual([]);
    expect(contactProblems(`${interim}, ${email}.`, null)).toEqual([`adres w polityce bez CONTACT_EMAIL: ${email}`]);
    expect(contactProblems('Napisz do nas.', null)).toEqual(['brak zdania przejściowego']);
    expect(contactProblems(`Napisz na ${email}.`, email)).toEqual([]);
    expect(contactProblems(`${interim}. Napisz na ${email}.`, email)).toEqual(['zdanie przejściowe obok adresu']);
    expect(contactProblems('Napisz do nas.', email)).toEqual(['polityka nie podaje CONTACT_EMAIL']);
  });
  it('adres kontaktowy nie jest prywatną skrzynką (ta sama reguła co gitleaks personal-email)', () => {
    const rule = /id = "personal-email"[\s\S]*?regex = '''(.+?)'''/.exec(read('.gitleaks.toml'))![1]!;
    const personal = new RegExp(rule.replace(/^\\b/, ''));
    // Kontrola testu: pierwsza domena z reguły (bez wpisywania nazwy dostawcy poczty w tym pliku — ADR 0043).
    const domain = /@\(\?:([a-z]+)\|/.exec(rule)![1]!;
    expect(personal.test(`ala@${domain}.com`)).toBe(true);
    expect(config.privacy.CONTACT_EMAIL === null || !personal.test(config.privacy.CONTACT_EMAIL)).toBe(true);
  });
  it('RODO art. 13: podstawy prawne, odbiorcy, przekazanie poza EOG, prawa, skarga do organu nadzorczego', () => {
    for (const phrase of [
      'art. 6 ust. 1 lit. b',
      'art. 6 ust. 1 lit. f',
      '## Komu przekazujemy dane',
      'Przekazanie poza Europejski Obszar Gospodarczy',
      'standardowe klauzule umowne',
      'prawo dostępu do swoich danych, ich sprostowania, usunięcia, ograniczenia przetwarzania i przeniesienia',
      'prawo sprzeciwu',
      'skargę do Prezesa Urzędu Ochrony Danych Osobowych',
      'Podanie danych jest dobrowolne',
      'zautomatyzowanych decyzji',
    ])
      expect(md.replace(/\s+/g, ' ')).toContain(phrase);
  });
});

describe('liczby w polityce z src/config (N-77)', () => {
  const r = config.retention;
  const days = (n: number) => `${n} ${plural(n, { one: 'dzień', few: 'dni', many: 'dni' })}`;
  const hours = (n: number) => `${n} ${plural(n, { one: 'godzinę', few: 'godziny', many: 'godzin' })}`;
  it.each([
    `w koszu ${days(config.sync.TOMBSTONE_DAYS)}`,
    `**Historia zmian:** ${days(r.ACTIVITY_DAYS)}`,
    `**Zrobione zakupy:** ${days(r.TRIP_DAYS)}`,
    `anulowane): ${days(r.HANDOFF_DAYS)} od decyzji`,
    `**Zaproszenia:** ${days(r.INVITE_DAYS)} po wygaśnięciu`,
    `uwagi:** ${days(config.feedback.RETENTION_DAYS)}`,
    `kodem:** ${days(r.JOIN_ATTEMPT_DAYS)} (sprzątanie raz na dobę, więc do ${days(r.JOIN_ATTEMPT_DAYS + r.PURGE_LAG_DAYS)})`,
    `dostępu do grup i list:** ${days(r.ACCESS_EVENT_DAYS)}`,
    `${days(r.SYNC_CLIENT_DAYS)} od ostatniego użycia`,
    `**Dziennik wysyłki powiadomień:** ${days(r.PUSH_LOG_DAYS)}`,
    `najwyżej ${config.feedback.ERRORS_PER_DAY} zgłoszeń na dobę`,
    `Najwyżej ${config.feedback.PER_DAY} dziennie`,
    `od ${days(config.calendar.READ_DAYS_BACK)} wstecz do ${days(config.calendar.READ_DAYS_AHEAD)} naprzód`,
    `od ${days(config.calendar.MIRROR_DAYS_BACK)} wstecz do ${days(config.calendar.MIRROR_DAYS_AHEAD)} naprzód`,
    `do ${config.travel.AHEAD_HOURS} godzin naprzód`,
    `najwyżej ${config.travel.GEO_MAX} adresów`,
    `kod ważny ${hours(config.invites.CODE_TTL_HOURS)}`,
  ])('%s', (phrase) => expect(text).toContain(phrase));
});

describe('każda tabela z danymi opisana w polityce (N-77)', () => {
  /** Tabela → fraza z polityki, która ją opisuje. */
  const DESCRIBED: Record<string, string> = {
    'public.activity': 'historia zmian pokazuje, kto i co zmienił',
    'public.app_feedback': '(„Wyślij uwagę”)',
    'public.client_errors': '### Raporty błędów i samosprawdzenie',
    'public.event_overrides': 'zmianami pojedynczych terminów',
    'public.event_participants': 'z osobami, których dotyczą',
    'public.event_rsvps': '**odpowiedzi o obecności**',
    'public.event_task_series': 'stałe zadania przy wydarzeniach',
    'public.events': 'wydarzenia (z miejscem',
    'public.group_members': 'osoby w grupach',
    'public.groups': 'Grupy, osoby w grupach',
    'public.handoffs': 'przekazanie widzą tylko dwie osoby',
    'public.invites': 'Na serwerze zapisujemy kod',
    'public.lists': 'listę „Cała grupa” widzą wszyscy',
    'public.my_day_scopes': '**Ustawienie „W Moich sprawach”**',
    'public.object_members': 'listę udostępnioną wybranym osobom',
    'public.profiles': 'w profilu konta na serwerze',
    'public.push_mutes': '**Wyciszenie grupy:**',
    'public.push_tokens': '**Token powiadomień**',
    'public.shopping_trips': '**Zrobione zakupy:** gdy ktoś oznaczy zakupy',
    'public.tasks': 'zadania (także stałe zadania',
    'private.account_deletion_options': 'zaznaczysz **„Usuń też moje wpisy w grupach”**',
    'private.access_events': 'Zapis, kiedy Twoje konto dostało albo straciło dostęp',
    'private.join_attempts': 'zapisujemy każdą nieudaną próbę',
    'private.push_log': '**Dziennik wysyłki:**',
    'private.rate_counters': '**Liczniki limitów:**',
    'private.sync_clients': 'Losowy identyfikator kopii danych',
    'private.sync_rejections': 'kody odrzuconych zmian',
    'private.wake_state': 'Przy tokenie zapisujemy tylko, kiedy poszło ostatnie takie powiadomienie',
  };
  /** Tabele bez danych o osobach — z powodem. */
  const NOT_PERSONAL: Record<string, string> = {
    'private.group_usage': 'liczba wierszy i bajtów grupy (limit rozmiaru), bez danych o osobach',
    'private.maintenance_runs': 'czas i wynik nocnego sprzątania',
    'private.sync_entities': 'opis tabel synchronizacji (stała konfiguracja)',
    'private.task_moves': 'pary identyfikatorów zadania przeniesionego do innej grupy (kopia → źródło), bez danych o osobach',
  };
  const sql = readdirSync(join(root, 'supabase/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .map((f) => read(`supabase/migrations/${f}`))
    .join('\n');
  const created = new Set([...sql.matchAll(/create table (?:if not exists )?((?:public|private)\.[a-z_]+)/gi)].map((m) => m[1]!.toLowerCase()));
  for (const m of sql.matchAll(/drop table (?:if exists )?((?:public|private)\.[a-z_]+)/gi)) created.delete(m[1]!.toLowerCase());
  it('słownik obejmuje dokładnie tabele z migracji', () => {
    expect([...created].sort()).toEqual([...Object.keys(DESCRIBED), ...Object.keys(NOT_PERSONAL)].sort());
  });
  it.each(Object.entries(DESCRIBED))('%s', (_t, phrase) => expect(text).toContain(phrase));
});

describe('konwencje tekstów w polityce (docs/glossary.md, N-77)', () => {
  it('bez form zakładających płeć (Poradnia PWN: forma neutralna płciowo)', () => {
    const gendered = /\p{L}+(?:łeś|łaś|łbyś|łabyś)(?!\p{L})|\(a\)|(?<!\p{L})(?:zalogowany|zalogowana|pewien|pewna|gotowy|gotowa)(?!\p{L})|(?<!\p{L})sama?(?=[ .,!?]|$)(?! telefon)/iu;
    expect(text.split(/(?<=[.;:])\s/).filter((s) => gendered.test(s))).toEqual([]);
  });
  it('słownik: „administrator”, nie „admin”; zadania „podpięte”, nie „przypięte”', () => {
    expect(text.match(/(?<!\p{L})admin(?!\p{L})/giu)).toBeNull();
    expect(text.match(/przypięt/giu)).toBeNull();
  });
  it('typografia: apostrof ’, półpauza tylko w nazwie kalendarza „Organizer – …”', () => {
    expect(text).not.toContain("'");
    expect(text.replace(/Organizer – /g, '').match(/ – /g)).toBeNull();
  });
  it('ścieżki „Ustawienia → …” prowadzą do istniejących ekranów i etykiet', () => {
    const values = new Set<string>(Object.values(strings as Record<string, unknown>).filter((v): v is string => typeof v === 'string'));
    const found = [...text.replace(/\*\*/g, '').matchAll(/(?<![\p{L}’])(Ustawienia|Ustawieniach|Grupy)((?: → (?:„[^”]+”|[^→.,;()„]+?))+)(?:(?<=”)|(?=[.,;:)]|$))/gu)];
    expect(found.length).toBeGreaterThan(4);
    for (const m of found) for (const seg of m[2]!.split(' → ').slice(1).map((x) => x.replace(/^„|”$/g, '').trim())) expect(values.has(seg) ? seg : `brak etykiety: ${seg}`).toBe(seg);
  });
});
