#!/usr/bin/env bash
# Bramka wdrożenia i wydania (audyt 2, M-155; decyzja właściciela 8.10.2026, PWD-40 A): wymaga zielonego przebiegu
# podanych workflow dla TEGO SAMEGO commitu na gałęzi main (push, ręczne uruchomienie albo harmonogram; przebieg PR
# testuje commit scalenia, więc się nie liczy). Gdy przebieg dla commitu jeszcze trwa, czeka (WAIT_MINUTES, domyślnie 30).
# Gdy go nie ma (np. db.yml nie ruszył, bo commit nie zmienił ścieżek z jego filtra) — uruchom ten workflow ręcznie
# na main (workflow_dispatch) i ponów wdrożenie albo wydanie po zielonym wyniku.
# Użycie: require-green-runs.sh <sha> <plik workflow>...   (GH_TOKEN z uprawnieniem actions: read, GITHUB_REPOSITORY)
set -euo pipefail
sha="${1:?sha commitu}"
shift
[ "$#" -gt 0 ] || { echo "Podaj co najmniej jeden plik workflow (np. db.yml)"; exit 2; }
repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY}"
deadline=$(($(date +%s) + ${WAIT_MINUTES:-30} * 60))
poll="${POLL_SECONDS:-30}"

for wf in "$@"; do
  while :; do
    runs="$(gh api -X GET "repos/$repo/actions/workflows/$wf/runs" -f head_sha="$sha" -f per_page=100 \
      --jq '[.workflow_runs[] | select(.head_branch == "main" and (.event == "push" or .event == "workflow_dispatch" or .event == "schedule"))]')"
    if jq -e 'any(.[]; .conclusion == "success")' <<<"$runs" >/dev/null; then
      echo "OK   $wf: zielony przebieg dla $sha: $(jq -r 'map(select(.conclusion == "success"))[0].html_url' <<<"$runs")"
      break
    fi
    if jq -e 'any(.[]; .status != "completed")' <<<"$runs" >/dev/null && [ "$(date +%s)" -lt "$deadline" ]; then
      echo "...  $wf: przebieg dla $sha jeszcze trwa, sprawdzę za ${poll} s"
      sleep "$poll"
      continue
    fi
    echo "::error::$wf: brak zielonego przebiegu dla $sha na main. Uruchom $wf ręcznie na main i ponów po zielonym wyniku."
    jq -r '.[] | "  " + .event + ": " + .status + " / " + (.conclusion // "-") + " " + .html_url' <<<"$runs"
    exit 1
  done
done
