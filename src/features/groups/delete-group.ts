/**
 * Usunięcie grupy do kosza — jedno miejsce dla przycisku na ekranie grupy i przesunięcia na liście grup.
 * D187 (audyt 2: PW-16 A, M-121): bez pytania, z paskiem „Cofnij” i koszem (właściciel, config.sync.TOMBSTONE_DAYS dni).
 * Audyt 3 (N-156, decyzja Q19 A): gdy w grupie są też inne osoby, najpierw pytanie z ich liczbą — usunięcie zabiera grupę
 * także im. Pytanie tak/nie — okno systemowe (PWD-4 A), jak przy liście z zadaniami (D187).
 * Usunięcie i przywrócenie idą przez serwer, więc wymagają internetu (komunikat błędu z server-errors).
 */
import { Alert } from 'react-native';

import { useServices } from '../../app/context';
import { config } from '../../config';
import { strings } from '../../i18n/strings.pl';
import { useUndo } from '../../ui/undo';
import { groupErrorText } from './server-errors';

export function useDeleteGroup(onError: (message: string) => void) {
  const { account, store } = useServices();
  const undo = useUndo();
  /**
   * `others` — ile osób (z kontem i profili dzieci) jest w grupie poza mną; `before` — po udanym usunięciu, przed
   * odświeżeniem (np. porzucenie niezapisanej nazwy), `after` — potem (np. powrót).
   */
  return (groupId: string, name: string, others: number, hooks: { before?: () => void; after?: () => void } = {}) => {
    const go = async () => {
      try {
        await account.deleteGroup(groupId);
      } catch (e) {
        return onError(groupErrorText(e));
      }
      hooks.before?.();
      store.refresh();
      hooks.after?.();
      undo.show(strings['undo.groupDeleted'](name), () => {
        account.restoreGroup(groupId).then(
          () => store.refresh(),
          (e: unknown) => undo.show(groupErrorText(e)),
        );
      });
    };
    if (others === 0) return void go();
    Alert.alert(strings['groups.deleteConfirm'](name, others, config.sync.TOMBSTONE_DAYS), undefined, [
      { text: strings['common.cancel'], style: 'cancel' },
      { text: strings['groups.delete'], style: 'destructive', onPress: () => void go() },
    ]);
  };
}
