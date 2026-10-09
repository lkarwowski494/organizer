/**
 * Dostępność i oba tryby kolorów na każdym ekranie: każdy element dotykowy ma etykietę i cel dotyku
 * ≥ 44 pt (Apple HIG), każdy tekst ma kolor z palety bieżącego trybu.
 */
import { getStateFromPath, NavigationContainer } from '@react-navigation/native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { groupLines, palettes, type Scheme } from '../../config/theme';
import { inviteUrl, joinUrl } from '../../domain/invite-link';
import { SignInScreen } from '../../features/auth/SignInScreen';
import { linking, RootStack } from '../navigation';
import { fakeAccount, ME, put, sampleBase, setup } from './harness';

/** Dane przykładowe + seria wydarzeń (środy 17:00, Kuba), żeby audyt objął ekrany wydarzeń. */
function baseWithEvent() {
  const t = sampleBase();
  put(t, 'events', 'ev', { id: 'ev', group_id: 'gf', title: 'Tańce', note: null, start_date: '2026-10-07', start_time: '17:00:00', end_time: '18:00:00', rrule: 'FREQ=WEEKLY;BYDAY=WE', audience: 'members', location: 'Szkoła tańca, ul. Długa 5', deleted_at: null, version: 1 });
  put(t, 'event_participants', 'p', { id: 'p', event_id: 'ev', group_id: 'gf', member_id: 'kuba', deleted_at: null, version: 1 });
  // Przekazania (D70): jedno do mnie, jedno moje odrzucone — „Do potwierdzenia” i plakietka na zakładce.
  const h = { group_id: 'gf', entity: 'tasks', occurrence_date: null, closed: false, decided_at: null, version: 1, created_at: '2026-10-07T07:00:00Z', deleted_at: null };
  put(t, 'handoffs', 'h1', { ...h, id: 'h1', entity_id: 't-ala', from_member: 'ala', to_member: 'mf', status: 'pending' });
  put(t, 'handoffs', 'h2', { ...h, id: 'h2', entity_id: 't-kwiaty', from_member: 'mf', to_member: 'ala', status: 'declined' });
  return t;
}

const INTERACTIVE = new Set(['button', 'checkbox', 'tab', 'radio']);

type Node = { props: Record<string, unknown>; children: unknown[]; type: unknown };

/** `inText` — węzeł leży wewnątrz innego tekstu (dziedziczy krój, rozmiar i kolor). */
function walk(n: Node | string, out: { n: Node; inText: boolean; selected: boolean }[], inText = false, selected = false) {
  if (typeof n === 'string' || !n) return;
  const state = n.props.accessibilityState as { selected?: boolean; checked?: boolean } | undefined;
  const sel = selected || (typeof n.type === 'string' && (state?.selected === true || state?.checked === true) && n.props.accessibilityRole !== 'tab');
  out.push({ n, inText, selected: sel });
  for (const c of n.children ?? []) walk(c as Node, out, inText || n.type === 'Text', sel);
}

function audit(root: unknown, scheme: Scheme, where: string) {
  const all: { n: Node; inText: boolean; selected: boolean }[] = [];
  walk(root as unknown as Node, all);
  const allowed = new Set([...Object.values(palettes[scheme]), ...groupLines.map((g) => g[scheme].ink)]);
  const problems: string[] = [];
  for (const { n, inText, selected } of all) {
    if (typeof n.type !== 'string') continue;
    const role = n.props.accessibilityRole as string | undefined;
    const style = StyleSheet.flatten(n.props.style as never) as Record<string, unknown> | undefined;
    if (role && INTERACTIVE.has(role)) {
      if (!n.props.accessibilityLabel) problems.push(`${where}: ${role} bez etykiety`);
      const h = Number(style?.minHeight ?? style?.height ?? 0);
      const w = style?.width;
      if (h < 44) problems.push(`${where}: ${role} „${String(n.props.accessibilityLabel)}” ma ${h} pt wysokości`);
      if (typeof w === 'number' && w < 44) problems.push(`${where}: ${role} „${String(n.props.accessibilityLabel)}” ma ${w} pt szerokości`);
    }
    // Tekst tylko w kolorach z palety bieżącego trybu albo z palety linii grup (obie sprawdza test motywu).
    if (n.type === 'Text' && style?.color && !allowed.has(String(style.color))) problems.push(`${where}: tekst w kolorze spoza palety ${String(style.color)}`);
    // Audyt 2 (M-42, M-152): tekst niezagnieżdżony w innym ma kolor i rozmiar z motywu — bez nich iOS rysuje czarny
    // systemowy 14 pt (w ciemnym trybie niewidoczny).
    if (n.type === 'Text' && !inText && (!style?.color || !style?.fontSize)) problems.push(`${where}: tekst bez ${style?.color ? 'rozmiaru' : 'koloru'} „${String(n.children?.[0] ?? '')}”`);
    // M-151 (PW-52 A, D198): zaznaczenie nigdy w kolorze przycisku głównego.
    if (selected && style?.backgroundColor === palettes[scheme].inverseBg) problems.push(`${where}: zaznaczenie w kolorze przycisku głównego`);
    // M-308: przełącznik ma nazwę dla VoiceOvera.
    if (role === 'switch' && !n.props.accessibilityLabel) problems.push(`${where}: przełącznik bez etykiety`);
  }
  return problems;
}

const SCREENS: [string, (press: (l: string | RegExp) => Promise<void>) => Promise<void>][] = [
  ['Moje sprawy', async () => {}],
  ['Listy', async (p) => p('Listy')],
  ['Lista zakupów', async (p) => (await p('Listy'), await p('Zakupy na weekend, Rodzina · Zakupy · 1 do kupienia'))],
  ['Lista zadań', async (p) => (await p('Listy'), await p('Dom, Rodzina · Zadania · 3 otwarte'))],
  ['Lista zadań: dla kogo albo na kiedy', async (p) => {
    await p('Listy');
    await p('Dom, Rodzina · Zadania · 3 otwarte');
    fireEvent.changeText(await screen.findByTestId('quick-add'), 'rosół');
    await p('Dodaj');
  }],
  ['Zadanie', async (p) => p(/^Odebrać paczkę(,|$)/)],
  ['Zadanie: przekazanie', async (p) => (await p(/^Odebrać paczkę(,|$)/), await p('Przekaż zadanie'))],
  ['Moje sprawy: tydzień', async (p) => p('Tydzień')],
  ['Pełny formularz zadania', async (p) => p('Więcej')],
  ['Pełny formularz: zadanie we wspólnej grupie z powtarzaniem', async (p) => (await p('Więcej'), await p('Rodzina'), await p('Jutro'), await p('Co tydzień'))],
  ['Pasek „Dodano · Zmień”', async (p) => {
    fireEvent.changeText(await screen.findByTestId('quick-add'), 'basen jutro 19.00');
    await p('Dodaj');
  }],
  ['Moje sprawy: wczoraj', async (p) => p('Poprzedni dzień')],
  ['Pasek „Cofnij”', async (p) => p('Usuń: Odebrać paczkę')],
  ['Nowa lista', async (p) => (await p('Listy'), await p('Nowa lista'))],
  ['Nowa lista zakupów', async (p) => (await p('Listy'), await p('Nowa lista'), await p('Zakupy'), await p('Rodzina'))],
  ['Lista zakupów: planowanie zakupów', async (p) => (await p('Listy'), await p('Zakupy na weekend, Rodzina · Zakupy · 1 do kupienia'), await p('Zaplanuj zakupy'))],
  ['Kalendarz', async (p) => p('Kalendarz')],
  ['Wydarzenie', async (p) => p('Tańce, 17:00–18:00, 1 godzina, Rodzina')],
  ['Wydarzenie: wybór zakresu', async (p) => (await p('Tańce, 17:00–18:00, 1 godzina, Rodzina'), await p('Zmień'))],
  ['Zmiana serii', async (p) => (await p('Tańce, 17:00–18:00, 1 godzina, Rodzina'), await p('Zmień'), await p('Całą serię'))],
  // Grupa wspólna: w osobistej nie ma „Kogo dotyczy” (audyt 2, P-53).
  ['Nowe wydarzenie', async (p) => (await p('Kalendarz'), await p('Dodaj wydarzenie'), await p('Rodzina'), await p('Co tydzień'), await p('Dodaj wariant (inne dni albo godzina)'), await p('Wybrane osoby'))],
  ['Nowe wydarzenie co miesiąc', async (p) => (await p('Kalendarz'), await p('Dodaj wydarzenie'), await p('Co miesiąc'), await p('Do dnia'))],
  ['Grupy', async (p) => p('Grupy')],
  ['Grupa', async (p) => (await p('Grupy'), await p('Rodzina, 3 osoby · administrator'))],
  ['Osoba', async (p) => (await p('Grupy'), await p('Rodzina, 3 osoby · administrator'), await p('Kuba, dziecko'))],
  ['Nowa grupa', async (p) => (await p('Grupy'), await p('Nowa grupa'))],
  ['Zaproszenie', async (p) => (await p('Grupy'), await p('Dołącz do grupy'))],
  ['Grupa: zaproszenie gotowe', async (p) => (await p('Grupy'), await p('Rodzina, 3 osoby · administrator'), await p('Zaproś'))],
  ['Ustawienia', async (p) => p('Ustawienia')],
  ['Ustawienia: Powiadomienia', async (p) => (await p('Ustawienia'), await p('Powiadomienia'))],
  ['Ustawienia: Kalendarz i dojazd', async (p) => (await p('Ustawienia'), await p('Kalendarz i dojazd'))],
  ['Ustawienia: Wygląd', async (p) => (await p('Ustawienia'), await p('Wygląd'))],
  ['Ustawienia: Konto i dane', async (p) => (await p('Ustawienia'), await p('Konto i dane'))],
  ['Wyślij uwagę', async (p) => (await p('Ustawienia'), await p('Wyślij uwagę'))],
  ['Wprowadzenie', async (p) => (await p('Ustawienia'), await p('Pokaż wprowadzenie'))],
  ['Wprowadzenie: start', async (p) => (await p('Ustawienia'), await p('Pokaż wprowadzenie'), await p('Pomiń'))],
  ['Mini kalendarz przy dacie', async (p) => (await p('Więcej'), await fireEvent.press(await screen.findByTestId('form-date')), await p('Następny miesiąc'))],
  ['Plan lekcji', async (p) => (await p('Grupy'), await p('Rodzina, 3 osoby · administrator'), await p('Kuba, dziecko'), await p('Plan lekcji'), await p('Dodaj lekcję: poniedziałek'))],
  ['Nowa rutyna', async (p) => (await p('Kalendarz'), await p('Dodaj rutynę'), await p('Dodaj krok'))],
  ['Wybór godziny', async (p) => (await p('Kalendarz'), await p('Dodaj rutynę'), await p(/^Początek$/))],
  ['Twoje imię', async (p) => (await p('Ustawienia'), await p('Konto i dane'), await p('Twoje imię, Łukasz'))],
  ['Pełny formularz: wydarzenie (przełącznik Rodzaj)', async (p) => (await p('Więcej'), await p('Wydarzenie'))],
  ['Pasek „Dodano wydarzenie · Zmień”', async (p) => {
    fireEvent.changeText(await screen.findByTestId('quick-add'), 'basen jutro 17–18');
    await p('Dodaj');
  }],
  ['Odrzucone', async (p) => (await p('Ustawienia'), await p('Konto i dane'), await p('Odrzucone zmiany, 0 zmian'))],
];

describe.each(['light', 'dark'] as Scheme[])('tryb %s', (scheme) => {
  it.each(SCREENS)('%s: etykiety, cele dotyku ≥ 44 pt, tło z palety', async (name, go) => {
    const s = setup({ scheme, base: baseWithEvent() });
    await s.renderApp(<RootStack />);
    await screen.findByTestId('screen-today');
    await go(async (label) => {
      await fireEvent.press(await screen.findByLabelText(label));
    });
    const root = screen.root!;
    expect(audit(root, scheme, name)).toEqual([]);
    const bg = screen.getAllByTestId(/^screen-/);
    expect(bg.length).toBeGreaterThan(0);
    expect(StyleSheet.flatten(bg.at(-1)!.props.style).backgroundColor).toBe(palettes[scheme].ground);
  });
});

describe('audyt sam łapie błędy (kontrola testu)', () => {
  it('brak etykiety, za mały cel, kolor spoza palety', async () => {
    const { Pressable, Text, View } = jest.requireActual<typeof import('react-native')>('react-native');
    await render(
      <View>
        <Pressable accessibilityRole="button" style={{ height: 20, width: 30 }} onPress={() => {}} />
        <Text style={{ color: '#123456', fontSize: 17 }}>x</Text>
        <Text style={{ fontSize: 17 }}>bez koloru</Text>
        <Text style={{ color: palettes.light.ink }}>
          bez rozmiaru<Text style={{ color: palettes.light.ink }}>w środku</Text>
        </Text>
        <Pressable accessibilityRole="radio" accessibilityLabel="wybrany" accessibilityState={{ selected: true }} style={{ minHeight: 44, backgroundColor: palettes.light.inverseBg }} onPress={() => {}} />
      </View>,
    );
    expect(audit(screen.root!, 'light', 'próba')).toEqual([
      'próba: button bez etykiety',
      'próba: button „undefined” ma 20 pt wysokości',
      'próba: button „undefined” ma 30 pt szerokości',
      'próba: tekst w kolorze spoza palety #123456',
      'próba: tekst bez koloru „bez koloru”',
      'próba: tekst bez rozmiaru „bez rozmiaru”',
      'próba: zaznaczenie w kolorze przycisku głównego',
    ]);
  });
});

describe('logowanie', () => {
  it.each(['light', 'dark'] as Scheme[])('tryb %s: tylko Apple (D177), bez pola e-mail', async (scheme) => {
    const account = fakeAccount();
    const { wrap } = setup({ scheme, account });
    await render(wrap(<SignInScreen account={account} />));
    expect(screen.getByText('Organizer')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('apple-sign-in'));
    expect(account.signInWithApple).toHaveBeenCalled();
    expect(screen.queryByTestId('email')).toBeNull();
    expect(screen.queryByTestId('send-link')).toBeNull();
    expect(screen.getByText('W wersji testowej logujesz się tylko przez Apple.')).toBeTruthy();
    // Audyt 2 (P-73): co to konto i że powstaje grupa osobista.
    expect(screen.getByText(/powstaje grupa osobista/)).toBeTruthy();
    expect(audit(screen.root!, scheme, 'Logowanie')).toEqual([]);
  });

  it('błąd logowania Apple pokazuje komunikat', async () => {
    const account = fakeAccount({ signInWithApple: jest.fn(async () => Promise.reject(new Error('cancel'))) });
    const { wrap } = setup({ account });
    await render(wrap(<SignInScreen account={account} />));
    await fireEvent.press(screen.getByTestId('apple-sign-in'));
    expect(await screen.findByText('Coś poszło nie tak. Spróbuj jeszcze raz.')).toBeTruthy();
  });
});

describe('linki głębokie (D40)', () => {
  const state = (path: string) => getStateFromPath(path, linking.config) as unknown as { routes: { name: string; params?: object; state?: { routes: { name: string }[] } }[] };

  it('zaproszenie, lista, zadanie, zakładki', () => {
    const tok = 'cd'.repeat(32);
    expect(inviteUrl(tok).startsWith(linking.prefixes[0]!)).toBe(true);
    expect(state(inviteUrl(tok).slice(linking.prefixes[0]!.length)).routes.at(-1)).toMatchObject({ name: 'Invite', params: { token: tok } });
    expect(state('list/lz').routes.at(-1)).toMatchObject({ name: 'List', params: { listId: 'lz' } });
    expect(state('task/t1').routes.at(-1)).toMatchObject({ name: 'Task', params: { taskId: 't1' } });
    expect(state('calendar').routes[0]!.state!.routes[0]!.name).toBe('Calendar');
  });

  it('link ID + kod (D94): https ze strony zaproszeń i schemat aplikacji → Dołącz z wypełnionymi polami', async () => {
    const url = joinUrl({ joinId: '482913507', code: '731064' });
    expect(linking.prefixes).toContain('https://lkarwowski494.github.io');
    const path = url.slice('https://lkarwowski494.github.io/'.length);
    expect(state(path).routes.at(-1)).toMatchObject({ name: 'Invite', params: { g: '482913507', c: '731064' } });
    expect(state('join?g=482913507&c=731064').routes.at(-1)).toMatchObject({ name: 'Invite', params: { g: '482913507', c: '731064' } });
    const s = setup();
    await render(s.wrap(<NavigationContainer initialState={{ routes: [{ name: 'Tabs' }, { name: 'Invite', params: { g: '482913507', c: '731064' } }] } as never}><RootStack /></NavigationContainer>));
    expect((await screen.findByTestId('invite-join-id')).props.value).toBe('482 913 507');
    expect(screen.getByTestId('invite-code').props.value).toBe('731 064');
    await fireEvent.press(screen.getByTestId('invite-accept'));
    expect(s.account.joinGroup).toHaveBeenCalledWith('482913507', '731064', 'Łukasz');
  });

  it('zaproszenie z linku otwiera ekran bez pola wklejania', async () => {
    const s = setup();
    await render(s.wrap(<NavigationContainer initialState={{ routes: [{ name: 'Tabs' }, { name: 'Invite', params: { token: 'ef'.repeat(32) } }] } as never}><RootStack /></NavigationContainer>));
    expect(await screen.findByTestId('screen-invite')).toBeTruthy();
    expect(screen.queryByTestId('invite-input')).toBeNull();
    await fireEvent.press(screen.getByTestId('invite-accept'));
    expect(s.account.acceptInvite).toHaveBeenCalledWith('ef'.repeat(32), 'Łukasz');
  });

  it('brakujące dane w trasie: ekrany pokazują błąd zamiast się wysypać', async () => {
    const s = setup();
    for (const [name, params, id] of [['List', { listId: 'nie-ma' }, 'screen-list-missing'], ['Task', { taskId: 'nie-ma' }, 'screen-task-missing'], ['Group', { groupId: 'nie-ma' }, 'screen-group-missing'], ['Member', { groupId: 'gf', memberId: 'nie-ma' }, 'screen-member-missing'], ['Event', { eventId: 'nie-ma', date: '2026-10-07' }, 'screen-event-missing'], ['EventEdit', { eventId: 'nie-ma' }, 'screen-event-edit-missing']] as const) {
      const r = await render(s.wrap(<NavigationContainer initialState={{ routes: [{ name: 'Tabs' }, { name, params }] } as never}><RootStack /></NavigationContainer>));
      expect(await screen.findByTestId(id)).toBeTruthy();
      await r.unmount();
    }
    expect(ME).toBe('u-me');
    // Przed pierwszym pobraniem (brak grup) nie ma gdzie dodać wydarzenia.
    const empty = setup({ base: {} });
    await render(empty.wrap(<NavigationContainer initialState={{ routes: [{ name: 'Tabs' }, { name: 'EventEdit', params: {} }] } as never}><RootStack /></NavigationContainer>));
    expect(await screen.findByTestId('screen-event-edit-nogroups')).toBeTruthy();
  });
});
