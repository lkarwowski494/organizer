/**
 * Pierwsze kroki (D79, ADR 0017): trzy krótkie ekrany o tym, co aplikacja robi, potem wybór startu — grupa rodzinna,
 * kod zaproszenia albo na razie samemu. Pokazywane raz dla konta (prefs „welcomeSeen”, D175); wrócić można z Ustawień.
 * Kto ma już grupę wspólną (nowy telefon, „Pokaż wprowadzenie”), nie dostaje wyboru startu — inaczej mógłby założyć drugą
 * „Rodzinę” (decyzja właściciela 8.10.2026, PWD-20 A / audyt 2 M-289).
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { useAppData, useServices } from '../../app/context';
import { groupsView } from '../../domain/views';
import type { RootStackParams } from '../../app/routes';
import { strings } from '../../i18n/strings.pl';
import { useA11yFocus } from '../../ui/a11y';
import { Body, Button, Card, Screen, Title, titleScale } from '../../ui/components';
import { useTheme } from '../../ui/theme';

type Props = NativeStackScreenProps<RootStackParams, 'Welcome'>;
export const WELCOME_SEEN = 'welcomeSeen';
const STEPS = 3;

export function WelcomeScreen({ navigation }: Props) {
  const { prefs, userId } = useServices();
  const { tables } = useAppData();
  const { c, font, size, fontScale } = useTheme();
  const [step, setStep] = useState(0);
  const hasShared = groupsView(tables, userId).some((g) => g.kind === 'shared');
  const pages = hasShared ? STEPS : STEPS + 1;
  // Audyt 2 (M-44): „Dalej” podmienia treść tego samego ekranu — fokus VoiceOvera na nowy nagłówek.
  const header = useA11yFocus<Text>(step, step > 0);
  const finish = (then?: () => void) => {
    prefs?.set(WELCOME_SEEN, '1').catch(() => {});
    navigation.goBack();
    then?.();
  };
  const dots = (
    // Audyt 2 (M-143): kropki jako jeden element VoiceOvera („Krok 1 z 4”) — etykieta zwykłego widoku nie jest czytana;
    // nieaktywne w kolorze obramowania pól (control), widoczne na tle (border prawie znikał).
    <View accessible accessibilityRole="text" accessibilityLabel={strings['welcome.progress'](Math.min(step + 1, pages), pages)} testID="welcome-progress" style={{ flexDirection: 'row', gap: 6, justifyContent: 'center' }}>
      {Array.from({ length: pages }, (_, i) => (
        <View key={i} style={{ width: i === step ? 22 : 8, height: 8, borderRadius: 4, backgroundColor: i === step ? c.inverseBg : c.control }} />
      ))}
    </View>
  );
  if (step < STEPS) {
    return (
      <Screen testID="screen-welcome">
        {dots}
        <Text ref={header} accessibilityRole="header" maxFontSizeMultiplier={titleScale(size.INTRO)} style={{ fontFamily: font.display800, fontSize: size.INTRO, lineHeight: size.INTRO * fontScale.TITLE_LEADING, color: c.ink, marginTop: 24 }}>
          {strings[`welcome.${step}.title` as 'welcome.0.title']}
        </Text>
        <Body>{strings[`welcome.${step}.body` as 'welcome.0.body']}</Body>
        <Card>
          <Text style={{ fontFamily: font.text600, fontSize: size.BODY, color: c.inkMuted }}>{strings[`welcome.${step}.example` as 'welcome.0.example']}</Text>
        </Card>
        {hasShared && step === STEPS - 1 ? (
          <Button label={strings['welcome.done']} testID="welcome-done" onPress={() => finish()} />
        ) : (
          <Button label={strings['welcome.next']} testID="welcome-next" onPress={() => setStep(step + 1)} />
        )}
        <Button kind="secondary" label={strings['welcome.skip']} testID="welcome-skip" onPress={() => (hasShared ? finish() : setStep(STEPS))} />
      </Screen>
    );
  }
  return (
    <Screen testID="screen-welcome-start">
      {dots}
      <Title a11yFocus>{strings['welcome.start.title']}</Title>
      <Body muted>{strings['welcome.start.body']}</Body>
      <Button label={strings['welcome.start.family']} testID="welcome-family" onPress={() => finish(() => navigation.navigate('NewGroup', { name: strings['welcome.start.familyName'], starter: true }))} />
      <Button kind="secondary" label={strings['welcome.start.code']} testID="welcome-code" onPress={() => finish(() => navigation.navigate('Invite', {}))} />
      <Button kind="secondary" label={strings['welcome.start.alone']} testID="welcome-alone" onPress={() => finish()} />
    </Screen>
  );
}
