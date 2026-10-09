#!/usr/bin/env bash
# Test reguł .gitleaks.toml (audyt 2, M-195): każda reguła projektu wykrywa swój rodzaj sekretu, domyślne reguły
# gitleaks są włączone (`useDefault`), a napis tylko podobny do tokenu Supabase nie jest zgłaszany.
# Fałszywe sekrety powstają dopiero w czasie testu (losowe bajty, katalog tymczasowy poza repozytorium); w tym pliku
# nie ma żadnego napisu w formacie sekretu, więc skan gitleaks (także całej historii w nightly.yml) nic tu nie znajduje.
# Użycie: .github/scripts/test-gitleaks-rules.sh   (gitleaks w PATH albo GITLEAKS=<ścieżka>; potrzebny jq).
# W ci.yml uruchamiany po .github/scripts/install-gitleaks.sh (ta sama wersja z sumą SHA-256, którą skanuje repozytorium).
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
gitleaks="${GITLEAKS:-gitleaks}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/hit" "$work/miss"

hex() { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; } # 2·n znaków 0-9a-f
alnum() { head -c 256 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "$1"; }
b64url() { base64 | tr -d '=\n' | tr '+/' '-_'; }
pem() { printf -- '-----%s PRIVATE KEY-----\n' "$1"; } # znacznik PEM składany w czasie testu

# Token dostępu Supabase: sam, w wierszu poleceń, w kodzie i w wariantach oauth/v0 (format: komentarz reguły).
sbp='sbp_'
printf '%s\n' "${sbp}$(hex 20)" >"$work/hit/sbp-bare.txt"
printf '%s\n' "${sbp}oauth_$(hex 20)" >"$work/hit/sbp-oauth.txt"
printf '%s\n' "${sbp}v0_$(hex 20)" >"$work/hit/sbp-v0.txt"
printf 'npx supabase login --token %s\n' "${sbp}$(hex 20)" >"$work/hit/sbp-cli.sh"
printf "const t = '%s';\n" "${sbp}$(hex 20)" >"$work/hit/sbp-code.ts"
# Pozostałe reguły projektu.
printf 'SECRET=%s\n' "sb_secret_$(alnum 32)" >"$work/hit/sb-secret.env"
{ pem BEGIN; head -c 96 /dev/urandom | base64 -w 64; pem END; } >"$work/hit/apns.p8"
jwt_head="$(printf '{"alg":"HS256","typ":"JWT"}' | b64url)"
# Klucz service_role: „service_role” w każdym z trzech przesunięć base64 (bajt 9, 10, 11 treści); ostatni w układzie
# pól prawdziwego klucza Supabase (bajt 56). Domyślna reguła jwt też by je złapała — tu sprawdzamy regułę projektu.
jwt() { # jwt <treść JSON> <plik>
  printf 'key: %s.%s.%s\n' "$jwt_head" "$(printf '%s' "$1" | b64url)" "$(head -c 32 /dev/urandom | b64url)" >"$work/hit/$2"
}
jwt '{"role":"service_role","iss":"supabase"}' service-role-0.yml
jwt '{"role": "service_role","iss":"supabase"}' service-role-1.yml
jwt '{"role":  "service_role","iss":"supabase"}' service-role-2.yml
jwt "{\"iss\":\"supabase\",\"ref\":\"$(alnum 20 | tr 'A-Z0-9' 'a-za-j')\",\"role\":\"service_role\",\"iat\":1759700000,\"exp\":2075276000}" service-role-real.yml
# Prywatny adres e-mail (reguła personal-email); adres składany w czasie testu, żeby ten plik go nie zawierał.
at='@'
printf "expect(emailName('%s')).toBe('x');\n" "jan.$(alnum 6)${at}gmail.com" >"$work/hit/email-gmail.test.ts"
printf 'Kontakt: %s\n' "ola$(alnum 4)${at}wp.pl" >"$work/hit/email-wp.md"
# Reguła domyślna (dowód, że useDefault działa): token GitHub.
printf '%s\n' "ghp_$(alnum 36)" >"$work/hit/github.txt"

# Podobne, ale nie w formacie tokenu Supabase: o jeden znak za krótki, wielkie litery, zwykłe słowo.
printf '%s\n' "${sbp}$(hex 20 | cut -c1-39)" >"$work/miss/sbp-short.txt"
printf '%s\n' "${sbp}$(hex 20 | tr 'a-f' 'A-F')" >"$work/miss/sbp-upper.txt"
printf 'zmienna %sprzyklad w tekście\n' "$sbp" >"$work/miss/sbp-word.txt"
# Adresy dozwolone: noreply GitHuba i domena przykładowa (RFC 2606).
printf '%s\n' "336954459+lkarwowski494${at}users.noreply.github.com" "jan.kowalski85${at}example.com" >"$work/miss/email-ok.txt"

scan() { # scan <katalog> <raport>
  "$gitleaks" dir "$1" --config "$root/.gitleaks.toml" --no-banner --redact --exit-code 0 \
    --report-format json --report-path "$2" --log-level error
}
scan "$work/hit" "$work/hit.json"
scan "$work/miss" "$work/miss.json"

status=0
expect() { # expect <reguła> <plik>: gitleaks zgłasza tę regułę w tym pliku
  if jq -e --arg r "$1" --arg f "/$2" 'any(.[]; .RuleID == $r and (.File | endswith($f)))' "$work/hit.json" >/dev/null; then
    echo "OK   $1: $2"
  else
    echo "BŁĄD $1 nie wykrywa $2"
    status=1
  fi
}
expect supabase-access-token sbp-bare.txt
expect supabase-access-token sbp-oauth.txt
expect supabase-access-token sbp-v0.txt
expect supabase-access-token sbp-cli.sh
expect supabase-access-token sbp-code.ts
expect supabase-secret-key sb-secret.env
expect apple-p8-private-key apns.p8
for f in service-role-0.yml service-role-1.yml service-role-2.yml service-role-real.yml; do expect supabase-service-role-jwt "$f"; done
expect personal-email email-gmail.test.ts
expect personal-email email-wp.md
expect github-pat github.txt

if jq -e 'length == 0' "$work/miss.json" >/dev/null; then
  echo "OK   napisy spoza formatu tokenu nie są zgłaszane"
else
  echo "BŁĄD zgłoszone napisy spoza formatu:"
  jq -r '.[] | "  " + .RuleID + ": " + (.File | split("/") | last)' "$work/miss.json"
  status=1
fi
exit "$status"
