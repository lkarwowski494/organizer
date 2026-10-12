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
 *    działa tylko poza iOS (https://reactnative.dev/docs/0.86/accessibility#accessibilityliveregion-android).
 */
import { createContext, type ReactNode, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { config } from '../config';
import type { NewOp } from '../domain/sync-engine/client';
import { type Fingerprint, parseRecent, type RecentLost, type RecentRecord, type RecentUndo } from '../domain/views/recent';
import { strings } from '../i18n/strings.pl';
import { announce, focusLater, pinFocus, spoken, useScreenReader } from './a11y';
import { Glyph } from './glyph';
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
 * Cofnięcie przez serwer (grupa: usunięcie i przywrócenie). Audyt 3 (N-34): wynik znamy dopiero po odpowiedzi, więc wpis
 * jest „w toku”, a po błędzie (np. brak internetu) wraca do „Cofnij”, z paskiem „Nie cofnięto: … · Spróbuj ponownie” —
 * jeden komunikat niezależnie od ekranu, z którego cofamy. `failed` — tekst błędu dla osoby.
 */
export type AsyncUndo = { run: () => Promise<unknown>; failed: (e: unknown) => string };

/**
 * Cofnięcie: operacje (zapisywane w bazie konta — działają też po ponownym uruchomieniu), operacje według przepisu
 * liczone w chwili cofnięcia (rutyna) albo funkcja (tylko w tym uruchomieniu; także przez serwer — AsyncUndo).
 */
export type UndoAction = RecentUndo | (() => void) | AsyncUndo;

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
  /**
   * Cofnięcie z listy; „stale” — rzecz się zmieniła, niczego nie zmieniamy; „gone” — już cofnięte, w toku albo
   * niemożliwe; „pending” — czekamy na serwer (wynik: wpis „Cofnięto” albo pasek błędu).
   */
  undoRecent: (id: number) => 'undone' | 'stale' | 'gone' | 'pending';
  /** Nawigacja do „Ostatnich zmian” (podpina ją komponent wewnątrz nawigacji). */
  bindOpenRecent: (fn: (() => void) | null) => void;
};
const UndoContext = createContext<Undo>({ show: () => {}, recent: [], undoRecent: () => 'gone', bindOpenRecent: () => {} });

/**
 * Wysokość widocznego paska „Cofnij” (0 — brak paska). Screen dodaje tyle miejsca pod treścią (audyt 2, M-149), żeby
 * pasek nie zasłaniał ostatnich przycisków, np. „Usuń listę” po usunięciu ostatniej pozycji.
 */
const UndoBarContext = createContext(0);
export const useUndoBarHeight = () => useContext(UndoBarContext);

type Bar = { message: string; onUndo?: () => void; action: string; n: number; listed: boolean };

export function UndoProvider({ children, nowMs = Date.now, backend }: { children: ReactNode; nowMs?: () => number; backend?: UndoBackend }) {
  const { c, font, size, layout, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const [bar, setBar] = useState<Bar | null>(null);
  // Zmierzona wysokość paska (rośnie z Dynamic Type); do pierwszego pomiaru — najmniejsza.
  const [barHeight, setBarHeight] = useState<number>(layout.UNDO_BAR_MIN_HEIGHT);
  // D194 b: lista z bazy konta (przeżywa ponowne uruchomienie).
  const [records, setRecords] = useState<readonly RecentRecord[]>(() => parseRecent(backend?.load() ?? null));
  const reader = useScreenReader();
  const [openRecent, setOpenRecent] = useState<{ fn: () => void } | null>(null);
  const n = useRef(Math.max(0, ...records.map((r) => r.id)));
  // Cofnięcia-funkcje (tylko w tym uruchomieniu).
  const actions = useRef(new Map<number, (() => void) | AsyncUndo>());
  const focus = useRef<View>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) return void (first.current = false);
    backend?.save(JSON.stringify(records));
  }, [records, backend]);
  const recent = useMemo(() => records.map(({ id, message, at, state, lost }) => ({ id, message, at, state, lost })), [records]);

  const retry = useRef<(id: number, message: string) => void>(() => {});
  const mark = useCallback((id: number, state: RecentRecord['state']) => setRecords((r) => r.map((e) => (e.id === id ? { ...e, state, ...(state === 'undone' ? { undo: null } : {}) } : e))), []);

  const show = useCallback(
    (message: string, undo?: UndoAction, opts?: string | UndoOptions) => {
      const o = typeof opts === 'string' ? { action: opts } : (opts ?? {});
      const action = o.action ?? strings['undo.action'];
      const fn = typeof undo === 'function' ? undo : undefined;
      const later = undo && 'run' in undo ? undo : undefined;
      const ops = undo && 'ops' in undo ? undo : undefined;
      let onUndo = fn ?? (ops ? () => backend?.run(ops) : undefined);
      // Cofnięcie przez serwer zawsze jest zmianą do cofnięcia (wpis na liście), bo tylko tam widać jego wynik.
      const listed = (onUndo !== undefined && action === strings['undo.action']) || later !== undefined;
      if (listed) {
        const id = ++n.current;
        // Z paska ta sama ścieżka co z listy (sprawdzenie zmian w międzyczasie, stan „w toku”).
        onUndo = () => retry.current(id, message);
        const run = fn ?? later;
        if (run) actions.current.set(id, run);
        const rec: RecentRecord = { id, message, at: nowMs(), state: 'open', undo: ops ?? null, lost: fn || later ? (o.lost ?? 'server') : null, fp: o.changed && backend ? backend.fingerprint(o.changed) : null };
        setRecords((r) => {
          for (const e of r.slice(config.RECENT_MAX - 1)) actions.current.delete(e.id);
          return [rec, ...r].slice(0, config.RECENT_MAX);
        });
      }
      setBar({ message, onUndo, action, n: ++n.current, listed });
    },
    [nowMs, backend],
  );

  const undoRecent = useCallback(
    (id: number) => {
      const rec = records.find((e) => e.id === id);
      const fn = actions.current.get(id);
      if (!rec || rec.state === 'undone' || rec.state === 'lost' || rec.state === 'pending' || (!fn && !rec.undo)) return 'gone' as const;
      if (rec.fp && backend?.isStale(rec.fp)) {
        mark(id, 'stale');
        return 'stale' as const;
      }
      if (fn && typeof fn !== 'function') {
        // N-34: „Cofnięto” dopiero po odpowiedzi serwera; po błędzie wpis wraca do „Cofnij” (cofnięcie zostaje w pamięci).
        mark(id, 'pending');
        fn.run().then(
          () => {
            actions.current.delete(id);
            mark(id, 'undone');
            announce(strings['recent.undone']);
          },
          (e: unknown) => {
            mark(id, 'open');
            show(strings['undo.failed'](rec.message, fn.failed(e)), () => retry.current(id, rec.message), strings['common.retry']);
          },
        );
        return 'pending' as const;
      }
      actions.current.delete(id);
      if (fn) fn();
      else backend?.run(rec.undo!);
      mark(id, 'undone');
      return 'undone' as const;
    },
    [records, backend, mark, show],
  );
  // Z paska (także „Spróbuj ponownie” po błędzie): ta sama ścieżka co z listy — rzecz zmieniona w międzyczasie nie jest
  // nadpisywana. Przez ref, bo pasek powstaje przed zmianą listy (undoRecent zależy od listy).
  useLayoutEffect(() => {
    retry.current = (id, message) => {
      if (undoRecent(id) === 'stale') show(strings['recent.staleBar'](message));
    };
  }, [undoRecent, show]);

  useEffect(() => {
    if (!bar) return;
    // Przy VoiceOverze fokus na treść paska (czyta ją od razu) i bez znikania (D194).
    // Pierwszeństwo przed tytułem ekranu, na który zaraz przechodzimy (np. usunięcie na ekranie zadania i powrót).
    if (reader) {
      pinFocus(() => focusLater(focus));
      const cancel = focusLater(focus);
      return () => (cancel(), pinFocus(null));
    }
    const t = setTimeout(() => setBar((b) => (b?.n === bar.n ? null : b)), config.UNDO_MS);
    return () => clearTimeout(t);
  }, [bar, reader]);

  const press = (b: Bar) => {
    setBar(null);
    b.onUndo?.();
  };

  const bindOpenRecent = useCallback((fn: (() => void) | null) => setOpenRecent(fn ? { fn } : null), []);
  const value = useMemo(() => ({ show, recent, undoRecent, bindOpenRecent }), [show, recent, undoRecent, bindOpenRecent]);
  const link = bar?.listed && openRecent ? openRecent.fn : null;
  const message = bar ? (
    <>
      <Text style={{ flexShrink: 1, fontFamily: font.text600, fontSize: size.META, color: c.inverseInk }}>{bar.message}</Text>
      {link ? <Glyph name="next" color={c.inverseInk} /> : null}
    </>
  ) : null;
  return (
    <UndoContext.Provider value={value}>
      <UndoBarContext.Provider value={bar ? barHeight : 0}>
        <View style={{ flex: 1 }}>
          {children}
          {bar ? (
            // M-294: na iPadzie pasek tej samej szerokości co treść ekranu, wyśrodkowany.
            <View pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + layout.UNDO_BAR_OFFSET, alignItems: 'center' }}>
              <View
                testID="undo-bar"
                accessibilityLiveRegion="polite"
                onLayout={(e) => setBarHeight(e.nativeEvent.layout.height)}
                style={{ width: '100%', maxWidth: layout.CONTENT_MAX_WIDTH, flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 16, paddingRight: 6, minHeight: layout.UNDO_BAR_MIN_HEIGHT, borderRadius: radius.PANEL, backgroundColor: c.inverseBg }}
              >
                {/* Treść paska otwiera „Ostatnie zmiany” (D194), gdy pasek jest zmianą do cofnięcia. */}
                {link ? (
                  <Pressable
                    ref={focus}
                    testID="undo-message"
                    accessibilityRole="button"
                    accessibilityLabel={spoken(bar.message)}
                    accessibilityHint={strings['recent.openHint']}
                    onPress={() => (setBar(null), link())}
                    style={{ flex: 1, minHeight: size.TOUCH_TARGET, flexDirection: 'row', alignItems: 'center', gap: 6 }}
                  >
                    {message}
                  </Pressable>
                ) : (
                  <View ref={focus} testID="undo-message" accessible accessibilityLabel={spoken(bar.message)} style={{ flex: 1, minHeight: size.TOUCH_TARGET, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
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
            </View>
          ) : null}
        </View>
      </UndoBarContext.Provider>
    </UndoContext.Provider>
  );
}

export const useUndo = (): Undo => useContext(UndoContext);
