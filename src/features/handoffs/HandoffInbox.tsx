/** „Do potwierdzenia” na „Moje sprawy” (D70): przekazania do mnie (Przyjmij / Odrzuć) i informacje o odrzuceniu moich. */
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { formatDateInline, parseIsoDate } from '../../domain/format';
import type { CivilDate } from '../../domain/civil-date';
import type { HandoffItem } from '../../domain/views/handoffs';
import { strings } from '../../i18n/strings.pl';
import { Button, Card, SectionTitle } from '../../ui/components';
import { announce } from '../../ui/a11y';
import { useTheme } from '../../ui/theme';

export function HandoffInbox({
  incoming,
  declined,
  today,
  focusHandoffId,
  onDecide,
  onClose,
}: {
  incoming: HandoffItem[];
  declined: HandoffItem[];
  today: CivilDate;
  focusHandoffId?: string | null;
  onDecide: (h: HandoffItem, accept: boolean) => void;
  onClose: (h: HandoffItem) => void;
}) {
  const { c, font, size, line } = useTheme();
  const [dismissedHandled, setDismissedHandled] = useState(false);

  const focused = focusHandoffId
    ? incoming.find((h) => h.id === focusHandoffId) ?? declined.find((h) => h.id === focusHandoffId)
    : null;

  useEffect(() => {
    if (focused) {
      announce(`${strings['handoff.focusCard']}: ${focused.title}`);
    }
  }, [focused]);

  const titleOf = (h: HandoffItem) => {
    const title = h.entity === 'lists' ? strings['trip.title'](h.title) : h.title;
    return h.date ? `${title} (${formatDateInline(parseIsoDate(h.date), today)})` : title;
  };

  const showHandledNotice = Boolean(focusHandoffId && !focused && !dismissedHandled);

  if (incoming.length === 0 && declined.length === 0 && !showHandledNotice) return null;

  const card = (h: HandoffItem, text: string, buttons: React.ReactNode) => {
    const isFocused = Boolean(focusHandoffId && h.id === focusHandoffId);
    return (
      <Card
        key={h.id}
        testID={`handoff-${h.id}`}
        style={{
          borderLeftWidth: 6,
          borderLeftColor: line(h.line).line,
          ...(isFocused ? { borderWidth: 2, borderColor: c.ink } : {}),
        }}
      >
        <Text style={{ fontFamily: font.text700, fontSize: size.BODY, color: c.ink }}>{text}</Text>
        <Text style={{ fontFamily: font.text600, fontSize: size.META, color: c.inkMuted }}>{h.groupName}</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>{buttons}</View>
      </Card>
    );
  };

  return (
    <View testID="handoff-inbox" style={{ gap: 8 }}>
      <SectionTitle>{strings['handoff.inbox']}</SectionTitle>
      {showHandledNotice ? (
        <Card testID="handoff-already-handled" style={{ borderWidth: 1, borderColor: c.border }}>
          <Text style={{ fontFamily: font.text700, fontSize: size.BODY, color: c.ink }}>{strings['handoff.alreadyDecided']}</Text>
          <View style={{ marginTop: 8 }}>
            <Button kind="secondary" label={strings['common.ok']} testID="handoff-dismiss-handled" onPress={() => setDismissedHandled(true)} />
          </View>
        </Card>
      ) : null}
      {incoming.map((h) =>
        card(
          h,
          strings['handoff.incoming'](h.otherName, titleOf(h)),
          <>
            <View style={{ flex: 1 }}>
              <Button label={strings['handoff.accept']} a11yLabel={strings['handoff.acceptA11y'](titleOf(h))} testID={`handoff-accept-${h.id}`} onPress={() => onDecide(h, true)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button kind="secondary" label={strings['handoff.decline']} a11yLabel={strings['handoff.declineA11y'](titleOf(h))} testID={`handoff-decline-${h.id}`} onPress={() => onDecide(h, false)} />
            </View>
          </>,
        ),
      )}
      {declined.map((h) =>
        card(
          h,
          strings['handoff.declined'](h.otherName, titleOf(h)),
          <View style={{ flex: 1 }}>
            <Button kind="secondary" label={strings['common.ok']} a11yLabel={strings['handoff.okA11y'](titleOf(h))} testID={`handoff-ok-${h.id}`} onPress={() => onClose(h)} />
          </View>,
        ),
      )}
    </View>
  );
}
