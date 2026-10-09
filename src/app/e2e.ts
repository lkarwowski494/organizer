/**
 * Tryb testów E2E (D143): build symulatora z EXPO_PUBLIC_E2E=1 (tylko .github/workflows/e2e.yml) dostaje zamiast
 * Supabase i natywnych modułów atrapy w pamięci — zalogowaną osobę demo, mały „serwer” z grupą rodzinną, stały zegar
 * i ciche kalendarz, powiadomienia i dojazd. Dzięki temu Maestro (.maestro/) przechodzi prawdziwe ekrany bez sieci,
 * bez logowania i bez Dockera na runnerze macOS, a zrzuty ekranu są powtarzalne.
 *
 * Bezpieczeństwo: (1) flagi nie ustawia żaden inny workflow ani konfiguracja buildu wydania — pilnuje tego test
 * kontraktowy src/app/__tests__/e2e-flag.test.ts; (2) nawet z flagą sesja demo powstaje tylko na symulatorze
 * (`isSimulator`, w wiring.ts: Application.getIosApplicationReleaseTypeAsync() === SIMULATOR), inaczej ekran logowania
 * bez działającego logowania. Kod produkcyjny nie importuje plików testów — serwer poniżej stosuje model reguł serwera
 * z src/domain/server-rules.ts (ten sam co atrapa w testach ekranów, zgodny z SQL — tests/db/rules-vs-sql.test.ts).
 */
import type { DbAdapter } from '../data/db/adapter';
import { applyOnServer, serverVerdict } from '../domain/server-rules';
import { type Entity, type PulledRow, type PullRequest, type PullResponse, type PushResponse, type Row, rowKey } from '../domain/sync-engine/client';
import { LEGACY_KEYS } from './account-prefs';
import { WHATS_NEW_SEEN } from '../features/today/WhatsNew';
import { WELCOME_SEEN } from '../features/welcome/WelcomeScreen';
import type { AccountApi } from '../sync/account';
import type { PushRequest, SyncTransport } from '../sync/transport';
import type { DevicePush } from './push';
import type { RootDeps, Session } from './Root';

/**
 * Początek zegara: środa 7.10.2026, 08:00 UTC (10:00 w Polsce). Zegar dalej płynie od tej chwili, więc liczniki
 * czasu w pętli synchronizacji działają, a dni i godziny na ekranach są takie same w każdym przebiegu. Godziny wydarzeń
 * to czas lokalny (pola start_time), więc strefa symulatora (na runnerach GitHuba UTC) nie zmienia dnia „dziś”.
 */
export const E2E_START_MS = Date.UTC(2026, 9, 7, 8, 0);
export function e2eClock(real: () => number = Date.now): () => number {
  const started = real();
  return () => E2E_START_MS + (real() - started);
}

const uuid = (n: number) => `0199a000-0000-7000-8000-${String(n).padStart(12, '0')}`;
/** Identyfikatory danych demo (stałe — scenariusze Maestro mogą ich używać w selektorach `id`). */
export const E2E_IDS = {
  me: uuid(1),
  ala: uuid(2),
  family: uuid(10),
  meInFamily: uuid(11),
  alaInFamily: uuid(12),
  tymek: uuid(13),
  personalList: uuid(20),
  homeList: uuid(21),
  shoppingList: uuid(22),
  swimming: uuid(30),
} as const;
const I = E2E_IDS;

export const E2E_SESSION: Session = { userId: I.me, displayName: 'Łukasz' };

type Seed = { e: Entity; row: Row };

/** Dane startowe: grupa osobista i „Rodzina” (ja i Ala — dorośli, Tymek — profil dziecka bez konta). */
export function e2eSeed(): Seed[] {
  const at = '2026-09-01T08:00:00Z';
  const group = (id: string, name: string, kind: 'personal' | 'shared'): Seed => ({ e: 'groups', row: { id, name, kind, created_at: at, deleted_at: null } });
  const member = (member_id: string, group_id: string, user_id: string | null, display_name: string, role: string): Seed => ({
    e: 'group_members',
    row: { member_id, group_id, user_id, display_name, role, created_at: at, deleted_at: null },
  });
  const list = (id: string, group_id: string, name: string, kind: 'tasks' | 'shopping'): Seed => ({
    e: 'lists',
    row: { id, group_id, kind, name, visibility: 'group', owner_member_id: null, sort_key: 'a0', deleted_at: null },
  });
  let n = 100;
  const task = (list_id: string, group_id: string, title: string, extra: Row = {}): Seed => ({
    e: 'tasks',
    row: {
      id: uuid(++n), group_id, list_id, parent_id: null, title, note: null, sort_key: `a${n}`, assignee_member_id: null,
      deadline_mode: 'none', due_date: null, due_time: null, start_date: null, completed_at: null, deleted_at: null, ...extra,
    },
  });
  return [
    group(I.me, 'Osobiste', 'personal'),
    member(I.me, I.me, I.me, E2E_SESSION.displayName, 'owner'),
    group(I.family, 'Rodzina', 'shared'),
    member(I.meInFamily, I.family, I.me, E2E_SESSION.displayName, 'owner'),
    member(I.alaInFamily, I.family, I.ala, 'Ala', 'member'),
    member(I.tymek, I.family, null, 'Tymek', 'child'),
    list(I.personalList, I.me, 'Moje', 'tasks'),
    list(I.homeList, I.family, 'Dom', 'tasks'),
    list(I.shoppingList, I.family, 'Zakupy', 'shopping'),
    task(I.personalList, I.me, 'Oddać książki do biblioteki', { deadline_mode: 'own', due_date: '2026-10-07' }),
    task(I.homeList, I.family, 'Odebrać paczkę', { deadline_mode: 'own', due_date: '2026-10-07', due_time: '18:00:00', assignee_member_id: I.meInFamily }),
    task(I.homeList, I.family, 'Zapłacić za obiady Tymka', { deadline_mode: 'own', due_date: '2026-10-09', assignee_member_id: I.meInFamily }),
    task(I.homeList, I.family, 'Umówić przegląd auta', { assignee_member_id: I.alaInFamily }),
    task(I.shoppingList, I.family, 'Chleb żytni'),
    task(I.shoppingList, I.family, '2 jogurty'),
    task(I.shoppingList, I.family, 'Masło', { completed_at: '2026-10-06T16:00:00Z' }),
    {
      e: 'events',
      row: {
        id: I.swimming, group_id: I.family, title: 'Basen Tymka', note: null, location: null, start_date: '2026-09-02', start_time: '17:00:00', end_time: '18:00:00',
        rrule: 'FREQ=WEEKLY;BYDAY=WE', audience: 'group', responsible_member_id: I.meInFamily, deleted_at: null,
      },
    },
  ];
}

const groupOf = (e: Entity, row: Row) => String(e === 'groups' ? row.id : row.group_id);

/**
 * „Serwer” w pamięci z semantyką sync_push / sync_pull (supabase/migrations/20261006120200_sync.sql): każda zmiana
 * podnosi wersję grupy, pobranie oddaje wiersze nowsze niż kursor, powtórzona operacja (seq ≤ ostatni) to duplikat,
 * a odrzucenie wraca przy powtórce z tym samym kodem (M-56). Reguły i skutki jak na serwerze (audyt 2, M-50): model
 * reguł (role, dziecko, widoczność list, kosz grupy, usunięte listy i wiersze) odrzuca operację z kodem, a przyjęta
 * dostaje wartości domyślne, pola serwera, kaskady i skutek przyjęcia przekazania (applyOnServer). Osoba demo jest jedna
 * (E2E_SESSION).
 */
export class E2eServer {
  private readonly rows = new Map<string, PulledRow>();
  private readonly versions = new Map<string, number>();
  private readonly lastSeq = new Map<string, number>();
  private readonly rejections = new Map<string, Map<number, { opId: string; code: string }>>();

  constructor(
    seed: readonly Seed[],
    private readonly nowIso: () => string,
    private readonly user: string = E2E_SESSION.userId,
  ) {
    for (const s of seed) this.put(s.e, s.row);
  }

  private put(e: Entity, row: Row): void {
    const g = groupOf(e, row);
    const v = (this.versions.get(g) ?? 0) + 1;
    this.versions.set(g, v);
    this.rows.set(`${e}:${rowKey(e, row)}`, { e, v, row: { ...row, version: v } });
  }

  /** Wiersze serwera jako tabele (encja → klucz → wiersz). */
  private tables(): { [e: string]: { [k: string]: Row } } {
    const t: { [e: string]: { [k: string]: Row } } = {};
    for (const r of this.rows.values()) (t[r.e] ??= {})[rowKey(r.e, r.row)] = r.row;
    return t;
  }

  /** Kod odrzucenia albo null; przyjęta operacja zapisuje zmienione wiersze z nowymi wersjami grup. */
  private apply(op: PushRequest['ops'][number]): string | null {
    const tables = this.tables();
    const code = serverVerdict(tables, this.user, op);
    if (code) return code;
    applyOnServer(tables, this.user, op, this.nowIso());
    for (const [e, rows] of Object.entries(tables)) {
      for (const row of Object.values(rows)) {
        if (this.rows.get(`${e}:${rowKey(e as Entity, row)}`)?.row !== row) this.put(e as Entity, row);
      }
    }
    return null;
  }

  push(req: PushRequest): PushResponse {
    let last = this.lastSeq.get(req.client_id) ?? 0;
    const remembered = this.rejections.get(req.client_id) ?? new Map<number, { opId: string; code: string }>();
    this.rejections.set(req.client_id, remembered);
    const results: PushResponse['results'] = req.ops.map((op) => {
      if (op.seq <= last) {
        const r = remembered.get(op.seq);
        return r && r.opId === op.op_id ? { seq: op.seq, status: 'rejected', code: r.code } : { seq: op.seq, status: 'duplicate' };
      }
      last = op.seq;
      const code = this.apply(op);
      if (code === null) return { seq: op.seq, status: 'ok' };
      remembered.set(op.seq, { opId: op.op_id, code });
      return { seq: op.seq, status: 'rejected', code };
    });
    this.lastSeq.set(req.client_id, last);
    return { last_seq: last, results };
  }

  /** Bez czyszczenia kosza i bez uprawnień: epoka zawsze 0, bez resync, list widocznych i „gone” (protokół 2, pola opcjonalne). */
  pull(req: Pick<PullRequest, 'cursors'>, limit: number): PullResponse {
    const groups = [...this.versions.keys()].sort().map((group_id) => {
      const since = req.cursors[group_id]?.v ?? 0;
      const fresh = [...this.rows.values()].filter((r) => groupOf(r.e, r.row) === group_id && r.v > since).sort((a, b) => a.v - b.v);
      const rows = fresh.slice(0, limit);
      const has_more = fresh.length > rows.length;
      return { group_id, cursor: has_more ? rows.at(-1)!.v : Math.max(since, this.versions.get(group_id)!), has_more, resync: false, rows };
    });
    return { groups, scopes: [] };
  }

  /** Nowa grupa jak RPC create_group: grupa i jej właściciel. */
  createGroup(a: { groupId: string; name: string; ownerMemberId: string; displayName: string }, userId: string): void {
    const at = this.nowIso();
    this.put('groups', { id: a.groupId, name: a.name, kind: 'shared', created_at: at, deleted_at: null });
    this.put('group_members', { member_id: a.ownerMemberId, group_id: a.groupId, user_id: userId, display_name: a.displayName, role: 'owner', created_at: at, deleted_at: null });
  }
}

export function e2eTransport(server: E2eServer): SyncTransport {
  return {
    push: async (req) => server.push(req),
    pull: async (req, limit) => server.pull(req, limit),
    fetchScope: async () => [],
  };
}

const ok = async () => {};
/** Konto bez serwera. Operacje, których scenariusze nie potrzebują (zaproszenia z kodem), kończą się błędem jak bez sieci. */
export function e2eAccount(server: E2eServer, auth: { signIn(): Promise<void>; signOut(): void }): AccountApi {
  const offline = async (): Promise<never> => {
    throw new Error('e2e_offline');
  };
  return {
    signInWithApple: auth.signIn,
    signOut: async () => auth.signOut(),
    deleteAccount: async (before) => {
      await before?.();
      auth.signOut();
    },
    finishSignOut: ok,
    setMyName: ok,
    createGroup: async (a) => server.createGroup(a, E2E_SESSION.userId),
    createInvite: offline,
    acceptInvite: offline,
    revokeInvite: ok,
    createJoinCode: offline,
    renewJoinCode: offline,
    createChildCode: offline,
    renewChildCode: offline,
    joinGroup: offline,
    rotateJoinId: offline,
    deleteGroup: offline,
    restoreGroup: offline,
    transferOwnership: offline,
    registerPushToken: ok,
    notifyHandoff: ok,
    notifyAssignment: ok,
    notifyGroups: async () => ({ retryInSec: null }),
    getPushMutes: async () => [],
    setPushMute: ok,
    reportError: ok,
    sendFeedback: ok,
  };
}

/** Powiadomienia wyłączone (status „denied”), więc nie pokazujemy prośby i nie pytamy systemu o zgodę. */
export const e2ePush: DevicePush = {
  status: async () => 'denied',
  request: async () => false,
  token: async () => null,
  onToken: () => () => {},
  onOpen: () => () => {},
  env: async () => 'sandbox',
  replaceReminders: ok,
};

/** Drobne ustawienia telefonu (nie konta) w pamięci. */
export function e2ePrefs(): NonNullable<RootDeps['prefs']> {
  const m = new Map<string, string>();
  return { get: async (k) => m.get(k) ?? null, set: async (k, v) => void m.set(k, v) };
}

/**
 * Ustawienia konta na start (D175 — trzymane w bazie konta, a ta w E2E jest w pamięci): wprowadzenie i „Co nowego” już
 * obejrzane, żeby nie zasłaniały ekranów. Podane jak dawne ustawienia z pęku kluczy, które konto przejmuje przy
 * zalogowaniu — za każdym razem (bez usuwania), bo każde zalogowanie w E2E ma świeżą bazę.
 */
export function e2eLegacyPrefs(): NonNullable<RootDeps['legacyPrefs']> {
  const m = new Map<string, string>([
    [LEGACY_KEYS[WELCOME_SEEN]!, '1'],
    [LEGACY_KEYS[WHATS_NEW_SEEN]!, String(Number.MAX_SAFE_INTEGER)],
  ]);
  return { get: async (k) => m.get(k) ?? null, remove: ok };
}

export type E2eNative = {
  /** Świeża baza w pamięci przy każdym starcie — tak jak serwer w pamięci. */
  openDb(userId: string): DbAdapter;
  newId(): string;
  /** Druga bariera: sesja demo tylko na symulatorze iOS. */
  isSimulator(): Promise<boolean>;
  nowMs?: () => number;
};

export function e2eDeps(native: E2eNative): RootDeps {
  const nowMs = native.nowMs ?? e2eClock();
  const server = new E2eServer(e2eSeed(), () => new Date(nowMs()).toISOString());
  const listeners = new Set<(s: Session | null) => void>();
  let signedIn = true;
  const emit = () => listeners.forEach((fn) => fn(signedIn ? E2E_SESSION : null));
  const allowed = native.isSimulator().catch(() => false);
  const account = e2eAccount(server, {
    signIn: async () => {
      if (!(await allowed)) throw new Error('e2e_not_simulator');
      signedIn = true;
      emit();
    },
    signOut: () => {
      signedIn = false;
      emit();
    },
  });
  let appearance: string | null = null;
  return {
    session: {
      current: async () => ((await allowed) && signedIn ? E2E_SESSION : null),
      onChange: (fn) => (listeners.add(fn), () => void listeners.delete(fn)),
    },
    account,
    calendar: { add: async () => 'canceled' },
    push: e2ePush,
    prefs: e2ePrefs(),
    legacyPrefs: e2eLegacyPrefs(),
    appearance: { load: async () => appearance, save: async (a) => void (appearance = a) },
    transport: e2eTransport(server),
    openDb: native.openDb,
    newId: native.newId,
    subscribe: () => () => {},
    links: { onUrl: () => () => {} },
    nowMs,
  };
}
