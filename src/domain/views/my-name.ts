/**
 * Moje imię (D100): pytanie o imię, gdy konto go nie ma (logowanie e-mailem — dotąd w grupach widać było początek
 * adresu, np. „lukasz.karwowski93”), i zmiana w Ustawieniach. Nowe imię trafia do profilu konta i do moich członkostw,
 * ale tylko tam, gdzie nazywam się „po staremu” (stare imię, początek adresu e-mail, „Ja” albo pusto) — imię ustawione
 * w konkretnej grupie (np. „Tata” w rodzinie) zostaje.
 */
import { config } from '../../config';
import type { NewOp } from '../sync-engine/client';
import { renameMember } from './commands';
import { groupsView } from './index';
import type { Tables } from './model';

/** Imię zastępcze, gdy konto nie ma imienia (serwer: migracja core, `coalesce(..., 'Ja')`). */
export const PLACEHOLDER_NAME = 'Ja';

/** Początek adresu e-mail — tak aplikacja nazywała osobę bez imienia (przed D100). */
export const emailName = (email: string | null | undefined) => (email ? email.split('@')[0]! : null);

export type NameError = 'empty' | 'tooLong';

export function validateName(name: string): NameError | null {
  const n = name.trim();
  if (n === '') return 'empty';
  return n.length > config.profile.NAME_MAX_LENGTH ? 'tooLong' : null;
}

/**
 * Zmiana nazwy moich członkostw z „dawnymi” imionami (`oldNames`, plus „Ja” i pusto) na `name`. Tylko w grupach, w których
 * jestem (groupsView: żywe członkostwo w grupie spoza kosza) — zmianę w grupie z kosza serwer odrzuca (deleted:group),
 * a odrzucenie trafiało do „Odrzuconych zmian” (audyt 2, R-35).
 */
export function renameMeOps(t: Tables, userId: string, name: string, oldNames: readonly (string | null | undefined)[]): NewOp[] {
  const n = name.trim();
  const old = new Set(['', PLACEHOLDER_NAME, ...oldNames.filter((x): x is string => !!x)]);
  const mine = new Set(groupsView(t, userId).map((g) => g.me.member_id));
  return Object.values(t.group_members ?? {})
    .filter((m) => mine.has(String(m.member_id)) && old.has(String(m.display_name ?? '').trim()) && m.display_name !== n)
    .map((m) => renameMember(String(m.member_id), n));
}
