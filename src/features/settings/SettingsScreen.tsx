/**
 * Ustawienia (D131): strona główna z podstronami — Powiadomienia, Kalendarz i dojazd, Wygląd, Dodawanie (grupa domyślna,
 * audyt 2 M-24), Konto i dane.
 * Konto i dane: imię, odrzucone zmiany, wylogowanie (z potwierdzeniem), wyczyszczenie danych offline, usunięcie konta
 * (wymóg App Store 5.1.1(v), D5, D49) z potwierdzeniem wpisaniem słowa — operacji nie da się cofnąć.
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { useAppData, useServices } from '../../app/context';
import type { RootStackParams, SettingsSection } from '../../app/routes';
import { config } from '../../config';
import { strings } from '../../i18n/strings.pl';
import { BackButton, Body, Button, ErrorText, Field, NavRow, Screen, SectionTitle, Segmented, SwitchRow, SyncChip, Title } from '../../ui/components';
import { useAppearance } from '../../ui/theme';
import { useReminderSettings } from '../../app/reminders';
import { useDeviceCalendar } from '../../app/calendar-sync';
import { CAL_ASKED } from '../calendar/DeviceCalendarCard';
import { useTravel } from '../../app/travel';
import { TRAVEL_MODES } from '../../domain/travel';
import { MuteSettings } from './MuteSettings';
import { useDefaultGroup } from '../../app/default-group';
import { LAST_USED } from '../../domain/views/default-group';
import { quickGroups } from '../../domain/views/quick-target';
import { pendingCount } from '../../domain/sync-engine/client';

type Props = NativeStackScreenProps<RootStackParams, 'Settings'>;
const SECTIONS: readonly SettingsSection[] = ['notifications', 'calendar', 'appearance', 'adding', 'account'];

export function SettingsScreen({ navigation, route }: Props) {
  const section = route.params?.section;
  const { account, nowMs, displayName, resetLocal, signInAgain, userId, emailOnly, prefs } = useServices();
  const [resetting, setResetting] = useState(false);
  const { appearance, setAppearance } = useAppearance();
  const reminders = useReminderSettings();
  const calendar = useDeviceCalendar();
  const travel = useTravel();
  const { state, indicator, tables } = useAppData();
  // Audyt 2 (M-166): zmiany naprawdę czekające na serwer (bez wysłanych, które czekają już tylko na pobranie).
  const pending = pendingCount(state);
  // M-24 (decyzja właściciela 8.10.2026): „Grupa domyślna” — skąd startuje chip przy polu dodawania w Moich sprawach.
  const defaultGroup = useDefaultGroup();
  const addGroups = quickGroups(tables, userId, strings['groups.personal']);
  // Ustawionej grupy już nie ma — działa (i widać) „Ostatnio użyta”, jak w startGroup.
  const defaultValue = addGroups.some((g) => g.id === defaultGroup.setting) ? defaultGroup.setting : LAST_USED;
  const [deleting, setDeleting] = useState(false);
  const [word, setWord] = useState('');
  const [wordError, setWordError] = useState(false);
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
    Alert.alert(
      strings['settings.signOutAsk'],
      [
        strings['settings.signOutInfo'],
        indicator.state === 'offline' ? strings['settings.signOutOffline'] : null,
        pending ? strings['settings.signOutPending'](pending) : null,
        emailOnly ? strings['settings.signOutEmail'] : null,
      ]
        .filter(Boolean)
        .join('\n\n'),
      [
        { text: strings['common.cancel'], style: 'cancel' },
        { text: strings['settings.signOut'], style: 'destructive', onPress: () => void account.signOut().catch(() => {}) },
      ],
    );
  const open = (s: SettingsSection) => navigation.push('Settings', { section: s });
  // Bez połączenia z serwerem (offline z NetInfo, wygasła sesja albo ostatnie żądanie nie doszło — captive portal, M-10)
  // wyczyszczony telefon zostałby pusty do powrotu sieci.
  const noServer = indicator.state === 'offline' || indicator.state === 'auth_expired' || (indicator.state === 'error' && indicator.error === 'network');

  if (!section) {
    return (
      <Screen testID="screen-settings">
        <BackButton onPress={() => navigation.goBack()} />
        <Title>{strings['settings.title']}</Title>
        <SyncChip indicator={indicator} nowMs={nowMs()} />
        {/* Audyt 2, M-9: wskaźnik tylko informuje (PW-28) — tu jest droga do ponownego logowania, gdy sesja nie dała się odświeżyć. */}
        {indicator.state === 'auth_expired' && signInAgain ? (
          <View testID="auth-expired" style={{ gap: 8 }}>
            <Body>{strings['auth.expiredInfo']}</Body>
            {/* D177: konto bez Apple — po wylogowaniu nie da się do niego wrócić; to samo ostrzeżenie co przy „Wyloguj”. */}
            {emailOnly ? <Body>{strings['settings.signOutEmail']}</Body> : null}
            <Button label={strings['sync.authExpired']} testID="sign-in-again" onPress={signInAgain} />
          </View>
        ) : null}
        {SECTIONS.filter((s) => s !== 'adding' || defaultGroup.available).map((s) => (
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
          label={strings['settings.section.appearance']}
          value={appearance}
          onChange={setAppearance}
          options={[
            { value: 'system', label: strings['settings.appearance.system'] },
            { value: 'light', label: strings['settings.appearance.light'] },
            { value: 'dark', label: strings['settings.appearance.dark'] },
          ]}
        />
      ) : null}
      {section === 'adding' ? (
        <>
          <Segmented
            label={strings['defaultGroup.setting']}
            value={defaultValue}
            onChange={defaultGroup.setSetting}
            options={[{ value: LAST_USED, label: strings['defaultGroup.last'] }, ...addGroups.map((g) => ({ value: g.id, label: g.name }))]}
          />
          <Body muted>{strings['defaultGroup.info']}</Body>
        </>
      ) : null}
      {section === 'notifications' ? (
        reminders.available ? (
          <>
            {/* Audyt 2 (N-8, P-5): po „Nie teraz” albo odmowie w oknie systemowym — droga do powiadomień jest tu. */}
            {reminders.status === 'undetermined' ? (
              <View testID="push-access" style={{ gap: 8 }}>
                <Body>{strings['push.off']}</Body>
                <Button label={strings['push.enable']} testID="settings-push-enable" onPress={() => void reminders.enable()} />
              </View>
            ) : reminders.status === 'denied' ? (
              <View testID="push-access" style={{ gap: 8 }}>
                <Body>{strings['push.denied']}</Body>
                <Button label={strings['push.openSettings']} testID="settings-push-open" onPress={reminders.openSettings} />
              </View>
            ) : null}
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
              options={config.reminders.MORNING_OPTIONS.map((m) => ({ value: m, label: m === 'off' ? strings['common.off'] : m }))}
            />
            {/* M-308 (PWD-39 A): włącz/wyłącz — systemowy przełącznik w wierszu. */}
            <SwitchRow label={strings['reminders.leave']} value={reminders.settings.leave !== false} onChange={(on) => reminders.setSettings({ ...reminders.settings, leave: on })} testID="switch-reminders-leave" />
            <Body muted>{strings['reminders.leaveInfo']}</Body>
            <Body muted>{strings['reminders.info']}</Body>
            <MuteSettings />
          </>
        ) : (
          <Body muted>{strings['settings.notificationsUnavailable']}</Body>
        )
      ) : null}
      {section === 'calendar' ? (
        <>
          {/* Audyt 2 (M-33, M-217): po „Nie teraz”, przy zgodzie tylko na dodawanie albo odmowie — droga do połączenia jest tu. */}
          {calendar.available && calendar.status !== null && calendar.status !== 'granted' ? (
            <View testID="device-access" style={{ gap: 8 }}>
              <SectionTitle>{strings['device.title']}</SectionTitle>
              {calendar.mirrorStale ? <Body testID="device-mirror-stale">{strings['device.mirrorStale']}</Body> : null}
              <Body muted>{calendar.status === 'denied' ? strings['device.denied'] : calendar.status === 'writeOnly' ? strings['device.writeOnly'] : strings['device.body']}</Body>
              {calendar.status === 'denied' ? (
                <Button label={strings['push.openSettings']} testID="settings-calendar-open" onPress={calendar.openSettings} />
              ) : (
                // Audyt 3 (N-185): połączenie stąd też kończy zaproszenie w Kalendarzu (jak „Połącz” na karcie).
                <Button label={strings['device.connect']} testID="settings-calendar-connect" onPress={() => void calendar.connect().then((ok) => void (ok && prefs?.set(CAL_ASKED, '1').catch(() => {})))} />
              )}
            </View>
          ) : null}
          {calendar.available && calendar.status === 'granted' ? (
            <View testID="device-settings" style={{ gap: 10 }}>
              <SectionTitle>{strings['device.title']}</SectionTitle>
              <SwitchRow label={strings['device.read']} value={calendar.read} onChange={calendar.setRead} testID="switch-device-read" />
              <SwitchRow label={strings['device.mirror']} value={calendar.mirror} onChange={calendar.setMirror} testID="switch-device-mirror" />
              {calendar.mirrorFailed ? <ErrorText>{strings['device.mirrorFailed']}</ErrorText> : null}
              <Body muted>{strings['device.mirrorInfo']}</Body>
              {calendar.tablet ? <Body muted>{strings['device.mirrorTablet']}</Body> : null}
              {/* D174: wybór grup w lustrze (w bazie konta). */}
              {calendar.mirror && calendar.groups.length ? (
                <View testID="device-mirror-groups" style={{ gap: 10 }}>
                  <Body muted>{strings['device.mirrorGroups']}</Body>
                  {calendar.groups.map((g) => (
                    <SwitchRow key={g.id} label={g.name} value={g.mirrored} onChange={(on) => calendar.setGroupMirrored(g.id, on)} testID={`switch-mirror-${g.id}`} />
                  ))}
                </View>
              ) : null}
              {calendar.read && calendar.calendars.length ? (
                <View testID="device-calendars" style={{ gap: 10 }}>
                  <Body muted>{strings['device.calendarsInfo']}</Body>
                  {calendar.calendars.map((cal) => (
                    <SwitchRow key={cal.id} label={cal.title} value={cal.read} onChange={(on) => calendar.setCalendarRead(cal.id, on)} testID={`switch-calendar-${cal.id}`} />
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}
          {/* „Nawiguj” otwiera zawsze Mapy Apple (ADR 0043) — bez wyboru aplikacji; sekcja tylko z czasem dojazdu. */}
          {travel.available ? (
            <>
              <SectionTitle>{strings['travel.section']}</SectionTitle>
              <View testID="travel-settings" style={{ gap: 10 }}>
                <SwitchRow label={strings['travel.enabled']} value={travel.enabled} onChange={(on) => void travel.setEnabled(on)} testID="switch-travel" />
                {/* Audyt 3 (N-56): odmowa — iOS nie zapyta drugi raz, więc droga do Ustawień iPhone'a (jak kalendarz i powiadomienia). */}
                {travel.status === 'denied' ? (
                  <>
                    <Body muted>{strings['travel.denied']}</Body>
                    <Button label={strings['push.openSettings']} testID="settings-travel-open" onPress={travel.openSettings} />
                  </>
                ) : null}
                {/* M-218: „Pozwól raz” wygasło — włączony dojazd bez zgody nic nie liczy. */}
                {travel.enabled && travel.status === 'undetermined' ? (
                  <View testID="travel-permission" style={{ gap: 8 }}>
                    <Body muted>{strings['travel.needsPermission']}</Body>
                    <Button kind="secondary" label={strings['travel.allow']} testID="settings-travel-allow" onPress={() => void travel.requestPermission()} />
                  </View>
                ) : null}
                <Segmented label={strings['travel.defaultMode']} value={travel.mode} onChange={travel.setMode} options={TRAVEL_MODES.map((m) => ({ value: m, label: strings[`travel.option.${m}`] }))} />
                <Body muted>{strings['travel.info']}</Body>
              </View>
            </>
          ) : null}
        </>
      ) : null}
      {section === 'account' ? (
        <>
          <NavRow title={strings['name.title']} subtitle={displayName} onPress={() => navigation.navigate('Name', { from: 'settings' })} testID="open-name" />
          <NavRow title={strings['rejected.title']} subtitle={strings['settings.rejectedCount'](state.rejected.length)} onPress={() => navigation.navigate('Rejected')} testID="open-rejected" />
          <Button kind="danger" label={strings['settings.signOut']} onPress={signOut} testID="sign-out" />
          {resetLocal ? (
            <View testID="reset-local" style={{ gap: 8 }}>
              <SectionTitle>{strings['reset.title']}</SectionTitle>
              <Body muted>{strings['reset.info']}</Body>
              {resetting ? (
                <>
                  {pending ? <Body>{strings['reset.pending'](pending)}</Body> : null}
                  {/* Bez połączenia telefon zostałby pusty do powrotu sieci (audyt 8.10.2026), a po upgrade_required — na stałe (audyt 2, M-57). */}
                  {noServer ? <Body>{strings['reset.offline']}</Body> : null}
                  {indicator.state === 'upgrade_required' ? <Body>{strings['reset.upgrade']}</Body> : null}
                  <Button kind="danger" label={strings['reset.confirm']} testID="reset-confirm" a11yFocus disabled={noServer || indicator.state === 'upgrade_required'} onPress={() => (setResetting(false), resetLocal(), navigation.popToTop())} />
                  <Button kind="secondary" label={strings['common.cancel']} onPress={() => setResetting(false)} />
                </>
              ) : (
                <Button kind="danger" label={strings['reset.start']} testID="reset-start" onPress={() => setResetting(true)} />
              )}
            </View>
          ) : null}
          <SectionTitle>{strings['settings.delete']}</SectionTitle>
          <Body muted>{strings['settings.deleteInfo'](config.sync.TOMBSTONE_DAYS)}</Body>
          {deleting ? (
            <View style={{ gap: 8 }}>
              {pending ? <Body>{strings['reset.pending'](pending)}</Body> : null}
              <Field label={strings['settings.deleteType']} value={word} onChangeText={(v) => (setWord(v), setWordError(false))} autoCapitalize="characters" testID="delete-word" a11yFocus />
              {wordError ? <ErrorText testID="delete-word-error">{strings['settings.deleteWordError']}</ErrorText> : null}
              {error ? <ErrorText>{`${strings['common.error']} ${strings['common.offlineOnly']}`}</ErrorText> : null}
              <Button kind="danger" label={strings['settings.deleteConfirm']} busy={busy} onPress={() => (word.trim().toLocaleUpperCase('pl') === strings['settings.deleteWord'] ? void del() : setWordError(true))} testID="delete-confirm" />
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
