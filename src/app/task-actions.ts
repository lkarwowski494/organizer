/**
 * Odhaczanie i usuwanie zadań oraz pozycji zakupów — wspólne dla wszystkich ekranów.
 * Odhaczenie zadania pyta o potwierdzenie (decyzja właściciela z 7.10.2026, D59: łatwo o przypadkowe dotknięcie,
 * a zrobione znika z widoku); cofnięcie odhaczenia nie pyta. Pozycja zakupów trafia do koszyka bez pytania, z paskiem
 * „Cofnij” — nie znika, tylko przechodzi do „W koszyku” (zmiana D59, decyzja właściciela z 8.10.2026, audyt 2: PW-15 A).
 * Usunięcie trafia do kosza i pokazuje „Cofnij” (D60), bez pytania (D187); pytamy tylko przy liście z zadaniami.
 * Zadanie z niezrobionymi podzadaniami (decyzja właściciela z 8.10.2026): to samo pytanie z wyborem — „Zostaw
 * podzadania” albo „Oznacz wszystko jako zrobione” (jak zakupy z niekupionymi pozycjami); hurtowe odhaczenie ma „Cofnij”,
 * które przywraca wszystko naraz.
 */
import { Alert } from 'react-native';

import { materialize } from '../domain/sync-engine/client';
import { inverseOps, remove, restore, toggleDone } from '../domain/views/commands';
import { subtasksOf } from '../domain/views/nesting';
import { finishTripOps, finishTripUndoOps, tripItems } from '../domain/views/shopping-trip';
import { repeatOps } from '../domain/views/task-repeat';
import { asTask } from '../domain/views/model';
import { checkOff, groupsView, type Task } from '../domain/views';
import { strings } from '../i18n/strings.pl';
import { useUndo } from '../ui/undo';
import { useAppData, useServices } from './context';

type Item = Pick<Task, 'id' | 'title' | 'completed_at'>;

export function useTaskActions() {
  const { store, nowIso, userId } = useServices();
  const { tables, today } = useAppData();
  const undo = useUndo();
  return {
    toggle(t: Item, shopping = false) {
      // Zadanie z powtarzaniem (D76): odhaczenie dokłada następne, cofnięcie zdejmuje nietknięte — w jednej transakcji.
      const raw = tables.tasks?.[t.id];
      // Dziecko (D34) nie tworzy zadań — następne dołoży telefon dorosłego (audyt 2, T-12).
      const canCreate = raw !== undefined && groupsView(tables, userId).some((g) => g.id === raw.group_id && g.me.role !== 'child');
      const opsFor = (subs: readonly Task[] = []) => [toggleDone(t, nowIso()), ...subs.map((s) => toggleDone(s, nowIso())), ...(raw ? repeatOps(tables, asTask(raw), today, canCreate) : [])];
      const done = (subs: readonly Task[] = []) => {
        const ops = opsFor(subs);
        store.dispatch(ops);
        return ops;
      };
      if (t.completed_at !== null) return void done();
      if (shopping) {
        // Same zmiany w wierszach, bez poleceń serwera — odwrotność zawsze istnieje.
        const ops = opsFor();
        const back = inverseOps(tables, ops)!;
        store.dispatch(ops);
        return undo.show(strings['undo.inCart'](t.title), () => store.dispatch(back), { changed: ops });
      }
      // PW-14 B: dziecko z kontem odhacza razem tylko swoje podzadania (cudze serwer odrzuci: forbidden:not_own).
      const can = checkOff(tables, userId);
      const open = subtasksOf(tables, t.id).filter((s) => s.completed_at === null && can(s));
      if (open.length === 0)
        return Alert.alert(strings['confirm.doneTitle'], t.title, [
          { text: strings['common.cancel'], style: 'cancel' },
          { text: strings['confirm.doneYes'], onPress: () => void done() },
        ]);
      // „Cofnij” po hurtowym odhaczeniu: ze stanu w chwili cofnięcia — jak odznaczenie zadania (następne znika, jeśli
      // nietknięte) i podzadania odhaczone razem z nim.
      const back = () => {
        const now = materialize(store.getSnapshot().state);
        const parent = now.tasks?.[t.id];
        if (!parent || parent.completed_at == null) return;
        const p = asTask(parent);
        const subs = open.flatMap((s) => (now.tasks?.[s.id]?.completed_at != null ? [asTask(now.tasks[s.id]!)] : []));
        store.dispatch([toggleDone(p, nowIso()), ...subs.map((s) => toggleDone(s, nowIso())), ...repeatOps(now, p, today, canCreate)]);
      };
      Alert.alert(strings['confirm.doneTitle'], strings['confirm.subtasksLeft'](t.title, open.length), [
        { text: strings['common.cancel'], style: 'cancel' },
        { text: strings['confirm.keepSubtasks'], onPress: () => void done() },
        {
          text: strings['confirm.allDone'],
          onPress: () => {
            undo.show(strings['undo.doneWithSubtasks'](t.title, open.length), back, { changed: done(open) });
          },
        },
      ]);
    },
    /**
     * „Zakupy” zrobione (D73): z potwierdzeniem; niekupione — zostają na następne zakupy albo też są kupione.
     * Potem pasek „Cofnij” jak przy usuwaniu (D60; audyt 2, M-225) — kupione pozycje idą do kosza.
     */
    finishTrip(listId: string, name: string) {
      const left = tripItems(tables, listId).open.length;
      const done = (all: boolean) => {
        const ops = finishTripOps(tables, userId, listId, all, nowIso());
        const back = finishTripUndoOps(tables, ops);
        store.dispatch(ops);
        undo.show(strings['undo.tripDone'](name), () => store.dispatch(back), { changed: ops });
      };
      Alert.alert(
        strings['trip.confirmTitle'],
        left ? strings['trip.confirmLeft'](left) : strings['trip.title'](name),
        left
          ? [
              { text: strings['common.cancel'], style: 'cancel' },
              { text: strings['trip.keep'], onPress: () => done(false) },
              { text: strings['trip.all'], onPress: () => done(true) },
            ]
          : [
              { text: strings['common.cancel'], style: 'cancel' },
              { text: strings['trip.yes'], onPress: () => done(false) },
            ],
      );
    },
    remove(t: Item) {
      const op = remove('tasks', t.id);
      store.dispatch(op);
      undo.show(strings['undo.deleted'](t.title), () => store.dispatch(restore('tasks', t.id)), { changed: [op] });
    },
    /**
     * Usunięcie listy (D187, audyt 2: PW-16 A, M-121): pusta — od razu, z „Cofnij” i koszem; z zadaniami — jedno pytanie
     * z ich liczbą („Usunąć listę i 23 zadania?”), bo usunięcie zabiera je wszystkim w grupie. Usuwa każdy dorosły (D34:
     * dziecko nie). `after` — po usunięciu (np. powrót z ekranu listy).
     */
    removeList(list: { id: string; name: string; kind: 'tasks' | 'shopping' }, after?: () => void) {
      const n = Object.values(tables.tasks ?? {}).filter((x) => x.list_id === list.id && x.deleted_at == null).length;
      const go = () => {
        const op = remove('lists', list.id);
        store.dispatch(op);
        undo.show(strings['undo.listDeleted'](list.name), () => store.dispatch(restore('lists', list.id)), { changed: [op] });
        after?.();
      };
      if (n === 0) return go();
      Alert.alert(strings['lists.deleteConfirm'](list.name, n, list.kind === 'shopping'), undefined, [
        { text: strings['common.cancel'], style: 'cancel' },
        { text: strings['lists.delete'], style: 'destructive', onPress: go },
      ]);
    },
  };
}
