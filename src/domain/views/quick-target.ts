/**
 * Dokąd trafia wpis z pola szybkiego dodawania w Moich sprawach (decyzja właściciela 8.10.2026, PW-3 / audyt 2 M-24):
 *  - chip przy polu pokazuje grupę i zaczyna od ustawienia „Grupa domyślna” (`startGroup`, default-group.ts): konkretna
 *    grupa albo „Ostatnio użyta” — ta wybrana ostatnio chipem albo przez „#Grupa”; bez niej osobista;
 *  - „#nazwa” wybiera grupę: początek nazwy bez wielkości liter, polskich znaków i spacji („#klasa2b” → „Klasa 2b”),
 *    osobista jako „#Osobiste”; dokładna nazwa wygrywa z początkiem innej; kilka pasujących — telefon pyta, żadna —
 *    pyta, czy dodać do grupy z chipa („#…” zostaje wtedy w nazwie);
 *  - „@ja” — ja jako osoba we wspólnej grupie (w osobistej bez osoby, i tak wszystko jest moje); pierwszeństwo przed
 *    imionami na „Ja…” („@jan” nadal znajdzie Jana);
 *  - „@imię” jak w D91, ale osoba z grupy wpisu (z „#” albo z chipa) ma pierwszeństwo przed resztą grup; po „#” — tylko
 *    z tej grupy.
 * Użyte „#…” i „@…” znikają z nazwy (zastąpione spacjami tej samej długości, żeby odklikane fragmenty zachowały pozycje).
 */
import { groupsView } from './index';
import { extractMention, foldName, type Mention, type MentionTarget, mentionTargets } from './mention';
import type { Tables } from './model';
import { memberCanSeeList } from './visibility';

/** „@ja” po złożeniu liter. */
const SELF = 'ja';

export type QuickAnswers = {
  /** Odpowiedź na „Którą grupę masz na myśli?”. */
  group?: string;
  /** Odpowiedź na „Kogo masz na myśli?”. */
  person?: MentionTarget;
  /** „#…” bez pasującej grupy — dodać do grupy z chipa, „#…” zostaje w nazwie. */
  skipTag?: boolean;
  /** „@…” bez pasującej osoby — dodać bez osoby, „@…” zostaje w nazwie. */
  skipMention?: boolean;
};

export type QuickTarget = {
  groupId: string;
  memberId: string | null;
  /** Tekst z użytymi „#…” i „@…” zastąpionymi spacjami. */
  body: string;
  /** Skąd grupa: chip, „#nazwa” albo osoba z „@imię” z innej grupy. */
  from: 'chip' | 'tag' | 'mention';
};

export type GroupChoice = { id: string; name: string };

export type QuickResolution =
  | { kind: 'ok'; target: QuickTarget }
  | { kind: 'manyGroups'; name: string; groups: GroupChoice[] }
  | { kind: 'unknownGroup'; name: string; chip: GroupChoice }
  | { kind: 'many'; name: string; targets: MentionTarget[] }
  | { kind: 'unknown'; name: string }
  | { kind: 'noGroup' };

const TAG = /(^|\s)#([\p{L}\p{N}_-]+)/u;

/** Pierwsze „#słowo” w tekście. */
export function extractTag(text: string): Mention | null {
  const m = TAG.exec(text);
  if (!m) return null;
  const start = m.index + m[1]!.length;
  return { start, end: start + 1 + m[2]!.length, name: m[2]! };
}

const blank = (text: string, m: Mention) => `${text.slice(0, m.start)}${' '.repeat(m.end - m.start)}${text.slice(m.end)}`;

/** Tekst bez pierwszego „#…” i „@…” — do sprawdzenia, czy zostaje jakaś nazwa (audyt 2, M-168). */
export function withoutShortcuts(text: string): string {
  const tag = extractTag(text);
  const noTag = tag ? blank(text, tag) : text;
  const mention = extractMention(noTag).mention;
  return mention ? blank(noTag, mention) : noTag;
}

/** Grupy pasujące do „#nazwa” (spośród `groups` z nazwami, jakie widzi osoba). */
export function tagTargets(groups: readonly GroupChoice[], name: string): GroupChoice[] {
  const q = foldName(name);
  const key = (g: GroupChoice) => foldName(g.name).replace(/\s/g, '');
  const starts = groups.filter((g) => key(g).startsWith(q));
  const exact = starts.filter((g) => key(g) === q);
  return exact.length === 1 ? exact : starts;
}

/**
 * Grupy, do których mogę dodawać (nie jako dziecko, D34 — jak formGroups), osobista pierwsza, z nazwą jak na ekranie
 * (`personalLabel`; bez niej nazwa z bazy).
 */
export function quickGroups(t: Tables, userId: string, personalLabel?: string): (GroupChoice & { shared: boolean; meId: string })[] {
  return groupsView(t, userId)
    .filter((g) => g.me.role !== 'child')
    .map((g) => ({ id: g.id, name: g.kind === 'personal' ? (personalLabel ?? g.name) : g.name, shared: g.kind === 'shared', meId: g.me.member_id }));
}

export function resolveQuick(t: Tables, userId: string, text: string, o: { chipGroupId: string | null; personalLabel?: string; answers?: QuickAnswers }): QuickResolution {
  const a = o.answers ?? {};
  const groups = quickGroups(t, userId, o.personalLabel);
  const chip = groups.find((g) => g.id === o.chipGroupId) ?? groups[0];
  if (!chip) return { kind: 'noGroup' };
  let group = chip;
  let from: QuickTarget['from'] = 'chip';
  let body = text;

  const tag = a.skipTag ? null : extractTag(text);
  if (tag) {
    const found = a.group ? groups.filter((g) => g.id === a.group) : tagTargets(groups, tag.name);
    if (found.length === 0) return { kind: 'unknownGroup', name: tag.name, chip: { id: chip.id, name: chip.name } };
    if (found.length > 1) return { kind: 'manyGroups', name: tag.name, groups: found.map(({ id, name }) => ({ id, name })) };
    group = groups.find((g) => g.id === found[0]!.id)!;
    from = 'tag';
    body = blank(body, tag);
  }

  const mention = a.skipMention ? null : extractMention(text).mention;
  let memberId: string | null = null;
  if (mention) {
    if (foldName(mention.name) === SELF) memberId = group.shared ? group.meId : null;
    else {
      const all = a.person ? [a.person] : mentionTargets(t, userId, mention.name);
      const inGroup = all.filter((x) => x.groupId === group.id);
      // Po „#” tylko osoby z tej grupy; inaczej osoba z grupy chipa ma pierwszeństwo, a bez niej — wszystkie grupy (D91).
      const scoped = from === 'tag' || inGroup.length ? inGroup : all;
      if (scoped.length === 0) return { kind: 'unknown', name: mention.name };
      if (scoped.length > 1) return { kind: 'many', name: mention.name, targets: scoped };
      const person = scoped[0]!;
      if (person.groupId !== group.id) {
        group = groups.find((g) => g.id === person.groupId)!;
        from = 'mention';
      }
      memberId = person.memberId;
    }
    body = blank(body, mention);
  }
  return { kind: 'ok', target: { groupId: group.id, memberId, body, from } };
}

/**
 * D68 po zmianie właściciela z 8.10.2026 (PW-18 b): we wspólnej grupie zadanie bez osoby i terminu zapisuje się bez
 * pytania, ale nikt go nie zobaczy w Moich sprawach — pole dodawania mówi to przed dodaniem. (Szybkie dodanie trafia na
 * ogólną listę grupy, nigdy na listę „Tylko ja”, więc wyjątek A tu nie zachodzi.)
 */
export function unseenInMyDays(t: Tables, userId: string, target: Pick<QuickTarget, 'groupId' | 'memberId'>, dated: boolean): boolean {
  return !dated && target.memberId === null && groupsView(t, userId).find((g) => g.id === target.groupId)?.kind === 'shared';
}

export type ListResolution = { kind: 'ok'; memberId: string | null; body: string } | { kind: 'many'; name: string; targets: MentionTarget[] } | { kind: 'unknown'; name: string };

/**
 * Pole dodawania na liście zadań (spójnie z Moimi sprawami, audyt 2): „@imię” przypisuje osobę z grupy listy, która widzi
 * tę listę (lista „Tylko ja” albo wybrane osoby — tylko one), „@ja” — mnie (we wspólnej grupie); kilka pasujących osób —
 * pytanie, żadna — pytanie, czy dodać bez osoby („@…” zostaje wtedy w nazwie). Grupę wyznacza lista, więc „#…” nic nie
 * zmienia i zostaje w nazwie (ekran listy mówi to pod polem).
 */
export function resolveListQuick(t: Tables, userId: string, listId: string, text: string, answers: Pick<QuickAnswers, 'person' | 'skipMention'> = {}): ListResolution {
  const list = t.lists?.[listId];
  const group = quickGroups(t, userId).find((g) => g.id === list?.group_id);
  const mention = answers.skipMention || !group ? null : extractMention(text).mention;
  if (!mention) return { kind: 'ok', memberId: null, body: text };
  const body = blank(text, mention);
  if (foldName(mention.name) === SELF) return { kind: 'ok', memberId: group!.shared ? group!.meId : null, body };
  const found = answers.person ? [answers.person] : mentionTargets(t, userId, mention.name).filter((x) => x.groupId === group!.id && memberCanSeeList(t, x.memberId, listId));
  if (found.length === 0) return { kind: 'unknown', name: mention.name };
  if (found.length > 1) return { kind: 'many', name: mention.name, targets: found };
  return { kind: 'ok', memberId: found[0]!.memberId, body };
}
