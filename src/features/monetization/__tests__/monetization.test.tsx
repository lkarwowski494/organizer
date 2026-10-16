import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import React, { useState } from 'react';
import { Button, Text, View } from 'react-native';

import { ThemeProvider } from '../../../ui/theme';
import { ACCESS_STORAGE_KEY, AppAccessProvider, useAppAccess } from '../useAppAccess';
import { PaywallModal } from '../PaywallModal';

function FallbackConsumer() {
  const access = useAppAccess();
  return (
    <View>
      <Text testID="fb-can-create">{String(access.canCreate)}</Text>
      <Text testID="fb-is-trial">{String(access.isTrial)}</Text>
      <Text testID="fb-days">{String(access.trialDaysLeft)}</Text>
      <Text testID="fb-show">{String(access.showPaywall)}</Text>
      <Button
        title="Check"
        testID="fb-btn-check"
        onPress={() => {
          access.setShowPaywall(true);
          void access.recordCreation();
          void access.subscribe('yearly');
          void access.restorePurchases();
          access.checkCanCreateOrShowPaywall();
        }}
      />
    </View>
  );
}

function TestConsumer() {
  const access = useAppAccess();
  const [restoreResult, setRestoreResult] = useState<boolean | null>(null);

  return (
    <View>
      <Text testID="can-create">{String(access.canCreate)}</Text>
      <Text testID="is-trial">{String(access.isTrial)}</Text>
      <Text testID="trial-days">{String(access.trialDaysLeft)}</Text>
      <Text testID="show-paywall">{String(access.showPaywall)}</Text>
      <Text testID="restore-result">{String(restoreResult)}</Text>
      <Button title="Open Paywall" testID="btn-open-pw" onPress={() => access.setShowPaywall(true)} />
      <Button title="Record" testID="btn-record" onPress={() => void access.recordCreation()} />
      <Button title="Monthly" testID="btn-sub-monthly" onPress={() => void access.subscribe('monthly')} />
      <Button title="Yearly" testID="btn-sub-yearly" onPress={() => void access.subscribe('yearly')} />
      <Button title="Lifetime" testID="btn-sub-lifetime" onPress={() => void access.subscribe('lifetime')} />
      <Button
        title="Restore"
        testID="btn-restore"
        onPress={async () => {
          const res = await access.restorePurchases();
          setRestoreResult(res);
        }}
      />
      <Button title="Check Create" testID="btn-check" onPress={() => access.checkCanCreateOrShowPaywall()} />
      <PaywallModal />
    </View>
  );
}

describe('features/monetization: useAppAccess i PaywallModal', () => {
  beforeEach(() => {
    (globalThis as unknown as { __mockSecureStore: Map<string, string> }).__mockSecureStore.clear();
  });

  it('useAppAccess poza AppAccessProvider zwraca bezpieczną atrapę (fallback)', async () => {
    await render(
      <ThemeProvider>
        <FallbackConsumer />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('fb-can-create').props.children).toBe('true');
    expect(screen.getByTestId('fb-is-trial').props.children).toBe('true');
    expect(screen.getByTestId('fb-days').props.children).toBe('7');
    expect(screen.getByTestId('fb-show').props.children).toBe('false');

    // Wywołanie metod atrapy nie rzuca błędu
    await fireEvent.press(screen.getByTestId('fb-btn-check'));
  });

  it('obsługuje pełny cykl subskrypcji i przywracania zakupów', async () => {
    await render(
      <ThemeProvider>
        <AppAccessProvider nowIso={() => '2026-10-16T12:00:00.000Z'}>
          <TestConsumer />
        </AppAccessProvider>
      </ThemeProvider>,
    );

    // Domyślny stan trialu
    expect(screen.getByTestId('can-create').props.children).toBe('true');
    expect(screen.getByTestId('is-trial').props.children).toBe('true');

    // checkCanCreateOrShowPaywall() gdy canCreate jest true
    await act(async () => {
      fireEvent.press(screen.getByTestId('btn-check'));
    });
    expect(screen.getByTestId('show-paywall').props.children).toBe('false');

    // Przywracanie zakupów gdy brak zapisu w SecureStore (zwraca false)
    await act(async () => {
      fireEvent.press(screen.getByTestId('btn-restore'));
    });
    expect(screen.getByTestId('restore-result').props.children).toBe('false');

    // Otwórz paywall i kliknij restore gdy brak zakupu (success === false w PaywallModal)
    await act(async () => {
      fireEvent.press(screen.getByTestId('btn-open-pw'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('paywall-restore'));
    });
    expect(screen.queryByText('Subskrypcja została przywrócona.')).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByTestId('paywall-cancel'));
    });

    // Rejestracja utworzenia
    await act(async () => {
      fireEvent.press(screen.getByTestId('btn-record'));
    });

    // Subskrypcja roczna
    await act(async () => {
      fireEvent.press(screen.getByTestId('btn-sub-yearly'));
    });

    // Subskrypcja miesięczna
    await act(async () => {
      fireEvent.press(screen.getByTestId('btn-sub-monthly'));
    });
    expect(screen.getByTestId('is-trial').props.children).toBe('false');

    // Przywracanie zakupów z SecureStore (zwraca true)
    await act(async () => {
      fireEvent.press(screen.getByTestId('btn-restore'));
    });
    expect(screen.getByTestId('restore-result').props.children).toBe('true');
  });

  it('wczytuje istniejący stan z SecureStore przy starcie', async () => {
    await SecureStore.setItemAsync(
      ACCESS_STORAGE_KEY,
      JSON.stringify({
        plan: 'lifetime',
        trialStartedAt: '2026-10-01T00:00:00.000Z',
        expiresAt: null,
        createdCount: 42,
      }),
    );

    await render(
      <ThemeProvider>
        <AppAccessProvider nowIso={() => '2026-10-16T12:00:00.000Z'}>
          <TestConsumer />
        </AppAccessProvider>
      </ThemeProvider>,
    );

    await act(async () => {
      // poczekaj na useEffect czytający z SecureStore
    });

    expect(screen.getByTestId('can-create').props.children).toBe('true');
    expect(screen.getByTestId('is-trial').props.children).toBe('false');
  });

  it('PaywallModal pozwala wybrać każdy z 3 planów, zamknąć modal oraz obsłużyć przywrócenie', async () => {
    // Zapisz aktywną subskrypcję w SecureStore, by restorePurchases zwróciło true
    await SecureStore.setItemAsync(
      ACCESS_STORAGE_KEY,
      JSON.stringify({
        plan: 'yearly',
        trialStartedAt: '2026-10-01T00:00:00.000Z',
        expiresAt: '2027-10-01T00:00:00.000Z',
        createdCount: 10,
      }),
    );

    await render(
      <ThemeProvider>
        <AppAccessProvider
          initialState={{
            plan: 'free_trial',
            trialStartedAt: '2026-09-01T00:00:00.000Z', // wygasły
            expiresAt: null,
            createdCount: 15,
          }}
          nowIso={() => '2026-10-16T12:00:00.000Z'}
        >
          <TestConsumer />
        </AppAccessProvider>
      </ThemeProvider>,
    );

    // canCreate jest false
    expect(screen.getByTestId('can-create').props.children).toBe('false');

    // checkCanCreateOrShowPaywall() otwiera paywall
    await act(async () => {
      fireEvent.press(screen.getByTestId('btn-check'));
    });

    expect(screen.getByTestId('modal-paywall')).toBeTruthy();

    // Wybór planu miesięcznego
    await act(async () => {
      fireEvent.press(screen.getByTestId('plan-monthly'));
    });

    // Wybór planu rocznego
    await act(async () => {
      fireEvent.press(screen.getByTestId('plan-yearly'));
    });

    // Przywracanie zakupów na paywallu
    await act(async () => {
      fireEvent.press(screen.getByTestId('paywall-restore'));
    });

    // Pojawił się komunikat o sukcesie
    expect(screen.getByText('Subskrypcja została przywrócona.')).toBeTruthy();

    // Po 1200ms modal się zamyka
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1300));
    });

    expect(screen.queryByTestId('modal-paywall')).toBeNull();

    // Ponowne otwarcie i przetestowanie Anuluj
    await act(async () => {
      fireEvent.press(screen.getByTestId('btn-open-pw'));
    });
    expect(screen.getByTestId('modal-paywall')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('paywall-cancel'));
    });
    expect(screen.queryByTestId('modal-paywall')).toBeNull();

    // Ponowne otwarcie i przetestowanie onRequestClose
    await act(async () => {
      fireEvent.press(screen.getByTestId('btn-open-pw'));
    });
    expect(screen.getByTestId('modal-paywall')).toBeTruthy();
    await act(async () => {
      fireEvent(screen.getByTestId('modal-paywall').parent!, 'requestClose');
    });
    expect(screen.queryByTestId('modal-paywall')).toBeNull();

    // Ponowne otwarcie i przetestowanie Aktywuj (subscribe)
    await act(async () => {
      fireEvent.press(screen.getByTestId('btn-open-pw'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('plan-lifetime'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('paywall-submit'));
    });
    expect(screen.queryByTestId('modal-paywall')).toBeNull();
  });

  it('AppAccessProvider działa z domyślnym nowIso i radzi sobie z błędem odczytu', async () => {
    jest.spyOn(SecureStore, 'getItemAsync').mockRejectedValueOnce(new Error('store read error'));
    await render(
      <ThemeProvider>
        <AppAccessProvider>
          <TestConsumer />
        </AppAccessProvider>
      </ThemeProvider>,
    );
    expect(screen.getByTestId('can-create').props.children).toBe('true');

    // Błąd przy restorePurchases
    jest.spyOn(SecureStore, 'getItemAsync').mockRejectedValueOnce(new Error('restore error'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('btn-restore'));
    });
    expect(screen.getByTestId('restore-result').props.children).toBe('false');
  });

  it('checkCanCreateOrShowPaywall() blokuje tworzenie i otwiera paywall po wygaśnięciu trialu', async () => {
    let checkResult = true;
    function GateConsumer() {
      const access = useAppAccess();
      return (
        <View>
          <Text testID="gate-can">{String(access.canCreate)}</Text>
          <Text testID="gate-show">{String(access.showPaywall)}</Text>
          <Button
            title="Gate Check"
            testID="gate-check-btn"
            onPress={() => {
              checkResult = access.checkCanCreateOrShowPaywall();
            }}
          />
        </View>
      );
    }

    await render(
      <ThemeProvider>
        <AppAccessProvider
          initialState={{
            plan: 'free_trial',
            trialStartedAt: '2026-09-01T00:00:00.000Z',
            expiresAt: null,
            createdCount: 20,
          }}
          nowIso={() => '2026-10-16T12:00:00.000Z'}
        >
          <GateConsumer />
        </AppAccessProvider>
      </ThemeProvider>,
    );

    expect(screen.getByTestId('gate-can').props.children).toBe('false');
    await act(async () => {
      fireEvent.press(screen.getByTestId('gate-check-btn'));
    });
    expect(checkResult).toBe(false);
    expect(screen.getByTestId('gate-show').props.children).toBe('true');
  });
});

