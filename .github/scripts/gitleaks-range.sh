#!/usr/bin/env bash
# Skan sekretów we wszystkich commitach, które wnosi push albo PR (audyt 2). gitleaks-action skanuje przy push tylko
# `--no-merges --first-parent <pierwszy>^..<ostatni>` z listy commitów zdarzenia (src/gitleaks.js w przypiętej wersji
# akcji), więc commity scalonej gałęzi (poza pierwszym rodzicem) i same scalenia nie były skanowane. Tu: cały zakres
# `<przed>..<po>` z historii git, ze scaleniami i wszystkimi rodzicami.
# Nowa gałąź (przed = same zera) albo przed spoza historii (wymuszony push): cała historia osiągalna z <po>.
# Użycie: .github/scripts/gitleaks-range.sh <sha przed> <sha po>   (gitleaks w PATH albo GITLEAKS=…; repozytorium
# z pełną historią — actions/checkout z fetch-depth: 0)
set -euo pipefail
before="${1:?sha przed}"
after="${2:?sha po}"
gitleaks="${GITLEAKS:-gitleaks}"
root="$(git rev-parse --show-toplevel)"

git cat-file -e "$after^{commit}" 2>/dev/null || { echo "Brak commitu $after w historii" >&2; exit 2; }
if [[ "$before" =~ ^0+$ ]] || ! git cat-file -e "$before^{commit}" 2>/dev/null; then
  range="$after"
  echo "Skan sekretów: cała historia do ${after:0:12} (nowa gałąź albo poprzedni stan spoza historii)"
else
  range="$before..$after"
  echo "Skan sekretów: $(git rev-list --count "$range") commitów w zakresie ${before:0:12}..${after:0:12}"
fi
"$gitleaks" git "$root" --config "$root/.gitleaks.toml" --no-banner --redact --log-level warn --log-opts="$range"
