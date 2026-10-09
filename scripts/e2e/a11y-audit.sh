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
grep -E "Test Case .*(passed|failed)|error: |Executed [0-9]+ tests?|A11Y-ISSUE" "$out/xcodebuild.log" | grep -v -E '^[[:space:]]*export ' | tee "$out/summary.txt" || true
passed="$(grep -c "' passed" "$out/summary.txt" || true)"
failed="$(grep -c "' failed" "$out/summary.txt" || true)"
{
  echo "### Audyt dostępności na symulatorze (D186)"
  echo
  if [ "$status" = 0 ]; then echo "Wszystkie ekrany bez problemów ($passed)."; else echo "**Problemy na $failed ekranach** (kod xcodebuild $status) — szczegóły w logu kroku."; fi
  echo
  grep -h "A11Y-ISSUE" "$out/summary.txt" | sed -E 's/^.*A11Y-ISSUE \| /- /' || true
  echo
} | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"
if [ "$status" != 0 ] && [ "$fail" = "--fail" ]; then exit 1; fi
exit 0
