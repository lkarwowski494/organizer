/**
 * Prywatność i licencje (audyt 3, PK-25): przełącznik raportów błędów w Ustawieniach → Konto i dane (N-74, decyzja Q3 A),
 * link do polityki prywatności w Ustawieniach i na ekranie logowania (N-75, Q4 A), ekran Licencje (N-78, Q22 A).
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { config } from '../../config';
import { SignInScreen } from '../../features/auth/SignInScreen';
import licenses from '../../licenses/third-party.json';
import { ERROR_REPORTS_KEY } from '../diagnostics';
import { RootStack } from '../navigation';
import { fakeAccount, memoryLocal, setup } from './harness';

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);

async function openSettings(local = memoryLocal()) {
  const s = setup({ local });
  await s.renderApp(<RootStack />);
  await press(await screen.findByLabelText('Ustawienia'));
  return s;
}

afterEach(() => jest.restoreAllMocks());

describe('raporty błędów (N-74)', () => {
  it('Konto i dane: „Wysyłaj raporty błędów” domyślnie włączone; wyłączenie zapisuje się na tym telefonie', async () => {
    const local = memoryLocal();
    await openSettings(local);
    await press(await screen.findByTestId('settings-account'));
    const sw = screen.getByRole('switch', { name: 'Wysyłaj raporty błędów' });
    expect(sw.props.value).toBe(true);
    expect(screen.getByText(/Bez treści list, zadań, wydarzeń i imion/)).toBeTruthy();
    await fireEvent(sw, 'valueChange', false);
    expect(local.load(ERROR_REPORTS_KEY)).toBe('off');
    expect(screen.getByRole('switch', { name: 'Wysyłaj raporty błędów' }).props.value).toBe(false);
    await fireEvent(screen.getByRole('switch', { name: 'Wysyłaj raporty błędów' }), 'valueChange', true);
    expect(local.load(ERROR_REPORTS_KEY)).toBeNull();
  });

  it('wyłączone wcześniej — przełącznik pokazuje „wyłączone”', async () => {
    const local = memoryLocal();
    local.save(ERROR_REPORTS_KEY, 'off');
    await openSettings(local);
    await press(await screen.findByTestId('settings-account'));
    expect(screen.getByRole('switch', { name: 'Wysyłaj raporty błędów' }).props.value).toBe(false);
  });
});

describe('polityka prywatności (N-75)', () => {
  it('Ustawienia → Konto i dane: „Polityka prywatności” otwiera stronę polityki', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await openSettings();
    await press(await screen.findByTestId('settings-account'));
    await press(screen.getByRole('button', { name: 'Polityka prywatności' }));
    expect(open).toHaveBeenCalledWith(config.privacy.POLICY_URL);
  });

  it('ekran logowania: zdanie o raportach błędów i link do polityki', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await render(setup().wrap(<SignInScreen account={fakeAccount()} />));
    expect(screen.getByText('Gdy coś pójdzie nie tak, aplikacja wysyła nam raport błędu — bez treści Twoich spraw. Wyłączysz to w Ustawieniach → Konto i dane.')).toBeTruthy();
    await press(screen.getByRole('button', { name: 'Polityka prywatności' }));
    expect(open).toHaveBeenCalledWith(config.privacy.POLICY_URL);
  });

  it('adres polityki to strona /privacy/ tej samej witryny co zaproszenia', () => {
    expect(new URL(config.privacy.POLICY_URL).origin).toBe(new URL(config.invites.JOIN_LINK).origin);
    expect(new URL(config.privacy.POLICY_URL).pathname).toBe('/privacy/');
  });
});

describe('licencje (N-78)', () => {
  it('Ustawienia → Licencje: każda pozycja z listy, dotknięcie pokazuje pełny tekst', async () => {
    await openSettings();
    await press(await screen.findByRole('button', { name: 'Licencje' }));
    expect(await screen.findByTestId('screen-licenses')).toBeTruthy();
    for (const p of licenses.packages) expect(screen.getByTestId(`license-${p.name}`)).toBeTruthy();
    expect(screen.getByText(/^wersja [\d.]+ · domena publiczna$/)).toBeTruthy();
    await press(screen.getByTestId('license-react-native'));
    expect(await screen.findByTestId('screen-license')).toBeTruthy();
    expect(screen.getByTestId('license-text').props.children).toMatch(/^MIT License\n\nCopyright \(c\) Meta Platforms/);
  });
});
