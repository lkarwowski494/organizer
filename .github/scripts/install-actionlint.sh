#!/usr/bin/env bash
# Instalacja actionlint w przypiętej wersji ze sprawdzeniem sumy SHA-256. Wcześniej `go install …@v1.7.12`: actionlint
# 1.7.12 wymaga Go ≥ 1.25, a Go z obrazu ubuntu-24.04 jest starsze, więc przy każdym przebiegu pobierał nowszy
# toolchain z proxy.golang.org (GOTOOLCHAIN=auto, wersja wybrana przez serwer, bez naszej sumy); 9.10.2026 proxy
# odpowiedziało 403 i zadanie workflows-lint padło. Teraz jeden plik z wydania, bez Go i bez sieci poza GitHubem.
# Suma z pliku https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_checksums.txt (wiersz
# actionlint_1.7.12_linux_amd64.tar.gz), sprawdzona 9.10.2026 na pobranym pliku.
# Użycie: .github/scripts/install-actionlint.sh [katalog]   (domyślnie ~/.actionlint; w GitHub Actions dopisuje go do PATH)
set -euo pipefail

ACTIONLINT_VERSION="1.7.12"
ACTIONLINT_SHA256="8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8"
dest="${1:-$HOME/.actionlint}"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl --fail --location --silent --show-error \
  "https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_linux_amd64.tar.gz" -o "$tmp/actionlint.tar.gz"
echo "${ACTIONLINT_SHA256}  $tmp/actionlint.tar.gz" | sha256sum -c -
mkdir -p "$dest"
tar -xzf "$tmp/actionlint.tar.gz" -C "$tmp" actionlint
install -m 0755 "$tmp/actionlint" "$dest/actionlint"
"$dest/actionlint" -version
if [ -n "${GITHUB_PATH:-}" ]; then echo "$dest" >> "$GITHUB_PATH"; fi
