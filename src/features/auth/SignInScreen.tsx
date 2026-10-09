/**
 * Logowanie: jedyny ekran przed sesją. W becie tylko Sign in with Apple (decyzja właściciela 8.10.2026, D177 / audyt 2
 * M-77 — wbudowana wysyłka e-maili Supabase to 2 na godzinę na cały projekt). Logowanie linkiem z e-maila wróci razem
 * z własnym dostawcą wysyłki.
 * `notice` — jednorazowy komunikat, np. „Konto zostało usunięte.” po usunięciu konta (audyt 3, N-72).
 */
import * as AppleAuthentication from 'expo-apple-authentication';
import { useState } from 'react';
import { View } from 'react-native';

import { strings } from '../../i18n/strings.pl';
import type { AccountApi } from '../../sync/account';
import { Body, ErrorText, Screen, StatusText, Title } from '../../ui/components';
import { useTheme } from '../../ui/theme';

export function SignInScreen({ account, notice }: { account: Pick<AccountApi, 'signInWithApple'>; notice?: string | null }) {
  const { size, scheme, line } = useTheme();
  const [error, setError] = useState<string | null>(null);

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
      <AppleAuthentication.AppleAuthenticationButton
        testID="apple-sign-in"
        buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
        buttonStyle={scheme === 'dark' ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
        cornerRadius={14}
        style={{ height: size.TOUCH_TARGET + 8 }}
        onPress={() => void account.signInWithApple().catch(() => setError(strings['common.error']))}
      />
      <Body muted>{strings['auth.appleOnly']}</Body>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Screen>
  );
}
