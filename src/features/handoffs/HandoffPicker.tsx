/** Wybór osoby, której przekazuję odpowiedzialność (D70): dorośli z kontem w grupie. */
import { Text, View } from 'react-native';

import type { Member } from '../../domain/views';
import { strings } from '../../i18n/strings.pl';
import { Body, Button } from '../../ui/components';
import { useTheme } from '../../ui/theme';

export function HandoffPicker({ targets, onPick, onCancel, children }: { targets: Member[]; onPick: (m: Member) => void; onCancel: () => void; children?: React.ReactNode }) {
  const { c, font } = useTheme();
  return (
    <View testID="handoff-picker" style={{ gap: 8, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface }}>
      <Text accessibilityRole="header" style={{ fontFamily: font.text700, fontSize: 17, color: c.ink }}>
        {strings['handoff.pickTitle']}
      </Text>
      <Body muted>{strings['handoff.pickInfo']}</Body>
      {children}
      {targets.length === 0 ? <Body muted>{strings['handoff.noTargets']}</Body> : null}
      {targets.map((m) => (
        <Button key={m.member_id} kind="secondary" label={strings['handoff.to'](m.display_name)} onPress={() => onPick(m)} />
      ))}
      <Button kind="secondary" label={strings['common.cancel']} onPress={onCancel} />
    </View>
  );
}
