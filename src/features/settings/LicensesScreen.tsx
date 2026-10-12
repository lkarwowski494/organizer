/**
 * Ustawienia → Licencje (audyt 3, N-78; decyzja Q22 A): biblioteki i kroje pisma z paczki aplikacji z pełnym tekstem
 * licencji — MIT, BSD i SIL OFL wymagają dołączenia informacji o prawach autorów do każdej kopii. Lista bez sieci,
 * z pliku src/licenses/third-party.json (generuje go scripts/licenses/gen-licenses.mjs z prawdziwej paczki iOS).
 * Bez `name` (nazwa@wersja) — lista; z `name` — tekst licencji jednej pozycji.
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParams } from '../../app/routes';
import { strings } from '../../i18n/strings.pl';
import licenses from '../../licenses/third-party.json';
import { BackButton, Body, NavRow, Screen, Title } from '../../ui/components';

type Props = NativeStackScreenProps<RootStackParams, 'Licenses'>;
const texts = licenses.texts as Record<string, string>;
const meta = (p: (typeof licenses.packages)[number]) => strings['licenses.meta'](p.version, p.license === 'blessing' ? strings['licenses.publicDomain'] : p.license);

export function LicensesScreen({ navigation, route }: Props) {
  const name = route.params?.name;
  const p = licenses.packages.find((x) => `${x.name}@${x.version}` === name);
  if (!p) {
    return (
      <Screen testID="screen-licenses">
        <BackButton onPress={() => navigation.goBack()} />
        <Title>{strings['licenses.title']}</Title>
        <Body muted>{strings['licenses.info']}</Body>
        {licenses.packages.map((x) => (
          <NavRow key={`${x.name}@${x.version}`} title={x.name} subtitle={meta(x)} onPress={() => navigation.push('Licenses', { name: `${x.name}@${x.version}` })} testID={`license-${x.name}`} />
        ))}
      </Screen>
    );
  }
  return (
    <Screen testID="screen-license">
      <BackButton onPress={() => navigation.goBack()} />
      <Title>{p.name}</Title>
      <Body muted>{meta(p)}</Body>
      <Body testID="license-text">{texts[p.text]}</Body>
    </Screen>
  );
}
