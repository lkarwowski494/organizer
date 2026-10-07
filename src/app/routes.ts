/** Trasy nawigacji (D26: React Navigation, linki głębokie konfigurowane ręcznie). */
import type { Scope } from '../domain/views/events';

export type RootStackParams = {
  Tabs: undefined;
  List: { listId: string };
  Task: { taskId: string };
  NewList: { groupId?: string; kind?: 'tasks' | 'shopping' };
  Group: { groupId: string };
  Member: { groupId: string; memberId: string };
  /** `name` — podpowiedź nazwy (pierwsze kroki: „Rodzina”). */
  NewGroup: { name?: string } | undefined;
  /** `date` — data wystąpienia według reguły (klucz wystąpienia, także gdy przeniesione). */
  Event: { eventId: string; date: string };
  /** Nowe: `groupId`/`date` podpowiadają grupę i dzień. Zmiana: `eventId` + `date` (wystąpienie) + `scope` (D57). */
  EventEdit: { groupId?: string; date?: string; eventId?: string; scope?: Scope };
  Invite: { token?: string };
  Settings: undefined;
  Rejected: undefined;
  /** Pierwsze kroki (D79): wprowadzenie i wybór startu. */
  Welcome: undefined;
};

export type TabParams = { Today: undefined; Lists: undefined; Calendar: undefined; Groups: undefined };
