/**
 * Jednorazowy pasek „Nie należysz już do grupy …” (audyt 3, N-162, decyzja Q33 A), gdy po pobraniu grupa znika z moich
 * grup, bo ktoś mnie z niej usunął (reguła: domain/views/group-loss.ts). Bez widoku, stoi poza nawigatorami jak UndoLinks.
 */
import { useEffect, useRef } from 'react';

import { lostGroups } from '../domain/views/group-loss';
import { strings } from '../i18n/strings.pl';
import { useUndo } from '../ui/undo';
import { useAppData, useServices } from './context';

export function GroupLossNotice() {
  const { userId } = useServices();
  const { tables } = useAppData();
  const { show } = useUndo();
  const prev = useRef(tables);
  useEffect(() => {
    const lost = lostGroups(prev.current, tables, userId);
    prev.current = tables;
    if (lost.length) show(strings['groups.lost'](lost.map((g) => g.name)));
  }, [tables, userId, show]);
  return null;
}
