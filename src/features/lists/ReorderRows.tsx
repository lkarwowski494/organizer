/**
 * Zmiana kolejności zadań (decyzja właściciela z 9.10.2026, audyt 3: Q37 B, N-130): przeciągnięcie za uchwyt ≡ albo
 * strzałki „Przesuń wyżej / niżej” (te działają też z VoiceOverem i Switch Control, bez gestu). Lista stoi najpierw według
 * terminu (D16), więc wiersz przesuwa się wśród sąsiadów z tym samym terminem (moveRange); zapis — sort-keys.ts.
 * Gest: uchwyt ≡ (Handle niżej); na czas przeciągania ekran się nie przewija (useScrollLock).
 */
import { useRef, useState } from 'react';
import { type GestureResponderEvent, type LayoutChangeEvent, Pressable, Text, View } from 'react-native';

import type { CivilDate } from '../../domain/civil-date';
import { formatDue } from '../../domain/format';
import type { TaskNode } from '../../domain/views';
import { dropIndex, dueBucket, moveRange } from '../../domain/views/sort-keys';
import { strings } from '../../i18n/strings.pl';
import { useScrollLock } from '../../ui/components';
import { Glyph } from '../../ui/glyph';
import { useTheme } from '../../ui/theme';

export type ReorderItem = { id: string; title: string; meta: string; bucket: string };

/** Wiersze z drzewa listy: termin i osoba jak w wierszu listy (M-251), grupa terminu do granic przesuwania. */
export function reorderItems(nodes: readonly TaskNode[], today: CivilDate, who: (memberId: string | null) => string[]): ReorderItem[] {
  return nodes.map((n) => ({ id: n.id, title: n.title, meta: [...(n.due ? [formatDue(n.due, today)] : []), ...who(n.assignee_member_id)].join(', '), bucket: dueBucket(n.due) }));
}

export function ReorderRows({ items, onMove, testID }: { items: readonly ReorderItem[]; onMove: (from: number, to: number) => void; testID: string }) {
  const { c, font, size, radius } = useTheme();
  const lock = useScrollLock();
  const [heights, setHeights] = useState<number[]>([]);
  const [drag, setDrag] = useState<{ index: number; dy: number } | null>(null);
  const buckets = items.map((x) => x.bucket);
  const finish = (index: number, dy: number) => {
    lock(false);
    setDrag(null);
    const { lo, hi } = moveRange(buckets, index);
    const to = dropIndex(heights, index, dy, lo, hi);
    if (to !== index) onMove(index, to);
  };
  const measured = (i: number, h: number) => setHeights((old) => (old[i] === h ? old : Object.assign([...old], { [i]: h })));
  return (
    <View testID={testID} style={{ gap: 4 }}>
      {items.map((x, i) => {
        const { lo, hi } = moveRange(buckets, i);
        const dragged = drag?.index === i;
        const arrow = (dir: -1 | 1) => {
          const off = dir < 0 ? i === lo : i === hi;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={strings[dir < 0 ? 'order.up' : 'order.down'](x.title)}
              accessibilityState={{ disabled: off }}
              disabled={off}
              testID={`${testID}-${dir < 0 ? 'up' : 'down'}-${x.id}`}
              onPress={() => onMove(i, i + dir)}
              style={{ minWidth: size.TOUCH_TARGET, minHeight: size.TOUCH_TARGET, alignItems: 'center', justifyContent: 'center', opacity: off ? 0.3 : 1 }}
            >
              <Glyph name={dir < 0 ? 'less' : 'more'} color={c.ink} />
            </Pressable>
          );
        };
        return (
          <View
            key={x.id}
            testID={`${testID}-row-${x.id}`}
            onLayout={(e: LayoutChangeEvent) => measured(i, e.nativeEvent.layout.height)}
            style={{ flexDirection: 'row', alignItems: 'center', minHeight: size.TOUCH_TARGET + 12, borderRadius: radius.PANEL, borderWidth: 1, borderColor: dragged ? c.ink : c.border, backgroundColor: c.surface, transform: [{ translateY: dragged ? drag.dy : 0 }], zIndex: dragged ? 1 : 0 }}
          >
            {/* Uchwyt — tylko gest; VoiceOver i Switch Control mają strzałki obok. */}
            <Handle testID={`${testID}-handle-${x.id}`} onStart={() => (lock(true), setDrag({ index: i, dy: 0 }))} onDrag={(dy) => setDrag({ index: i, dy })} onDrop={(dy) => finish(i, dy)} />
            <View accessible accessibilityLabel={x.meta ? `${x.title}, ${x.meta}` : x.title} style={{ flex: 1, paddingVertical: 8, gap: 2 }}>
              <Text style={{ fontFamily: font.text600, fontSize: size.BODY, color: c.ink }}>{x.title}</Text>
              {x.meta ? <Text style={{ fontFamily: font.text400, fontSize: size.META, color: c.inkMuted }}>{x.meta}</Text> : null}
            </View>
            {arrow(-1)}
            {arrow(1)}
          </View>
        );
      })}
    </View>
  );
}

/**
 * Uchwyt przeciągania — system odpowiadania na dotyk z RN (https://reactnative.dev/docs/0.86/gesture-responder-system:
 * „onResponderMove: evt => {} - The user is moving their finger”, „onResponderTerminationRequest: evt => true - Something
 * else wants to become responder. Should this view release the responder? Returning true allows release” — tu false,
 * żeby przewijanie nie przejęło gestu); przesunięcie to różnica `pageY` („The Y position of the touch, relative to the
 * root element”) od dotknięcia.
 */
function Handle(props: { testID: string; onStart: () => void; onDrag: (dy: number) => void; onDrop: (dy: number) => void }) {
  const { c, size } = useTheme();
  const start = useRef(0);
  const dy = (e: GestureResponderEvent) => e.nativeEvent.pageY - start.current;
  return (
    <View
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => ((start.current = e.nativeEvent.pageY), props.onStart())}
      onResponderMove={(e) => props.onDrag(dy(e))}
      onResponderRelease={(e) => props.onDrop(dy(e))}
      onResponderTerminate={(e) => props.onDrop(dy(e))}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      testID={props.testID}
      style={{ minWidth: size.TOUCH_TARGET, minHeight: size.TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' }}
    >
      <Glyph name="reorder" color={c.inkMuted} />
    </View>
  );
}
