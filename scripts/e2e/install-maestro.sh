#!/usr/bin/env bash
# Instalacja Maestro CLI w przypiętej wersji ze sprawdzeniem sumy SHA-256 (zamiast `curl … | bash` z najnowszą wersją).
# Paczka z wydań GitHuba: https://github.com/mobile-dev-inc/maestro/releases/tag/cli-2.11.0 (suma policzona 8.10.2026
# z pobranego maestro.zip). Wymaga Javy 17+ (Maestro to aplikacja JVM).
# Użycie: scripts/e2e/install-maestro.sh [katalog]   (domyślnie ~/.maestro-cli; w GitHub Actions dopisuje bin do PATH)
set -euo pipefail

MAESTRO_VERSION="2.11.0"
MAESTRO_SHA256="5384593cb4e7a106489e75a821d157dd43f4e438df6bc308b72e82c685e1283a"
dest="${1:-$HOME/.maestro-cli}"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl --fail --location --silent --show-error \
  "https://github.com/mobile-dev-inc/maestro/releases/download/cli-${MAESTRO_VERSION}/maestro.zip" -o "$tmp/maestro.zip"
echo "${MAESTRO_SHA256}  $tmp/maestro.zip" | shasum -a 256 -c -
rm -rf "$dest"
mkdir -p "$dest"
unzip -q "$tmp/maestro.zip" -d "$dest"
"$dest/maestro/bin/maestro" --version
if [ -n "${GITHUB_PATH:-}" ]; then echo "$dest/maestro/bin" >> "$GITHUB_PATH"; fi
