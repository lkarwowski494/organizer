/**
 * Połączenia paska „Cofnij” z nawigacją (komponent stoi poza nawigatorami, jak NotificationOpener):
 *  - treść paska otwiera „Ostatnie zmiany” (D194);
 *  - jednorazowy pasek „Serwer nie przyjął N zmian — Zobacz” przy nowych odrzuceniach (decyzja właściciela z 8.10.2026,
 *    audyt 2: PW-30 A, M-137; D190). Odrzucenia sprzed uruchomienia nie wracają — już je widać w liście.
 */
import { type NavigationContainerRef, NavigationContainerRefContext } from '@react-navigation/native';
import { useContext, useEffect, useRef } from 'react';

import { strings } from '../i18n/strings.pl';
import { useUndo } from '../ui/undo';
import { useAppData } from './context';
import type { RootStackParams } from './routes';

export function UndoLinks() {
  const nav = useContext(NavigationContainerRefContext) as NavigationContainerRef<RootStackParams> | undefined;
  const { show, bindOpenRecent } = useUndo();
  const { state } = useAppData();
  const seen = useRef(Math.max(0, ...state.rejected.map((r) => r.op.seq)));
  useEffect(() => {
    if (!nav) return;
    bindOpenRecent(() => nav.navigate('Recent'));
    return () => bindOpenRecent(null);
  }, [nav, bindOpenRecent]);
  useEffect(() => {
    const fresh = state.rejected.filter((r) => r.op.seq > seen.current);
    if (fresh.length === 0) return;
    seen.current = Math.max(...fresh.map((r) => r.op.seq));
    show(strings['rejected.bar'](fresh.length), () => nav?.navigate('Rejected'), strings['rejected.see']);
  }, [state.rejected, show, nav]);
  return null;
}
