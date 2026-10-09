/** Zgłaszanie błędów (D80): treść zgłoszenia, globalny handler, granica błędów; ekran „Wyślij uwagę”. */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as fc from 'fast-check';
import { Text } from 'react-native';

import { appVersion, ERROR_REPORTS_KEY, ErrorBoundary, gatedReport, installGlobalHandler, reportsOn, toClientError } from '../diagnostics';
import { RootStack } from '../navigation';
import { fakeAccount, memoryLocal, setup } from './harness';

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

  it('audyt 2 (M-159): błąd kalendarza i dojazdu — tylko nazwa, kod i ramki stosu, bez treści z komunikatu', () => {
    const e = Object.assign(new Error('Nie można zapisać „Basen Tymka” w kalendarzu Rodzina, ul. Wodna 1'), { code: 'E_CALENDAR_ERROR_UNKNOWN' });
    e.stack = `Error: ${e.message}\n    at save (calendar.js:10:5)\n    at run (app.js:3:1)\n    at Rodzina, ul. Wodna 1`;
    expect(toClientError(e, 'error', 'calendar-mirror', 'v', { private: true })).toEqual({ kind: 'error', message: 'Error (E_CALENDAR_ERROR_UNKNOWN)', stack: '    at save (calendar.js:10:5)\n    at run (app.js:3:1)', screen: 'calendar-mirror', appVersion: 'v' });
    // Kod, który nie wygląda na kod (np. z treścią), pomijany; brak stosu — null; pusty komunikat nie chowa ramek.
    expect(toClientError(Object.assign(new TypeError('x'), { code: 'Basen Tymka 17:00', stack: undefined }), 'error', null, 'v', { private: true })).toMatchObject({ message: 'TypeError', stack: null });
    const bare = new Error('');
    bare.stack = 'Error\n    at a (b.js:1:1)';
    expect(toClientError(bare, 'error', null, 'v', { private: true }).stack).toBe('    at a (b.js:1:1)');
    expect(toClientError('Basen', 'error', null, 'v', { private: true }).message).toBe('Error');
    // Własność: żadna treść wiersza (tytuł, adres, nazwa kalendarza) z komunikatu nie trafia do zgłoszenia.
    fc.assert(
      fc.property(fc.string({ minLength: 3 }).filter((x) => x.trim().length >= 3 && !/:\d/.test(x) && !'Error ()E_CALENDAR'.includes(x)), (secret) => {
        const err = new Error(`Brak: ${secret}`);
        err.stack = `Error: Brak: ${secret}\n    at f (x.js:1:1)\n    at ${secret}`;
        const r = toClientError(err, 'error', 'travel', 'v', { private: true });
        return !JSON.stringify([r.message, r.stack]).includes(JSON.stringify(secret).slice(1, -1));
      }),
    );
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

describe('zgoda na raporty błędów (audyt 3, N-74)', () => {
  const e = { kind: 'error' as const, message: 'm', stack: null, screen: null, appVersion: 'v' };
  it('domyślnie wysyła; po wyłączeniu w Ustawieniach nic nie idzie na serwer; po włączeniu znowu wysyła', async () => {
    const local = memoryLocal();
    const send = jest.fn(async () => {});
    const report = gatedReport(local, send);
    await report(e);
    expect(send).toHaveBeenCalledTimes(1);
    local.save(ERROR_REPORTS_KEY, 'off');
    expect(reportsOn(local)).toBe(false);
    await report(e);
    expect(send).toHaveBeenCalledTimes(1);
    local.save(ERROR_REPORTS_KEY, null);
    await report(e);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('granica błędów przy wyłączonych raportach: bez zgłoszenia i bez obietnicy „spróbujemy zgłosić”', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const Bomb = () => {
      throw new Error('render');
    };
    const report = jest.fn();
    await render(
      <ErrorBoundary report={report} reporting={() => false} version="v" colors={{ ground: '#fff', ink: '#000', inkMuted: '#333' }}>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('screen-crash')).toBeTruthy();
    expect(report).not.toHaveBeenCalled();
    expect(screen.queryByText(/zgłosić/)).toBeNull();
    expect(screen.getByText('Twoje dane są bezpieczne na telefonie.')).toBeTruthy();
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
    await press(screen.getByTestId('feedback-send'));
    expect(screen.getByTestId('feedback-empty').props.children).toBe('Wpisz, co chcesz nam przekazać.');
    expect(account.sendFeedback).not.toHaveBeenCalled();
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
