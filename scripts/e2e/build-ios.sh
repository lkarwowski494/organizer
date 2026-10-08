#!/usr/bin/env bash
# Build aplikacji dla symulatora iOS w trybie E2E (D143): EXPO_PUBLIC_E2E=1 → atrapy z src/app/e2e.ts zamiast Supabase.
# Konfiguracja Release (paczka JS w aplikacji, bez serwera Metro i bez nakładek trybu deweloperskiego na zrzutach),
# bez podpisu (CODE_SIGNING_ALLOWED=NO — symulator nie wymaga profilu, żadne sekrety nie są potrzebne).
# Tego buildu NIE wolno wysyłać do TestFlight: ios-release.yml buduje osobno, bez flagi (test kontraktowy
# src/app/__tests__/e2e-flag.test.ts), a sesja demo i tak działa tylko na symulatorze.
# Użycie: scripts/e2e/build-ios.sh <udid symulatora>   Wynik (ostatni wiersz): ios/build/e2e/Build/Products/Release-iphonesimulator/Organizer.app
# (katalog ios/ jest generowany i w .gitignore)
set -euo pipefail
cd "$(dirname "$0")/../.."
udid="${1:?Podaj UDID symulatora (scripts/e2e/boot-simulator.sh)}"

export EXPO_PUBLIC_E2E=1
export CI=1 # expo prebuild bez pytań
npx expo prebuild --platform ios --clean
mkdir -p ios/build
log=ios/build/e2e-xcodebuild.log
echo "xcodebuild (pełny log: $log)…"
if ! xcodebuild \
  -workspace ios/Organizer.xcworkspace \
  -scheme Organizer \
  -configuration Release \
  -sdk iphonesimulator \
  -destination "id=$udid" \
  -derivedDataPath ios/build/e2e \
  ONLY_ACTIVE_ARCH=YES \
  CODE_SIGNING_ALLOWED=NO \
  build >"$log" 2>&1; then
  grep -E 'error:|\*\* BUILD FAILED' "$log" | head -50 || true
  tail -n 100 "$log"
  exit 1
fi
tail -n 3 "$log"
app="ios/build/e2e/Build/Products/Release-iphonesimulator/Organizer.app"
test -d "$app" || { echo "Brak $app"; exit 1; }
echo "$app"
