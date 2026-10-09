#!/usr/bin/env bash
# Uruchamia symulator iPhone'a do E2E i ustawia go powtarzalnie (zrzuty ekranu porównywane pikselami):
# stały pasek stanu (9:41, pełna bateria), jasny wygląd, bez autokorekty i podpowiedzi klawiatury (inputText wpisuje
# dokładnie podany tekst). Polecenia: `xcrun simctl help status_bar`, `xcrun simctl help ui`.
# Użycie: scripts/e2e/boot-simulator.sh [nazwa urządzenia]   (domyślnie E2E_DEVICE albo „iPhone 17e” — telefon wariantu bazowego, run-matrix.sh)
# Wypisuje UDID; w GitHub Actions zapisuje też udid i device do GITHUB_OUTPUT.
set -euo pipefail

want="${1:-${E2E_DEVICE:-iPhone 17e}}"
# Najnowszy dostępny runtime iOS z urządzeniem o tej nazwie (format `xcrun simctl list devices available -j`).
read -r udid name runtime < <(xcrun simctl list devices available -j | WANT="$want" node -e '
  const all = JSON.parse(require("fs").readFileSync(0, "utf8")).devices;
  const ios = Object.keys(all).filter((r) => r.includes("SimRuntime.iOS")).sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
  for (const r of ios) {
    const d = all[r].find((x) => x.name === process.env.WANT) ?? null;
    if (d) { console.log(d.udid, JSON.stringify(d.name), r.split(".").pop()); process.exit(0); }
  }
  console.error("Brak symulatora: " + process.env.WANT + ". Dostępne: " + ios.flatMap((r) => all[r].map((x) => x.name)).join(", "));
  process.exit(1);
')
echo "Symulator: $name ($runtime) $udid" >&2

xcrun simctl boot "$udid" 2>/dev/null || true # już uruchomiony — w porządku
xcrun simctl bootstatus "$udid" -b >/dev/null
xcrun simctl ui "$udid" appearance light
xcrun simctl status_bar "$udid" override --time "9:41" --dataNetwork wifi --wifiMode active --wifiBars 3 \
  --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100
for key in KeyboardAutocorrection KeyboardPrediction KeyboardAutocapitalization KeyboardCheckSpelling; do
  xcrun simctl spawn "$udid" defaults write com.apple.Preferences "$key" -bool false
done

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  { echo "udid=$udid"; echo "device=$name $runtime"; } >> "$GITHUB_OUTPUT"
fi
echo "$udid"
