#!/usr/bin/env bash
# Przyjęcie nowych wzorców zrzutów ekranu: z rozpakowanego artefaktu „e2e-<numer przebiegu>-<próba>” (e2e.yml) kopiuje
# pliki NN-*.png każdego wariantu (screenshots/<wariant>/, PWD-38 B — scripts/e2e/run-matrix.sh --list) do
# .maestro/baselines/<wariant>/, razem z opisem symulatora (devices/<wariant>.txt → device.txt). Warianty bez zrzutów
# (np. przebieg push/PR ma tylko bazowy) zostają bez zmian. Potem przejrzyj zmiany (git diff --stat, podgląd PNG)
# i zatwierdź je w osobnym commicie „E2E: nowe wzorce zrzutów”.
# Użycie: scripts/e2e/accept-baselines.sh <katalog screenshots z artefaktu>
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="${1:?katalog ze zrzutami (…/screenshots)}"
dest="$here/../../.maestro/baselines"
shopt -s nullglob
total=0
while read -r v; do
  files=("$src/$v"/[0-9][0-9]-*.png)
  [ "${#files[@]}" -gt 0 ] || continue
  mkdir -p "$dest/$v"
  cp "${files[@]}" "$dest/$v/"
  if [ -f "$src/../devices/$v.txt" ]; then cp "$src/../devices/$v.txt" "$dest/$v/device.txt"; fi
  echo "$v: ${#files[@]} wzorców"
  total=$((total + ${#files[@]}))
done < <(bash "$here/run-matrix.sh" --list all)
[ "$total" -gt 0 ] || { echo "Brak plików <wariant>/NN-*.png w $src"; exit 1; }
echo "Skopiowano $total wzorców do $(cd "$dest" && pwd)"
