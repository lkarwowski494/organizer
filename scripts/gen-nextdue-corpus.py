#!/usr/bin/env python3
"""Korpus następnego terminu zadania powtarzanego (nextDue, src/domain/views/task-repeat.ts) z NIEZALEŻNEJ implementacji.
Według kalendarza: python-dateutil (dateutil.rrule, RFC 5545) — pierwszy dzień reguły z DTSTART = termin, licząc od dnia
po późniejszym z (termin, dzień wykonania). Od wykonania (D23): dzień wykonania + interwał (datetime.timedelta).
Zapis reguły (pole "rule") składa ten skrypt sam — test sprawdza też, że telefon zapisuje ją tak samo (formatRepeat).
Uruchomienie: python3 -I scripts/gen-nextdue-corpus.py > src/domain/__tests__/fixtures/nextdue.json
Wersja: python-dateutil 2.9.0.post0 (sprawdzone 8.10.2026); poza CI, jak korpusy RRULE i świąt (zależność spoza npm).
Audyt 2 (Q-21, M-190): dotąd 7 przypadków wpisanych ręcznie bez generatora.
"""
import json
import random
from datetime import date, datetime, timedelta

from dateutil.rrule import rrulestr

rnd = random.Random(20261008)
DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']


def calendar_next(rule, due, done):
    frm = max(due, done) + timedelta(days=1)
    r = rrulestr(rule, dtstart=datetime.combine(due, datetime.min.time()))
    return r.after(datetime.combine(frm, datetime.min.time()), inc=True).date()


def repeats():
    out = [({'kind': 'daily'}, 'FREQ=DAILY'), ({'kind': 'monthly'}, 'FREQ=MONTHLY')]
    for day in [1, 15, 28, 29, 30, 31]:
        out.append(({'kind': 'monthly', 'day': day}, f'FREQ=MONTHLY;BYMONTHDAY={day}'))
    for days in [[0], [6], [0, 3], [1, 3, 5], [0, 1, 2, 3, 4], [5, 6], list(range(7))]:
        out.append(({'kind': 'weekly', 'days': days}, 'FREQ=WEEKLY;BYDAY=' + ','.join(DAYS[d] for d in days)))
    for unit in ['DAILY', 'WEEKLY']:
        for interval in [1, 2, 3, 7, 10, 14, 99]:
            out.append(({'kind': 'after', 'unit': unit, 'interval': interval}, f'AFTER={unit};INTERVAL={interval}'))
    return out


def dues():
    fixed = [date(2026, 1, 31), date(2027, 1, 29), date(2027, 1, 30), date(2027, 1, 31), date(2028, 1, 29), date(2028, 1, 31),
             date(2028, 2, 28), date(2028, 2, 29), date(2026, 12, 31), date(2026, 10, 5), date(2026, 10, 7), date(2026, 10, 11)]
    return fixed + [date(2026, 1, 1) + timedelta(days=rnd.randint(0, 900)) for _ in range(4)]


def main():
    cases = []
    for rep, rule in repeats():
        for due in dues():
            # Wykonanie przed terminem, w dniu terminu, dzień po, z zaległością.
            for delta in [-3, 0, 1, 10, 40]:
                done = due + timedelta(days=delta)
                if rep['kind'] == 'after':
                    step = rep['interval'] * (7 if rep['unit'] == 'WEEKLY' else 1)
                    nxt = done + timedelta(days=step)
                else:
                    nxt = calendar_next(rule, due, done)
                cases.append({'repeat': rep, 'rule': rule, 'due': due.isoformat(), 'done': done.isoformat(), 'next': nxt.isoformat()})
    # Jeden przypadek w wierszu — czytelna różnica po zmianie generatora.
    print('[\n' + ',\n'.join(json.dumps(c, ensure_ascii=False) for c in cases) + '\n]')


main()
