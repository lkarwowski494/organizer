/**
 * Serwer w pamięci z semantyką sync_push / sync_pull (supabase/migrations/20261006120200_sync.sql)
 * dla podzbioru danych: grupy, członkostwa, listy (group/restricted), zadania. Do symulacji wielu
 * klientów w testach własności — zgodność z prawdziwym SQL sprawdzają testy pgTAP.
 */
import type { Op, PullResponse, PushResponse, Row } from '../../sync-engine/client';

type Stored = { [k: string]: unknown; version: number; deleted_at: string | null };

export class FakeServer {
  readonly groups = new Map<string, { version: number; members: Set<string> }>();
  readonly lists = new Map<string, Stored>();
  readonly tasks = new Map<string, Stored>();
  readonly allowed = new Map<string, Set<string>>(); // lista restricted → użytkownicy z dostępem
  readonly clients = new Map<string, { user: string; lastSeq: number }>();
  /** Ile razy każda operacja (op_id) została faktycznie zastosowana — idempotencja wymaga ≤ 1. */
  readonly applied = new Map<string, number>();
  readonly rejectedOps = new Map<string, string>();
  private clock = 0;

  addGroup(id: string, members: string[]): void {
    this.groups.set(id, { version: 0, members: new Set(members) });
  }

  removeMember(group: string, user: string): void {
    const g = this.groups.get(group)!;
    g.members.delete(user);
    this.bump(group);
  }

  private bump(group: string): number {
    const g = this.groups.get(group)!;
    g.version += 1;
    return g.version;
  }

  private canSeeList(user: string, l: Stored | undefined): boolean {
    if (!l || !this.groups.get(String(l.group_id))!.members.has(user)) return false;
    return l.visibility !== 'restricted' || l.owner === user || (this.allowed.get(String(l.id))?.has(user) ?? false);
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

  private applyOne(user: string, op: Op): string {
    if (op.kind === 'cmd') {
      const l = this.lists.get(String(op.args.list_id));
      if (!l || !this.canSeeList(user, l)) throw new Error('not_found');
      if (l.owner !== user) throw new Error('forbidden:not_list_owner');
      const set = this.allowed.get(String(l.id)) ?? new Set<string>();
      if (op.cmd === 'grant_scope') set.add(String(op.args.user));
      else set.delete(String(op.args.user));
      this.allowed.set(String(l.id), set);
      return String(l.group_id);
    }
    const t = this.table(op.entity);
    const row = t.get(op.id);
    if (op.kind === 'create') {
      if (row) {
        // Powtórzone utworzenie (id nadaje klient) — o ile wiersz widzę; cudzy, niewidoczny = konflikt klucza.
        if (!this.canSee(user, op.entity, row)) throw new Error('invalid:23505');
        return String(row.group_id);
      }
      const g = this.groups.get(op.group_id);
      if (!g?.members.has(user)) throw new Error('forbidden');
      if (op.entity === 'tasks') {
        const l = this.lists.get(String(op.set.list_id));
        if (!l || String(l.group_id) !== op.group_id) throw new Error('invalid_list');
        if (!this.canSeeList(user, l)) throw new Error('forbidden');
        if (l.deleted_at) throw new Error('deleted:list');
      }
      const extra = op.entity === 'lists' ? { owner: user } : {};
      t.set(op.id, { ...op.set, ...extra, id: op.id, group_id: op.group_id, deleted_at: null, version: this.bump(op.group_id) });
      return op.group_id;
    }
    if (!this.canSee(user, op.entity, row)) throw new Error('not_found');
    const r = row!;
    const g = String(r.group_id);
    if (op.kind === 'patch') {
      if (r.deleted_at) throw new Error('deleted');
      t.set(op.id, { ...r, ...op.set, version: this.bump(g) });
    } else if (op.kind === 'delete') {
      if (r.deleted_at) return g;
      const at = `t${++this.clock}`;
      t.set(op.id, { ...r, deleted_at: at, version: this.bump(g) });
      if (op.entity === 'lists') {
        for (const [id, task] of this.tasks) {
          if (task.list_id === op.id && !task.deleted_at) this.tasks.set(id, { ...task, deleted_at: at, version: this.bump(g) });
        }
      }
    } else {
      if (!r.deleted_at) return g;
      // Zadania nie przywraca się do usuniętej listy (jak tasks_guard: deleted:list).
      if (op.entity === 'tasks' && this.lists.get(String(r.list_id))?.deleted_at) throw new Error('deleted:list');
      t.set(op.id, { ...r, deleted_at: null, version: this.bump(g) });
      if (op.entity === 'lists') {
        for (const [id, task] of this.tasks) {
          if (task.list_id === op.id && task.deleted_at === r.deleted_at) {
            this.tasks.set(id, { ...task, deleted_at: null, version: this.bump(g) });
          }
        }
      }
    }
    return g;
  }

  push(user: string, req: { client_id: string; ops: readonly Op[] }): PushResponse {
    const c = this.clients.get(req.client_id) ?? { user, lastSeq: 0 };
    if (c.user !== user) throw new Error('client_mismatch');
    const results: PushResponse['results'] = [];
    for (const op of req.ops) {
      if (op.seq <= c.lastSeq) {
        results.push({ seq: op.seq, status: 'duplicate' });
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
        results.push({ seq: op.seq, status: 'rejected', code });
      }
    }
    this.clients.set(req.client_id, c);
    return { last_seq: c.lastSeq, results };
  }

  /** Wiersz tak, jak wysyła go serwer (bez pól wewnętrznych symulatora). */
  private exported(row: Stored): Row {
    const { owner: _owner, ...rest } = row;
    return rest;
  }

  visibleRows(user: string): { lists: Row[]; tasks: Row[] } {
    return {
      lists: [...this.lists.values()].filter((r) => this.canSee(user, 'lists', r)).map((r) => this.exported(r)),
      tasks: [...this.tasks.values()].filter((r) => this.canSee(user, 'tasks', r)).map((r) => this.exported(r)),
    };
  }

  pull(user: string, cursors: { [g: string]: number }, lim: number): PullResponse {
    const groups: PullResponse['groups'] = [];
    for (const [gid, g] of this.groups) {
      if (!g.members.has(user)) continue;
      const since = cursors[gid] ?? 0;
      const rows = [
        ...[...this.lists.values()].filter((r) => r.group_id === gid && this.canSee(user, 'lists', r)).map((r) => ({ e: 'lists' as const, r })),
        ...[...this.tasks.values()].filter((r) => r.group_id === gid && this.canSee(user, 'tasks', r)).map((r) => ({ e: 'tasks' as const, r })),
      ]
        .filter((x) => x.r.version > since)
        .map((x) => ({ e: x.e, v: x.r.version, row: this.exported(x.r) }));
      // Wiersz grupy: zawsze widoczny, ma bieżącą wersję (jak w group_rows_since).
      if (g.version > since) rows.push({ e: 'groups' as never, v: g.version, row: { id: gid, version: g.version } });
      rows.sort((a, b) => a.v - b.v);
      const cut = rows.length > lim ? rows[lim - 1]!.v : Infinity;
      const out = rows.filter((x) => x.v <= cut);
      const top = out.length ? out[out.length - 1]!.v : since;
      groups.push({ group_id: gid, cursor: top, has_more: out.length > 0 && !out.some((x) => x.e === ('groups' as never)), resync: false, rows: out });
    }
    const scopes = [...this.lists.values()]
      .filter((l) => l.visibility === 'restricted' && !l.deleted_at && this.canSee(user, 'lists', l))
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
