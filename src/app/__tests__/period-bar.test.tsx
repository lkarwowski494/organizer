/**
 * Pasek okresu przy dużym tekście (E2E 38208123607, AX5: „Czwartek, 8” między strzałkami i „Dziś” łamał się po 2–3
 * litery). Od fontScale.STACK_FROM (AX1 w React Native) nazwa okresu stoi nad przyciskami — Apple HIG Typography:
 * „consider using a stacked layout where text appears above secondary items”.
 */
import { render, screen } from '@testing-library/react-native';
import * as RN from 'react-native';

import { fontScale } from '../../config/theme';
import { PeriodBar } from '../../ui/components';

const bar = () => <PeriodBar testID="bar" prev={<RN.Text testID="prev">‹</RN.Text>} title={<RN.Text testID="title">Czwartek, 8 października</RN.Text>} next={<RN.Text testID="next">›</RN.Text>} extra={<RN.Text testID="today">Dziś</RN.Text>} />;
const rows = () =>
  (screen.getByTestId('bar').children as unknown as { props: { style?: unknown }; children: unknown[] }[]).map((r) =>
    (r.children as { props: { testID?: string } }[]).map((c) => c.props.testID),
  );
const withScale = (scale: number) => jest.spyOn(RN.Dimensions, 'get').mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: scale });

afterEach(() => jest.restoreAllMocks());

describe('PeriodBar', () => {
  it('do rozmiaru xxxLarge (1,353) wszystko w jednym wierszu', async () => {
    withScale(1.353);
    await render(bar());
    expect(RN.StyleSheet.flatten(screen.getByTestId('bar').props.style)).toMatchObject({ flexDirection: 'row' });
    expect((screen.getByTestId('bar').children as { props: { testID?: string } }[]).map((c) => c.props.testID)).toEqual(['prev', 'title', 'next', 'today']);
  });

  it('od AX1 nazwa okresu w osobnym wierszu nad strzałkami i „Dziś”', async () => {
    withScale(fontScale.STACK_FROM);
    await render(bar());
    expect(rows()).toEqual([['title'], ['prev', 'next', 'today']]);
  });

  it('przy AX5 (3,571) też', async () => {
    withScale(3.571);
    await render(bar());
    expect(rows()).toEqual([['title'], ['prev', 'next', 'today']]);
  });
});
