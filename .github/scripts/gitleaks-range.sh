#!/usr/bin/env bash
# Skan sekretów we wszystkich commitach, które wnosi push albo PR (audyt 2), i nocą w całej historii (audyt 3, N-84).
# gitleaks-action skanuje przy push tylko `--no-merges --first-parent <pierwszy>^..<ostatni>` z listy commitów zdarzenia
# (src/gitleaks.js w wersji v3.0.0), więc commity scalonej gałęzi (poza pierwszym rodzicem) i same scalenia nie były
# skanowane. Tu: cały zakres `<przed>..<po>` z historii git, ze wszystkimi rodzicami, a `-m` dokłada diff każdego
# scalenia względem każdego rodzica — bez niego `git log -p` nie pokazuje zmian wniesionych w samym scaleniu
# (rozwiązanie konfliktu), więc sekret dopisany przy scalaniu przechodził (git-log(1): „-m … show the full diff with
# respect to each of the parents”, https://git-scm.com/docs/git-log#Documentation/git-log.txt--m).
# Nowa gałąź (przed = same zera) albo przed spoza historii (wymuszony push): cała historia osiągalna z <po>.
# Użycie: .github/scripts/gitleaks-range.sh <sha przed> <sha po>
#         .github/scripts/gitleaks-range.sh --all          (wszystkie gałęzie i tagi — nocny skan w nightly.yml)
# gitleaks w PATH (.github/scripts/install-gitleaks.sh) albo GITLEAKS=…; repozytorium z pełną historią
# (actions/checkout z fetch-depth: 0).
set -euo pipefail
gitleaks="${GITLEAKS:-gitleaks}"
root="$(git rev-parse --show-toplevel)"

if [ "${1:-}" = "--all" ]; then
  range="--all"
  echo "Skan sekretów: cała historia ($(git rev-list --all --count) commitów, w tym $(git rev-list --all --merges --count) scaleń)"
else
  before="${1:?sha przed (albo --all)}"
  after="${2:?sha po}"
  git cat-file -e "$after^{commit}" 2>/dev/null || { echo "Brak commitu $after w historii" >&2; exit 2; }
  if [[ "$before" =~ ^0+$ ]] || ! git cat-file -e "$before^{commit}" 2>/dev/null; then
    range="$after"
    echo "Skan sekretów: cała historia do ${after:0:12} (nowa gałąź albo poprzedni stan spoza historii)"
  else
    range="$before..$after"
    echo "Skan sekretów: $(git rev-list --count "$range") commitów w zakresie ${before:0:12}..${after:0:12}"
  fi
fi
"$gitleaks" git "$root" --config "$root/.gitleaks.toml" --no-banner --redact --log-level warn --log-opts="-m $range"
