/**
 * Serwer w pamięci z semantyką sync_push / sync_pull (supabase/migrations/20261006120200_sync.sql, protokół 2:
 * 20261008310000_sync_protocol_v2.sql) dla podzbioru danych: grupy, członkostwa z rolami, listy (group / restricted /
 * private), zadania, przeniesienie zadania (move_task), czyszczenie kosza z epoką (purged_version), resync.
 * Do symulacji wielu klientów w testach własności — zgodność z prawdziwym SQL sprawdzają pgTAP i
 * tests/db/fake-vs-sql.test.ts.
 */
import type { Op, PulledRow, PullRequest, PullResponse, PushResponse, Row } from '../../sync-engine/client';

type Stored = { [k: string]: unknown; version: number; deleted_at: string | null };
export type Role = 'owner' | 'admin' | 'member' | 'child';
type Member = { role: Role; deleted: boolean; version: number };
type Group = { version: number; purged: number; members: Map<string, Member> };

/** Pola wewnętrzne symulatora (nie wysyła ich serwer): twórca listy i chwila usunięcia (zegar symulacji). */
const INTERNAL = ['owner', 'deletedAt'] as const;

export class FakeServer {
  readonly groups = new Map<string, Group>();
  readonly lists = new Map<string, Stored>();
  readonly tasks = new Map<string, Stored>();
  readonly allowed = new Map<string, Set<string>>(); // lista restricted → użytkownicy z dostępem
  readonly clients = new Map<string, { user: string; lastSeq: number; rejections: Map<number, { opId: string; code: string }> }>();
  /** Ile razy każda operacja (op_id) została faktycznie zastosowana — idempotencja wymaga ≤ 1. */
  readonly applied = new Map<string, number>();
  readonly rejectedOps = new Map<string, string>();
  /** Ile razy powtórka dostała zapamiętane odrzucenie zamiast „duplicate” (M-56) — statystyka symulacji. */
  recalled = 0;
  /** Przeniesienia zadań między listami (ślad jak wpis aktywności z changes.list_id) — do „gone” w pobieraniu. */
  private readonly moves: { task: string; from: string; version: number; group: string }[] = [];
  private clock = 0;

  /** Grupa z członkami; pierwszy jest właścicielem, reszta dorosłymi członkami, chyba że `roles` mówi inaczej. */
  addGroup(id: string, members: string[], roles: Readonly<Record<string, Role>> = {}): void {
    const g: Group = { version: 0, purged: 0, members: new Map() };
    this.groups.set(id, g);
    members.forEach((u, i) => g.members.set(u, { role: roles[u] ?? (i === 0 ? 'owner' : 'member'), deleted: false, version: this.bump(id) }));
  }

  /** Wyjście z grupy: wiersz członkostwa usunięty (miękko), dostęp do list ograniczonych odebrany (jak SQL). */
  removeMember(group: string, user: string): void {
    const m = this.member(group, user);
    if (!m) return;
    this.groups.get(group)!.members.set(user, { ...m, deleted: true, version: this.bump(group) });
    for (const [id, set] of this.allowed) if (this.lists.get(id)?.group_id === group) set.delete(user);
  }

  /** Powrót przez zaproszenie: ten sam wiersz członkostwa, bez dawnych dostępów do list ograniczonych. */
  rejoin(group: string, user: string): void {
    const m = this.groups.get(group)!.members.get(user);
    if (!m?.deleted) return;
    this.groups.get(group)!.members.set(user, { ...m, deleted: false, version: this.bump(group) });
  }

  /** Zmiana roli przez właściciela (dziecko może tylko odhaczać — D34). */
  setRole(group: string, user: string, role: Role): void {
    const m = this.member(group, user);
    if (!m || m.role === role) return;
    this.groups.get(group)!.members.set(user, { ...m, role, version: this.bump(group) });
  }

  private bump(group: string): number {
    const g = this.groups.get(group)!;
    g.version += 1;
    return g.version;
  }

  private childOwns(task: Stored, me: string): boolean {
    let cur: Stored | undefined = task;
    for (let step = 0; cur && step < 8; step++) {
      if (cur.assignee_member_id != null) return cur.assignee_member_id === me;
      cur = cur.parent_id == null ? undefined : this.tasks.get(String(cur.parent_id));
    }
    return false;
  }

  private member(group: string, user: string): Member | undefined {
    const m = this.groups.get(group)?.members.get(user);
    return m && !m.deleted ? m : undefined;
  }

  private canSeeList(user: string, l: Stored | undefined): boolean {
    if (!l || !this.member(String(l.group_id), user)) return false;
    if (l.visibility === 'group' || l.owner === user) return true;
    return l.visibility === 'restricted' && (this.allowed.get(String(l.id))?.has(user) ?? false);
  }

  private canSee(user: string, entity: string, row: Stored | undefined): boolean {
    if (!row) return false;
    if (entity === 'lists') return this.canSeeList(user, row);
    return this.canSeeList(user, this.lists.get(String(row.list_id)));
  }

  private table(entity: string): Map<string, Stored> {
    if (entity === 'lists') return this.lists;
    if (entity === 'tasks') return this.tasks;
    throw new Error('unknown_entity');
  }

  private cmd(user: string, op: Extract<Op, { kind: 'cmd' }>): string {
    if (op.cmd === 'move_task') {
      // Jak private.move_task: widoczne zadanie, dorosły, żywe zadanie; nowa lista jak w tasks_guard.
      const t = this.tasks.get(String(op.args.id));
      if (!t || !this.canSee(user, 'tasks', t)) throw new Error('not_found');
      const g = String(t.group_id);
      if (this.member(g, user)!.role === 'child') throw new Error('forbidden');
      if (t.deleted_at) throw new Error('deleted');
      const to = this.lists.get(String(op.args.list_id));
      if (!to || to.group_id !== g) throw new Error('invalid_list');
      if (to.deleted_at) throw new Error('deleted:list');
      if (!this.canSeeList(user, to)) throw new Error('forbidden');
      const version = this.bump(g);
      if (to.id !== t.list_id) this.moves.push({ task: String(t.id), from: String(t.list_id), version, group: g });
      this.tasks.set(String(t.id), { ...t, list_id: to.id, version });
      return g;
    }
    const l = this.lists.get(String(op.args.list_id));
    if (!l || !this.canSeeList(user, l)) throw new Error('not_found');
    if (l.owner !== user) throw new Error('forbidden:not_list_owner');
    // Jak SQL (20261008290000_grant_deleted_list): listy z kosza nie udostępniamy.
    if (op.cmd === 'grant_scope' && l.deleted_at) throw new Error('deleted:list');
    // Udostępnić można tylko członkowi grupy (object_members_guard: invalid_member).
    if (op.cmd === 'grant_scope' && !this.member(String(l.group_id), String(op.args.user))) throw new Error('invalid_member');
    const set = this.allowed.get(String(l.id)) ?? new Set<string>();
    if (op.cmd === 'grant_scope') set.add(String(op.args.user));
    else set.delete(String(op.args.user));
    this.allowed.set(String(l.id), set);
    return String(l.group_id);
  }

  private applyOne(user: string, op: Op): string {
    if (op.kind === 'cmd') return this.cmd(user, op);
    const t = this.table(op.entity);
    const row = t.get(op.id);
    if (op.kind === 'create') {
      if (row) {
        // Powtórzone utworzenie (id nadaje klient) — o ile wiersz widzę; cudzy, niewidoczny = konflikt klucza.
        if (!this.canSee(user, op.entity, row)) throw new Error('invalid:23505');
        return String(row.group_id);
      }
      const m = this.member(op.group_id, user);
      if (!m) throw new Error('forbidden');
      if (m.role === 'child') throw new Error('forbidden:child');
      if (op.entity === 'tasks') {
        const l = this.lists.get(String(op.set.list_id));
        if (!l || String(l.group_id) !== op.group_id) throw new Error('invalid_list');
        if (l.deleted_at) throw new Error('deleted:list');
        if (!this.canSeeList(user, l)) throw new Error('forbidden');
      }
      const extra = op.entity === 'lists' ? { owner: user, visibility: op.set.visibility ?? 'group' } : {};
      t.set(op.id, { ...op.set, ...extra, id: op.id, group_id: op.group_id, deleted_at: null, version: this.bump(op.group_id) });
      return op.group_id;
    }
    if (!this.canSee(user, op.entity, row)) throw new Error('not_found');
    const r = row!;
    const g = String(r.group_id);
    const child = this.member(g, user)!.role === 'child';
    if (op.kind === 'patch') {
      if (r.deleted_at) throw new Error('deleted');
      // D34: dziecko tylko odhacza (tasks_guard porównuje wiersz przed i po — zmiana na tę samą wartość przechodzi),
      // list nie zmienia wcale (lists_guard); widoczność zmienia tylko twórca listy.
      const changes = Object.entries(op.set).some(([k, v]) => k !== 'completed_at' && (r[k] ?? null) !== (v ?? null));
      if (child && (op.entity === 'lists' || changes)) throw new Error('forbidden:child');
      // PW-14 B (migracja 20261008441000): dziecko odhacza tylko swoje sprawy. Model upraszcza private.child_owns_task:
      // swoje = przypisane do dziecka (identyfikator członka jak w memberRows) albo podzadanie takiego; zadania przy
      // wydarzeniach i listy z osobą zakupów — w testach SQL (child_account.test.sql), generator ich tu nie tworzy.
      if (child && op.entity === 'tasks' && 'completed_at' in op.set && (r.completed_at ?? null) !== (op.set.completed_at ?? null) && !this.childOwns(r, `${g}:${user}`)) {
        throw new Error('forbidden:not_own');
      }
      if (op.entity === 'lists' && op.set.visibility !== undefined && op.set.visibility !== r.visibility && r.owner !== user) throw new Error('forbidden:not_list_owner');
      t.set(op.id, { ...r, ...op.set, version: this.bump(g) });
      // D139 (lists_widen_bump): lista poszerzona do „cała grupa” — jej zadania z nowymi wersjami, żeby trafiły do nowych osób.
      if (op.entity === 'lists' && r.visibility !== 'group' && op.set.visibility === 'group') {
        for (const [id, task] of this.tasks) if (task.list_id === op.id) this.tasks.set(id, { ...task, version: this.bump(g) });
      }
    } else if (op.kind === 'delete') {
      if (r.deleted_at) return g;
      if (child) throw new Error('forbidden:child');
      const deletedAt = ++this.clock;
      const at = `t${deletedAt}`;
      t.set(op.id, { ...r, deleted_at: at, deletedAt, version: this.bump(g) });
      if (op.entity === 'lists') {
        for (const [id, task] of this.tasks) {
          if (task.list_id === op.id && !task.deleted_at) this.tasks.set(id, { ...task, deleted_at: at, deletedAt, version: this.bump(g) });
        }
      }
    } else {
      if (!r.deleted_at) return g;
      if (child) throw new Error('forbidden:child');
      // Zadania nie przywraca się do usuniętej listy (jak tasks_guard: deleted:list).
      if (op.entity === 'tasks' && this.lists.get(String(r.list_id))?.deleted_at) throw new Error('deleted:list');
      t.set(op.id, { ...r, deleted_at: null, deletedAt: undefined, version: this.bump(g) });
      if (op.entity === 'lists') {
        for (const [id, task] of this.tasks) {
          if (task.list_id === op.id && task.deleted_at === r.deleted_at) {
            this.tasks.set(id, { ...task, deleted_at: null, deletedAt: undefined, version: this.bump(g) });
          }
        }
      }
    }
    return g;
  }

  push(user: string, req: { client_id: string; ops: readonly Op[] }): PushResponse {
    const c = this.clients.get(req.client_id) ?? { user, lastSeq: 0, rejections: new Map() };
    if (c.user !== user) throw new Error('client_mismatch');
    // Jak sync_push (M-56): paczka zaczyna się od najmniejszego niepotwierdzonego numeru — niżej odrzucenia odebrane.
    const min = Math.min(...req.ops.map((o) => o.seq));
    for (const s of [...c.rejections.keys()]) if (s < min) c.rejections.delete(s);
    const results: PushResponse['results'] = [];
    for (const op of req.ops) {
      if (op.seq <= c.lastSeq) {
        const r = c.rejections.get(op.seq);
        if (r && r.opId === op.op_id) {
          this.recalled++;
          results.push({ seq: op.seq, status: 'rejected', code: r.code });
        } else results.push({ seq: op.seq, status: 'duplicate' });
        continue;
      }
      c.lastSeq = op.seq;
      try {
        this.applyOne(user, op);
        this.applied.set(op.op_id, (this.applied.get(op.op_id) ?? 0) + 1);
        results.push({ seq: op.seq, status: 'ok' });
      } catch (e) {
        const code = (e as Error).message;
        this.rejectedOps.set(op.op_id, code);
        c.rejections.set(op.seq, { opId: op.op_id, code });
        results.push({ seq: op.seq, status: 'rejected', code });
      }
    }
    this.clients.set(req.client_id, c);
    return { last_seq: c.lastSeq, results };
  }

  /**
   * Nocne czyszczenie kosza (private.purge_tombstones): wiersze usunięte przed chwilą `horizon` zegara symulacji znikają
   * na dobre (lista — gdy nie zostało w niej żadne zadanie), a purged_version grupy rośnie do najwyższej wersji
   * usuniętych wierszy (M-4). Zwraca liczbę usuniętych.
   */
  purge(horizon: number): number {
    let n = 0;
    for (const [gid, g] of this.groups) {
      let top = 0;
      const old = (r: Stored) => r.group_id === gid && r.deleted_at !== null && Number(r.deletedAt) < horizon;
      for (const [id, t] of this.tasks) {
        if (!old(t)) continue;
        this.tasks.delete(id);
        top = Math.max(top, t.version);
        n++;
        // Jak SQL: z zadaniem znika jego historia, a z nią ślad przeniesienia.
        for (let i = this.moves.length - 1; i >= 0; i--) if (this.moves[i]!.task === id) this.moves.splice(i, 1);
      }
      for (const [id, l] of this.lists) {
        if (!old(l) || [...this.tasks.values()].some((t) => t.list_id === id)) continue;
        this.lists.delete(id);
        this.allowed.delete(id);
        top = Math.max(top, l.version);
        n++;
      }
      if (top === 0) continue;
      g.purged = Math.max(g.purged, top);
      this.bump(gid); // jak groups_stamp: zmiana purged_version podbija wersję grupy
    }
    return n;
  }

  /** Bieżąca chwila zegara symulacji (znaczniki usunięcia). */
  now(): number {
    return this.clock;
  }

  /** Wiersz tak, jak wysyła go serwer (bez pól wewnętrznych symulatora). */
  private exported(row: Stored): Row {
    const out: { [k: string]: unknown } = { ...row };
    for (const k of INTERNAL) delete out[k];
    return out;
  }

  private memberRows(gid: string): Stored[] {
    // member_id jak w SQL: osobny dla każdego członkostwa (ta sama osoba w dwóch grupach = dwa wiersze).
    return [...this.groups.get(gid)!.members].map(([u, m]) => ({ member_id: `${gid}:${u}`, group_id: gid, user_id: u, role: m.role, deleted_at: m.deleted ? 'x' : null, version: m.version }));
  }

  visibleRows(user: string): { lists: Row[]; tasks: Row[]; group_members: Row[]; groups: number } {
    const mine = [...this.groups.keys()].filter((g) => this.member(g, user));
    return {
      groups: mine.length,
      lists: [...this.lists.values()].filter((r) => this.canSee(user, 'lists', r)).map((r) => this.exported(r)),
      tasks: [...this.tasks.values()].filter((r) => this.canSee(user, 'tasks', r)).map((r) => this.exported(r)),
      group_members: mine.flatMap((g) => this.memberRows(g)),
    };
  }

  /** Protokół 2: kursor {v, p} (epoka), listy widoczne, „gone”, filtr encji. */
  pull(user: string, req: Pick<PullRequest, 'cursors'> & { entities?: readonly string[] }, lim: number): PullResponse {
    const groups: PullResponse['groups'] = [];
    for (const [gid, g] of this.groups) {
      if (!this.member(gid, user)) continue;
      const c = req.cursors[gid];
      let since = c?.v ?? 0;
      const resync = since > 0 && since < g.purged && c?.p !== g.purged;
      if (resync) since = 0;
      const rows: PulledRow[] = [
        ...[...this.lists.values()].filter((r) => r.group_id === gid && this.canSee(user, 'lists', r)).map((r) => ({ e: 'lists' as const, r })),
        ...[...this.tasks.values()].filter((r) => r.group_id === gid && this.canSee(user, 'tasks', r)).map((r) => ({ e: 'tasks' as const, r })),
        ...this.memberRows(gid).map((r) => ({ e: 'group_members' as const, r })),
      ]
        .filter((x) => x.r.version > since)
        .map((x) => ({ e: x.e, v: x.r.version, row: this.exported(x.r) }));
      // Wiersz grupy: zawsze widoczny, ma bieżącą wersję (jak w group_rows_since).
      if (g.version > since) rows.push({ e: 'groups', v: g.version, row: { id: gid, version: g.version } });
      rows.sort((a, b) => a.v - b.v);
      const cut = rows.length > lim ? rows[lim - 1]!.v : Infinity;
      const page = rows.filter((x) => x.v <= cut);
      const top = page.length ? page[page.length - 1]!.v : since;
      // Jak private.tasks_moved_out (20261010330000_moved_out_paging): także zadanie widoczne, którego bieżący wiersz
      // nie mieści się w tej porcji — kursor mija przeniesienie, a wiersz po zawężeniu nowej listy mógłby nie przyjść.
      const delivered = (t: Stored | undefined) => this.canSee(user, 'tasks', t) && t!.version <= top;
      const movedOut = (m: (typeof this.moves)[number]) =>
        m.group === gid && m.version > since && m.version <= top && this.canSeeList(user, this.lists.get(m.from)) && !delivered(this.tasks.get(m.task));
      groups.push({
        group_id: gid,
        cursor: top,
        has_more: page.length > 0 && !page.some((x) => x.e === 'groups'),
        resync,
        rows: req.entities ? page.filter((x) => req.entities!.includes(x.e)) : page,
        purged: g.purged,
        lists: [...this.lists.values()].filter((l) => l.group_id === gid && this.canSeeList(user, l)).map((l) => String(l.id)).sort(),
        gone: since > 0 ? [...new Set(this.moves.filter(movedOut).map((m) => m.task))].sort() : [],
      });
    }
    const scopes = [...this.lists.values()]
      .filter((l) => l.visibility !== 'group' && !l.deleted_at && this.canSee(user, 'lists', l))
      .map((l) => String(l.id))
      .sort();
    return { groups, scopes };
  }

  fetchScope(user: string, listId: string) {
    const l = this.lists.get(listId);
    if (!this.canSee(user, 'lists', l)) return [];
    return [
      { e: 'lists' as const, v: l!.version, row: this.exported(l!) },
      ...[...this.tasks.values()].filter((t) => t.list_id === listId).map((t) => ({ e: 'tasks' as const, v: t.version, row: this.exported(t) })),
    ];
  }
}
