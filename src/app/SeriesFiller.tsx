/**
 * Dokłada brakujące kopie stałych zadań serii (D65) po każdej zmianie danych i każdego dnia. Kopie mają identyfikator
 * z definicji i daty (UUIDv5), więc kilka telefonów naraz nie tworzy duplikatów, a drugi przebieg nic już nie robi.
 */
import { useEffect } from 'react';

import { fillOps } from '../domain/views/series-tasks';
import { useAppData, useServices } from './context';

export function SeriesFiller() {
  const { userId, store } = useServices();
  const { tables, today } = useAppData();
  useEffect(() => {
    const ops = fillOps(tables, userId, today);
    if (ops.length) store.dispatch(ops);
  }, [tables, userId, today, store]);
  return null;
}
