#!/usr/bin/env python3
"""Korpus długości wydarzeń przez zmianę czasu (audyt 3, N-114) z NIEZALEŻNEJ implementacji: Python zoneinfo
(baza IANA systemu), a nie Intl z silnika JS. Europe/Warsaw w bazie IANA (https://data.iana.org/time-zones/tzdb/europe):
„Rule EU 1981 max - Mar lastSun 1:00u 1:00 S”, „Rule EU 1996 max - Oct lastSun 1:00u 0 -”.
Godzina, której nie ma (wiosną 2:xx), i podwójna (jesienią 2:xx) — fold=0, czyli przesunięcie sprzed zmiany: tak jak
RFC 5545 §3.3.5 (pierwsze wystąpienie; w luce — „the UTC offset before the gap”).
Wynik ≤ 0 (wydarzenie w luce wiosennej) — długość na zegarze (tak samo span.ts, exactMinutes).
Uruchomienie: python3 -I scripts/gen-dst-corpus.py > src/domain/__tests__/fixtures/dst-lengths.json
"""
import json
import random
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

TZ = ZoneInfo('Europe/Warsaw')
DAY = 24 * 60


def clock(start, end):
    m = end - start
    return m if m > 0 else m + DAY


def real(day, start_min, minutes):
    a = datetime.combine(day, time(start_min // 60, start_min % 60), TZ)
    end_abs = start_min + minutes
    b = datetime.combine(day + timedelta(days=end_abs // DAY), time((end_abs % DAY) // 60, end_abs % 60), TZ)
    diff = (b.astimezone(timezone.utc) - a.astimezone(timezone.utc)) // timedelta(minutes=1)
    return diff if diff > 0 else minutes


def hm(m):
    return f'{m // 60:02d}:{m % 60:02d}'


def last_sunday(y, month):
    d = date(y, month + 1, 1) - timedelta(days=1)
    return d - timedelta(days=(d.weekday() + 1) % 7)


rnd = random.Random(20261009)
days = []
for y in (2026, 2027, 2030):
    for month in (3, 10):
        s = last_sunday(y, month)
        days += [s - timedelta(days=2), s - timedelta(days=1), s, s + timedelta(days=1)]
days.append(date(2026, 7, 15))

cases = []
# Stałe przypadki z audytu: dyżur 22:00–06:00, wyjazd pt. 18:00 – nd. 16:00, zajęcia w luce i w godzinie podwójnej.
fixed = [(22 * 60, 6 * 60, None), (18 * 60, 16 * 60, 46 * 60), (2 * 60, 3 * 60, None), (2 * 60 + 30, 3 * 60 + 30, None),
         (1 * 60 + 30, 2 * 60 + 30, None), (0, 0, None), (20 * 60, 0, None), (1 * 60, 4 * 60, None)]
for day in days:
    for (st, en, dur) in fixed:
        cases.append((day, st, en, dur))
    for _ in range(12):
        st = rnd.randrange(0, DAY, 15)
        dur = rnd.choice([None, None, rnd.randrange(DAY + 15, 4 * DAY, 15)])
        en = rnd.randrange(0, DAY, 15) if dur is None else (st + dur) % DAY
        cases.append((day, st, en, dur))

out = []
for (day, st, en, dur) in cases:
    minutes = dur if dur is not None else clock(st, en)
    out.append({'date': day.isoformat(), 'start': hm(st), 'end': hm(en), 'duration': dur, 'minutes': real(day, st, minutes)})
print(json.dumps(out, ensure_ascii=False, indent=1))
