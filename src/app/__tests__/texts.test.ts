/**
 * Teksty aplikacji (audyt 2, P17): słownictwo i konwencje zapisu z docs/glossary.md pilnowane testem, polskie opisy
 * reguł powtarzania (słowa w strings.pl.ts, kształt w domenie — M-158) i ścieżki w „Co nowego” (M-136).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { parseIsoDate } from '../../domain/format';
import { parseRule } from '../../domain/rrule';
import { describeRule } from '../../domain/views/events';
import { strings } from '../../i18n/strings.pl';
import { whatsNewEntries } from '../../i18n/whats-new.pl';

const src = join(__dirname, '../..');
const stringsSource = readFileSync(join(src, 'i18n/strings.pl.ts'), 'utf8');
/** Same teksty: bez komentarzy (komentarze cytują dawne brzmienia). */
const textLines = stringsSource.split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l));
const values = new Set<string>(Object.values(strings as Record<string, unknown>).filter((v): v is string => typeof v === 'string'));

describe('opis reguły po polsku', () => {
  const at = parseIsoDate('2026-10-05');
  const cases: [string, string][] = [
    ['FREQ=DAILY', 'Codziennie'],
    ['FREQ=DAILY;INTERVAL=3', 'Co 3 dni'],
    ['FREQ=WEEKLY', 'Co tydzień'],
    ['FREQ=WEEKLY;BYDAY=SA,MO,MO', 'Co tydzień: pon., sob.'],
    ['FREQ=WEEKLY;INTERVAL=2;BYDAY=TU', 'Co 2 tygodnie: wt.'],
    ['FREQ=WEEKLY;INTERVAL=5', 'Co 5 tygodni'],
    ['FREQ=MONTHLY', 'Co miesiąc, 5. dnia'],
    ['FREQ=MONTHLY;INTERVAL=2', 'Co 2 miesiące, 5. dnia'],
    ['FREQ=MONTHLY;INTERVAL=6', 'Co 6 miesięcy, 5. dnia'],
    ['FREQ=MONTHLY;BYMONTHDAY=15', 'Co miesiąc, 15. dnia'],
    ['FREQ=MONTHLY;BYMONTHDAY=-1', 'Co miesiąc, ostatniego dnia'],
    ['FREQ=MONTHLY;BYDAY=-1FR', 'Co miesiąc, w ostatni piątek'],
    ['FREQ=MONTHLY;BYDAY=-1SA', 'Co miesiąc, w ostatnią sobotę'],
    ['FREQ=MONTHLY;BYDAY=-1WE', 'Co miesiąc, w ostatnią środę'],
    ['FREQ=MONTHLY;BYDAY=-1SU', 'Co miesiąc, w ostatnią niedzielę'],
    ['FREQ=MONTHLY;BYDAY=2MO', 'Co miesiąc, w 2. poniedziałek'],
    ['FREQ=MONTHLY;BYDAY=MO,TH', 'Co miesiąc: pon., czw.'],
    ['FREQ=YEARLY', 'Co roku'],
    ['FREQ=YEARLY;INTERVAL=2', 'Co 2 lata'],
    ['FREQ=YEARLY;INTERVAL=5', 'Co 5 lat'],
    ['FREQ=WEEKLY;BYDAY=MO;UNTIL=20261231', 'Co tydzień: pon., do 31.12.2026'],
    ['FREQ=WEEKLY;UNTIL=20270105', 'Co tydzień, do 5.01.2027'],
    ['FREQ=DAILY;COUNT=1', 'Codziennie, 1 raz'],
    ['FREQ=DAILY;COUNT=3', 'Codziennie, 3 razy'],
    ['FREQ=DAILY;COUNT=12', 'Codziennie, 12 razy'],
  ];
  it.each(cases)('%s → %s', (r, text) => expect(describeRule(parseRule(r), at, strings['event.rule'])).toBe(text));
});

describe('ścieżki „A → B” w tekstach i w „Co nowego” prowadzą do istniejących ekranów (M-136)', () => {
  // Pierwszy człon to zakładka albo ekran (także w miejscowniku: „w Ustawieniach → …”); dalej etykiety z strings.pl.ts
  // albo nazwy własne użytkownika (grupa, dziecko). Ścieżki w Ustawieniach iPhone’a opisują system, nie aplikację.
  const roots: Record<string, string> = { Ustawienia: strings['settings.title'], Ustawieniach: strings['settings.title'], Grupy: strings['tabs.groups'], Kalendarz: strings['tabs.calendar'] };
  const placeholders = new Set(['grupa', 'dziecko', 'osoba']);
  const chain = /(?<![\p{L}’])(\p{Lu}[\p{L}’]*)((?: → (?:„[^”]+”|[^→.,;()„]+?))+)(?:(?<=”)|(?=[.,;)]|$))/gu;
  const texts = [
    ...whatsNewEntries.flatMap((e) => e.items.map((t) => ({ where: `whats-new ${e.fromBuild}`, t }))),
    ...textLines.map((t) => ({ where: 'strings.pl.ts', t })),
  ];
  const found = texts.flatMap(({ where, t }) =>
    [...t.matchAll(chain)].filter((m) => !t.slice(0, m.index).endsWith('→ ')).map((m) => ({ where, root: m[1]!, rest: m[2]!.split(' → ').slice(1).map((x) => x.replace(/^„|”$/g, '')) })),
  );
  it('są takie ścieżki (test coś sprawdza)', () => expect(found.length).toBeGreaterThan(8));
  it.each(found.map((f) => [f.where, [f.root, ...f.rest].join(' → '), f] as const))('%s: %s', (_w, _p, f) => {
    expect(roots[f.root]).toBeDefined();
    for (const seg of f.rest) expect(values.has(seg) || placeholders.has(seg) ? seg : `brak etykiety: ${seg}`).toBe(seg);
  });
});

describe('konwencje zapisu (docs/glossary.md)', () => {
  it('aplikacja nie zakłada płci użytkownika (Poradnia PWN: forma neutralna płciowo)', () => {
    const gendered = /\p{L}+(?:łeś|łaś|łbyś|łabyś)(?!\p{L})|\(a\)|(?<!\p{L})(?:zalogowany|zalogowana|spóźniony|spóźniona|pewien|pewna|gotowy|gotowa)(?!\p{L})|(?<!\p{L})sama?(?=[.,!?]|$)/iu;
    expect(textLines.filter((l) => gendered.test(l))).toEqual([]);
  });
  it('nazwy ekranów bez cudzysłowu, chyba że po określeniu rodzajowym (PWN [446] c)', () => {
    const quoted = /(?<!(?:ekran|zakładka|zakładce|ekranie|ekranu) )„(?:Moje sprawy|Moich spraw|Moich sprawach|Kalendarz|Kalendarzu|Ustawienia|Ustawieniach|Grupy|Listy)”/iu;
    const all = [...textLines, ...whatsNewEntries.flatMap((e) => e.items)];
    expect(all.filter((l) => quoted.test(l))).toEqual([]);
  });
  it('typografia: apostrof ’, myślnik — ze spacjami, półpauza tylko w zakresach (PWN [397], [408])', () => {
    const all = [...textLines.map((l) => l.replace(/^[^:]*'[^']*':\s*/, '')), ...whatsNewEntries.flatMap((e) => e.items)];
    // „Organizer – nazwa grupy” to nazwa kalendarza w iPhonie (identyfikator lustra, D172) — cytujemy ją dosłownie.
    expect(all.filter((l) => / – /.test(l.replace(/Organizer – /g, '')))).toEqual([]);
    expect(whatsNewEntries.flatMap((e) => e.items).filter((l) => l.includes("'"))).toEqual([]);
  });
});

describe('każdy klucz strings.pl.ts jest używany w kodzie aplikacji (U-60)', () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) {
        if (f !== '__tests__') walk(p);
      } else if (/\.tsx?$/.test(f) && !p.endsWith('strings.pl.ts')) files.push(p);
    }
  };
  walk(src);
  const code = files.map((f) => readFileSync(f, 'utf8')).join('\n') + stringsSource.replace(/^\s*'[^']+':/gm, '');
  // Klucze składane w locie: strings[`event.scope.${s}`] — wystarczy przedrostek przed „${”.
  const prefixes = [...code.matchAll(/`([a-zA-Z.]+\.)\$\{/g)].map((m) => m[1]!);
  // Teksty serwera (private.deleted_user_label, private.push_texts) — używa ich test kontraktowy z SQL.
  const intentional = (key: string) => key === 'member.deleted' || key.startsWith('push.text.');
  it.each(Object.keys(strings))('%s', (key) => {
    const used = intentional(key) || code.includes(`'${key}'`) || prefixes.some((p) => key.startsWith(p));
    expect(used ? key : `nieużywany: ${key}`).toBe(key);
  });
});

describe('drobne teksty (M-262)', () => {
  it('„Zakupy: ” pomijane, gdy nazwa listy już zaczyna się od „Zakupy” (P-75)', () => {
    expect(strings['trip.title']('Zakupy')).toBe('Zakupy');
    expect(strings['trip.title']('zakupy na weekend')).toBe('zakupy na weekend');
    expect(strings['trip.title']('Dom')).toBe('Zakupy: Dom');
    expect(strings['trip.title']('Zakupowe szaleństwo')).toBe('Zakupy: Zakupowe szaleństwo');
  });
  it('licznik z rzędu bez słowa „seria” (U-29)', () => {
    expect([2, 5, 22].map((n) => strings['streak'](n))).toEqual(['2 razy z rzędu', '5 razy z rzędu', '22 razy z rzędu']);
  });
});

describe('jeden klucz na jedno pojęcie (U-60)', () => {
  // Ten sam tekst pod kilkoma kluczami tylko tam, gdzie znaczenie jest inne (albo klucz wybiera się w locie z zestawu).
  const allowed: Record<string, string> = {
    'tabs.today, common.today': 'nazwa zakładki (może się zmienić, PW-27) i dzień „dziś”',
    'tabs.lists, trash.kind.list': 'zakładka i rodzaj rzeczy w koszu',
    'tabs.groups, trash.kind.group': 'zakładka i rodzaj rzeczy w koszu',
    'today.range.day, event.date': 'zakres widoku i pole formularza',
    'quick.groupPick, device.addToGroup': 'nagłówek wyboru grupy i przycisk przy wydarzeniu z iPhone’a',
    'rsvp.maybe, rsvp.other.maybe': 'zestawy odpowiedzi za siebie i za dziecko (`rsvp.${a}`, `rsvp.other.${a}`)',
    'due.when, timetable.week': 'termin zadania i wybór tygodnia A/B',
    'timetable.both, event.repeat.weekly, repeat.weekly': 'opcja planu lekcji i zestawy opcji powtarzania (`event.repeat.${r}`, `repeat.${k}`)',
    'lists.kind.tasks, event.defaultList, trash.kind.task': 'rodzaj listy, nazwa nadawana liście (names.pl.ts) i rodzaj w koszu',
    'lists.kind.shopping, trip.section': 'rodzaj listy i sekcja planu zakupów',
    'lists.visibility.group, event.audience.group': 'kto widzi listę i kogo dotyczy wydarzenie',
    'lists.done, common.done': 'nagłówek sekcji i przycisk potwierdzenia',
    'event.repeat.daily, repeat.daily': 'zestawy opcji powtarzania wydarzeń i zadań',
    'event.repeat.monthly, repeat.monthly': 'zestawy opcji powtarzania wydarzeń i zadań',
    'draft.discard, handoff.decline': 'odrzucenie szkicu i odrzucenie przekazania',
    'reminders.lead.0, common.off': 'opcja z zestawu `reminders.lead.${m}` i stan przełącznika',
  };
  it('powtórzone teksty są tylko na liście wyjątków', () => {
    const byValue = new Map<string, string[]>();
    for (const [k, v] of Object.entries(strings as Record<string, unknown>)) if (typeof v === 'string') byValue.set(v, [...(byValue.get(v) ?? []), k]);
    const dups = [...byValue.values()].filter((ks) => ks.length > 1).map((ks) => ks.join(', '));
    expect(dups.filter((d) => !(d in allowed))).toEqual([]);
  });
});
