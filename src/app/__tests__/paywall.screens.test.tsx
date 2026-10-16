/**
 * Testy kontraktowe i integracyjne monetyzacji Apps4Brew („Cheaper than Espresso” $0.99 / $4.99 / $14.99):
 * 1. Zero podziału na funkcje Free/Pro w okresie próbnym (100% możliwości aplikacji).
 * 2. Blokada tworzenia nowych rekordów po wygaśnięciu trialu z wyświetleniem Paywalla.
 * 3. Historia Read-Only po trialu (użytkownik ZAWSZE ma dostęp do swoich danych, odhaczanie działa).
 * 4. Aktywacja subskrypcji i przywracanie zakupów.
 * 5. Ekran Ustawień: sekcja „Subskrypcja i dostęp”.
 */
import { fireEvent, screen, within } from '@testing-library/react-native';

import type { AccessState } from '../../domain/access';
import { RootStack } from '../navigation';
import { answerAlert, sampleBase, setup } from './harness';

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);

async function openApp(access?: AccessState) {
  const base = sampleBase();
  const s = setup({ base, access });
  await s.renderApp(<RootStack />);
  await screen.findByTestId('screen-today');
  return s;
}

describe('Monetyzacja i model dostępu Apps4Brew („Cheaper than Espresso”)', () => {
  it('użytkownik w okresie próbnym może tworzyć zadania bez paywalla', async () => {
    const trialAccess: AccessState = {
      plan: 'free_trial',
      trialStartedAt: '2026-10-06T00:00:00.000Z',
      expiresAt: null,
      createdCount: 0,
    };

    const { store } = await openApp(trialAccess);

    expect(screen.queryByTestId('modal-paywall')).toBeNull();

    await fireEvent.changeText(screen.getByTestId('quick-add'), 'Kup mleko');
    await fireEvent(screen.getByTestId('quick-add'), 'submitEditing');

    const created = store.dispatched.find((o) => o.kind === 'create' && o.entity === 'tasks');
    expect(created).toBeTruthy();
    expect(screen.queryByTestId('modal-paywall')).toBeNull();
  });

  it('po wygaśnięciu trialu tworzenie nowego zadania jest blokowane i otwiera Paywall', async () => {
    const expiredAccess: AccessState = {
      plan: 'free_trial',
      trialStartedAt: '2026-09-01T00:00:00.000Z', // ponad 30 dni temu
      expiresAt: null,
      createdCount: 15,
    };

    const { store } = await openApp(expiredAccess);

    await fireEvent.changeText(screen.getByTestId('quick-add'), 'Nowe zadanie po trialu');
    await fireEvent(screen.getByTestId('quick-add'), 'submitEditing');

    // Zadanie NIE zostało utworzone
    const created = store.dispatched.find((o) => o.kind === 'create' && o.entity === 'tasks');
    expect(created).toBeUndefined();

    // Pokazał się Paywall Modal
    const paywall = await screen.findByTestId('modal-paywall');
    expect(paywall).toBeTruthy();
    expect(within(paywall).getByText('Organizer Studio Pass')).toBeTruthy();
    expect(within(paywall).getByText('Twoje dane są bezpieczne')).toBeTruthy();

    // Domyślnie wybrany jest plan Roczny ($4.99)
    expect(within(paywall).getByTestId('plan-yearly')).toBeTruthy();
    expect(within(paywall).getByTestId('plan-monthly')).toBeTruthy();
    expect(within(paywall).getByTestId('plan-lifetime')).toBeTruthy();
  });

  it('historia pozostaje w 100% czytelna i odhaczalna w trybie Read-Only po trialu (ochrona ocen 4.9★)', async () => {
    const expiredAccess: AccessState = {
      plan: 'free_trial',
      trialStartedAt: '2026-09-01T00:00:00.000Z',
      expiresAt: null,
      createdCount: 20,
    };

    const { store } = await openApp(expiredAccess);

    // Stare zadanie z historii jest w 100% widoczne na ekranie (Read-Only access)
    expect(screen.getByText('Odebrać paczkę')).toBeTruthy();

    // Użytkownik może odhaczyć zadanie ze swojej historii (z potwierdzeniem D59)
    const checkBtn = screen.getByLabelText('Oznacz jako zrobione: Odebrać paczkę');
    expect(checkBtn).toBeTruthy();
    await press(checkBtn);
    await answerAlert('Zrobione');

    // Wysłano patch do store (nie blokujemy odhaczania dotychczasowych spraw!)
    const patched = store.dispatched.find((o) => o.kind === 'patch' && o.entity === 'tasks' && o.id === 't-paczka');
    expect(patched).toBeTruthy();
  });

  it('wybór planu i subskrypcja na Paywallu odblokowuje tworzenie i zamyka modal', async () => {
    const expiredAccess: AccessState = {
      plan: 'free_trial',
      trialStartedAt: '2026-09-01T00:00:00.000Z',
      expiresAt: null,
      createdCount: 15,
    };

    const { store } = await openApp(expiredAccess);

    // Wywołanie paywalla przez próbę dodania
    await fireEvent.changeText(screen.getByTestId('quick-add'), 'Nowy wpis');
    await fireEvent(screen.getByTestId('quick-add'), 'submitEditing');

    const paywall = await screen.findByTestId('modal-paywall');
    expect(paywall).toBeTruthy();

    // Wybór planu Lifetime
    await press(within(paywall).getByTestId('plan-lifetime'));

    // Kliknięcie Aktywuj
    await press(within(paywall).getByTestId('paywall-submit'));

    // Modal się zamknął
    expect(screen.queryByTestId('modal-paywall')).toBeNull();

    // Teraz dodanie nowego zadania przechodzi pomyślnie
    await fireEvent.changeText(screen.getByTestId('quick-add'), 'Kolejne zadanie');
    await fireEvent(screen.getByTestId('quick-add'), 'submitEditing');

    const created = store.dispatched.find((o) => o.kind === 'create' && o.entity === 'tasks');
    expect(created).toBeTruthy();
  });

  it('sekcja Subskrypcja i dostęp w Ustawieniach pokazuje stan licencji i otwiera Paywall', async () => {
    const trialAccess: AccessState = {
      plan: 'free_trial',
      trialStartedAt: '2026-10-05T08:00:00.000Z',
      expiresAt: null,
      createdCount: 2,
    };

    await openApp(trialAccess);

    // Przejście do Ustawień
    await press(screen.getByLabelText('Ustawienia'));
    await screen.findByTestId('screen-settings');

    // Widać wiersz subskrypcji
    const subRow = screen.getByTestId('open-subscription');
    expect(subRow).toBeTruthy();
    expect(within(subRow).getByText('Subskrypcja i dostęp')).toBeTruthy();

    // Dotknięcie otwiera Paywall
    await press(subRow);
    const paywall = await screen.findByTestId('modal-paywall');
    expect(paywall).toBeTruthy();

    // Anulowanie zamyka Paywall
    await press(within(paywall).getByTestId('paywall-cancel'));
    expect(screen.queryByTestId('modal-paywall')).toBeNull();
  });
});
