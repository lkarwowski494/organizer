/**
 * Filtr grup w Moich sprawach i Kalendarzu (decyzja właściciela 8.10.2026, PW-38 A / audyt 2 M-119, D192): chipy grup
 * pod tytułem wybierają, które grupy widać (kilka naraz; żadna — wszystkie). Włączony filtr widać zawsze („Filtr
 * włączony: …” z „Pokaż wszystkie” — jedno dotknięcie wyłącza). Jeden filtr dla obu ekranów (te same chipy), pamiętany
 * na tym telefonie w lokalnej bazie konta (klucz local:*, jak „Grupa domyślna”, D175). Grupa, której już nie mam, wypada
 * z filtra sama (liczą się tylko wybrane spośród moich grup).
 */
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { strings } from '../i18n/strings.pl';
import { Button, GroupMark } from '../ui/components';
import { Glyph } from '../ui/glyph';
import { useTheme } from '../ui/theme';
import { useServices } from './context';

export const GROUP_FILTER_KEY = 'groupFilter';

type Api = { selected: readonly string[]; set(ids: readonly string[]): void };
const Ctx = createContext<Api>({ selected: [], set: () => {} });

const parse = (raw: string | null): string[] => {
  try {
    const v: unknown = JSON.parse(raw ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

export function GroupFilterProvider({ children }: { children: ReactNode }) {
  const { local } = useServices();
  const [selected, setSelected] = useState(() => parse(local?.load(GROUP_FILTER_KEY) ?? null));
  const api = useMemo<Api>(
    () => ({
      selected,
      set: (ids) => {
        setSelected([...ids]);
        local?.save(GROUP_FILTER_KEY, ids.length ? JSON.stringify(ids) : null);
      },
    }),
    [local, selected],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

type FilterGroup = { id: string; name: string; line: number };

/**
 * Wybrane grupy spośród `groups` (pusty zbiór — bez filtra). Przy jednej grupie filtra nie ma (pasek się nie pokazuje),
 * więc nie działa i zapis znika — audyt 3, N-179: po wyjściu z grup wspólnych filtr „Osobiste” chował dalej wydarzenia
 * z iPhone'a bez paska „Filtr włączony” i bez „Pokaż wszystkie”. Zero grup (konto jeszcze bez danych) zapisu nie czyści.
 */
export function useGroupFilter(groups: readonly FilterGroup[]) {
  const { selected, set } = useContext(Ctx);
  const single = groups.length === 1;
  const active = useMemo(() => new Set(groups.length < 2 ? [] : groups.filter((g) => selected.includes(g.id)).map((g) => g.id)), [groups, selected]);
  useEffect(() => {
    if (single && selected.length) set([]);
  }, [single, selected.length, set]);
  return {
    active,
    toggle: (id: string) => set(active.has(id) ? [...active].filter((x) => x !== id) : [...active, id]),
    clear: () => set([]),
  };
}

/** Chipy grup (przełączniki) i znak włączonego filtra z „Pokaż wszystkie”. Przy jednej grupie filtr nie ma sensu. */
export function GroupFilterBar({ groups, testID }: { groups: readonly FilterGroup[]; testID: string }) {
  const { c, font, size, radius } = useTheme();
  const f = useGroupFilter(groups);
  if (groups.length < 2) return null;
  const names = groups.filter((g) => f.active.has(g.id)).map((g) => g.name);
  return (
    <View style={{ gap: 8 }}>
      <View accessibilityLabel={strings['filter.label']} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {groups.map((g) => {
          const on = f.active.has(g.id);
          return (
            <Pressable
              key={g.id}
              testID={`${testID}-${g.id}`}
              accessibilityRole="button"
              accessibilityLabel={strings['filter.chipA11y'](g.name)}
              accessibilityState={{ selected: on }}
              onPress={() => f.toggle(g.id)}
              // PW-52 A (D198): jeden wzór zaznaczenia jak w Toggles — ciemne wypełnienie, jasny napis i ✓ (wybór wielu);
              // znacznik grupy ten sam co w wierszach (M-252), rozmiar napisu chipu z motywu (size.CONTROL, M-152).
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: size.TOUCH_TARGET, paddingLeft: 8, paddingRight: 12, borderRadius: radius.PILL, borderWidth: 1, borderColor: on ? c.ink : c.control, backgroundColor: on ? c.ink : c.surface }}
            >
              <GroupMark line={g.line} size={14} />
              {on ? <Glyph name="check" color={c.surface} place="inline" /> : null}
              <Text style={{ fontFamily: on ? font.text700 : font.text600, fontSize: size.CONTROL, color: on ? c.surface : c.ink }}>{g.name}</Text>
            </Pressable>
          );
        })}
      </View>
      {names.length ? (
        <View testID={`${testID}-on`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: radius.PANEL, borderWidth: 1, borderColor: c.warnBorder, backgroundColor: c.warnBg }}>
          <Text accessibilityRole="text" style={{ flex: 1, fontFamily: font.text700, fontSize: size.META, color: c.warnInk }}>
            {strings['filter.on'](names.join(', '))}
          </Text>
          <Button kind="secondary" label={strings['filter.clear']} a11yLabel={strings['filter.clearA11y']} testID={`${testID}-clear`} onPress={f.clear} />
        </View>
      ) : null}
    </View>
  );
}
