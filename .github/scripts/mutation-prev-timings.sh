#!/usr/bin/env bash
# Pomiar czasu testów mutacyjnych z poprzedniego przebiegu nightly (artefakt mutation-timings, mutation-merge.mjs) dla
# planu części (mutation-plan.mjs). Szuka w najnowszych zakończonych przebiegach nightly.yml najpierw na podanej gałęzi,
# potem na main; pobiera pierwszy znaleziony timings.json do <katalog>. Brak pomiaru (pierwszy przebieg, artefakt po
# 7 dniach usunięty, błąd API) nie jest błędem — plan liczy wtedy z samego modelu.
#
# Artefakt pochodzi z naszego workflow na tej samej gałęzi albo na main (PR z forka nie zapisuje artefaktów w przebiegach
# nightly), a mutation-plan.mjs i tak sprawdza jego postać: wpływa tylko na podział pracy, nie na wynik — zły pomiar
# może co najwyżej spowodować przekroczenie czasu części, które oblewa przebieg.
#
# Użycie: GH_TOKEN=… GITHUB_REPOSITORY=właściciel/repo mutation-prev-timings.sh <gałąź> <katalog>
set -uo pipefail

branch="$1"
dir="$2"
repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY}"
mkdir -p "$dir"

for b in "$branch" main; do
  ids="$(gh api -X GET "repos/$repo/actions/workflows/nightly.yml/runs" -f branch="$b" -f status=completed -f per_page=10 \
    --jq '.workflow_runs[].id' 2>/dev/null)" || ids=""
  for id in $ids; do
    if gh run download "$id" -R "$repo" -n mutation-timings -D "$dir" >/dev/null 2>&1 && [ -s "$dir/timings.json" ]; then
      echo "Pomiar z przebiegu $id (gałąź $b): $dir/timings.json"
      exit 0
    fi
  done
done
echo "Brak pomiaru z poprzedniego przebiegu — plan z samego modelu."
exit 0
