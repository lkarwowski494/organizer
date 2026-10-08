#!/usr/bin/env bash
# Przyjęcie nowych wzorców zrzutów ekranu: kopiuje pliki NN-*.png z katalogu zrzutów (np. rozpakowany artefakt
# „e2e-<numer przebiegu>” z e2e.yml, podkatalog screenshots/) do .maestro/baselines/. Potem przejrzyj zmiany
# (git diff --stat, podgląd PNG) i zatwierdź je w osobnym commicie „E2E: nowe wzorce zrzutów”.
# Użycie: scripts/e2e/accept-baselines.sh <katalog ze zrzutami>
set -euo pipefail
src="${1:?katalog ze zrzutami (…/screenshots)}"
dest="$(cd "$(dirname "$0")/../.." && pwd)/.maestro/baselines"
mkdir -p "$dest"
shopt -s nullglob
files=("$src"/[0-9][0-9]-*.png)
[ "${#files[@]}" -gt 0 ] || { echo "Brak plików NN-*.png w $src"; exit 1; }
cp "${files[@]}" "$dest/"
if [ -f "$src/../device.txt" ]; then cp "$src/../device.txt" "$dest/device.txt"; fi
echo "Skopiowano ${#files[@]} wzorców do $dest"
