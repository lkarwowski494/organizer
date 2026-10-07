/** Trasy nawigacji (D26: React Navigation, linki głębokie konfigurowane ręcznie). */
export type RootStackParams = {
  Tabs: undefined;
  List: { listId: string };
  Task: { taskId: string };
  NewList: { groupId?: string; kind?: 'tasks' | 'shopping' };
  Group: { groupId: string };
  NewGroup: undefined;
  Invite: { token?: string };
  Settings: undefined;
  Rejected: undefined;
};

export type TabParams = { Today: undefined; Lists: undefined; Calendar: undefined; Groups: undefined };
