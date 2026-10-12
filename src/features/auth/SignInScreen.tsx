/**
 * Logowanie: jedyny ekran przed sesją. W becie tylko Sign in with Apple (decyzja właściciela 8.10.2026, D177 / audyt 2
 * M-77 — wbudowana wysyłka e-maili Supabase to 2 na godzinę na cały projekt). Logowanie linkiem z e-maila wróci razem
 * z własnym dostawcą wysyłki.
 * Audyt 3: zamknięcie okna Apple to nie błąd (N-73); brak sieci mówi o internecie; w trakcie logowania przycisk jest
 * przygaszony jak zajęty `Button` (wskaźnik postępu, „w toku” dla VoiceOvera), a drugie dotknięcie nic nie robi.
 * `notice` — jednorazowy komunikat, np. „Konto zostało usunięte.” (N-72).
 */
import * as AppleAuthentication from 'expo-apple-authentication';
import { useRef, useState } from 'react';
import { ActivityIndicator, Linking, View } from 'react-native';

import { config } from '../../config';
import { strings } from '../../i18n/strings.pl';
import { accountErrorCode, type AccountApi } from '../../sync/account';
import { Body, Button, ErrorText, Screen, StatusText, Title } from '../../ui/components';
import { useTheme } from '../../ui/theme';

export function SignInScreen({ account, notice }: { account: Pick<AccountApi, 'signInWithApple'>; notice?: string | null }) {
  const { size, scheme, line, c } = useTheme();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  const signIn = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      await account.signInWithApple();
    } catch (e) {
      const code = accountErrorCode(e);
      if (code === 'network') setError(`${strings['common.error']} ${strings['common.offlineOnly']}`);
      else if (code !== 'canceled') setError(strings['common.error']);
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  return (
    <Screen testID="screen-sign-in">
      <View style={{ flexDirection: 'row', gap: 6, marginTop: 40 }}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: line(i).line }} />
        ))}
      </View>
      <Title role="BRAND">{strings['auth.title']}</Title>
      {notice ? <StatusText>{notice}</StatusText> : null}
      <Body muted>{strings['auth.tagline']}</Body>
      <Body muted>{strings['auth.info']}</Body>
      <View style={{ opacity: busy ? 0.5 : 1 }}>
        <AppleAuthentication.AppleAuthenticationButton
          testID="apple-sign-in"
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
          buttonStyle={scheme === 'dark' ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
          cornerRadius={14}
          style={{ height: size.TOUCH_TARGET + 8 }}
          onPress={() => void signIn()}
        />
      </View>
      {/* „w toku” po polsku (bez accessibilityState.busy — RN dopisałby angielskie „busy”, src/ui/a11y.ts buttonA11y). */}
      {busy ? <ActivityIndicator testID="apple-sign-in-busy" accessible accessibilityLabel={strings['a11y.busy']} color={c.ink} /> : null}
      <Body muted>{strings['auth.appleOnly']}</Body>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {/* Audyt 3: raporty błędów (N-74, Q3 A) i polityka prywatności przed założeniem konta (N-75, Q4 A). */}
      <Body muted>{strings['auth.errorReports']}</Body>
      <Button kind="secondary" label={strings['privacy.open']} testID="sign-in-privacy" onPress={() => void Linking.openURL(config.privacy.POLICY_URL).catch(() => {})} />
    </Screen>
  );
}
