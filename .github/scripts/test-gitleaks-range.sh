#!/usr/bin/env bash
# Test .github/scripts/gitleaks-range.sh na repozytorium tymczasowym: sekret w commicie scalonej gałęzi (poza pierwszym
# rodzicem) jest wykryty w zakresie pusha, choć skan w stylu gitleaks-action (`--no-merges --first-parent`) go pomija;
# czysty zakres przechodzi; nowa gałąź (sha przed = zera) skanuje całą historię. Fałszywy sekret powstaje w czasie
# testu (losowe bajty), więc w tym pliku nie ma napisu w formacie sekretu.
# Użycie: .github/scripts/test-gitleaks-range.sh   (gitleaks w PATH albo GITLEAKS=…)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
gitleaks="${GITLEAKS:-gitleaks}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$work"
git init -q -b main .
git config user.name test && git config user.email test@example.invalid
cp "$here/../../.gitleaks.toml" .gitleaks.toml
alnum() { head -c 256 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "$1"; }

echo a >a.txt && git add . && git commit -qm start
clean="$(git rev-parse HEAD)"
echo b >b.txt && git add b.txt && git commit -qm czysty
clean2="$(git rev-parse HEAD)"
git switch -qc feature
printf 'SECRET=%s\n' "sb_secret_$(alnum 32)" >leak.env && git add leak.env && git commit -qm sekret
git switch -q main
echo c >c.txt && git add c.txt && git commit -qm obok
git merge -q --no-ff feature -m scalenie
git rm -q leak.env && git commit -qm usuniety
merged="$(git rev-parse HEAD)"

status=0
check() { # check <opis> <oczekiwany kod> <polecenie…>
  local want="$1" desc="$2"; shift 2
  local got=0
  "$@" >"$work/out.txt" 2>&1 || got=$?
  if [ "$got" = "$want" ]; then echo "ok: $desc"; else echo "BŁĄD: $desc (kod $got, oczekiwany $want)"; cat "$work/out.txt"; status=1; fi
}
check 1 "sekret ze scalonej gałęzi wykryty w zakresie pusha" env GITLEAKS="$gitleaks" "$here/gitleaks-range.sh" "$clean2" "$merged"
check 0 "skan jak w gitleaks-action (pierwszy rodzic, bez scaleń) go pomija — powód tego skryptu" \
  "$gitleaks" git . --config .gitleaks.toml --no-banner --log-level error --log-opts="--no-merges --first-parent $clean2..$merged"
check 0 "czysty zakres przechodzi" env GITLEAKS="$gitleaks" "$here/gitleaks-range.sh" "$clean" "$clean2"
check 1 "nowa gałąź (zera): cała historia" env GITLEAKS="$gitleaks" "$here/gitleaks-range.sh" 0000000000000000000000000000000000000000 "$merged"
check 1 "poprzedni stan spoza historii (wymuszony push): cała historia" env GITLEAKS="$gitleaks" "$here/gitleaks-range.sh" "$(printf '%040d' 1)" "$merged"
check 2 "brak commitu po" env GITLEAKS="$gitleaks" "$here/gitleaks-range.sh" "$clean" "$(printf '%040d' 2)"
exit "$status"
