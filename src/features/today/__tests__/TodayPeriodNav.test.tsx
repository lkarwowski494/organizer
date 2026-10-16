import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import { ThemeProvider } from '../../../ui/theme';
import { TodayPeriodNav } from '../TodayPeriodNav';

describe('TodayPeriodNav', () => {
  afterEach(() => {
    cleanup();
  });

  it('renderuje etykietę i obsługuje strzałkę poprzedniego okresu', async () => {
    const onPrev = jest.fn();
    await render(
      <ThemeProvider>
        <TodayPeriodNav
          mode="day"
          onModeChange={jest.fn()}
          label="piątek, 16 października"
          showsToday={false}
          onPrev={onPrev}
          onNext={jest.fn()}
          onGoToday={jest.fn()}
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('today-range-label').props.children).toBe('piątek, 16 października');
    fireEvent.press(screen.getByLabelText('Poprzedni dzień'));
    expect(onPrev).toHaveBeenCalledTimes(1);
  });


  it('obsługuje strzałkę następnego okresu', async () => {
    const onNext = jest.fn();
    await render(
      <ThemeProvider>
        <TodayPeriodNav
          mode="day"
          onModeChange={jest.fn()}
          label="piątek, 16 października"
          showsToday={false}
          onPrev={jest.fn()}
          onNext={onNext}
          onGoToday={jest.fn()}
        />
      </ThemeProvider>,
    );

    fireEvent.press(screen.getByLabelText('Następny dzień'));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('obsługuje powrót do dzisiaj gdy showsToday jest false', async () => {
    const onGoToday = jest.fn();
    await render(
      <ThemeProvider>
        <TodayPeriodNav
          mode="day"
          onModeChange={jest.fn()}
          label="piątek, 16 października"
          showsToday={false}
          onPrev={jest.fn()}
          onNext={jest.fn()}
          onGoToday={onGoToday}
        />
      </ThemeProvider>,
    );

    fireEvent.press(screen.getByTestId('go-today'));
    expect(onGoToday).toHaveBeenCalledTimes(1);
  });

  it('gdy showsToday jest true, przycisk Dzisiaj jest wyłączony', async () => {
    await render(
      <ThemeProvider>
        <TodayPeriodNav
          mode="day"
          onModeChange={jest.fn()}
          label="piątek, 16 października"
          showsToday={true}
          onPrev={jest.fn()}
          onNext={jest.fn()}
          onGoToday={jest.fn()}
        />
      </ThemeProvider>,
    );

    const btn = screen.getByTestId('go-today');
    expect(btn.props.accessibilityState.disabled).toBe(true);
  });

  it('obsługuje zmianę trybu na tydzień', async () => {
    const onModeChange = jest.fn();
    await render(
      <ThemeProvider>
        <TodayPeriodNav
          mode="day"
          onModeChange={onModeChange}
          label="piątek, 16 października"
          showsToday={false}
          onPrev={jest.fn()}
          onNext={jest.fn()}
          onGoToday={jest.fn()}
        />
      </ThemeProvider>,
    );

    fireEvent.press(screen.getByText('Tydzień'));
    expect(onModeChange).toHaveBeenCalledWith('week');
  });
});

