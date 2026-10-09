#!/usr/bin/env bash
# Instalacja Supabase CLI w przypiętej wersji ze sprawdzeniem sumy SHA-256 (audyt 3, N-255) zamiast `npx --yes supabase@…`:
# paczka npm ma zależności z daszkiem (jose ^6.2.10, eciesjs ^0.5.0) bez lockfile, a jej nakładka dist/supabase.js
# czyta zmienną SUPABASE_CLI_BINARY_OVERRIDE (ścieżka innego pliku binarnego), którą każdy wcześniejszy kod mógł dopisać
# do GITHUB_ENV przed krokami z sekretami. Plik z wydania GitHuba nie ma zależności ani tej zmiennej.
# Suma z pliku https://github.com/supabase/cli/releases/download/v2.119.0/checksums.txt (wiersz
# supabase_linux_amd64.tar.gz), sprawdzona 9.10.2026 na pobranym pliku. W paczce: supabase i supabase-go (moduł Go,
# którego CLI szuka obok siebie).
# Użycie: .github/scripts/install-supabase-cli.sh [katalog]   (domyślnie ~/.supabase-cli; w GitHub Actions dopisuje go do PATH)
set -euo pipefail

SUPABASE_CLI_VERSION="2.119.0"
SUPABASE_CLI_SHA256="bf1c3ae93be98533eb8a3105dbf4564bd0b2d9dc24690d8a920f980ef975c1b4"
dest="${1:-$HOME/.supabase-cli}"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl --fail --location --silent --show-error \
  "https://github.com/supabase/cli/releases/download/v${SUPABASE_CLI_VERSION}/supabase_linux_amd64.tar.gz" -o "$tmp/supabase.tar.gz"
echo "${SUPABASE_CLI_SHA256}  $tmp/supabase.tar.gz" | sha256sum -c -
rm -rf "$dest"
mkdir -p "$dest"
tar -xzf "$tmp/supabase.tar.gz" -C "$dest" supabase supabase-go
test "$("$dest/supabase" --version)" = "$SUPABASE_CLI_VERSION" || { echo "Nieoczekiwana wersja Supabase CLI" >&2; exit 1; }
echo "Supabase CLI $SUPABASE_CLI_VERSION"
if [ -n "${GITHUB_PATH:-}" ]; then echo "$dest" >> "$GITHUB_PATH"; fi
