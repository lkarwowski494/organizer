// Tylko używane odmiany (src/ui/theme.tsx fontFamily); import z indeksu pakietu dołączyłby wszystkie 26 plików.
import { AtkinsonHyperlegibleNext_400Regular } from '@expo-google-fonts/atkinson-hyperlegible-next/400Regular';
import { AtkinsonHyperlegibleNext_600SemiBold } from '@expo-google-fonts/atkinson-hyperlegible-next/600SemiBold';
import { AtkinsonHyperlegibleNext_700Bold } from '@expo-google-fonts/atkinson-hyperlegible-next/700Bold';
import { BricolageGrotesque_700Bold } from '@expo-google-fonts/bricolage-grotesque/700Bold';
import { BricolageGrotesque_800ExtraBold } from '@expo-google-fonts/bricolage-grotesque/800ExtraBold';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';

import { registerWakeTask } from './src/app/background';
import { Root } from './src/app/Root';
import { appDeps } from './src/app/wiring';

// ADR-0045: ekran startowy iOS zostaje, dopóki nakładka animacji (src/ui/Intro.tsx) nie narysuje tej samej klatki — Root
// chowa go sam (deps.intro.hideSplash). expo-splash-screen 57 (JSDoc preventAutoHideAsync, https://docs.expo.dev/versions/v57.0.0/sdk/splash-screen/):
// „It is recommended to call this in global scope without awaiting, rather than inside React components or hooks”.
void SplashScreen.preventAutoHideAsync().catch(() => {});

const deps = appDeps();
// D159: zadanie cichego powiadomienia — w zasięgu modułu, zanim iOS przekaże powiadomienie (dokumentacja SDK 57).
registerWakeTask(deps);

export default function App() {
  const [fontsLoaded] = useFonts({
    BricolageGrotesque_700Bold,
    BricolageGrotesque_800ExtraBold,
    AtkinsonHyperlegibleNext_400Regular,
    AtkinsonHyperlegibleNext_600SemiBold,
    AtkinsonHyperlegibleNext_700Bold,
  });
  return (
    // Pasek stanu rysuje ThemeProvider (styl według trybu aplikacji, audyt 2 M-139).
    <Root deps={deps} fontsLoaded={fontsLoaded} />
  );
}
