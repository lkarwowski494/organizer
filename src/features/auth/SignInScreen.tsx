/** Logowanie (D5): Sign in with Apple albo link na e-mail (magic link). Jedyny ekran przed sesją. */
import * as AppleAuthentication from 'expo-apple-authentication';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { strings } from '../../i18n/strings.pl';
import type { AccountApi } from '../../sync/account';
import { Body, Button, Field, Screen } from '../../ui/components';
import { useTheme } from '../../ui/theme';

// Wystarczająco ścisłe dla formularza (jedna „@”, kropka w domenie, bez spacji); ostatecznie sprawdza serwer.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SignInScreen({ account }: { account: Pick<AccountApi, 'signInWithApple' | 'sendMagicLink'> }) {
  const { c, font, size, scheme, line } = useTheme();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    const e = email.trim();
    if (!EMAIL.test(e)) return setError(strings['auth.invalidEmail']);
    setError(null);
    try {
      await account.sendMagicLink(e);
      setSent(e);
    } catch {
      setError(strings['common.error']);
    }
  };

  return (
    <Screen testID="screen-sign-in">
      <View style={{ flexDirection: 'row', gap: 6, marginTop: 40 }}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: line(i).line }} />
        ))}
      </View>
      <Text accessibilityRole="header" style={{ fontFamily: font.display800, fontSize: 48, letterSpacing: -1.5, color: c.ink }}>{strings['auth.title']}</Text>
      <Body muted>{strings['auth.tagline']}</Body>
      <AppleAuthentication.AppleAuthenticationButton
        testID="apple-sign-in"
        buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
        buttonStyle={scheme === 'dark' ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
        cornerRadius={14}
        style={{ height: size.TOUCH_TARGET + 8 }}
        onPress={() => void account.signInWithApple().catch(() => setError(strings['common.error']))}
      />
      <Text style={{ textAlign: 'center', fontFamily: font.text600, color: c.inkMuted }}>{strings['auth.or']}</Text>
      <Field label={strings['auth.email']} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" testID="email" />
      <Button label={strings['auth.sendLink']} onPress={send} testID="send-link" />
      {sent ? <Body>{strings['auth.linkSent'](sent)}</Body> : null}
      {error ? <Text accessibilityRole="alert" style={{ fontFamily: font.text700, color: c.danger }}>{error}</Text> : null}
    </Screen>
  );
}
