import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import { ThemeProvider } from '../../../ui/theme';
import { TodayAskPanels } from '../TodayAskPanels';

describe('TodayAskPanels', () => {
  afterEach(() => {
    cleanup();
  });

  it('gdy ask jest null, nic nie renderuje', async () => {
    const { toJSON } = await render(
      <ThemeProvider>
        <TodayAskPanels ask={null} onProceed={jest.fn()} onCancel={jest.fn()} toShopping={jest.fn()} />
      </ThemeProvider>,
    );
    expect(toJSON()).toBeNull();
  });

  it('obsługuje panel wyboru osoby (many)', async () => {
    const onProceed = jest.fn();

    await render(
      <ThemeProvider>
        <TodayAskPanels
          ask={{
            r: {
              kind: 'many',
              name: 'Ania',
              targets: [
                { memberId: 'm1', groupId: 'g1', groupName: 'Dom', displayName: 'Ania K.' },
                { memberId: 'm2', groupId: 'g2', groupName: 'Praca', displayName: 'Ania M.' },
              ],
            },
            answers: {},
          }}
          onProceed={onProceed}
          onCancel={jest.fn()}
          toShopping={jest.fn()}
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('mention-choices')).toBeTruthy();
    fireEvent.press(screen.getByText('Ania K. · Dom'));
    expect(onProceed).toHaveBeenCalledWith({ person: { memberId: 'm1', groupId: 'g1', groupName: 'Dom', displayName: 'Ania K.' } });
  });

  it('obsługuje panel nieznanej osoby (unknown)', async () => {
    const onProceed = jest.fn();

    await render(
      <ThemeProvider>
        <TodayAskPanels
          ask={{
            r: { kind: 'unknown', name: 'Zdzichu' },
            answers: {},
          }}
          onProceed={onProceed}
          onCancel={jest.fn()}
          toShopping={jest.fn()}
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('mention-unknown')).toBeTruthy();
    fireEvent.press(screen.getByText('Dodaj bez osoby'));
    expect(onProceed).toHaveBeenCalledWith({ skipMention: true });
  });

  it('obsługuje panel wyboru grupy (manyGroups)', async () => {
    const onProceed = jest.fn();

    await render(
      <ThemeProvider>
        <TodayAskPanels
          ask={{
            r: {
              kind: 'manyGroups',
              name: 'Projekt',
              groups: [
                { id: 'g1', name: 'Projekt A' },
                { id: 'g2', name: 'Projekt B' },
              ],
            },
            answers: {},
          }}
          onProceed={onProceed}
          onCancel={jest.fn()}
          toShopping={jest.fn()}
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('tag-choices')).toBeTruthy();
    fireEvent.press(screen.getByText('Projekt A'));
    expect(onProceed).toHaveBeenCalledWith({ group: 'g1' });
  });

  it('obsługuje grupę dziecka z listą zakupów (childGroup)', async () => {
    const toShopping = jest.fn();

    await render(
      <ThemeProvider>
        <TodayAskPanels
          ask={{
            r: {
              kind: 'childGroup',
              name: 'Rodzina',
              body: 'szampon',
              groups: [{ id: 'g1', name: 'Rodzina', list: { id: 'l1', name: 'Zakupy' } }],
            },
            answers: {},
          }}
          onProceed={jest.fn()}
          onCancel={jest.fn()}
          toShopping={toShopping}
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('tag-child')).toBeTruthy();
    fireEvent.press(screen.getByText('Na listę: Zakupy (Rodzina)'));
    expect(toShopping).toHaveBeenCalledWith(null, 'szampon', { id: 'l1', name: 'Zakupy' });
  });

  it('obsługuje nieznaną grupę z chipem (unknownGroup)', async () => {
    const onProceed = jest.fn();

    await render(
      <ThemeProvider>
        <TodayAskPanels
          ask={{
            r: {
              kind: 'unknownGroup',
              name: 'Nieznana',
              chip: { id: 'g-dom', name: 'Dom' },
            },
            answers: {},
          }}
          onProceed={onProceed}
          onCancel={jest.fn()}
          toShopping={jest.fn()}
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('tag-unknown')).toBeTruthy();
    fireEvent.press(screen.getByText('Dodaj do: Dom'));
    expect(onProceed).toHaveBeenCalledWith({ skipTag: true });
  });

  it('obsługuje grupę dziecka bez listy zakupów (childGroup)', async () => {
    await render(
      <ThemeProvider>
        <TodayAskPanels
          ask={{
            r: {
              kind: 'childGroup',
              name: 'Rodzina',
              body: 'szampon',
              groups: [{ id: 'g1', name: 'Rodzina', list: null }],
            },
            answers: {},
          }}
          onProceed={jest.fn()}
          onCancel={jest.fn()}
          toShopping={jest.fn()}
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('tag-child')).toBeTruthy();
  });

  it('zwraca null dla nieobsługiwanego rodzaju zapytania', async () => {
    const { toJSON } = await render(
      <ThemeProvider>
        <TodayAskPanels
          ask={{
            r: { kind: 'unknownKind' as unknown as 'many' } as unknown as any,
            answers: {},
          }}
          onProceed={jest.fn()}
          onCancel={jest.fn()}
          toShopping={jest.fn()}
        />
      </ThemeProvider>,
    );
    expect(toJSON()).toBeNull();
  });

  it('obsługuje przycisk Anuluj', async () => {
    const onCancel = jest.fn();

    await render(
      <ThemeProvider>
        <TodayAskPanels
          ask={{
            r: {
              kind: 'unknown',
              name: 'Zdzichu',
            },
            answers: {},
          }}
          onProceed={jest.fn()}
          onCancel={onCancel}
          toShopping={jest.fn()}
        />
      </ThemeProvider>,
    );

    fireEvent.press(screen.getByText('Anuluj'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
