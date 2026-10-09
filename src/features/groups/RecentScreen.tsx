/**
 * Ostatnie zmiany (decyzja właściciela z 8.10.2026, audyt 2: PW-10 C+A, M-38; D194): moje zmiany z „Cofnij” (zapisane
 * w bazie konta — D194 b), „Cofnij” bez limitu czasu. Zmiany, których cofnięcie nie przeżyło zamknięcia aplikacji, zostają
 * z wyjaśnieniem. Rzecz zmieniona od tamtej chwili nie jest nadpisywana — wpis mówi
 * dlaczego. Wejście: Grupy (obok Kosza) i treść paska „Cofnij”.
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AccessibilityInfo, Text, View } from 'react-native';

import { localNow } from '../../domain/local-time';
import { useAppData } from '../../app/context';
import type { RootStackParams } from '../../app/routes';
import { config } from '../../config';
import { formatIsoDate } from '../../domain/civil-date';
import { formatDue } from '../../domain/format';
import { strings } from '../../i18n/strings.pl';
import { BackButton, Body, Button, Screen, Title } from '../../ui/components';
import { useTheme } from '../../ui/theme';
import { useUndo } from '../../ui/undo';

type Props = NativeStackScreenProps<RootStackParams, 'Recent'>;

export function RecentScreen({ navigation }: Props) {
  const { recent, undoRecent } = useUndo();
  const { today } = useAppData();
  const { c, font, size } = useTheme();
  const when = (ms: number) => {
    const l = localNow(ms);
    return formatDue({ date: formatIsoDate(l), time: `${String(l.hh).padStart(2, '0')}:${String(l.mm).padStart(2, '0')}` }, today).replace(' · ', ', ');
  };
  return (
    <Screen testID="screen-recent">
      <BackButton onPress={() => navigation.goBack()} />
      <Title>{strings['recent.title']}</Title>
      <Body muted>{recent.length ? strings['recent.info'](config.RECENT_MAX) : strings['recent.empty']}</Body>
      {recent.map((e) => (
        <View key={e.id} testID={`recent-${e.id}`} style={{ gap: 8, padding: 14, borderRadius: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }}>
          <Body>{e.message}</Body>
          <Text style={{ fontFamily: font.text400, fontSize: size.META, color: c.inkMuted }}>{when(e.at)}</Text>
          {e.state === 'undone' ? (
            <Text style={{ fontFamily: font.text700, fontSize: size.META, color: c.inkMuted }}>{strings['recent.undone']}</Text>
          ) : e.state === 'lost' ? (
            <Text style={{ fontFamily: font.text400, fontSize: size.META, color: c.inkMuted }}>{strings[`recent.lost.${e.lost ?? 'server'}`]}</Text>
          ) : e.state === 'stale' ? (
            <Text accessibilityRole="alert" style={{ fontFamily: font.text700, fontSize: size.META, color: c.danger }}>
              {strings['recent.stale']}
            </Text>
          ) : (
            <Button
              kind="secondary"
              label={strings['undo.action']}
              a11yLabel={strings['recent.undoA11y'](e.message)}
              testID={`recent-undo-${e.id}`}
              onPress={() => {
                const r = undoRecent(e.id);
                // Wynik od razu dla VoiceOvera (iOS nie ma regionów na żywo).
                AccessibilityInfo.announceForAccessibility(r === 'stale' ? strings['recent.stale'] : strings['recent.undone']);
              }}
            />
          )}
        </View>
      ))}
    </Screen>
  );
}
