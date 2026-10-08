/**
 * Konto i dane (audyt 2, paczka P9): niewysłane zmiany w oknach wylogowania, usunięcia konta i czyszczenia (M-166),
 * wylogowanie bez internetu, konto e-mail w becie bez logowania e-mailem (D177), przycisk TestFlight przy
 * „Zaktualizuj aplikację”.
 */
import { act, fireEvent, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { config } from '../../config';
import type { Indicator } from '../../domain/sync-engine/scheduler';
import { RootStack } from '../navigation';
import { answerAlert, lastAlert, setup } from './harness';

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);

async function openAccount(opts: { indicator?: Indicator; queued?: number; sent?: number; emailOnly?: boolean } = {}) {
  const s = setup({ resetLocal: jest.fn(), indicator: opts.indicator, session: opts.emailOnly ? { emailOnly: true } : {} });
  // Kolejka: `sent` zmian wysłanych i potwierdzonych (czekają tylko na pobranie) + `queued` niewysłanych.
  const n = (opts.sent ?? 0) + (opts.queued ?? 0);
  for (let i = 0; i < n; i++) s.store.dispatch({ kind: 'patch', entity: 'tasks', id: 't-kwiaty', set: { title: `Kwiaty ${i}` } });
  const st = s.store.getSnapshot().state;
  await act(async () => {
    s.store.getSnapshot().state = { ...st, ackedSeq: st.pending[(opts.sent ?? 0) - 1]?.seq ?? st.ackedSeq } as never;
  });
  await s.renderApp(<RootStack />);
  await press(await screen.findByLabelText('Ustawienia'));
  await press(await screen.findByTestId('settings-account'));
  return s;
}

describe('niewysłane zmiany (M-166)', () => {
  it('„Wyczyść dane” liczy tylko niewysłane, nie te czekające na pobranie', async () => {
    await openAccount({ sent: 2, queued: 1 });
    await press(screen.getByTestId('reset-start'));
    expect(screen.getByText('Uwaga: 1 zmiana nie została jeszcze wysłana na serwer i przepadnie.')).toBeTruthy();
  });

  it('usunięcie konta ostrzega, że niewysłane przepadną; bez kolejki — bez ostrzeżenia', async () => {
    await openAccount({ queued: 3 });
    await press(screen.getByTestId('delete-start'));
    expect(screen.getByText('Uwaga: 3 zmiany nie zostały jeszcze wysłane na serwer i przepadną.')).toBeTruthy();
    await openAccount({ sent: 1 });
    await press(screen.getAllByTestId('delete-start').at(-1)!);
    expect(screen.queryByText(/nie został/)).toBeNull();
  });

  it('wylogowanie mówi, że niewysłane wyślą się po ponownym zalogowaniu (baza konta zostaje, D172 b)', async () => {
    await openAccount({ queued: 5 });
    await press(screen.getByTestId('sign-out'));
    expect(lastAlert().message).toBe(
      'Przypomnienia i kalendarze „Organizer” znikną z tego iPhone’a, a powiadomienia tego konta przestaną tu przychodzić. Na innych urządzeniach zostajesz zalogowany. Żeby wrócić, zaloguj się tym samym kontem.\n\n5 zmian czeka na wysłanie — wyśle się, gdy znów zalogujesz się tym kontem.',
    );
  });
});

describe('wylogowanie', () => {
  it('bez internetu: krótka uwaga o powiadomieniach; błąd wylogowania nie wychodzi poza okno', async () => {
    const s = await openAccount({ indicator: { state: 'offline', pending: 0 } });
    s.account.signOut.mockRejectedValueOnce(new Error('x'));
    await press(screen.getByTestId('sign-out'));
    expect(lastAlert().message).toMatch(/\n\nPowiadomienia tego konta przestaną przychodzić, gdy telefon połączy się z internetem\.$/);
    await answerAlert('Wyloguj');
    expect(s.account.signOut).toHaveBeenCalled();
  });

  it('konto bez Apple (dawne logowanie e-mailem, D177): ostrzeżenie, że nie da się wrócić', async () => {
    await openAccount({ emailOnly: true, queued: 1 });
    await press(screen.getByTestId('sign-out'));
    expect(lastAlert().message).toMatch(/1 zmiana czeka na wysłanie — wyśle się.*\n\nTo konto założono e-mailem\. W wersji testowej logowanie e-mailem jest wyłączone, więc po wylogowaniu nie zalogujesz się do niego ponownie\.$/s);
  });
});

describe('„Zaktualizuj aplikację” a TestFlight (decyzja koordynatora 8.10.2026)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('bez linku — sam tekst', async () => {
    await setup({ indicator: { state: 'upgrade_required', pending: 0 } }).renderApp(<RootStack />);
    expect(await screen.findByLabelText('Stan synchronizacji: Zaktualizuj aplikację')).toBeTruthy();
    expect(screen.queryByTestId('sync-upgrade')).toBeNull();
  });

  it('z publicznym linkiem — przycisk otwiera TestFlight (błąd otwarcia cichy); w innym stanie przycisku nie ma', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    jest.replaceProperty(config.invites, 'TESTFLIGHT_LINK', 'https://testflight.apple.com/join/AbCd1234');
    const r = await setup({ indicator: { state: 'upgrade_required', pending: 0 } }).renderApp(<RootStack />);
    const button = await screen.findByRole('button', { name: 'Otwórz TestFlight' });
    await press(button);
    expect(open).toHaveBeenCalledWith('https://testflight.apple.com/join/AbCd1234');
    open.mockRejectedValueOnce(new Error('x'));
    await press(button);
    r.unmount();
    await setup({ indicator: { state: 'offline', pending: 0 } }).renderApp(<RootStack />);
    await screen.findByTestId('sync-chip');
    expect(screen.queryByTestId('sync-upgrade')).toBeNull();
  });
});
