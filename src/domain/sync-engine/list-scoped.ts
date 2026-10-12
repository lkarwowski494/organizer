/**
 * Tabele, których wiersz należy do listy przez kolumnę list_id: widzi go tylko ten, kto widzi listę (polityki RLS
 * private.can_see_list(list_id)), więc po zawężeniu listy znika z telefonu, a po poszerzeniu albo nadaniu dostępu
 * przychodzi razem z listą. Ten sam zbiór zwraca private.list_scoped_entities() na serwerze (migracja
 * 20261012010000_pull_budget; test kontraktowy src/config/__tests__/sql.contract.test.ts, a test schematu w
 * supabase/tests/pull_budget.test.sql pilnuje, że każda tabela z list_id jest na liście). Audyt 3, N-88: zrobione zakupy
 * wypadły z tych miejsc, tak jak wcześniej stałe zadania wydarzeń.
 * Wpisy dostępu (object_members) i historia (activity) należą do listy przez scope_id — osobno.
 */
export const LIST_SCOPED_ENTITIES: readonly string[] = ['tasks', 'event_task_series', 'shopping_trips'];
