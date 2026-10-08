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
  EventEdit: { groupId?: string; date?: string; eventId?: string; scope?: Scope; title?: string; start?: string; end?: string; responsibleId?: string };
  /** `token` — stare zaproszenie (64 znaki); `g` + `c` — ID grupy i kod z linku (D94). */
  Invite: { token?: string; g?: string; c?: string };
  Settings: undefined;
  Rejected: undefined;
  /** Pierwsze kroki (D79): wprowadzenie i wybór startu. */
  Welcome: undefined;
  Feedback: undefined;
  /** Plan lekcji osoby z tygodniami A/B (D112). */
  Timetable: { groupId: string; memberId: string };
  /** „Jak masz na imię?” (D100): przy starcie albo z Ustawień (`from: 'settings'`). */
  Name: { from?: 'settings' } | undefined;
  /** Pełny formularz zadania (D90): `text` z pola dodawania („Więcej”) albo `taskId` dodanego zadania („Zmień”). */
  AddTask: { text?: string; taskId?: string; title?: string; date?: string; time?: string; groupId?: string };
};

export type TabParams = { Today: undefined; Lists: undefined; Calendar: undefined; Groups: undefined };
