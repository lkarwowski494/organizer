#!/usr/bin/env bash
# Audyt dostępności na symulatorze (D186, audyt 2 M-153): XCUITest performAccessibilityAudit na każdym ekranie
# z e2e/a11y/AccessibilityAuditTests.swift, na zainstalowanym buildzie E2E (scripts/e2e/run-flows.sh).
# Wynik w podsumowaniu przebiegu; z --fail problem oblewa krok (nocą i przy ręcznym uruchomieniu, jak różnice zrzutów).
# Wypisuje tylko wiersze wyników testów i opisy problemów „A11Y-ISSUE” (rodzaj, opis Apple, element: typ, testID,
# etykieta, ramka — dane demo; log zadania jest publiczny — bez wierszy `export`, D170).
# Użycie: scripts/e2e/a11y-audit.sh <udid> <katalog wyników> [--fail]
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
udid="${1:?UDID symulatora}"
out="${2:?katalog wyników}"
fail="${3:-}"
mkdir -p "$out"
proj="$(ruby "$root/e2e/a11y/make-project.rb" "$out/project")"
status=0
xcodebuild test -project "$proj" -scheme OrganizerA11yAudit -destination "id=$udid" \
  -derivedDataPath "$out/derived" -resultBundlePath "$out/a11y.xcresult" CODE_SIGNING_ALLOWED=NO >"$out/xcodebuild.log" 2>&1 || status=$?
# Zrzuty z chwili błędu (XCTAttachment „brak-<ekran>”, AccessibilityAuditTests.expectScreen) do <out>/failures —
# e2e.yml kopiuje do artefaktu tylko obrazy. `xcrun xcresulttool export attachments` (Xcode 16+, `xcrun xcresulttool
# help export attachments`); gdy go nie ma, audyt i tak się kończy.
mkdir -p "$out/failures"
xcrun xcresulttool export attachments --path "$out/a11y.xcresult" --output-path "$out/attachments" >/dev/null 2>&1 || true
find "$out/attachments" -type f \( -name '*.png' -o -name '*.jpeg' -o -name '*.jpg' -o -name '*.heic' \) -exec cp {} "$out/failures/" \; 2>/dev/null || true
grep -E "Test Case .*(passed|failed)|error: |Executed [0-9]+ tests?|\*\* TEST [A-Z]+ \*\*|Testing failed:|^\s+\S.*\(Underlying Error|A11Y-RETRY|A11Y-ISSUE" "$out/xcodebuild.log" | grep -v -E '^[[:space:]]*export ' | tee "$out/summary.txt" || true
# E2E 38208123607: kod 65 bez żadnego wiersza „Test Case” — przyczyna była tylko w pełnym logu. Wiersze po
# „Testing failed:” (opis błędu xcodebuild, bez zmiennych środowiska) też trafiają do podsumowania.
grep -A12 "Testing failed:" "$out/xcodebuild.log" | grep -v -E '^[[:space:]]*export ' | head -n 40 | tee -a "$out/summary.txt" || true
passed="$(grep -c "' passed" "$out/summary.txt" || true)"
failed="$(grep -c "' failed" "$out/summary.txt" || true)"
{
  echo "### Audyt dostępności na symulatorze (D186)"
  echo
  if [ "$status" = 0 ]; then echo "Wszystkie ekrany bez problemów ($passed)."; else echo "**Problemy na $failed ekranach** (kod xcodebuild $status) — szczegóły w logu kroku."; fi
  echo
  # Przyczyny porażek (E2E 38220289381: w podsumowaniu były tylko pominięte problemy klawiatury, a przyczyna —
  # „Audit failed to complete in time” — tylko w logu kroku), potem wszystkie problemy z audytu i ponowienia.
  grep -h -E "error: -\[" "$out/summary.txt" | sed -E 's/^[^ ]*: error: /- błąd: /' || true
  grep -h -E "A11Y-ISSUE|A11Y-RETRY" "$out/summary.txt" | sed -E 's/^.*(A11Y-ISSUE|A11Y-RETRY) \| /- \1: /' || true
  echo
} | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"
if [ "$status" != 0 ] && [ "$fail" = "--fail" ]; then exit 1; fi
exit 0
