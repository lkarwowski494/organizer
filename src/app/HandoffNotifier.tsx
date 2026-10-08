/**
 * Push o przekazaniach (D70, ADR 0015) i przypisaniach (D81, ADR 0017), bez widoku: rejestruje token telefonu (gdy jest zgoda) i prosi serwer
 * o powiadomienie drugiej strony, gdy moje przekazanie albo moja decyzja dotrze na serwer. Każdy stan raz na
 * uruchomienie; serwer i tak powiadamia najwyżej raz.
 * Audyt 2:
 *  - po powrocie do aplikacji rejestracja jeszcze raz (zgoda włączona w Ustawieniach iPhone'a, wcześniej brak sieci;
 *    N-10, N-11) — serwer dostaje token tylko, gdy w tym uruchomieniu jeszcze go nie ma (supabaseAccount);
 *  - token zmieniony przez APNs w trakcie działania — od razu na serwer (N-36);
 *  - nieudana prośba o powiadomienie (brak sieci, APNs chwilowo niedostępne — serwer zwalnia wtedy zaznaczenie,
 *    N-15) — ponowienie przy powrocie do aplikacji, nie przy każdej zmianie danych.
 */
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { config } from '../config';
import { assignmentsToNotify } from '../domain/views/assignments';
import { handoffsToNotify } from '../domain/views/handoffs';
import { useAppData, useServices } from './context';
import { registerIfAllowed } from './push';

export function HandoffNotifier() {
  const { account, userId, nowMs, push } = useServices();
  const { tables } = useAppData();
  const asked = useRef(new Set<string>());
  const failed = useRef(new Set<string>());
  const [foreground, setForeground] = useState(0);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      for (const key of failed.current) asked.current.delete(key);
      failed.current.clear();
      setForeground((n) => n + 1);
    });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (push) void registerIfAllowed(push, (t, e) => account.registerPushToken(t, e));
  }, [push, account, foreground]);
  useEffect(() => {
    if (!push) return;
    return push.onToken((token) => void registerIfAllowed(push, (t, e) => account.registerPushToken(t, e), token));
  }, [push, account]);
  useEffect(() => {
    const ask = (key: string, notify: () => Promise<void>) => {
      if (asked.current.has(key)) return;
      asked.current.add(key);
      notify().catch(() => failed.current.add(key));
    };
    for (const id of handoffsToNotify(tables, userId, nowMs(), config.PUSH_MAX_AGE_H)) ask(`${id}|${String(tables.handoffs?.[id]?.status)}`, () => account.notifyHandoff(id));
    for (const id of assignmentsToNotify(tables, userId, nowMs(), config.PUSH_MAX_AGE_H)) ask(`a|${id}`, () => account.notifyAssignment(id));
  }, [tables, userId, nowMs, account, foreground]);
  return null;
}
