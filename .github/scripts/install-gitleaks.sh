#!/usr/bin/env bash
# Instalacja gitleaks w przypiętej wersji ze sprawdzeniem sumy SHA-256 (audyt 3, N-258): gitleaks-action pobierał plik
# bez sprawdzenia sumy. Wersja ta sama, którą pobierała akcja (v3.0.0 → 8.24.3). Suma z pliku
# https://github.com/gitleaks/gitleaks/releases/download/v8.24.3/gitleaks_8.24.3_checksums.txt (wiersz
# gitleaks_8.24.3_linux_x64.tar.gz), sprawdzona 9.10.2026 na pobranym pliku.
# Użycie: .github/scripts/install-gitleaks.sh [katalog]   (domyślnie ~/.gitleaks; w GitHub Actions dopisuje go do PATH)
set -euo pipefail

GITLEAKS_VERSION="8.24.3"
GITLEAKS_SHA256="9991e0b2903da4c8f6122b5c3186448b927a5da4deef1fe45271c3793f4ee29c"
dest="${1:-$HOME/.gitleaks}"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl --fail --location --silent --show-error \
  "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" -o "$tmp/gitleaks.tar.gz"
echo "${GITLEAKS_SHA256}  $tmp/gitleaks.tar.gz" | sha256sum -c -
mkdir -p "$dest"
tar -xzf "$tmp/gitleaks.tar.gz" -C "$tmp" gitleaks
install -m 0755 "$tmp/gitleaks" "$dest/gitleaks"
"$dest/gitleaks" version
if [ -n "${GITHUB_PATH:-}" ]; then echo "$dest" >> "$GITHUB_PATH"; fi
