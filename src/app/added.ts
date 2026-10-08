/**
 * Utworzenie z formularza (decyzja właściciela z 8.10.2026, audyt 2: PW-29 A, M-126; D189): zapis i pasek
 * „Dodano … · Cofnij” — jak po usunięciu (D60), z wpisem w „Ostatnich zmianach” (D194). Po szybkim dodaniu zostaje
 * „Dodano … · Zmień” (D90).
 */
import type { NewOp } from '../domain/sync-engine/client';
import { inverseOps } from '../domain/views/commands';
import { useUndo } from '../ui/undo';
import { useAppData, useServices } from './context';

export function useAdded() {
  const { store } = useServices();
  const { tables } = useAppData();
  const undo = useUndo();
  return (message: string, ops: readonly NewOp[]) => {
    const back = inverseOps(tables, ops);
    store.dispatch(ops);
    // Polecenia serwera (np. „to i następne”) nie mają odwrotności — wtedy bez paska.
    if (back) undo.show(message, () => store.dispatch(back), { changed: ops });
  };
}
