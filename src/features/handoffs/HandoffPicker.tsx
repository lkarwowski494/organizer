/**
 * Wybór osoby, której przekazuję odpowiedzialność (D70): dorośli z kontem w grupie; w dużej grupie z wyszukiwaniem
 * (PWD-30 A, jak wybór osoby w formularzach).
 */
import { useState } from 'react';
import { Text, View } from 'react-native';

import type { Member } from '../../domain/views';
import { strings } from '../../i18n/strings.pl';
import { Body, Button } from '../../ui/components';
import { matchesPerson, PeopleSearch } from '../../ui/PersonPicker';
import { useTheme } from '../../ui/theme';

export function HandoffPicker({ targets, onPick, onCancel, children }: { targets: Member[]; onPick: (m: Member) => void; onCancel: () => void; children?: React.ReactNode }) {
  const { c, font } = useTheme();
  const [query, setQuery] = useState('');
  const shown = targets.filter((m) => matchesPerson(m.display_name, query));
  return (
    <View testID="handoff-picker" style={{ gap: 8, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface }}>
      <Text accessibilityRole="header" style={{ fontFamily: font.text700, fontSize: 17, color: c.ink }}>
        {strings['handoff.pickTitle']}
      </Text>
      <Body muted>{strings['handoff.pickInfo']}</Body>
      {children}
      <PeopleSearch count={targets.length} query={query} onQuery={setQuery} testID="handoff-search" />
      {targets.length === 0 ? <Body muted>{strings['handoff.noTargets']}</Body> : shown.length === 0 ? <Body muted>{strings['people.none']}</Body> : null}
      {shown.map((m) => (
        <Button key={m.member_id} kind="secondary" label={strings['handoff.to'](m.display_name)} onPress={() => onPick(m)} />
      ))}
      <Button kind="secondary" label={strings['common.cancel']} onPress={onCancel} />
    </View>
  );
}
