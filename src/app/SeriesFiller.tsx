/**
 * Dokłada brakujące kopie stałych zadań serii (D65) po każdej zmianie danych i każdego dnia. Kopie mają identyfikator
 * z definicji i daty (UUIDv5), więc kilka telefonów naraz nie tworzy duplikatów, a drugi przebieg nic już nie robi.
 */
import { useEffect, useMemo } from 'react';

import { rejectedCreateIds } from '../domain/sync-engine/client';
import { fillOps } from '../domain/views/series-tasks';
import { useAppData, useServices } from './context';

export function SeriesFiller() {
  const { userId, store } = useServices();
  const { tables, today, state } = useAppData();
  // Kopia odrzucona przez serwer nie wraca przy każdym pobraniu (audyt 2, M-49).
  const rejected = useMemo(() => rejectedCreateIds(state), [state.rejected]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const ops = fillOps(tables, userId, today, rejected);
    if (ops.length) store.dispatch(ops);
  }, [tables, userId, today, store, rejected]);
  return null;
}
