/**
 * Dostępność i oba tryby kolorów na każdym ekranie: każdy element dotykowy ma etykietę i cel dotyku
 * ≥ 44 pt (Apple HIG), każdy tekst ma kolor z palety bieżącego trybu.
 */
import { getStateFromPath, NavigationContainer } from '@react-navigation/native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { groupLines, palettes, type Scheme } from '../../config/theme';
import { inviteUrl } from '../../domain/invite-link';
import { SignInScreen } from '../../features/auth/SignInScreen';
import { linking, RootStack } from '../navigation';
import { fakeAccount, ME, put, sampleBase, setup } from './harness';

/** Dane przykładowe + seria wydarzeń (środy 17:00, Kuba), żeby audyt objął ekrany wydarzeń. */
function baseWithEvent() {
  const t = sampleBase();
  put(t, 'events', 'ev', { id: 'ev', group_id: 'gf', title: 'Tańce', note: null, start_date: '2026-10-07', start_time: '17:00:00', end_time: '18:00:00', rrule: 'FREQ=WEEKLY;BYDAY=WE', audience: 'members', deleted_at: null, version: 1 });
  put(t, 'event_participants', 'p', { id: 'p', event_id: 'ev', group_id: 'gf', member_id: 'kuba', deleted_at: null, version: 1 });
  return t;
}

const INTERACTIVE = new Set(['button', 'checkbox', 'tab', 'radio']);

type Node = { props: Record<string, unknown>; children: unknown[]; type: unknown };

function walk(n: Node | string, out: Node[]) {
  if (typeof n === 'string' || !n) return;
  out.push(n);
  for (const c of n.children ?? []) walk(c as Node, out);
}

function audit(root: unknown, scheme: Scheme, where: string) {
  const all: Node[] = [];
  walk(root as unknown as Node, all);
  const allowed = new Set([...Object.values(palettes[scheme]), ...groupLines.map((g) => g[scheme].ink)]);
  const problems: string[] = [];
  for (const n of all) {
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
  }
  return problems;
}

const SCREENS: [string, (press: (l: string) => Promise<void>) => Promise<void>][] = [
  ['Dotyczy mnie', async () => {}],
  ['Listy', async (p) => p('Listy')],
  ['Lista zakupów', async (p) => (await p('Listy'), await p('Zakupy na weekend, Rodzina · Zakupy · 1 otwarte'))],
  ['Lista zadań', async (p) => (await p('Listy'), await p('Dom, Rodzina · Zadania · 3 otwarte'))],
  ['Zadanie', async (p) => p('Otwórz: Odebrać paczkę')],
  ['Dotyczy mnie: tydzień', async (p) => p('Tydzień')],
  ['Dotyczy mnie: wczoraj', async (p) => p('Poprzedni dzień')],
  ['Pasek „Cofnij”', async (p) => p('Usuń: Odebrać paczkę')],
  ['Nowa lista', async (p) => (await p('Listy'), await p('Nowa lista'))],
  ['Kalendarz', async (p) => p('Kalendarz')],
  ['Wydarzenie', async (p) => p('Tańce, 17:00–18:00, Rodzina, powtarza się')],
  ['Wydarzenie: wybór zakresu', async (p) => (await p('Tańce, 17:00–18:00, Rodzina, powtarza się'), await p('Zmień'))],
  ['Zmiana serii', async (p) => (await p('Tańce, 17:00–18:00, Rodzina, powtarza się'), await p('Zmień'), await p('Wszystkie w serii'))],
  ['Nowe wydarzenie', async (p) => (await p('Kalendarz'), await p('Dodaj wydarzenie'), await p('Co tydzień'), await p('Dodaj inny termin (inne dni lub godzina)'), await p('Wybrane osoby'))],
  ['Nowe wydarzenie co miesiąc', async (p) => (await p('Kalendarz'), await p('Dodaj wydarzenie'), await p('Co miesiąc'), await p('Do dnia'))],
  ['Grupy', async (p) => p('Grupy')],
  ['Grupa', async (p) => (await p('Grupy'), await p('Rodzina, 3 osoby · admin'))],
  ['Osoba', async (p) => (await p('Grupy'), await p('Rodzina, 3 osoby · admin'), await p('Kuba, dziecko'))],
  ['Nowa grupa', async (p) => (await p('Grupy'), await p('Nowa grupa'))],
  ['Zaproszenie', async (p) => (await p('Grupy'), await p('Dołącz z linku'))],
  ['Ustawienia', async (p) => p('Ustawienia')],
  ['Odrzucone', async (p) => (await p('Ustawienia'), await p('Odrzucone zmiany, 0 zmian'))],
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
        <Text style={{ color: '#123456' }}>x</Text>
      </View>,
    );
    expect(audit(screen.root!, 'light', 'próba')).toEqual([
      'próba: button bez etykiety',
      'próba: button „undefined” ma 20 pt wysokości',
      'próba: button „undefined” ma 30 pt szerokości',
      'próba: tekst w kolorze spoza palety #123456',
    ]);
  });
});

describe('logowanie', () => {
  it.each(['light', 'dark'] as Scheme[])('tryb %s: Apple, e-mail z walidacją, potwierdzenie wysłania, błąd', async (scheme) => {
    const account = fakeAccount();
    const { wrap } = setup({ scheme, account });
    await render(wrap(<SignInScreen account={account} />));
    expect(screen.getByText('Organizer')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('apple-sign-in'));
    expect(account.signInWithApple).toHaveBeenCalled();
    await fireEvent.changeText(screen.getByTestId('email'), 'zly adres');
    await fireEvent.press(screen.getByTestId('send-link'));
    expect(screen.getByText('Sprawdź adres e-mail')).toBeTruthy();
    expect(account.sendMagicLink).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByTestId('email'), ' ala@example.com ');
    await fireEvent.press(screen.getByTestId('send-link'));
    expect(account.sendMagicLink).toHaveBeenCalledWith('ala@example.com');
    expect(await screen.findByText('Wysłaliśmy link na ala@example.com. Otwórz go na tym iPhonie.')).toBeTruthy();
    account.sendMagicLink.mockRejectedValueOnce(new Error('rate limit'));
    await fireEvent.press(screen.getByTestId('send-link'));
    expect(await screen.findByText('Coś poszło nie tak. Spróbuj jeszcze raz.')).toBeTruthy();
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
