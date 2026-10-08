/**
 * Usuwanie wydarzeń przesunięciem wiersza (audyt 2, M-239 — jak zadania; D187): bez pytania, z paskiem „Cofnij”
 * i koszem. Wiersz to jeden termin: jednorazowe wydarzenie się usuwa, termin serii — odwołuje (tylko ten, D57; resztę
 * serii zmienia się na ekranie wydarzenia); wiersz serii na ekranie grupy usuwa całą serię. Gdy do terminu są podpięte
 * zadania, najpierw pytanie, co z nimi (D14) — na ekranie wydarzenia, od razu otwarte.
 */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { inverseOps } from '../domain/views/commands';
import { affectedByCancel, seriesCopiesCancelOps } from '../domain/views/event-tasks';
import { cancelEvent, eventDetail, fieldsOf } from '../domain/views/events';
import { strings } from '../i18n/strings.pl';
import { useUndo } from '../ui/undo';
import { useAppData, useServices } from './context';
import type { RootStackParams } from './routes';

export function useEventActions() {
  const { store, userId } = useServices();
  const { tables } = useAppData();
  const undo = useUndo();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  return {
    /**
     * Przesunięcie wiersza terminu `date` wydarzenia `eventId`. `series` — wiersz całej serii (lista wydarzeń grupy):
     * usuwa całą serię.
     */
    cancel(eventId: string, date: string, series = false) {
      const d = eventDetail(tables, userId, eventId);
      if (!d?.canEdit) return;
      const scope = d.rule === null || series ? 'all' : 'this';
      if (affectedByCancel(tables, d, date, scope).length) return nav.navigate('Event', { eventId, date, cancel: scope });
      const ops = [...cancelEvent(d, date, scope), ...seriesCopiesCancelOps(tables, d, date, scope)];
      // Same usunięcia i zmiany wierszy, bez poleceń serwera — odwrotność zawsze istnieje.
      const back = inverseOps(tables, ops)!;
      store.dispatch(ops);
      undo.show(strings[scope === 'all' ? 'undo.deleted' : 'undo.eventCancelled'](fieldsOf(d, date, 'this').title), () => store.dispatch(back), { changed: ops });
    },
  };
}
