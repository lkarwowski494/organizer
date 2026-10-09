/**
 * Miejsce wydarzenia (D115–D117): adres, „Nawiguj” (Mapy Apple albo Google Maps — Ustawienia), „Wyjdź o …”
 * i środek transportu dla tego wydarzenia (tylko na moim telefonie). Audyt 2: przy wyłączonym czasie dojazdu
 * „Pokaż, kiedy wyjść →” (PWD-3, M-175 — włącza go i pyta o lokalizację), przy wygasłej zgodzie „Zezwól na lokalizację”
 * (M-218), przy adresie, którego Mapy nie znalazły — informacja (M-106).
 */
import { View } from 'react-native';

import { formatTime } from '../../domain/local-time';
import { useTravel } from '../../app/travel';
import { TRAVEL_MODES } from '../../domain/travel';
import { strings } from '../../i18n/strings.pl';
import { Body, Button, Segmented } from '../../ui/components';

export function TravelBox({ location, eventId, date, upcoming = true }: { location: string; eventId: string; date: string; upcoming?: boolean }) {
  const travel = useTravel();
  const info = travel.info(eventId, date);
  return (
    <View testID="travel-box" style={{ gap: 8 }}>
      <Body>{location}</Body>
      {info ? <Body>{strings['travel.leave'](formatTime(info.leaveMs), info.minutes, strings[`travel.mode.${info.mode}`])}</Body> : null}
      {upcoming && travel.available && !travel.enabled ? <Button kind="secondary" label={strings['travel.suggest']} testID="travel-suggest" onPress={() => void travel.setEnabled(true)} /> : null}
      {upcoming && travel.enabled && travel.status === 'undetermined' ? (
        <>
          <Body muted>{strings['travel.needsPermission']}</Body>
          <Button kind="secondary" label={strings['travel.allow']} testID="travel-allow" onPress={() => void travel.requestPermission()} />
        </>
      ) : null}
      {upcoming && travel.enabled && travel.status === 'denied' ? <Body muted>{strings['travel.denied']}</Body> : null}
      {upcoming && travel.notFound(location) ? <Body muted>{strings['travel.notFound']}</Body> : null}
      <Button kind="secondary" label={strings['event.navigate']} testID="navigate" onPress={() => travel.navigate(location, eventId)} />
      {travel.available ? (
        <Segmented
          label={strings['event.myMode']}
          value={travel.modeFor(eventId)}
          onChange={(m) => travel.setEventMode(eventId, m === travel.mode ? null : m)}
          options={TRAVEL_MODES.map((m) => ({ value: m, label: strings[`travel.option.${m}`] }))}
        />
      ) : null}
    </View>
  );
}
