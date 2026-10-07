/**
 * Ustawienia: odrzucone zmiany, wylogowanie, usunięcie konta (wymóg App Store 5.1.1(v), D5, D49)
 * z potwierdzeniem wpisaniem słowa — operacji nie da się cofnąć.
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { useAppData, useServices } from '../../app/context';
import type { RootStackParams } from '../../app/routes';
import { config } from '../../config';
import { strings } from '../../i18n/strings.pl';
import { BackButton, Body, Button, Field, NavRow, Screen, SectionTitle, Segmented, SyncChip, Title } from '../../ui/components';
import { useAppearance, useTheme } from '../../ui/theme';
import { useReminderSettings } from '../../app/reminders';

type Props = NativeStackScreenProps<RootStackParams, 'Settings'>;

export function SettingsScreen({ navigation }: Props) {
  const { account, nowMs } = useServices();
  const { appearance, setAppearance } = useAppearance();
  const reminders = useReminderSettings();
  const { state, indicator } = useAppData();
  const { c, font } = useTheme();
  const [deleting, setDeleting] = useState(false);
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const del = async () => {
    setBusy(true);
    setError(false);
    try {
      await account.deleteAccount();
    } catch {
      setError(true);
      setBusy(false);
    }
  };

  return (
    <Screen testID="screen-settings">
      <BackButton onPress={() => navigation.goBack()} />
      <Title>{strings['settings.title']}</Title>
      <SyncChip indicator={indicator} nowMs={nowMs()} />
      <Segmented
        label={strings['settings.appearance']}
        value={appearance}
        onChange={setAppearance}
        options={[
          { value: 'system', label: strings['settings.appearance.system'] },
          { value: 'light', label: strings['settings.appearance.light'] },
          { value: 'dark', label: strings['settings.appearance.dark'] },
        ]}
      />
      {reminders.available ? (
        <>
          <SectionTitle>{strings['reminders.section']}</SectionTitle>
          <Segmented
            label={strings['reminders.lead']}
            value={String(reminders.settings.leadMin)}
            onChange={(v) => reminders.setSettings({ ...reminders.settings, leadMin: Number(v) })}
            options={config.reminders.LEAD_OPTIONS.map((m) => ({ value: String(m), label: strings[`reminders.lead.${m}`] }))}
          />
          <Segmented
            label={strings['reminders.morning']}
            value={reminders.settings.morning}
            onChange={(v) => reminders.setSettings({ ...reminders.settings, morning: v })}
            options={config.reminders.MORNING_OPTIONS.map((m) => ({ value: m, label: m === 'off' ? strings['reminders.morning.off'] : m.replace(/^0/, '') }))}
          />
          <Body muted>{strings['reminders.info']}</Body>
        </>
      ) : null}
      <NavRow title={strings['settings.rejected']} subtitle={strings['settings.rejectedCount'](state.rejected.length)} onPress={() => navigation.navigate('Rejected')} testID="open-rejected" />
      <Button kind="secondary" label={strings['settings.signOut']} onPress={() => void account.signOut()} testID="sign-out" />
      <SectionTitle>{strings['settings.delete']}</SectionTitle>
      <Body muted>{strings['settings.deleteInfo'](config.sync.TOMBSTONE_DAYS)}</Body>
      {deleting ? (
        <View style={{ gap: 8 }}>
          <Field label={strings['settings.deleteType']} value={word} onChangeText={setWord} autoCapitalize="characters" testID="delete-word" />
          {error ? <Text accessibilityRole="alert" style={{ fontFamily: font.text700, color: c.danger }}>{`${strings['common.error']} ${strings['common.offlineOnly']}`}</Text> : null}
          <Button kind="danger" label={strings['settings.deleteConfirm']} disabled={busy || word.trim().toLocaleUpperCase('pl') !== strings['settings.deleteWord']} onPress={del} testID="delete-confirm" />
          <Button kind="secondary" label={strings['common.cancel']} onPress={() => (setDeleting(false), setWord(''))} />
        </View>
      ) : (
        <Button kind="danger" label={strings['settings.delete']} onPress={() => setDeleting(true)} testID="delete-start" />
      )}
    </Screen>
  );
}
