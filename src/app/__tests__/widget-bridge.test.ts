/**
 * Testy mostka widżetu iOS (src/app/widget-bridge.ts).
 */
describe('widget-bridge', () => {
  it('gdy moduł natywny jest dostępny, deleguje updateSnapshot i clearSnapshot', () => {
    const native = {
      updateSnapshot: jest.fn(),
      clearSnapshot: jest.fn(),
    };
    let bridge: typeof import('../widget-bridge');
    jest.isolateModules(() => {
      jest.doMock('expo', () => ({
        requireOptionalNativeModule: jest.fn((name: string) => (name === 'WidgetBridge' ? native : null)),
      }));
      /* eslint-disable @typescript-eslint/no-require-imports -- dynamiczne przeładowanie modułu w testach isolateModules */
      bridge = require('../widget-bridge');
      /* eslint-enable @typescript-eslint/no-require-imports */
    });

    expect(bridge!.expoWidgetBridge).toBeDefined();
    bridge!.expoWidgetBridge!.updateSnapshot('{"version":1}');
    expect(native.updateSnapshot).toHaveBeenCalledWith('{"version":1}');

    bridge!.expoWidgetBridge!.clearSnapshot();
    expect(native.clearSnapshot).toHaveBeenCalledTimes(1);
  });

  it('gdy moduł natywny nie jest dostępny, expoWidgetBridge jest undefined', () => {
    let bridge: typeof import('../widget-bridge');
    jest.isolateModules(() => {
      jest.doMock('expo', () => ({
        requireOptionalNativeModule: jest.fn(() => null),
      }));
      /* eslint-disable @typescript-eslint/no-require-imports -- dynamiczne przeładowanie modułu w testach isolateModules */
      bridge = require('../widget-bridge');
      /* eslint-enable @typescript-eslint/no-require-imports */
    });

    expect(bridge!.expoWidgetBridge).toBeUndefined();
  });
});
