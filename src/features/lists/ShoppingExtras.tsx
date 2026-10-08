/**
 * Dodatki listy zakupów (D85, D86; ADR 0018): panel pozycji (nazwa i ilość, dział), podpowiedzi przy wpisywaniu i stałe
 * zakupy. Logika w src/domain/views/shopping.ts; tu tylko widok i wysyłka operacji.
 */
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { config } from '../../config';
import { SHOPPING_CATEGORIES, type ShoppingCategory } from '../../config/shopping.pl';
import type { NewOp, Row } from '../../domain/sync-engine/client';
import { addStaple, itemKey, removeStaple, type StaplesEdit, staplesOf } from '../../domain/views/shopping';
import { strings } from '../../i18n/strings.pl';
import { Body, Button, Field, SectionTitle, Segmented } from '../../ui/components';
import { useLiveText } from '../../ui/live-text';
import { useTheme } from '../../ui/theme';

/** Przycisk-pigułka podpowiedzi i „✕” (wybór działu to Segmented). */
function Chip({ label, onPress, testID, a11yLabel }: { label: string; onPress: () => void; testID?: string; a11yLabel?: string }) {
  const { c, font, size } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel ?? label}
      onPress={onPress}
      style={{ minHeight: size.TOUCH_TARGET, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 22, borderWidth: 1, borderColor: c.control, backgroundColor: c.surface }}
    >
      <Text style={{ fontFamily: font.text700, fontSize: 15, color: c.ink }}>{label}</Text>
    </Pressable>
  );
}

/** Komunikat błędu stałej pozycji — ten sam w karcie stałych i w panelu pozycji (audyt 2, M-224). */
export function stapleError(error: Extract<StaplesEdit, { ok: false }>['error']): string {
  const messages = {
    empty: strings['shop.stapleError.empty'],
    duplicate: strings['shop.stapleError.duplicate'],
    full: strings['shop.stapleError.full'](config.shopping.STAPLES_MAX),
    tooLong: strings['shop.stapleError.tooLong'](config.shopping.STAPLE_MAX_LENGTH),
  };
  return messages[error];
}

const CATEGORY_OPTIONS = SHOPPING_CATEGORIES.map((cat) => ({ value: cat.key, label: cat.name }));

/**
 * Panel pod pozycją (dotknięcie wiersza): nazwa z ilością, dział i przełącznik „stała pozycja” (decyzja właściciela
 * z 8.10.2026, audyt 2: PW-17 B, M-107). Nazwa i ilość to jeden tekst, jak przy dodawaniu (D77: ilość zostaje w nazwie);
 * zapis od razu (D130, jak tytuł zadania), także przy zamknięciu panelu — dlatego „Gotowe”, nie „Anuluj”. Dział to wybór
 * jednej opcji, więc Segmented z rolą radio, jak inne takie wybory (audyt 2, M-238, A-32).
 */
export function ItemPanel({ title, current, isStaple, error, onRename, onPick, onToggleStaple, onClose }: {
  title: string;
  current: ShoppingCategory;
  isStaple: boolean;
  error?: string | null;
  onRename: (title: string) => void;
  onPick: (c: ShoppingCategory) => void;
  onToggleStaple: () => void;
  onClose: () => void;
}) {
  const { c } = useTheme();
  const name = useLiveText(title, onRename);
  return (
    <View testID="item-panel" style={{ gap: 8, padding: 12, marginLeft: 30, borderRadius: 14, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface }}>
      <Field label={strings['shop.itemName']} {...name} maxLength={config.lengths.TASK_TITLE} testID="item-name" />
      <Body muted>{strings['shop.categoryHint']}</Body>
      <Segmented label={strings['shop.category']} value={current} onChange={onPick} options={CATEGORY_OPTIONS} />
      <Button kind="secondary" label={isStaple ? strings['shop.removeStaple'] : strings['shop.addStaple']} testID="staple-toggle" onPress={onToggleStaple} a11yHint={title} />
      {error ? <Body>{error}</Body> : null}
      <Button kind="secondary" label={strings['shop.done']} testID="item-done" onPress={onClose} />
    </View>
  );
}

/** Podpowiedzi z wcześniejszych zakupów pod polem dodawania. */
export function Suggestions({ names, onPick }: { names: readonly string[]; onPick: (name: string) => void }) {
  if (names.length === 0) return null;
  return (
    <View testID="suggestions" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {names.map((n) => (
        <Chip key={n} label={n} a11yLabel={strings['shop.suggest'](n)} onPress={() => onPick(n)} testID={`suggest-${itemKey(n)}`} />
      ))}
    </View>
  );
}

/** Karta „Stałe zakupy”: dodanie brakujących jednym dotknięciem i edycja listy stałych. */
export function StaplesCard({ list, missing, onAddMissing, onEdit }: { list: Row; missing: number; onAddMissing: () => void; onEdit: (op: NewOp) => void }) {
  const { c } = useTheme();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const staples = staplesOf(list);
  const save = () => {
    const r = addStaple(list, text);
    if (!r.ok) return setError(stapleError(r.error));
    onEdit(r.op);
    setText('');
    setError(null);
  };
  return (
    <View testID="staples" style={{ gap: 8, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface }}>
      <SectionTitle>{strings['shop.staples']}</SectionTitle>
      {staples.length === 0 && !editing ? <Body muted>{strings['shop.staplesInfo']}</Body> : null}
      {staples.length > 0 && !editing ? <Body>{staples.join(', ')}</Body> : null}
      {!editing && staples.length > 0 ? (
        missing > 0 ? <Button label={strings['shop.staplesAdd'](missing)} testID="staples-add" onPress={onAddMissing} /> : <Body muted>{strings['shop.staplesAll']}</Body>
      ) : null}
      {editing ? (
        <>
          {staples.length === 0 ? <Body muted>{strings['shop.staplesNone']}</Body> : null}
          {staples.map((s) => (
            <View key={s} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <Body>{s}</Body>
              <Chip label="✕" a11yLabel={strings['shop.stapleRemove'](s)} testID={`staple-remove-${itemKey(s)}`} onPress={() => onEdit(removeStaple(list, s))} />
            </View>
          ))}
          <Field label={strings['shop.stapleName']} value={text} onChangeText={(v) => (setText(v), setError(null))} onSubmitEditing={save} maxLength={config.shopping.STAPLE_MAX_LENGTH} testID="staple-name" />
          {error ? <Body>{error}</Body> : null}
          <Button label={strings['shop.stapleSave']} testID="staple-save" onPress={save} />
          <Button kind="secondary" label={strings['shop.done']} testID="staples-done" onPress={() => (setEditing(false), setError(null))} />
        </>
      ) : (
        <Button kind="secondary" label={strings['shop.staplesEdit']} testID="staples-edit" onPress={() => setEditing(true)} />
      )}
    </View>
  );
}
