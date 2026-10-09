/**
 * Chipy pod polem dodawania w Moich sprawach (decyzje z 8.10.2026, PW-3; audyt 2 M-24):
 *  - grupa — pokazuje, dokąd trafi wpis; dotknięcie rozwija wybór grupy. Gdy grupę wskazuje tekst („#Klasa” albo „@Ala”
 *    z innej grupy), chip pokazuje ją i jest nieaktywny — grupę zmienia się wtedy w tekście;
 *  - „Na listę: …” — podpowiedź, gdy cały wpis to produkt (wariant D): jedno dotknięcie dodaje go do listy zakupów
 *    grupy wpisu; bez dotknięcia wpis zostaje zadaniem.
 * Ten sam kształt co chipy rozpoznanych fragmentów (TokenChip): obrys, 44 pt wysokości.
 */
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { strings } from '../../i18n/strings.pl';
import { buttonA11y } from '../../ui/a11y';
import { Glyph } from '../../ui/glyph';
import { useTheme } from '../../ui/theme';

function Pill({ testID, label, hint, disabled, expanded, onPress, children }: { testID: string; label: string; hint: string; disabled?: boolean; expanded?: boolean; onPress: () => void; children: ReactNode }) {
  const { c, size } = useTheme();
  return (
    <Pressable
      testID={testID}
      {...buttonA11y({ disabled: !!disabled, expanded })}
      accessibilityLabel={label}
      accessibilityHint={hint}
      disabled={disabled}
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: size.TOUCH_TARGET, paddingHorizontal: 12, borderRadius: 22, borderWidth: 1, borderColor: disabled ? c.border : c.control, backgroundColor: c.surface }}
    >
      {children}
    </Pressable>
  );
}

export function QuickGroupChip({ name, line, fromText, open, onToggle }: { name: string; line: number; fromText: boolean; open: boolean; onToggle: () => void }) {
  const { c, font, size, line: lineOf } = useTheme();
  return (
    <Pill testID="quick-group" label={strings['quick.group'](name)} hint={fromText ? strings['quick.groupFromText'] : strings['quick.groupHint']} disabled={fromText} expanded={open} onPress={onToggle}>
      <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: lineOf(line).line }} />
      <Text style={{ fontFamily: font.text600, fontSize: size.CONTROL, color: c.ink }}>{strings['quick.groupChip'](name)}</Text>
      {fromText ? null : <Glyph name="more" color={c.inkMuted} place="inline" />}
    </Pill>
  );
}

export function ShoppingChip({ item, list, onPress }: { item: string; list: string; onPress: () => void }) {
  const { c, font, size } = useTheme();
  return (
    <Pill testID="quick-shopping" label={strings['quick.toShoppingA11y'](item, list)} hint={strings['quick.toShoppingHint']} onPress={onPress}>
      <Text style={{ fontFamily: font.text600, fontSize: size.CONTROL, color: c.ink }}>{strings['quick.toShopping'](list)}</Text>
    </Pill>
  );
}
