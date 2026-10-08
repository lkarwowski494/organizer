/**
 * Pod polem szybkiego dodawania (Moje sprawy i lista zadań): chipy rozpoznanych fragmentów do odklikania (D18, D99),
 * zapowiedź wydarzenia przy zakresie godzin (audyt 2, M-256), nierozpoznany dzień (M-23) i błąd „nie ma czego dodać” (M-168).
 */
import { Text, View } from 'react-native';

import type { Fragment } from '../domain/quickadd';
import type { QuickPreview } from '../domain/views/quick-event';
import { strings } from '../i18n/strings.pl';
import { Body, TokenChip } from './components';
import { useTheme } from './theme';

export function QuickAddExtras({ preview, error, onUnclick }: { preview: Pick<QuickPreview, 'tokens' | 'event' | 'unrecognizedDay'>; error: string | null; onUnclick: (t: Fragment) => void }) {
  const { c, font } = useTheme();
  return (
    <>
      {preview.tokens.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {preview.tokens.map((t) => (
            <TokenChip key={`${t.start}-${t.end}`} text={t.text} onPress={() => onUnclick(t)} />
          ))}
        </View>
      ) : null}
      {preview.event ? <Body muted>{strings['quick.isEvent']}</Body> : null}
      {preview.unrecognizedDay ? <Body muted>{strings['quick.dayUnclear'](preview.unrecognizedDay.text)}</Body> : null}
      {error ? (
        <Text accessibilityRole="alert" style={{ fontFamily: font.text700, color: c.danger }}>
          {error}
        </Text>
      ) : null}
    </>
  );
}
