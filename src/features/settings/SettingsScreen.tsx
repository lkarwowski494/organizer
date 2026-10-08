/**
 * Ustawienia (D131): strona główna z podstronami — Powiadomienia, Kalendarz i dojazd, Wygląd, Konto i dane.
 * Konto i dane: imię, odrzucone zmiany, wylogowanie (z potwierdzeniem), wyczyszczenie danych offline, usunięcie konta
 * (wymóg App Store 5.1.1(v), D5, D49) z potwierdzeniem wpisaniem słowa — operacji nie da się cofnąć.
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { useAppData, useServices } from '../../app/context';
import type { RootStackParams, SettingsSection } from '../../app/routes';
import { config } from '../../config';
import { strings } from '../../i18n/strings.pl';
import { BackButton, Body, Button, Field, NavRow, Screen, SectionTitle, Segmented, SyncChip, Title } from '../../ui/components';
import { useAppearance, useTheme } from '../../ui/theme';
import { useReminderSettings } from '../../app/reminders';
import { useDeviceCalendar } from '../../app/calendar-sync';
import { useTravel } from '../../app/travel';
import { TRAVEL_MODES } from '../../domain/travel';
import { MuteSettings } from './MuteSettings';

type Props = NativeStackScreenProps<RootStackParams, 'Settings'>;
const SECTIONS: readonly SettingsSection[] = ['notifications', 'calendar', 'appearance', 'account'];

export function SettingsScreen({ navigation, route }: Props) {
  const section = route.params?.section;
  const { account, nowMs, displayName, resetLocal } = useServices();
  const [resetting, setResetting] = useState(false);
  const { appearance, setAppearance } = useAppearance();
  const reminders = useReminderSettings();
  const calendar = useDeviceCalendar();
  const travel = useTravel();
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

  const signOut = () =>
    Alert.alert(strings['settings.signOutAsk'], strings['settings.signOutInfo'], [
      { text: strings['common.cancel'], style: 'cancel' },
      { text: strings['settings.signOut'], style: 'destructive', onPress: () => void account.signOut() },
    ]);
  const open = (s: SettingsSection) => navigation.push('Settings', { section: s });

  if (!section) {
    return (
      <Screen testID="screen-settings">
        <BackButton onPress={() => navigation.goBack()} />
        <Title>{strings['settings.title']}</Title>
        <SyncChip indicator={indicator} nowMs={nowMs()} />
        {SECTIONS.map((s) => (
          <NavRow key={s} title={strings[`settings.section.${s}`]} onPress={() => open(s)} testID={`settings-${s}`} />
        ))}
        <NavRow title={strings['feedback.open']} onPress={() => navigation.navigate('Feedback')} testID="open-feedback" />
        <Button kind="secondary" label={strings['welcome.again']} testID="welcome-again" onPress={() => navigation.navigate('Welcome')} />
      </Screen>
    );
  }

  return (
    <Screen testID={`screen-settings-${section}`}>
      <BackButton onPress={() => navigation.goBack()} />
      <Title>{strings[`settings.section.${section}`]}</Title>
      {section === 'appearance' ? (
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
      ) : null}
      {section === 'notifications' ? (
        reminders.available ? (
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
        ) : (
          <Body muted>{strings['settings.notificationsUnavailable']}</Body>
        )
      ) : null}
      {section === 'calendar' ? (
        <>
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
          <SectionTitle>{strings['travel.section']}</SectionTitle>
          <View testID="travel-settings" style={{ gap: 10 }}>
            <Segmented label={strings['travel.navApp']} value={travel.navApp} onChange={travel.setNavApp} options={[{ value: 'apple', label: strings['travel.apple'] }, { value: 'google', label: strings['travel.google'] }]} />
            {travel.available ? (
              <>
                <Segmented label={strings['travel.enabled']} value={travel.enabled ? 'on' : 'off'} onChange={(v) => void travel.setEnabled(v === 'on')} options={[{ value: 'on', label: strings['travel.on'] }, { value: 'off', label: strings['travel.off'] }]} />
                {travel.status === 'denied' ? <Body muted>{strings['travel.denied']}</Body> : null}
                <Segmented label={strings['travel.defaultMode']} value={travel.mode} onChange={travel.setMode} options={TRAVEL_MODES.map((m) => ({ value: m, label: strings[`travel.option.${m}`] }))} />
                <Body muted>{strings['travel.info']}</Body>
              </>
            ) : null}
          </View>
        </>
      ) : null}
      {section === 'account' ? (
        <>
          <NavRow title={strings['name.title']} subtitle={displayName} onPress={() => navigation.navigate('Name', { from: 'settings' })} testID="open-name" />
          <NavRow title={strings['settings.rejected']} subtitle={strings['settings.rejectedCount'](state.rejected.length)} onPress={() => navigation.navigate('Rejected')} testID="open-rejected" />
          <Button kind="secondary" label={strings['settings.signOut']} onPress={signOut} testID="sign-out" />
          {resetLocal ? (
            <View testID="reset-local" style={{ gap: 8 }}>
              <SectionTitle>{strings['reset.title']}</SectionTitle>
              <Body muted>{strings['reset.info']}</Body>
              {resetting ? (
                <>
                  {state.pending.length ? <Body>{strings['reset.pending'](state.pending.length)}</Body> : null}
                  {/* Bez połączenia telefon zostałby pusty do powrotu sieci (audyt 8.10.2026). */}
                  {indicator.state === 'offline' || indicator.state === 'auth_expired' ? <Body>{strings['reset.offline']}</Body> : null}
                  <Button kind="danger" label={strings['reset.confirm']} testID="reset-confirm" disabled={indicator.state === 'offline' || indicator.state === 'auth_expired'} onPress={() => (setResetting(false), resetLocal(), navigation.popToTop())} />
                  <Button kind="secondary" label={strings['common.cancel']} onPress={() => setResetting(false)} />
                </>
              ) : (
                <Button kind="secondary" label={strings['reset.start']} testID="reset-start" onPress={() => setResetting(true)} />
              )}
            </View>
          ) : null}
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
        </>
      ) : null}
    </Screen>
  );
}
