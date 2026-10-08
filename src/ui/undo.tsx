/**
 * Pasek „Cofnij” (zasada produktu: miękkie usuwanie i cofanie, nic nie ginie po jednym dotknięciu) i „Ostatnie zmiany”.
 * Jeden pasek naraz; nowy zastępuje poprzedni. Znika po config.UNDO_MS albo po „Cofnij”.
 *
 * Decyzja właściciela z 8.10.2026 (audyt 2: PW-10 C+A, M-38; D194):
 *  - każda zmiana z „Cofnij” trafia też do „Ostatnich zmian” (config.RECENT_MAX ostatnich, w bazie konta — D194 b)
 *    z „Cofnij” bez limitu czasu; przed cofnięciem sprawdzamy, czy rzecz nie zmieniła się od tamtej chwili
 *    (`changed` → odcisk, src/domain/views/recent.ts) — jeśli tak, nie cofamy i mówimy dlaczego;
 *  - przy włączonym VoiceOverze pasek nie znika sam (zostaje do „Cofnij”, „Zamknij” albo następnego paska), a fokus
 *    przechodzi na jego treść, więc VoiceOver od razu ją czyta. AccessibilityInfo w React Native 0.86 (SDK 57):
 *    https://reactnative.dev/docs/0.86/accessibilityinfo — „isScreenReaderEnabled() … resolves to a boolean”,
 *    „screenReaderChanged … The argument to the event handler is a boolean”, „sendAccessibilityEvent … like changing
 *    the focused element for a screen reader” (zamiast przestarzałego setAccessibilityFocus). accessibilityLiveRegion
 *    działa tylko na Androidzie (https://reactnative.dev/docs/0.86/accessibility#accessibilityliveregion-android).
 */
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { config } from '../config';
import type { NewOp } from '../domain/sync-engine/client';
import { type Fingerprint, parseRecent, type RecentLost, type RecentRecord, type RecentUndo } from '../domain/views/recent';
import { strings } from '../i18n/strings.pl';
import { useTheme } from './theme';

export type UndoOptions = {
  /**
   * Napis przycisku (domyślnie „Cofnij”). Inny napis („Zmień” po szybkim dodaniu — D90, „Zobacz”) to nie cofnięcie
   * zmiany, więc taki pasek nie trafia do „Ostatnich zmian”.
   */
  action?: string;
  /** Operacje, które zrobiły zmianę (już wysłane do `dispatch`) — do sprawdzenia przed cofnięciem (D194). */
  changed?: readonly NewOp[];
  /**
   * Cofnięcie jako funkcja nie przeżyje ponownego uruchomienia — dlaczego (do wyjaśnienia na liście): „server” — idzie
   * przez serwer (grupa), „plan” — plan lekcji liczony w chwili cofnięcia z całego planu.
   */
  lost?: RecentLost;
};

/**
 * Cofnięcie: operacje (zapisywane w bazie konta — działają też po ponownym uruchomieniu), operacje według przepisu
 * liczone w chwili cofnięcia (rutyna) albo funkcja (tylko w tym uruchomieniu).
 */
export type UndoAction = RecentUndo | (() => void);

export type RecentEntry = Pick<RecentRecord, 'id' | 'message' | 'at' | 'state' | 'lost'>;

/** Baza konta i dane dla „Ostatnich zmian” (AppProvider). */
export type UndoBackend = {
  fingerprint: (ops: readonly NewOp[]) => Fingerprint;
  isStale: (fp: Fingerprint) => boolean;
  run: (u: RecentUndo) => void;
  load: () => string | null;
  save: (json: string) => void;
};

type Undo = {
  /** Bez `undo` — sam komunikat (np. „Nie cofnięto…”). `opts` jako tekst = napis przycisku. */
  show: (message: string, undo?: UndoAction, opts?: string | UndoOptions) => void;
  /** Ostatnie zmiany, najnowsze pierwsze. */
  recent: readonly RecentEntry[];
  /** Cofnięcie z listy; „stale” — rzecz się zmieniła, niczego nie zmieniamy; „gone” — już cofnięte albo niemożliwe. */
  undoRecent: (id: number) => 'undone' | 'stale' | 'gone';
  /** Nawigacja do „Ostatnich zmian” (podpina ją komponent wewnątrz nawigacji). */
  bindOpenRecent: (fn: (() => void) | null) => void;
};
const UndoContext = createContext<Undo>({ show: () => {}, recent: [], undoRecent: () => 'gone', bindOpenRecent: () => {} });

type Bar = { message: string; onUndo?: () => void; action: string; n: number; entry: number | null };

export function UndoProvider({ children, nowMs = Date.now, backend }: { children: ReactNode; nowMs?: () => number; backend?: UndoBackend }) {
  const { c, font, size } = useTheme();
  const insets = useSafeAreaInsets();
  const [bar, setBar] = useState<Bar | null>(null);
  // D194 b: lista z bazy konta (przeżywa ponowne uruchomienie).
  const [records, setRecords] = useState<readonly RecentRecord[]>(() => parseRecent(backend?.load() ?? null));
  const [reader, setReader] = useState(false);
  const [openRecent, setOpenRecent] = useState<{ fn: () => void } | null>(null);
  const n = useRef(Math.max(0, ...records.map((r) => r.id)));
  // Cofnięcia-funkcje (tylko w tym uruchomieniu).
  const actions = useRef(new Map<number, () => void>());
  const focus = useRef<View>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) return void (first.current = false);
    backend?.save(JSON.stringify(records));
  }, [records, backend]);
  const recent = useMemo(() => records.map(({ id, message, at, state, lost }) => ({ id, message, at, state, lost })), [records]);

  useEffect(() => {
    let live = true;
    AccessibilityInfo.isScreenReaderEnabled()
      .then((on) => live && setReader(on))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', (on: boolean) => setReader(on));
    return () => {
      live = false;
      sub.remove();
    };
  }, []);

  const mark = useCallback((id: number, state: RecentRecord['state']) => setRecords((r) => r.map((e) => (e.id === id ? { ...e, state, ...(state === 'undone' ? { undo: null } : {}) } : e))), []);

  const undoRecent = useCallback(
    (id: number) => {
      const rec = records.find((e) => e.id === id);
      const fn = actions.current.get(id);
      if (!rec || rec.state === 'undone' || rec.state === 'lost' || (!fn && !rec.undo)) return 'gone' as const;
      if (rec.fp && backend?.isStale(rec.fp)) {
        mark(id, 'stale');
        return 'stale' as const;
      }
      actions.current.delete(id);
      if (fn) fn();
      else backend?.run(rec.undo!);
      mark(id, 'undone');
      return 'undone' as const;
    },
    [records, backend, mark],
  );

  const show = useCallback(
    (message: string, undo?: UndoAction, opts?: string | UndoOptions) => {
      const o = typeof opts === 'string' ? { action: opts } : (opts ?? {});
      const action = o.action ?? strings['undo.action'];
      const fn = typeof undo === 'function' ? undo : undefined;
      const ops = typeof undo === 'object' ? undo : undefined;
      const onUndo = fn ?? (ops ? () => backend?.run(ops) : undefined);
      let entry: number | null = null;
      if (onUndo && action === strings['undo.action']) {
        const id = ++n.current;
        entry = id;
        if (fn) actions.current.set(id, fn);
        const rec: RecentRecord = { id, message, at: nowMs(), state: 'open', undo: ops ?? null, lost: fn ? (o.lost ?? 'server') : null, fp: o.changed && backend ? backend.fingerprint(o.changed) : null };
        setRecords((r) => {
          for (const e of r.slice(config.RECENT_MAX - 1)) actions.current.delete(e.id);
          return [rec, ...r].slice(0, config.RECENT_MAX);
        });
      }
      setBar({ message, onUndo, action, n: ++n.current, entry });
    },
    [nowMs, backend],
  );

  useEffect(() => {
    if (!bar) return;
    // Przy VoiceOverze fokus na treść paska (czyta ją od razu) i bez znikania (D194).
    if (reader) {
      const t = setTimeout(() => focus.current && AccessibilityInfo.sendAccessibilityEvent(focus.current, 'focus'), 0);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setBar((b) => (b?.n === bar.n ? null : b)), config.UNDO_MS);
    return () => clearTimeout(t);
  }, [bar, reader]);

  const press = (b: Bar) => {
    setBar(null);
    if (b.entry === null) return b.onUndo?.();
    // Ta sama ścieżka co z listy: rzecz zmieniona w międzyczasie nie jest nadpisywana.
    if (undoRecent(b.entry) === 'stale') show(strings['recent.staleBar'](b.message));
  };

  const bindOpenRecent = useCallback((fn: (() => void) | null) => setOpenRecent(fn ? { fn } : null), []);
  const value = useMemo(() => ({ show, recent, undoRecent, bindOpenRecent }), [show, recent, undoRecent, bindOpenRecent]);
  const link = bar?.entry != null && openRecent ? openRecent.fn : null;
  const message = bar ? (
    <>
      <Text style={{ flexShrink: 1, fontFamily: font.text600, fontSize: size.META, color: c.inverseInk }}>{bar.message}</Text>
      {link ? <Text style={{ fontFamily: font.text700, fontSize: size.BODY, color: c.inverseInk }}>›</Text> : null}
    </>
  ) : null;
  return (
    <UndoContext.Provider value={value}>
      <View style={{ flex: 1 }}>
        {children}
        {bar ? (
          <View
            testID="undo-bar"
            accessibilityLiveRegion="polite"
            style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 72, flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 16, paddingRight: 6, minHeight: 52, borderRadius: 14, backgroundColor: c.inverseBg }}
          >
            {/* Treść paska otwiera „Ostatnie zmiany” (D194), gdy pasek jest zmianą do cofnięcia. */}
            {link ? (
              <Pressable
                ref={focus}
                testID="undo-message"
                accessibilityRole="button"
                accessibilityLabel={bar.message}
                accessibilityHint={strings['recent.openHint']}
                onPress={() => (setBar(null), link())}
                style={{ flex: 1, minHeight: size.TOUCH_TARGET, flexDirection: 'row', alignItems: 'center', gap: 6 }}
              >
                {message}
              </Pressable>
            ) : (
              <View ref={focus} testID="undo-message" accessible accessibilityLabel={bar.message} style={{ flex: 1, minHeight: size.TOUCH_TARGET, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {message}
              </View>
            )}
            {bar.onUndo ? (
              <Pressable accessibilityRole="button" accessibilityLabel={bar.action} onPress={() => press(bar)} style={{ minHeight: size.TOUCH_TARGET, paddingHorizontal: 14, justifyContent: 'center' }}>
                <Text style={{ fontFamily: font.text700, fontSize: size.BODY, color: c.inverseInk }}>{bar.action}</Text>
              </Pressable>
            ) : null}
            {reader ? (
              <Pressable testID="undo-close" accessibilityRole="button" accessibilityLabel={strings['common.close']} onPress={() => setBar(null)} style={{ minHeight: size.TOUCH_TARGET, paddingHorizontal: 10, justifyContent: 'center' }}>
                <Text style={{ fontFamily: font.text700, fontSize: size.BODY, color: c.inverseInk }}>{strings['common.close']}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </UndoContext.Provider>
  );
}

export const useUndo = (): Undo => useContext(UndoContext);
