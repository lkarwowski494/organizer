/**
 * Pytanie w miejscu, pod polem dodawania: nagłówek, opcjonalny opis, odpowiedzi jako przyciski i „Anuluj”.
 * Jeden wygląd dla „Kogo masz na myśli: @al?” (D91) w Moich sprawach i w pełnym formularzu (audyt 2, M-170) oraz dla
 * nieznanego „@imię” (M-169) — taki sam jak panel adresata na liście (D68).
 */
import { Text, View } from 'react-native';

import { strings } from '../i18n/strings.pl';
import { Body, Button } from './components';
import { useTheme } from './theme';

export type AskOption = { key: string; label: string; onPress: () => void };

export function AskPanel({ testID, title, body, options, onCancel }: { testID: string; title: string; body?: string; options: AskOption[]; onCancel: () => void }) {
  const { c, font } = useTheme();
  return (
    <View testID={testID} style={{ gap: 8, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface }}>
      <Text accessibilityRole="header" style={{ fontFamily: font.text700, fontSize: 17, color: c.ink }}>
        {title}
      </Text>
      {body ? <Body muted>{body}</Body> : null}
      {options.map((o) => (
        <Button key={o.key} kind="secondary" label={o.label} onPress={o.onPress} />
      ))}
      <Button kind="secondary" label={strings['common.cancel']} onPress={onCancel} />
    </View>
  );
}
