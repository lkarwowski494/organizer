import type React from 'react';
import { Pressable, Text } from 'react-native';

import type { RangeMode } from '../../domain/views/my-days';
import { strings } from '../../i18n/strings.pl';
import { PeriodArrow, PeriodBar, PeriodTitle, Segmented } from '../../ui/components';
import { useTheme } from '../../ui/theme';

export const TODAY_MODES: RangeMode[] = ['day', 'week', 'month'];

export function TodayPeriodNav({
  mode,
  onModeChange,
  label,
  showsToday,
  onPrev,
  onNext,
  onGoToday,
}: {
  mode: RangeMode;
  onModeChange: (m: RangeMode) => void;
  label: string;
  showsToday: boolean;
  onPrev: () => void;
  onNext: () => void;
  onGoToday: () => void;
}) {
  const { c, font, size } = useTheme();

  return (
    <>
      <Segmented
        label={strings['today.range']}
        value={mode}
        onChange={onModeChange}
        options={TODAY_MODES.map((m) => ({ value: m, label: strings[`today.range.${m}`] }))}
      />
      <PeriodBar
        prev={<PeriodArrow dir={-1} label={strings[`today.prev.${mode}`]} onPress={onPrev} />}
        title={<PeriodTitle testID="today-range-label">{label}</PeriodTitle>}
        next={<PeriodArrow dir={1} label={strings[`today.next.${mode}`]} onPress={onNext} />}
        extra={
          /* Stałe miejsce (D101): na bieżącym okresie wyszarzony, więc strzałki i nazwa okresu się nie przesuwają. */
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={strings['common.today']}
            accessibilityState={{ disabled: showsToday }}
            disabled={showsToday}
            testID="go-today"
            onPress={onGoToday}
            style={{
              minHeight: size.TOUCH_TARGET,
              paddingHorizontal: 12,
              justifyContent: 'center',
              borderRadius: 22,
              borderWidth: 1,
              borderColor: c.control,
              opacity: showsToday ? 0.35 : 1,
            }}
          >
            <Text style={{ fontFamily: font.text700, fontSize: size.CONTROL, color: c.ink }}>
              {strings['common.today']}
            </Text>
          </Pressable>
        }
      />
    </>
  );
}
