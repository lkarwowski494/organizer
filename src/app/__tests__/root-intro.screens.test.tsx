/**
 * Animacja przy starcie w korzeniu aplikacji (ADR-0045): zimny start z nakładką, dane ładują się pod nią równolegle
 * (ukryte dla VoiceOvera i E2E do końca animacji), potem aplikacja; powrót z tła i proces obudzony w tle — bez animacji,
 * ekran startowy schowany od razu; „Ogranicz ruch”; błąd startu („Dane z nowszej wersji”) i zawieszone ładowanie nie
 * zostawiają nakładki ani ekranu startowego. Atrapy jak w trybie E2E (src/app/e2e.ts) — te same dane co scenariusze Maestro.
 */
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AccessibilityInfo, AppState } from 'react-native';

import { memoryDb } from '../../data/__tests__/sqlite';
import { intro } from '../../config/intro';
import { coldStartGate } from '../../domain/intro';
import { strings } from '../../i18n/strings.pl';
import { E2E_START_MS, e2eDeps } from '../e2e';
import { Root, type RootDeps } from '../Root';

jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);

const H_ = { includeHiddenElements: true } as const;
const raf = globalThis.requestAnimationFrame;
beforeEach(() => {
  globalThis.requestAnimationFrame = ((cb: (t: number) => void) => setTimeout(() => cb(performance.now()), 0)) as unknown as typeof raf;
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
});
afterEach(() => {
  globalThis.requestAnimationFrame = raf;
  jest.restoreAllMocks();
});

function deps(over: Partial<RootDeps> = {}, gate = coldStartGate()) {
  let n = 0;
  let clock = E2E_START_MS;
  const hideSplash = jest.fn();
  const d: RootDeps = {
    ...e2eDeps({ openDb: () => memoryDb(), newId: () => `0199b000-0000-7000-8000-${String(++n).padStart(12, '0')}`, isSimulator: async () => true, nowMs: () => clock }),
    setTimer: (fn, ms) => {
      const t = setTimeout(() => {
        clock += ms;
        fn();
      }, 0);
      return () => clearTimeout(t);
    },
    intro: { coldStart: gate, hideSplash },
    ...over,
  };
  return { d, hideSplash };
}

const gone = () => waitFor(() => expect(screen.queryByTestId('intro', H_)).toBeNull(), { timeout: intro.HOLD_MAX_MS + 2000 });

describe('animacja przy starcie w korzeniu aplikacji', () => {
  it('zimny start: nakładka od razu, „Moje sprawy” ładują się pod nią (ukryte dla VoiceOvera), potem aplikacja; ekran startowy schowany', async () => {
    const { d, hideSplash } = deps();
    await render(<Root deps={d} fontsLoaded />);
    expect(screen.getByTestId('intro', H_)).toBeTruthy();
    // Ekran startowy chowa nakładka po swoich klatkach (kolejność sprawdza intro.screens.test.tsx) — tu: zanim zniknie.
    await waitFor(() => expect(hideSplash).toHaveBeenCalled());
    expect(screen.getByTestId('intro', H_)).toBeTruthy();
    // Dane gotowe pod nakładką (równolegle), ale niewidoczne dla VoiceOvera i Maestro, dopóki trwa animacja.
    expect(await screen.findByTestId('screen-today', H_)).toBeTruthy();
    expect(screen.queryByTestId('screen-today')).toBeNull();
    await gone();
    expect(screen.getByTestId('screen-today')).toBeTruthy();
    expect(screen.getByLabelText(/^Oddać książki do biblioteki,/)).toBeTruthy();
    expect(hideSplash).toHaveBeenCalled();
  });

  it('proces obudzony w tle (ciche powiadomienie): bez animacji, ekran startowy schowany od razu; potem otwarcie aplikacji — też bez', async () => {
    const was = Object.getOwnPropertyDescriptor(AppState, 'currentState')!;
    Object.defineProperty(AppState, 'currentState', { value: 'background', configurable: true });
    const gate = coldStartGate();
    const { d, hideSplash } = deps({}, gate);
    await render(<Root deps={d} fontsLoaded />);
    expect(screen.queryByTestId('intro', H_)).toBeNull();
    expect(hideSplash).toHaveBeenCalledTimes(1);
    Object.defineProperty(AppState, 'currentState', was);
    await screen.unmount();
    await render(<Root deps={d} fontsLoaded />); // ponowne zamontowanie w tym samym procesie
    expect(screen.queryByTestId('intro', H_)).toBeNull();
    expect(await screen.findByTestId('screen-today')).toBeTruthy();
  });

  it('powrót z tła: korzeń zostaje, nakładka się nie pojawia', async () => {
    const handlers: ((s: string) => void)[] = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_e, fn) => {
      handlers.push(fn as (s: string) => void);
      return { remove: () => {} } as never;
    });
    const { d } = deps();
    await render(<Root deps={d} fontsLoaded />);
    await gone();
    await act(async () => handlers.forEach((h) => h('background')));
    await act(async () => handlers.forEach((h) => h('active')));
    expect(screen.queryByTestId('intro', H_)).toBeNull();
    expect(screen.getByTestId('screen-today')).toBeTruthy();
  });

  it('„Ogranicz ruch”: bez nakładki — aplikacja od razu po załadowaniu, ekran startowy schowany', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const { d, hideSplash } = deps();
    await render(<Root deps={d} fontsLoaded />);
    await waitFor(() => expect(screen.queryByTestId('intro', H_)).toBeNull());
    expect(hideSplash).toHaveBeenCalled();
    expect(await screen.findByTestId('screen-today')).toBeTruthy();
  });

  it('błąd startu — baza z nowszej wersji: nakładka znika, widać wyjaśnienie (nie ekran startowy)', async () => {
    const db = memoryDb();
    db.exec('pragma user_version = 999');
    const { d, hideSplash } = deps({ openDb: () => db });
    await render(<Root deps={d} fontsLoaded />);
    await gone();
    expect(screen.getByTestId('screen-newer-data')).toBeTruthy();
    expect(hideSplash).toHaveBeenCalled();
  });

  it('zawieszone ładowanie (sesja bez odpowiedzi): po HOLD_MAX_MS nakładka i tak znika — widać „Ładowanie…”', async () => {
    const { d, hideSplash } = deps({ session: { current: () => new Promise(() => {}), onChange: () => () => {} } });
    await render(<Root deps={d} fontsLoaded />);
    await act(() => new Promise<void>((r) => setTimeout(r, intro.TOTAL_MS + 200)));
    expect(screen.getByTestId('intro', H_)).toBeTruthy(); // ikona czeka na dane
    await gone();
    expect(screen.getByText(strings['app.loading'])).toBeTruthy();
    expect(hideSplash).toHaveBeenCalled();
  }, 15_000);

  it('bez deps.intro (testy ekranów): bez nakładki i bez chowania ekranu startowego', async () => {
    const { d } = deps();
    delete d.intro;
    await render(<Root deps={d} fontsLoaded />);
    expect(screen.queryByTestId('intro', H_)).toBeNull();
    expect(await screen.findByTestId('screen-today')).toBeTruthy();
  });
});

describe('E2E i audyt dostępności czekają na ekran, nie na nakładkę', () => {
  const root = join(__dirname, '../../..');
  it('każdy scenariusz Maestro startuje przez common/launch.yaml, a po launchApp czeka na „Moje sprawy” (treść ukryta do końca animacji)', () => {
    const launch = readFileSync(join(root, '.maestro/common/launch.yaml'), 'utf8');
    const steps = launch.split('---')[1]!.split(/\n(?=- )/).map((s) => s.trim()).filter(Boolean);
    expect(steps[0]).toMatch(/^- launchApp:/);
    expect(steps[1]).toMatch(/^- extendedWaitUntil:\s+visible:\s+id: "screen-today"/);
    const flows = readdirSync(join(root, '.maestro')).filter((f) => /^\d\d-.*\.yaml$/.test(f));
    expect(flows.length).toBeGreaterThan(5);
    for (const f of flows) {
      const text = readFileSync(join(root, '.maestro', f), 'utf8');
      expect([f, /runFlow: common\/launch\.yaml/.test(text), /launchApp/.test(text)]).toEqual([f, true, false]);
    }
  });

  it('audyt XCUITest czeka na „Moje sprawy” po starcie aplikacji (element ukryty, dopóki trwa animacja)', () => {
    const swift = readFileSync(join(root, 'e2e/a11y/AccessibilityAuditTests.swift'), 'utf8');
    expect(swift).toMatch(/app\.launch\(\)[^\n]*\n\s*XCTAssertTrue\(element\("screen-today"\)\.waitForExistence\(timeout: \d+\)/);
  });

});
