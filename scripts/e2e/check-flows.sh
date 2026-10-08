#!/usr/bin/env bash
# Składnia scenariuszy Maestro (`maestro check-syntax`, bez urządzenia — działa też na Linuksie).
# Sprawdza każdy plik .maestro/*.yaml i .maestro/common/*.yaml poza config.yaml (konfiguracja obszaru, nie scenariusz).
export MAESTRO_CLI_NO_ANALYTICS=1 MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true
set -euo pipefail
cd "$(dirname "$0")/../.."
maestro="${MAESTRO:-maestro}"
status=0
for f in .maestro/*.yaml .maestro/common/*.yaml; do
  [ "$(basename "$f")" = "config.yaml" ] && continue
  if out="$("$maestro" check-syntax "$f" 2>&1)" && grep -q '^OK$' <<<"$out"; then
    echo "OK   $f"
  else
    echo "BŁĄD $f"; grep -v '^Picked up JAVA_TOOL_OPTIONS' <<<"$out" || true
    status=1
  fi
done
# Cały obszar (config.yaml, ścieżki runFlow): `maestro test` bez urządzenia najpierw wczytuje scenariusze, a dopiero
# potem szuka symulatora — komunikat o braku urządzeń oznacza, że wczytanie się udało.
# Tylko bez symulatorów (Linux): na Macu z uruchomionym symulatorem to polecenie naprawdę przeszłoby scenariusze.
if [ "$status" -eq 0 ] && [ "$(uname)" != "Darwin" ]; then
  out="$("$maestro" test -p ios .maestro 2>&1 || true)"
  if grep -q 'Not enough devices connected\|0 devices connected' <<<"$out"; then
    echo "OK   .maestro (obszar)"
  else
    echo "BŁĄD .maestro (obszar)"; grep -v '^Picked up JAVA_TOOL_OPTIONS' <<<"$out" | tail -n 20 || true
    status=1
  fi
fi
exit "$status"
