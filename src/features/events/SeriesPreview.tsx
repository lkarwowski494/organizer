/**
 * Podgląd skutków zmiany serii (D14): najbliższe terminy po zmianie, zadania, które przejdą same, zadania z terminów,
 * które znikają (wybór: najbliższy termin albo odpięcie), i zmienione pojedynczo terminy, które przepadną. Ten sam ekran
 * przy „to i następne”/„wszystkie” (EventEditScreen) i przy zapisie planu lekcji (audyt 2, M-14 — TimetableScreen).
 */
import { View } from 'react-native';

import type { CivilDate } from '../../domain/civil-date';
import { formatDue } from '../../domain/format';
import type { SeriesEffects } from '../../domain/views/event-tasks';
import { strings } from '../../i18n/strings.pl';
import { Body, Button, Screen, Segmented, Title } from '../../ui/components';

export function SeriesPreview({ effects, today, choice, onChoice, onSave, onBack, testID, saveTestID }: {
  effects: SeriesEffects;
  today: CivilDate;
  choice: 'nearest' | 'unlink';
  onChoice: (c: 'nearest' | 'unlink') => void;
  onSave: () => void;
  onBack: () => void;
  testID: string;
  saveTestID: string;
}) {
  return (
    <Screen testID={testID}>
      <Title>{strings['event.previewTitle']}</Title>
      <Body>{effects.preview.length ? strings['event.previewDates'](effects.preview.map((x) => formatDue({ date: x, time: null }, today)).join(', ')) : strings['event.previewNone']}</Body>
      {effects.kept.length ? <Body muted>{strings['event.previewKept'](effects.kept.length)}</Body> : null}
      {effects.overridesLost ? <Body>{strings['event.previewOverridesLost'](effects.overridesLost)}</Body> : null}
      {effects.lost.length ? (
        <View style={{ gap: 8 }}>
          <Body>{strings['event.previewLost'](effects.lost.length)}</Body>
          <Body muted>{effects.lost.map((x) => x.task.title).join(', ')}</Body>
          <Segmented label={strings['event.previewLostChoice']} value={choice} onChange={onChoice} options={[{ value: 'nearest', label: strings['event.previewNearest'] }, { value: 'unlink', label: strings['event.previewUnlink'] }]} />
        </View>
      ) : null}
      <Button label={strings['event.previewSave']} testID={saveTestID} onPress={onSave} />
      <Button kind="secondary" label={strings['event.previewBack']} onPress={onBack} />
    </Screen>
  );
}
