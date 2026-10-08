/**
 * Dotknięcie powiadomienia otwiera sprawę (PWD-16, decyzja właściciela 8.10.2026): zadanie, listę zakupów, termin
 * wydarzenia albo „Moje sprawy” (skrzynka przekazań). Przypomnienia i push niosą tę samą ścieżkę co linki głębokie
 * (notification-target.ts). Sprawę, której na telefonie nie ma (usunięta, jeszcze niepobrana), ekran pokazuje jak
 * zwykle — „screen-task-missing”, „screen-event-missing”, a po pobraniu zmian już ją samą.
 * Komponent stoi poza nawigatorami, więc używa kontenera nawigacji; przy uruchomieniu z powiadomienia czeka, aż
 * kontener będzie gotowy (zdarzenie „ready”, React Navigation 7: NavigationContainerEventMap).
 */
import { type NavigationContainerRef, NavigationContainerRefContext } from '@react-navigation/native';
import { useContext, useEffect } from 'react';

import { parseTarget, type Target } from '../domain/notification-target';
import { useServices } from './context';
import type { RootStackParams } from './routes';

function open(nav: NavigationContainerRef<RootStackParams>, t: Target) {
  if (t.screen === 'task') nav.navigate('Task', { taskId: t.id });
  else if (t.screen === 'list') nav.navigate('List', { listId: t.id });
  else if (t.screen === 'event') nav.navigate('Event', t.date ? { eventId: t.id, date: t.date } : { eventId: t.id });
  else nav.navigate('Tabs', { screen: 'Today' });
}

export function NotificationOpener() {
  const { push } = useServices();
  const nav = useContext(NavigationContainerRefContext) as NavigationContainerRef<RootStackParams> | undefined;
  useEffect(() => {
    if (!push || !nav) return;
    const waiting: (() => void)[] = [];
    const off = push.onOpen((path) => {
      const t = parseTarget(path);
      if (!t) return;
      if (nav.isReady()) return open(nav, t);
      const stop = nav.addListener('ready', () => {
        stop();
        open(nav, t);
      });
      waiting.push(stop);
    });
    return () => {
      off();
      waiting.forEach((stop) => stop());
    };
  }, [push, nav]);
  return null;
}
