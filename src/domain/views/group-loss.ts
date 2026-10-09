/**
 * Grupy, do których już nie należę — jednorazowy pasek „Nie należysz już do grupy …” (audyt 3, N-162, decyzja Q33 A).
 * Grupa „znika”, gdy serwer przestaje ją pokazywać (ktoś mnie usunął; telefon zapomina jej wiersze przy pobraniu —
 * onPullResponse, sync-engine/client.ts). Nazwę zna poprzedni stan telefonu. Bez paska:
 *  - moje wyjście z grupy — już przed pobraniem nie ma jej wśród moich grup (moja zmiana jest w kolejce);
 *  - grupa w koszu (D54) — jej wiersz zostaje z datą usunięcia, a członek widzi ją w koszu (PWD-21 A);
 *  - grupa osobista (nie da się z niej wypaść).
 */
import { groupsView } from './index';
import type { Tables } from './model';

export function lostGroups(prev: Tables, next: Tables, userId: string): { id: string; name: string }[] {
  return groupsView(prev, userId)
    .filter((g) => g.kind === 'shared' && !next.groups?.[g.id])
    .map((g) => ({ id: g.id, name: g.name }));
}
