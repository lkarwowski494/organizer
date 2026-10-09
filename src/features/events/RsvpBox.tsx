/** Obecność na terminie (D124): moja odpowiedź, odpowiedzi za dzieci bez konta i podsumowanie grupy. */
import { View } from 'react-native';

import { useAppData, useServices } from '../../app/context';
import { ANSWERS, type Answer, answerOps, type RsvpView } from '../../domain/views/rsvp';
import { strings } from '../../i18n/strings.pl';
import { Body, SectionTitle, Segmented } from '../../ui/components';

export function RsvpBox({ view, eventId, date }: { view: RsvpView; eventId: string; date: string }) {
  const { store } = useServices();
  const { tables } = useAppData();
  const name = (p: RsvpView['people'][number]) => (p.me ? strings['who.me'] : p.name);
  const list = (a: Answer) => view.people.filter((p) => p.answer === a).map(name).join(', ');
  return (
    <View testID="rsvp" style={{ gap: 8 }}>
      <SectionTitle>{strings['rsvp.title']}</SectionTitle>
      {view.people
        .filter((p) => p.canAnswer)
        .map((p) => (
          <Segmented<Answer | ''>
            key={p.memberId}
            label={p.me ? strings['rsvp.mine'] : strings['rsvp.for'](p.name)}
            value={p.answer ?? ''}
            options={ANSWERS.map((a) => ({ value: a, label: p.me ? strings[`rsvp.${a}`] : strings[`rsvp.other.${a}`] }))}
            onChange={(a) => a && store.dispatch(answerOps(tables, { groupId: view.groupId, eventId, date, memberId: p.memberId, answer: a }))}
          />
        ))}
      {view.counts.yes ? <Body>{strings['rsvp.list.yes'](list('yes'))}</Body> : null}
      {view.counts.maybe ? <Body>{strings['rsvp.list.maybe'](list('maybe'))}</Body> : null}
      {view.counts.no ? <Body>{strings['rsvp.list.no'](list('no'))}</Body> : null}
      {view.counts.none ? <Body muted>{strings['rsvp.none'](view.counts.none)}</Body> : null}
    </View>
  );
}
