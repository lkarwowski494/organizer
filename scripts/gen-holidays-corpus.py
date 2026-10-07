#!/usr/bin/env python3
"""Korpus dni wolnych od pracy w Polsce z NIEZALEŻNYCH implementacji: biblioteka „holidays” (daty świąt)
i dateutil.easter (Wielkanoc). Test różnicowy dla src/domain/holidays.ts. Nazwy porównujemy z ustawą
w kodzie, więc tu tylko daty.
Uruchomienie: python3 scripts/gen-holidays-corpus.py > src/domain/__tests__/fixtures/holidays.pl.json
Wersje: holidays 0.106, python-dateutil 2.9.0 (sprawdzone 7.10.2026)."""
import json, sys
import holidays
from dateutil.easter import easter, EASTER_WESTERN

out = {"easter": {}, "holidays": {}}
for y in range(2011, 2201):
    out["easter"][str(y)] = easter(y, EASTER_WESTERN).isoformat()
for y in range(2011, 2101):
    out["holidays"][str(y)] = sorted(d.isoformat() for d in holidays.Poland(years=y))
json.dump(out, sys.stdout, indent=0, sort_keys=True)
sys.stdout.write("\n")
