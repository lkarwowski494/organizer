/**
 * Chip grupy przy polu dodawania w Moich sprawach (decyzja właściciela 8.10.2026, audyt 2 M-24): pokazuje, dokąd trafi
 * wpis, a dotknięcie rozwija wybór grupy. Gdy grupę wskazuje tekst („#Klasa” albo „@Ala” z innej grupy), chip pokazuje
 * ją i jest nieaktywny — grupę zmienia się wtedy w tekście.
 */
import { Pressable, Text, View } from 'react-native';

import { strings } from '../../i18n/strings.pl';
import { Segmented } from '../../ui/components';
import { useTheme } from '../../ui/theme';

export function QuickGroupChip({ name, line, fromText, open, groups, value, onToggle, onPick }: {
  name: string;
  line: number;
  fromText: boolean;
  open: boolean;
  groups: { id: string; name: string }[];
  value: string;
  onToggle: () => void;
  onPick: (groupId: string) => void;
}) {
  const { c, font, size, line: lineOf } = useTheme();
  return (
    <>
      <Pressable
        testID="quick-group"
        accessibilityRole="button"
        accessibilityLabel={strings['quick.group'](name)}
        accessibilityHint={fromText ? strings['quick.groupFromText'] : strings['quick.groupHint']}
        accessibilityState={{ disabled: fromText, expanded: open }}
        disabled={fromText}
        onPress={onToggle}
        style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: size.TOUCH_TARGET, paddingHorizontal: 12, borderRadius: 22, borderWidth: 1, borderColor: fromText ? c.border : c.control, backgroundColor: c.surface }}
      >
        <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: lineOf(line).line }} />
        <Text style={{ fontFamily: font.text600, fontSize: 15, color: c.ink }}>{strings['quick.groupChip'](name)}</Text>
        {fromText ? null : <Text style={{ fontSize: 13, color: c.inkMuted }}>▾</Text>}
      </Pressable>
      {open && !fromText ? <Segmented label={strings['quick.groupPick']} value={value} onChange={onPick} options={groups.map((g) => ({ value: g.id, label: g.name }))} /> : null}
    </>
  );
}
