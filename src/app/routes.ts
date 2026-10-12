/** Trasy nawigacji (D26: React Navigation, linki głębokie konfigurowane ręcznie). */
import type { NavigatorScreenParams } from '@react-navigation/native';

import type { Scope } from '../domain/views/events';
import type { Lesson } from '../domain/views/timetable';

export type RootStackParams = {
  /** Z zakładką — np. „Moje sprawy” po dotknięciu powiadomienia o przekazaniu (PWD-16). */
  Tabs: NavigatorScreenParams<TabParams> | undefined;
  List: { listId: string };
  Task: { taskId: string };
  NewList: { groupId?: string; kind?: 'tasks' | 'shopping' };
  /** `fresh` — grupa właśnie utworzona albo dołączona: do pierwszego pobrania „Pobieram grupę…” zamiast błędu (audyt 2, R-16). */
  Group: { groupId: string; fresh?: boolean };
  Member: { groupId: string; memberId: string };
  /** `name` — podpowiedź nazwy (pierwsze kroki: „Rodzina”); `starter` — z Pierwszych kroków: listy i „Następne kroki” (PW-36 A). */
  NewGroup: { name?: string; starter?: boolean } | undefined;
  /**
   * `date` — data wystąpienia według reguły (klucz wystąpienia, także gdy przeniesione). Bez niej (link do całej serii,
   * PWD-16) — najbliższy termin od dziś, a gdy go nie ma — pierwszy.
   */
  Event: {
    eventId: string;
    date?: string;
    /** Przesunięcie wiersza terminu z podpiętymi zadaniami (M-239): od razu pytanie, co z nimi (D14), w tym zakresie. */
    cancel?: Scope;
  };
  /** Nowe: `groupId`/`date` podpowiadają grupę i dzień. Zmiana: `eventId` + `date` (wystąpienie) + `scope` (D57). */
  EventEdit: {
    groupId?: string; date?: string; eventId?: string; scope?: Scope; title?: string; start?: string; end?: string; responsibleId?: string;
    /** PWD-33 (D200): kopia wydarzenia z kalendarza iPhone'a — miejsce, cały dzień i dopisek o kopii. */
    location?: string; allDay?: boolean; fromDevice?: boolean;
    /** D199: ostatni dzień całodniowego (kopia wielodniowego wydarzenia z iPhone'a). */
    endDate?: string;
    /** Audyt 2 (M-255): z przełącznika rodzaju — dziecko jako uczestnik, ogłoszenie formularza. */
    participantIds?: string[]; kindSwitch?: boolean;
  };
  /** `token` — stare zaproszenie (64 znaki); `g` + `c` — ID grupy i kod z linku (D94). */
  Invite: { token?: string; g?: string; c?: string };
  /** Bez `section` — strona główna ustawień; z nią — podstrona (D131). */
  Settings: { section?: SettingsSection } | undefined;
  Rejected: undefined;
  /** Ostatnie zmiany z „Cofnij” bez limitu czasu (D194). */
  Recent: undefined;
  /** Pierwsze kroki (D79): wprowadzenie i wybór startu. */
  Welcome: undefined;
  Feedback: undefined;
  /** Licencje bibliotek (audyt 3, N-78): bez `name` lista, z `name` („nazwa@wersja”) tekst jednej licencji. */
  Licenses: { name?: string } | undefined;
  /** Plan lekcji osoby z tygodniami A/B (D112). */
  /** `copy` — plan skopiowany z innej grupy do sprawdzenia przed zapisem (audyt 3, Q27 B); `from` — „Tymek · Rodzina”. */
  Timetable: { groupId: string; memberId: string; copy?: { lessons: Lesson[]; thisWeek: 'A' | 'B'; until: string; from: string } };
  /** Nowa rutyna z krokami (D113); `groupId` — podpowiedź grupy, `title` — nazwa z pełnego formularza (PWD-26). */
  Routine: { groupId?: string; title?: string; kindSwitch?: boolean } | undefined;
  /** „Jak masz na imię?” (D100): przy starcie albo z Ustawień (`from: 'settings'`). */
  Name: { from?: 'settings' } | undefined;
  /**
   * Formularz nowego zadania (D90): `text` z pola dodawania („Więcej”); `kindSwitch` — przejście z formularza wydarzenia.
   * `defaultGroupId` — grupa z chipa przy polu (M-24), gdy tekst nie wskazuje innej.
   */
  AddTask: { text?: string; title?: string; date?: string; time?: string; groupId?: string; defaultGroupId?: string; kindSwitch?: boolean };
};

export type SettingsSection = 'notifications' | 'calendar' | 'appearance' | 'adding' | 'account';

export type TabParams = { Today: undefined; Lists: undefined; Calendar: undefined; Groups: undefined };
