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
import { useDeviceCalendar } from '../../app/calendar-sync';
import { MuteSettings } from './MuteSettings';

type Props = NativeStackScreenProps<RootStackParams, 'Settings'>;

export function SettingsScreen({ navigation }: Props) {
  const { account, nowMs, displayName } = useServices();
  const { appearance, setAppearance } = useAppearance();
  const reminders = useReminderSettings();
  const calendar = useDeviceCalendar();
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
          <MuteSettings />
        </>
      ) : null}
      {calendar.available && calendar.status === 'granted' ? (
        <View testID="device-settings" style={{ gap: 10 }}>
          <SectionTitle>{strings['device.title']}</SectionTitle>
          <Segmented label={strings['device.read']} value={calendar.read ? 'on' : 'off'} onChange={(v) => calendar.setRead(v === 'on')} options={[{ value: 'on', label: strings['device.on'] }, { value: 'off', label: strings['device.off'] }]} />
          <Segmented label={strings['device.mirror']} value={calendar.mirror ? 'on' : 'off'} onChange={(v) => calendar.setMirror(v === 'on')} options={[{ value: 'on', label: strings['device.on'] }, { value: 'off', label: strings['device.off'] }]} />
          <Body muted>{strings['device.mirrorInfo']}</Body>
          {calendar.read && calendar.calendars.length ? (
            <View testID="device-calendars" style={{ gap: 10 }}>
              <Body muted>{strings['device.calendarsInfo']}</Body>
              {calendar.calendars.map((cal) => (
                <Segmented key={cal.id} label={cal.title} value={cal.read ? 'on' : 'off'} onChange={(v) => calendar.setCalendarRead(cal.id, v === 'on')} options={[{ value: 'on', label: strings['device.on'] }, { value: 'off', label: strings['device.off'] }]} />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
      <NavRow title={strings['name.title']} subtitle={displayName} onPress={() => navigation.navigate('Name', { from: 'settings' })} testID="open-name" />
      <NavRow title={strings['feedback.open']} onPress={() => navigation.navigate('Feedback')} testID="open-feedback" />
      <Button kind="secondary" label={strings['welcome.again']} testID="welcome-again" onPress={() => navigation.navigate('Welcome')} />
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
