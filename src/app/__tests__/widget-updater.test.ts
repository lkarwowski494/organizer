/**
 * Testy modułu aktualizacji widżetu (src/app/widget-updater.ts).
 */
import { initialState, type ClientState } from '../../domain/sync-engine/client';
import { updateWidgetSnapshot } from '../widget-updater';
import type { WidgetBridge } from '../widget-bridge';

describe('widget-updater', () => {
  it('gdy widget jest undefined, nie rzuca błędu i nic nie robi', () => {
    const state = initialState('client-1');
    expect(() => updateWidgetSnapshot(undefined, state, 'u-1', Date.now())).not.toThrow();
  });

  it('gdy widget jest podany, wywołuje updateSnapshot z poprawnym zrzutem danych', () => {
    const updateSnapshot = jest.fn();
    const clearSnapshot = jest.fn();
    const widget: WidgetBridge = { updateSnapshot, clearSnapshot };

    const nowMs = Date.UTC(2026, 9, 15, 10, 0); // 2026-10-15T10:00:00Z
    const state: ClientState = {
      ...initialState('client-1'),
      base: {
        groups: {
          'g-1': { id: 'g-1', name: 'Rodzina', kind: 'shared', line: 1, deleted_at: null },
        },
        group_members: {
          'gm-1': { id: 'gm-1', group_id: 'g-1', user_id: 'u-1', member_id: 'm-1', role: 'admin', display_name: 'Łukasz', deleted_at: null },
        },
        lists: {
          'l-1': { id: 'l-1', group_id: 'g-1', kind: 'tasks', name: 'Sprawy', visibility: 'group', deleted_at: null },
        },
        tasks: {
          't-1': {
            id: 't-1',
            group_id: 'g-1',
            list_id: 'l-1',
            parent_id: null,
            title: 'Kupić mleko',
            deadline_mode: 'own',
            due_date: '2026-10-15',
            due_time: '12:00:00',
            status: 'todo',
            completed_at: null,
            deleted_at: null,
          },
          't-done': {
            id: 't-done',
            group_id: 'g-1',
            list_id: 'l-1',
            parent_id: null,
            title: 'Zrobione rano',
            deadline_mode: 'own',
            due_date: '2026-10-15',
            due_time: null,
            status: 'done',
            completed_at: '2026-10-15T08:00:00.000Z',
            deleted_at: null,
          },
        },
      },
    };

    updateWidgetSnapshot(widget, state, 'u-1', nowMs);

    expect(updateSnapshot).toHaveBeenCalledTimes(1);
    const jsonStr = updateSnapshot.mock.calls[0][0];
    const payload = JSON.parse(jsonStr);

    expect(payload.version).toBe(1);
    expect(payload.today).toBe('2026-10-15');
    expect(payload.totalRemainingCount).toBe(1);
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]).toMatchObject({
      id: 't-1',
      title: 'Kupić mleko',
      time: '12:00',
      kind: 'task',
      groupName: 'Rodzina',
      groupLine: 1,
      isOverdue: false,
      deepLink: 'organizer://task/t-1',
    });
  });
});
