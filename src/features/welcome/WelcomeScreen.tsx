/**
 * Pierwsze kroki (D79, ADR 0017): trzy krótkie ekrany o tym, co aplikacja robi, potem wybór startu — grupa rodzinna,
 * kod zaproszenia albo na razie samemu. Pokazywane raz na telefonie (prefs „welcomeSeen”); wrócić można z Ustawień.
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { useServices } from '../../app/context';
import type { RootStackParams } from '../../app/routes';
import { strings } from '../../i18n/strings.pl';
import { Body, Button, Screen, Title } from '../../ui/components';
import { useTheme } from '../../ui/theme';

type Props = NativeStackScreenProps<RootStackParams, 'Welcome'>;
export const WELCOME_SEEN = 'welcomeSeen';
const STEPS = 3;

export function WelcomeScreen({ navigation }: Props) {
  const { prefs } = useServices();
  const { c, font, size } = useTheme();
  const [step, setStep] = useState(0);
  const finish = (then?: () => void) => {
    prefs?.set(WELCOME_SEEN, '1').catch(() => {});
    navigation.goBack();
    then?.();
  };
  const dots = (
    <View accessibilityLabel={strings['welcome.progress'](Math.min(step + 1, STEPS + 1), STEPS + 1)} style={{ flexDirection: 'row', gap: 6, justifyContent: 'center' }}>
      {Array.from({ length: STEPS + 1 }, (_, i) => (
        <View key={i} style={{ width: i === step ? 22 : 8, height: 8, borderRadius: 4, backgroundColor: i === step ? c.inverseBg : c.border }} />
      ))}
    </View>
  );
  if (step < STEPS) {
    return (
      <Screen testID="screen-welcome">
        {dots}
        <Text accessibilityRole="header" style={{ fontFamily: font.display800, fontSize: 34, lineHeight: 38, color: c.ink, marginTop: 24 }}>
          {strings[`welcome.${step}.title` as 'welcome.0.title']}
        </Text>
        <Body>{strings[`welcome.${step}.body` as 'welcome.0.body']}</Body>
        <View style={{ padding: 16, borderRadius: 18, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }}>
          <Text style={{ fontFamily: font.text600, fontSize: size.BODY, color: c.inkMuted }}>{strings[`welcome.${step}.example` as 'welcome.0.example']}</Text>
        </View>
        <Button label={strings['welcome.next']} testID="welcome-next" onPress={() => setStep(step + 1)} />
        <Button kind="secondary" label={strings['welcome.skip']} testID="welcome-skip" onPress={() => setStep(STEPS)} />
      </Screen>
    );
  }
  return (
    <Screen testID="screen-welcome-start">
      {dots}
      <Title>{strings['welcome.start.title']}</Title>
      <Body muted>{strings['welcome.start.body']}</Body>
      <Button label={strings['welcome.start.family']} testID="welcome-family" onPress={() => finish(() => navigation.navigate('NewGroup', { name: strings['welcome.start.familyName'], starter: true }))} />
      <Button kind="secondary" label={strings['welcome.start.code']} testID="welcome-code" onPress={() => finish(() => navigation.navigate('Invite', {}))} />
      <Button kind="secondary" label={strings['welcome.start.alone']} testID="welcome-alone" onPress={() => finish()} />
    </Screen>
  );
}
