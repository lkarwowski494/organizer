#!/usr/bin/env python3
"""Korpus rozwijania reguł powtarzania z NIEZALEŻNEJ implementacji: python-dateutil (dateutil.rrule, RFC 5545).
Pierwsze wystąpienie serii (DTSTART) to pierwszy dzień pasujący do reguły od losowej kotwicy — tak samo zapisuje je
telefon (alignStart), bo RFC liczy DTSTART zawsze jako pierwsze wystąpienie.
Uruchomienie: python3 -I scripts/gen-rrule-corpus.py > src/domain/__tests__/fixtures/rrule.json
Wersja: python-dateutil 2.9.0.post0 (sprawdzone 7.10.2026); poza CI, jak korpus świąt (zależność spoza npm).
"""
import json
import random
from datetime import date, datetime, timedelta

from dateutil.rrule import rrulestr

rnd = random.Random(20261008)
DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']


def rule():
    freq = rnd.choice(['DAILY', 'WEEKLY', 'WEEKLY', 'MONTHLY', 'MONTHLY', 'YEARLY'])
    parts = [f'FREQ={freq}']
    if rnd.random() < 0.4:
        parts.append(f'INTERVAL={rnd.randint(2, 4)}')
    if freq == 'WEEKLY' and rnd.random() < 0.8:
        parts.append('BYDAY=' + ','.join(sorted(rnd.sample(DAYS, rnd.randint(1, 3)), key=DAYS.index)))
    if freq == 'MONTHLY':
        c = rnd.random()
        if c < 0.35:
            parts.append(f'BYDAY={rnd.choice(["1", "2", "3", "4", "-1"])}{rnd.choice(DAYS)}')
        elif c < 0.6:
            parts.append(f'BYMONTHDAY={rnd.choice([1, 15, 28, 29, 30, 31, -1, -2])}')
    end = rnd.random()
    if end < 0.3:
        parts.append(f'COUNT={rnd.randint(1, 30)}')
    elif end < 0.6:
        u = date(2026, 1, 1) + timedelta(days=rnd.randint(0, 900))
        parts.append('UNTIL=' + u.strftime('%Y%m%d'))
    return ';'.join(parts)


cases = []
# Przypadki brzegowe wprost (rok przestępny, 31. dzień, ostatni piątek, przypadek właściciela: pon. i sob.).
fixed = [('FREQ=WEEKLY;BYDAY=MO,SA', date(2026, 10, 5)), ('FREQ=YEARLY', date(2028, 2, 29)),
         ('FREQ=MONTHLY', date(2026, 1, 31)), ('FREQ=MONTHLY;BYDAY=-1FR', date(2026, 10, 1)),
         ('FREQ=MONTHLY;BYMONTHDAY=-1', date(2026, 1, 1)), ('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH', date(2026, 10, 7)),
         ('FREQ=MONTHLY;BYDAY=MO', date(2026, 10, 1)), ('FREQ=MONTHLY;BYDAY=5FR', date(2026, 1, 1)), ('FREQ=MONTHLY;BYDAY=1MO,-1FR', date(2026, 3, 1))]
specs = fixed + [(rule(), date(2025, 6, 1) + timedelta(days=rnd.randint(0, 700))) for _ in range(400)]
# Ostatni dzień miesiąca (PWD-37, audyt 2): luty zwykły i przestępny, co 2 miesiące, z końcem — dopisane na końcu,
# żeby losowe przypadki wyżej zostały bez zmian.
specs += [('FREQ=MONTHLY;BYMONTHDAY=-1', date(2026, 10, 31)), ('FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=6', date(2027, 11, 30)),
          ('FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=-1', date(2027, 12, 31)), ('FREQ=MONTHLY;BYMONTHDAY=-1;UNTIL=20280331', date(2028, 1, 31))]
for text, anchor in specs:
    free = ';'.join(p for p in text.split(';') if not p.startswith(('COUNT', 'UNTIL')))
    first = rrulestr(free, dtstart=datetime.combine(anchor, datetime.min.time()))[0].date()
    frm = first + timedelta(days=rnd.randint(-40, 200))
    to = frm + timedelta(days=rnd.randint(0, 400))
    r = rrulestr(text.replace('UNTIL=', 'UNTIL=') , dtstart=datetime.combine(first, datetime.min.time()))
    got = [d.date().isoformat() for d in r.between(datetime.combine(frm, datetime.min.time()), datetime.combine(to, datetime.max.time()), inc=True)]
    cases.append({'rule': text, 'anchor': anchor.isoformat(), 'start': first.isoformat(), 'from': frm.isoformat(), 'to': to.isoformat(), 'expected': got})
print(json.dumps(cases, indent=0))
