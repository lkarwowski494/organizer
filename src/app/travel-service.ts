/**
 * Usługa dojazdu na iPhonie (D116, ADR 0029): zgoda na lokalizację „podczas używania” i bieżące położenie (expo-location,
 * https://docs.expo.dev/versions/v57.0.0/sdk/location/), adres → współrzędne (geocodeAsync, na iOS geokoder Apple)
 * i czas dojazdu z Map Apple (lokalny moduł TravelTime, MapKit). Położenie nie wychodzi poza telefon i Apple.
 */
import { requireOptionalNativeModule } from 'expo';
import * as Location from 'expo-location';

import type { TravelMode } from '../domain/travel';

export type Coords = { lat: number; lng: number };

export type TravelService = {
  status(): Promise<'granted' | 'denied' | 'undetermined'>;
  request(): Promise<boolean>;
  position(): Promise<Coords | null>;
  geocode(address: string): Promise<Coords | null>;
  eta(from: Coords, to: Coords, mode: TravelMode, departureMs: number): Promise<number>;
};

type Native = { eta(fromLat: number, fromLng: number, toLat: number, toLng: number, mode: string, departureMs: number): Promise<number> };
const native = requireOptionalNativeModule<Native>('TravelTime');

export const expoTravel: TravelService | undefined = native
  ? {
      async status() {
        const p = await Location.getForegroundPermissionsAsync();
        return p.granted ? 'granted' : p.canAskAgain ? 'undetermined' : 'denied';
      },
      async request() {
        return (await Location.requestForegroundPermissionsAsync()).granted;
      },
      async position() {
        // Ostatnie znane położenie wystarczy, jeśli świeże; inaczej jedno ustalenie z dokładnością „zrównoważoną”.
        const last = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 });
        const p = last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
        return p ? { lat: p.coords.latitude, lng: p.coords.longitude } : null;
      },
      async geocode(address) {
        const r = await Location.geocodeAsync(address);
        return r[0] ? { lat: r[0].latitude, lng: r[0].longitude } : null;
      },
      eta: (from, to, mode, departureMs) => native.eta(from.lat, from.lng, to.lat, to.lng, mode, departureMs),
    }
  : undefined;
