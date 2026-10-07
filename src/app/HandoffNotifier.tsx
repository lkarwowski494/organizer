/**
 * Push o przekazaniach (D70, ADR 0015) i przypisaniach (D81, ADR 0017), bez widoku: rejestruje token telefonu (gdy jest zgoda) i prosi serwer
 * o powiadomienie drugiej strony, gdy moje przekazanie albo moja decyzja dotrze na serwer. Każdy stan raz na
 * uruchomienie; nieudane — przy następnym (serwer i tak powiadamia najwyżej raz).
 */
import { useEffect, useRef } from 'react';

import { config } from '../config';
import { assignmentsToNotify } from '../domain/views/assignments';
import { handoffsToNotify } from '../domain/views/handoffs';
import { useAppData, useServices } from './context';
import { registerIfAllowed } from './push';

export function HandoffNotifier() {
  const { account, userId, nowMs, push } = useServices();
  const { tables } = useAppData();
  const asked = useRef(new Set<string>());
  useEffect(() => {
    if (push) void registerIfAllowed(push, (t, e) => account.registerPushToken(t, e));
  }, [push, account]);
  useEffect(() => {
    for (const id of handoffsToNotify(tables, userId, nowMs(), config.PUSH_MAX_AGE_H)) {
      const key = `${id}|${String(tables.handoffs?.[id]?.status)}`;
      if (asked.current.has(key)) continue;
      asked.current.add(key);
      account.notifyHandoff(id).catch(() => {});
    }
    for (const id of assignmentsToNotify(tables, userId, nowMs(), config.PUSH_MAX_AGE_H)) {
      const key = `a|${id}`;
      if (asked.current.has(key)) continue;
      asked.current.add(key);
      account.notifyAssignment(id).catch(() => {});
    }
  }, [tables, userId, nowMs, account]);
  return null;
}
