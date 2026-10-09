#!/usr/bin/env bash
# Scenariusze E2E w wariantach zrzutów (decyzja PWD-38 B, audyt 2 M-307): 2 telefony × 2 tryby kolorów × 2 rozmiary
# tekstu. Jeden build (scripts/e2e/build-ios.sh) instalowany na każdym symulatorze; zrzuty każdego wariantu w osobnym
# katalogu <out>/<wariant>/screenshots, wzorce w .maestro/baselines/<wariant>/.
# Telefony: najmniejszy i największy iPhone zainstalowany na obrazie runnera macos-26 (lista „Installed Simulators”
# w https://github.com/actions/runner-images/blob/main/images/macos/macos-26-arm64-Readme.md, 8.10.2026: iPhone 17e,
# iPhone 17, iPhone 17 Pro, iPhone 17 Pro Max, iPhone Air). Rozmiar tekstu: domyślny („large”) i największy
# z ustawień dostępności (`xcrun simctl ui <udid> content_size accessibility-extra-extra-extra-large`, Dynamic Type
# AX5); wygląd: `xcrun simctl ui <udid> appearance light|dark` (`xcrun simctl help ui`).
#
# Użycie: scripts/e2e/run-matrix.sh <ścieżka .app> <katalog wyników> base|all
#         scripts/e2e/run-matrix.sh --list [base|all]   — same nazwy wariantów (do testów i e2e:accept)
# „base” = pierwszy wariant (iPhone 17e, jasny, domyślny tekst) — przy push i PR; „all” — nocą i ręcznie.
# Kod wyjścia: 1, gdy scenariusze nie przeszły w wariancie bazowym; porażki pozostałych wariantów są w
# <out>/variants-failed.txt (krok porównania zrzutów oblewa je nocą, jak różnice zrzutów).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"

PHONES=("iPhone 17e" "iPhone 17 Pro Max")
APPEARANCES=(light dark)
SIZES=(default ax5)

slug() { printf '%s' "$1" | tr '[:upper:] ' '[:lower:]-'; }
variants() { # variants base|all → wiersze „wariant|telefon|wygląd|rozmiar”
  for phone in "${PHONES[@]}"; do
    for appearance in "${APPEARANCES[@]}"; do
      for size in "${SIZES[@]}"; do
        echo "$(slug "$phone")-$appearance-$size|$phone|$appearance|$size"
        if [ "$1" = base ]; then return; fi
      done
    done
  done
}

if [ "${1:-}" = "--list" ]; then
  variants "${2:-all}" | cut -d'|' -f1
  exit 0
fi

app="${1:?ścieżka do Organizer.app}"
out="${2:?katalog wyników}"
which="${3:?base albo all}"
[ "$which" = base ] || [ "$which" = all ] || { echo "Trzeci argument: base albo all" >&2; exit 2; }
mkdir -p "$out"
: >"$out/variants-failed.txt"
: >"$out/variants.txt"

status=0
current=""
first=1
while IFS='|' read -r name phone appearance size; do
  udid="$("$here/boot-simulator.sh" "$phone" | tail -n 1)"
  if [ -n "$current" ] && [ "$current" != "$udid" ]; then xcrun simctl shutdown "$current" 2>/dev/null || true; fi
  current="$udid"
  xcrun simctl ui "$udid" appearance "$appearance"
  if [ "$size" = ax5 ]; then xcrun simctl ui "$udid" content_size accessibility-extra-extra-extra-large; else xcrun simctl ui "$udid" content_size large; fi
  echo "== wariant $name ($phone, $appearance, tekst $size)"
  echo "$name" >>"$out/variants.txt"
  xcrun simctl list devices booted >"$out/device-$name.txt"
  if ! "$here/run-flows.sh" "$udid" "$app" "$out/$name"; then
    echo "$name" >>"$out/variants-failed.txt"
    if [ "$first" = 1 ]; then status=1; fi
  fi
  first=0
done < <(variants "$which")
exit "$status"
