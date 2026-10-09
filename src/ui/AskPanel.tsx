/**
 * Pytanie w miejscu, pod polem dodawania: nagłówek, opcjonalny opis, odpowiedzi jako przyciski i „Anuluj”.
 * Jeden wygląd dla „Kogo masz na myśli: @al?” (D91) w Moich sprawach i w pełnym formularzu (audyt 2, M-170) oraz dla
 * nieznanego „@imię” (M-169) — taki sam jak panel adresata na liście (D68).
 */
import { View } from 'react-native';

import { strings } from '../i18n/strings.pl';
import { Body, Button, PanelTitle } from './components';
import { spoken } from './a11y';
import { useTheme } from './theme';

export type AskOption = { key: string; label: string; onPress: () => void };

export function AskPanel({ testID, title, body, options, onCancel }: { testID: string; title: string; body?: string; options: AskOption[]; onCancel: () => void }) {
  const { c } = useTheme();
  return (
    <View testID={testID} style={{ gap: 8, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface }}>
      <PanelTitle>{title}</PanelTitle>
      {body ? <Body muted>{body}</Body> : null}
      {options.map((o) => (
        // Audyt 2 (M-263): „Ala · Rodzina” — VoiceOver czyta przecinek, nie kropkę.
        <Button key={o.key} kind="secondary" label={o.label} a11yLabel={spoken(o.label)} onPress={o.onPress} />
      ))}
      <Button kind="secondary" label={strings['common.cancel']} onPress={onCancel} />
    </View>
  );
}
