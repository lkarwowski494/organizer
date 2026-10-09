/**
 * Zaproszenie do połączenia z kalendarzem iPhone'a (D95) w Kalendarzu: raz, do „Nie teraz” albo połączenia (potem
 * Ustawienia → Kalendarz i dojazd, audyt 2 M-33). Zgoda tylko na dodawanie (po „Dodaj do kalendarza”) — dalej
 * „Połącz” (M-217). Odmowa w iOS — wskazówka i „Otwórz Ustawienia iPhone’a”.
 */
import { useEffect, useState } from 'react';

import { useDeviceCalendar } from '../../app/calendar-sync';
import { useServices } from '../../app/context';
import { strings } from '../../i18n/strings.pl';
import { Body, Button, Card, CardTitle } from '../../ui/components';

export const CAL_ASKED = 'calendarAsked';

export function DeviceCalendarCard() {
  const cal = useDeviceCalendar();
  const { prefs } = useServices();
  const [asked, setAsked] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    prefs
      ?.get(CAL_ASKED)
      .then((v) => live && setAsked(v === '1'))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [prefs]);
  // Audyt 3 (N-185): przy pełnej zgodzie karty nie ma — wyłączony odczyt to wybór w Ustawieniach, nie powód, by znowu
  // proponować połączenie (które włączało też świadomie wyłączone lustro).
  if (!cal.available || asked !== false || cal.status === null || cal.status === 'granted') return null;
  const done = () => {
    setAsked(true);
    prefs?.set(CAL_ASKED, '1').catch(() => {});
  };
  return (
    <Card testID="device-calendar-card">
      <CardTitle>
        {strings['device.title']}
      </CardTitle>
      <Body muted>{cal.status === 'denied' ? strings['device.denied'] : cal.status === 'writeOnly' ? strings['device.writeOnly'] : strings['device.body']}</Body>
      {cal.status === 'denied' ? (
        <Button label={strings['push.openSettings']} testID="device-open-settings" onPress={cal.openSettings} />
      ) : (
        <Button label={strings['device.connect']} testID="device-connect" onPress={() => void cal.connect().then((ok) => ok && done())} />
      )}
      <Button kind="secondary" label={strings['common.later']} testID="device-later" onPress={done} />
    </Card>
  );
}
