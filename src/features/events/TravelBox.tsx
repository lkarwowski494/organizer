/**
 * Miejsce wydarzenia (D115–D117): adres, „Nawiguj” (Mapy Apple albo Google Maps — Ustawienia), dziś „Wyjdź o …”
 * i środek transportu dla tego wydarzenia (tylko na moim telefonie).
 */
import { View } from 'react-native';

import { formatTime } from '../../app/clock';
import { useTravel } from '../../app/travel';
import { TRAVEL_MODES } from '../../domain/travel';
import { strings } from '../../i18n/strings.pl';
import { Body, Button, Segmented } from '../../ui/components';

export function TravelBox({ location, eventId, date }: { location: string; eventId: string; date: string }) {
  const travel = useTravel();
  const info = travel.info(eventId, date);
  return (
    <View testID="travel-box" style={{ gap: 8 }}>
      <Body>{location}</Body>
      {info ? <Body>{strings['travel.leave'](formatTime(info.leaveMs), info.minutes, strings[`travel.mode.${info.mode}`])}</Body> : null}
      <Button label={strings['event.navigate']} testID="navigate" onPress={() => travel.navigate(location, eventId)} />
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
