#!/usr/bin/env bash
# Instaluje build E2E na uruchomionym symulatorze i przechodzi scenariusze .maestro/ (Maestro CLI w PATH albo $MAESTRO).
# Zrzuty z takeScreenshot zbiera do <out>/screenshots, raport JUnit i logi Maestro do <out>/maestro.
# Flagi `maestro test --help` (wersja z install-maestro.sh): --test-output-dir zawiera takeScreenshot/.
# Użycie: scripts/e2e/run-flows.sh <udid> <ścieżka .app> [katalog wyników, domyślnie e2e-artifacts]
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
udid="${1:?UDID symulatora}"
app="${2:?ścieżka do Organizer.app}"
out="${3:-e2e-artifacts}"
case "$out" in /*) ;; *) out="$root/$out" ;; esac
maestro="${MAESTRO:-maestro}"
export MAESTRO_CLI_NO_ANALYTICS=1 MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true

mkdir -p "$out/maestro" "$out/screenshots" "$out/run"
xcrun simctl install "$udid" "$app"

# Maestro zapisuje takeScreenshot względem bieżącego katalogu — osobny katalog, potem zbieramy pliki NN-*.png.
status=0
(cd "$out/run" && "$maestro" test --device "$udid" --format JUNIT --output "$out/maestro/report.xml" \
  --test-output-dir "$out/maestro/output" --debug-output "$out/maestro/debug" --flatten-debug-output \
  "$root/.maestro") || status=$?

find "$out/run" "$out/maestro" -type f -name '[0-9][0-9]-*.png' -exec cp {} "$out/screenshots/" \;
echo "Zrzuty: $(find "$out/screenshots" -name '*.png' | wc -l | tr -d ' ') w $out/screenshots"
exit "$status"
