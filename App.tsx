import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

import { strings } from './src/i18n/strings.pl';

export default function App() {
  return (
    <View style={styles.container}>
      <Text accessibilityRole="header">{strings['app.name']}</Text>
      <Text>{strings['app.placeholder']}</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
});
