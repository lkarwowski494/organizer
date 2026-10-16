/**
 * Mostek widżetu iOS (D17, BRD B4): zapis zrzutu danych do App Group
 * i odświeżenie osi czasu widżetów (WidgetKit, reloadAllTimelines).
 */
import { requireOptionalNativeModule } from 'expo';

export type WidgetBridge = {
  updateSnapshot(json: string): void;
  clearSnapshot(): void;
};

type Native = {
  updateSnapshot(json: string): void;
  clearSnapshot(): void;
};

const native = requireOptionalNativeModule<Native>('WidgetBridge');

export const expoWidgetBridge: WidgetBridge | undefined = native
  ? {
      updateSnapshot: (json) => native.updateSnapshot(json),
      clearSnapshot: () => native.clearSnapshot(),
    }
  : undefined;
