/** Zgłaszanie błędów (D80): treść zgłoszenia, globalny handler, granica błędów; ekran „Wyślij uwagę”. */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { appVersion, ErrorBoundary, installGlobalHandler, toClientError } from '../diagnostics';
import { RootStack } from '../navigation';
import { fakeAccount, setup } from './harness';

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);

describe('zgłoszenie błędu', () => {
  it('komunikat z nazwą, przycięty stos i ekran; nie-Error też', () => {
    const e = new TypeError('x is undefined');
    e.stack = 'a'.repeat(5000);
    expect(toClientError(e, 'crash', 'Task', '0.1.0 (13)')).toEqual({ kind: 'crash', message: 'TypeError: x is undefined', stack: 'a'.repeat(4000), screen: 'Task', appVersion: '0.1.0 (13)' });
    expect(toClientError('bum', 'error', null, 'v')).toMatchObject({ message: 'Error: bum', screen: null });
    expect(toClientError(new Error('m'.repeat(600)), 'error', 's'.repeat(200), 'v')).toMatchObject({ message: `Error: ${'m'.repeat(493)}`, screen: 's'.repeat(100) });
    expect(appVersion()).toBe('0.1.0 (13)');
  });

  it('globalny handler zgłasza i oddaje poprzedniemu; zgłoszenie z błędem nie psuje; przywrócenie', () => {
    const previous = jest.fn();
    let current: (e: unknown, f?: boolean) => void = previous;
    const utils = { getGlobalHandler: () => current, setGlobalHandler: (h: typeof current) => void (current = h) };
    const report = jest.fn();
    const restore = installGlobalHandler(utils, report, 'v');
    current(new Error('a'), true);
    expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'crash', message: 'Error: a' }));
    current(new Error('b'), false);
    expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'error' }));
    expect(previous).toHaveBeenCalledTimes(2);
    report.mockImplementation(() => {
      throw new Error('sieć');
    });
    current(new Error('c'));
    expect(previous).toHaveBeenCalledTimes(3);
    restore();
    expect(current).toBe(previous);
  });

  it('granica błędów: ekran „Coś poszło nie tak”, zgłoszenie, „Spróbuj ponownie”', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    let boom = true;
    const Bomb = () => {
      if (boom) throw new Error('render');
      return <Text>ok</Text>;
    };
    const report = jest.fn(() => {
      throw new Error('nawet zgłoszenie padło');
    });
    await render(
      <ErrorBoundary report={report} version="v" colors={{ ground: '#fff', ink: '#000', inkMuted: '#333' }}>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('screen-crash')).toBeTruthy();
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ kind: 'crash', screen: 'render', message: 'Error: render' }));
    boom = false;
    await act(async () => press(screen.getByLabelText('Spróbuj ponownie')));
    expect(screen.getByText('ok')).toBeTruthy();
  });
});

describe('Wyślij uwagę', () => {
  it('wysyła tekst z wersją; podziękowanie; limit dzienny i brak internetu', async () => {
    const account = fakeAccount();
    const s = setup({ account });
    await s.renderApp(<RootStack />);
    await screen.findByTestId('screen-today');
    await press(screen.getByLabelText('Ustawienia'));
    await press(await screen.findByTestId('open-feedback'));
    expect(screen.getByTestId('feedback-send').props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(screen.getByTestId('feedback-text'), '  Brakuje stałych zakupów ');
    await press(screen.getByTestId('feedback-send'));
    await act(async () => {});
    expect(account.sendFeedback).toHaveBeenCalledWith({ message: 'Brakuje stałych zakupów', screen: 'Settings', appVersion: '0.1.0 (13)' });
    expect(screen.getByText('Dziękujemy! Uwaga dotarła.')).toBeTruthy();
    account.sendFeedback.mockRejectedValueOnce(new Error('rate_limited'));
    await fireEvent.changeText(screen.getByTestId('feedback-text'), 'Jeszcze');
    await press(screen.getByTestId('feedback-send'));
    await act(async () => {});
    expect(screen.getByText('Na dziś to już dużo uwag — spróbuj jutro.')).toBeTruthy();
    account.sendFeedback.mockRejectedValueOnce(new Error('Network request failed'));
    await fireEvent.changeText(screen.getByTestId('feedback-text'), 'Raz jeszcze');
    await press(screen.getByTestId('feedback-send'));
    await act(async () => {});
    expect(screen.getByText('Nie udało się wysłać. Sprawdź internet i spróbuj jeszcze raz.')).toBeTruthy();
    account.sendFeedback.mockRejectedValueOnce(undefined);
    await press(screen.getByTestId('feedback-send'));
    await act(async () => {});
    expect(screen.getByText('Nie udało się wysłać. Sprawdź internet i spróbuj jeszcze raz.')).toBeTruthy();
  });
});
