/**
 * Dziecko z własnym kontem (decyzja właściciela z 8.10.2026, PW-14 B, D155): w Moich sprawach, przypomnieniach
 * i Kalendarzu widzi tylko swoje sprawy i wydarzenia, w których uczestniczy — nie nieprzypisane zadania rodziców
 * z terminem (audyt 2, P-70). Listy grupy otwiera jak dotąd, ale odhacza tylko swoje sprawy (decyzja koordynatora
 * z 8.10.2026, PW-14 B; serwer: forbidden:not_own, migracja 20261008441000 — ta sama reguła co private.child_owns_task).
 *  - Zadanie jest jego, gdy jest przypisane do niego; bez osoby (albo osoby usuniętej z grupy, D132) — gdy jego rodzic
 *    jest jego (podzadania jego zadania) albo stoi przy wydarzeniu, które go dotyczy (kroki jego rutyny, D65; zadania
 *    na spotkaniu, D13), albo jest pozycją listy zakupów, za której zakupy ono odpowiada. Zadanie innej osoby (także
 *    rodzeństwa) nie jest jego.
 *  - Wydarzenie dotyczy go jak każdego (D58, D66), ale bez reguły „dziecko uczestnikiem — dotyczy dorosłych”: całej
 *    grupy albo jest uczestnikiem; z osobą odpowiedzialną — gdy to ono albo jest wskazanym uczestnikiem.
 * Ta sama reguła po stronie listy wydarzeń (events.ts) i zadań (index.ts), więc moduł zależy tylko od wierszy.
 */
import { asEvent, asOverride, asParticipant, type EventRow, occurrenceResponsible, type Override } from './event-rows';
import { asTask, type Member, rows, type Tables, type Task } from './model';

/** Czy wydarzenie dotyczy dziecka (bez reguły dorosłych, D58). `responsibleId` — żywa osoba odpowiedzialna albo `null`. */
export function childEventConcerns(audience: EventRow['audience'], responsibleId: string | null, me: string, iParticipate: boolean): boolean {
  return responsibleId === null ? audience === 'group' || iParticipate : responsibleId === me || (audience === 'members' && iParticipate);
}

/** Czy zadanie jest sprawą dziecka o danym member_id — z indeksem wierszy budowanym przy pierwszym pytaniu (raz na widok). */
export type ChildOwner = (x: Task, me: string) => boolean;

/**
 * Reguła wyżej dla jednego stanu danych. `live` — żywi członkowie (D132). Ograniczenie kroków po rodzicach jak
 * w effectiveDue (uszkodzone dane lokalne, np. cykl).
 */
export function childOwner(t: Tables, live: ReadonlyMap<string, Member>): ChildOwner {
  let i: { tasks: Map<string, Task>; events: Map<string, EventRow>; overrides: Map<string, Override>; parts: Set<string>; tripOwner: Map<string, unknown> } | null = null;
  return (x, me) => {
    i ??= {
      tasks: new Map(rows(t, 'tasks', asTask).map((y) => [y.id, y])),
      events: new Map(rows(t, 'events', asEvent).filter((e) => e.deleted_at === null).map((e) => [e.id, e])),
      overrides: new Map(rows(t, 'event_overrides', asOverride).filter((o) => o.deleted_at === null).map((o) => [`${o.event_id}|${o.occurrence_date}`, o])),
      parts: new Set(rows(t, 'event_participants', asParticipant).filter((p) => p.deleted_at === null).map((p) => `${p.event_id}|${p.member_id}`)),
      tripOwner: new Map(Object.values(t.lists ?? {}).flatMap((l) => (l.kind === 'shopping' && l.responsible_member_id != null ? [[String(l.id), l.responsible_member_id]] : []))),
    };
    let cur: Task | undefined = x;
    for (let step = 0; cur && step < 8; step++) {
      const who = cur.assignee_member_id !== null && live.has(cur.assignee_member_id) ? cur.assignee_member_id : null;
      if (who !== null) return who === me;
      if (cur.event_id !== null) {
        const e = i.events.get(cur.event_id);
        if (!e) return false;
        const raw = occurrenceResponsible(i.overrides.get(`${cur.event_id}|${cur.occurrence_date}`), e);
        return childEventConcerns(e.audience, raw !== null && live.has(raw) ? raw : null, me, i.parts.has(`${e.id}|${me}`));
      }
      // Pozycja listy zakupów, za które odpowiada dziecko (dziś osoba zakupów to zawsze dorosły, D73 — reguła jak w SQL).
      if (cur.parent_id === null) return i.tripOwner.get(cur.list_id) === me;
      cur = i.tasks.get(cur.parent_id);
    }
    return false;
  };
}
