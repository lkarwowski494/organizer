/** „Do potwierdzenia” na „Moje sprawy” (D70): przekazania do mnie (Przyjmij / Odrzuć) i informacje o odrzuceniu moich. */
import { Text, View } from 'react-native';

import { formatDateInline, parseIsoDate } from '../../domain/format';
import type { CivilDate } from '../../domain/civil-date';
import type { HandoffItem } from '../../domain/views/handoffs';
import { strings } from '../../i18n/strings.pl';
import { Button, SectionTitle } from '../../ui/components';
import { useTheme } from '../../ui/theme';

export function HandoffInbox({ incoming, declined, today, onDecide, onClose }: { incoming: HandoffItem[]; declined: HandoffItem[]; today: CivilDate; onDecide: (h: HandoffItem, accept: boolean) => void; onClose: (h: HandoffItem) => void }) {
  const { c, font, size, line } = useTheme();
  if (incoming.length === 0 && declined.length === 0) return null;
  const titleOf = (h: HandoffItem) => {
    const title = h.entity === 'lists' ? strings['trip.title'](h.title) : h.title;
    return h.date ? `${title} (${formatDateInline(parseIsoDate(h.date), today)})` : title;
  };
  const card = (h: HandoffItem, text: string, buttons: React.ReactNode) => (
    <View key={h.id} testID={`handoff-${h.id}`} style={{ gap: 10, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: c.border, borderLeftWidth: 6, borderLeftColor: line(h.line).line, backgroundColor: c.surface }}>
      <Text style={{ fontFamily: font.text700, fontSize: size.BODY, color: c.ink }}>{text}</Text>
      <Text style={{ fontFamily: font.text600, fontSize: size.META, color: c.inkMuted }}>{h.groupName}</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>{buttons}</View>
    </View>
  );
  return (
    <View testID="handoff-inbox" style={{ gap: 8 }}>
      <SectionTitle>{strings['handoff.inbox']}</SectionTitle>
      {incoming.map((h) =>
        card(
          h,
          strings['handoff.incoming'](h.otherName, titleOf(h)),
          <>
            <View style={{ flex: 1 }}>
              <Button label={strings['handoff.accept']} testID={`handoff-accept-${h.id}`} onPress={() => onDecide(h, true)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button kind="secondary" label={strings['handoff.decline']} testID={`handoff-decline-${h.id}`} onPress={() => onDecide(h, false)} />
            </View>
          </>,
        ),
      )}
      {declined.map((h) =>
        card(
          h,
          strings['handoff.declined'](h.otherName, titleOf(h)),
          <View style={{ flex: 1 }}>
            <Button kind="secondary" label={strings['common.ok']} testID={`handoff-ok-${h.id}`} onPress={() => onClose(h)} />
          </View>,
        ),
      )}
    </View>
  );
}
