import { StatusBar } from 'expo-status-bar';
import { Text, View } from 'react-native';

import { strings } from './src/i18n/strings.pl';

// Tymczasowo: szkielet do czasu podłączenia sesji i synchronizacji (następny commit, src/app/Root.tsx).
export default function App() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text accessibilityRole="header">{strings['app.name']}</Text>
      <StatusBar style="auto" />
    </View>
  );
}
