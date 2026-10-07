/**
 * Odhaczanie i usuwanie zadań oraz pozycji zakupów — wspólne dla wszystkich ekranów.
 * Odhaczenie pyta o potwierdzenie (decyzja właściciela z 7.10.2026, D59: łatwo o przypadkowe dotknięcie,
 * a zrobione znika z widoku); cofnięcie odhaczenia nie pyta. Usunięcie trafia do kosza i pokazuje „Cofnij” (D60).
 */
import { Alert } from 'react-native';

import { remove, restore, toggleDone } from '../domain/views/commands';
import type { Task } from '../domain/views';
import { strings } from '../i18n/strings.pl';
import { useUndo } from '../ui/undo';
import { useServices } from './context';

type Item = Pick<Task, 'id' | 'title' | 'completed_at'>;

export function useTaskActions() {
  const { store, nowIso } = useServices();
  const undo = useUndo();
  return {
    toggle(t: Item, shopping = false) {
      if (t.completed_at !== null) return store.dispatch(toggleDone(t, nowIso()));
      Alert.alert(shopping ? strings['confirm.cartTitle'] : strings['confirm.doneTitle'], t.title, [
        { text: strings['common.cancel'], style: 'cancel' },
        { text: shopping ? strings['confirm.cartYes'] : strings['confirm.doneYes'], onPress: () => store.dispatch(toggleDone(t, nowIso())) },
      ]);
    },
    remove(t: Item) {
      store.dispatch(remove('tasks', t.id));
      undo.show(strings['undo.deleted'](t.title), () => store.dispatch(restore('tasks', t.id)));
    },
  };
}
