#!/usr/bin/env python3
"""Generuje korpus testowy parsera szybkiego dodawania (D18) z NIEZALEŻNĄ implementacją reguł.

Oczekiwane terminy liczy moduł datetime z biblioteki standardowej Pythona, a nie kod parsera,
więc zgodność obu jest testem różnicowym. Reguły D42–D45 i bezpiecznik dnia (audyt 2, M-23) opisane
w docs/adr/0003-quickadd-pl.md.
Uruchomienie: python3 -I scripts/gen-quickadd-corpus.py > src/domain/__tests__/fixtures/quickadd.pl.json
"""
import json
import sys
from datetime import date, datetime, timedelta

NOWS = [
    datetime(2026, 10, 6, 10, 0),   # wtorek przed południem
    datetime(2026, 10, 9, 20, 0),   # piątek wieczorem
    datetime(2026, 12, 31, 23, 30), # sylwester tuż przed północą
    datetime(2028, 2, 28, 8, 0),    # poniedziałek, rok przestępny
    datetime(2027, 3, 28, 1, 15),   # niedziela, noc zmiany czasu (bez znaczenia dla dat lokalnych)
]
TITLES = ["kupić mleko", "zadzwonić do mamy", "odebrać paczkę", "wizyta u dentysty"]
WEEKDAYS = [  # biernik po przyimku, 0 = poniedziałek
    ("w poniedziałek", 0), ("we wtorek", 1), ("w środę", 2), ("we czwartek", 3),
    ("w piątek", 4), ("w sobotę", 5), ("w niedzielę", 6), ("na środę", 2), ("w srode", 2),
]
MONTHS_GEN = ["stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca", "lipca", "sierpnia",
              "września", "października", "listopada", "grudnia"]
BYDAY = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]
# Bezpiecznik dnia (audyt 2, M-23): nazwa dnia w dowolnej formie albo „przyszły/następny”, gdy daty nie rozpoznano —
# godzina i „co tydzień” zostają w tytule, terminu nie ma. Formy przepisane osobno z haseł sjp.pl (poniedziałek …
# niedziela, przyszły, następny), nie z kodu parsera.
DAY_FORMS = [
    "poniedziałek poniedziałkiem poniedziałkowi poniedziałku poniedziałków poniedziałkach poniedziałkami poniedziałkom poniedziałki",
    "wtorek wtorkiem wtorkowi wtorku wtorków wtorkach wtorkami wtorkom wtorki",
    "środa środą środę środo środy środzie środach środami środom śród",
    "czwartek czwartkiem czwartkowi czwartku czwartków czwartkach czwartkami czwartkom czwartki",
    "piątek piątkiem piątkowi piątku piątków piątkach piątkami piątkom piątki",
    "sobota sobocie sobotą sobotę soboto soboty sobotach sobotami sobotom sobót",
    "niedziela niedziele niedzielą niedzielę niedzieli niedzielo niedzielach niedzielami niedzielom niedziel",
]
NEXT_FORMS = ("przyszły przyszłego przyszłemu przyszłych przyszłym przyszłymi przyszli przyszła przyszłą przyszłe przyszłej "
              "następny następnego następnemu następnych następnym następnymi następni następna następną następne następnej")
DAY_WORDS = set(" ".join(DAY_FORMS + [NEXT_FORMS]).split())


def iso(d):
    return d.isoformat()


def weekday_date(today, wd):
    diff = (wd - today.weekday()) % 7
    return today + timedelta(days=7 if diff == 0 else diff)  # D42


def no_year_date(today, d, m):
    for y in range(today.year, today.year + 9):  # D44
        try:
            cand = date(y, m, d)
        except ValueError:
            continue
        if cand >= today:
            return cand
    return None


def resolve_time(now, day, h, mi):
    """D43: godzina 1–11 bez dopowiedzenia = najbliższa przyszła; bez dnia: dziś albo jutro."""
    def fut(dd, hh):
        return datetime(dd.year, dd.month, dd.day, hh, mi) > now
    amb = 1 <= h <= 11
    if day is not None:
        if amb and not fut(day, h) and fut(day, h + 12):
            return day, h + 12
        return day, h
    today = now.date()
    opts = [(today, h)] + ([(today, h + 12)] if amb else []) + [(today + timedelta(days=1), h)]
    for o in opts:
        if fut(*o):
            return o
    return opts[-1]


def unrecognized(now, text):
    """Bezpiecznik: w tekście jest słowo dnia, a dnia nie rozpoznano — cały tekst zostaje tytułem, bez terminu."""
    assert DAY_WORDS & set(text.replace(",", " ").split()), text
    return case(now, text, text, None)


def case(now, text, title, day, hm=None, weekly=False):
    if hm is not None:
        day, h = resolve_time(now, day, *hm)
        due = {"date": iso(day), "time": f"{h:02d}:{hm[1]:02d}"}
    elif day is not None:
        due = {"date": iso(day), "time": None}  # D45
    elif weekly:
        day = now.date()
        due = {"date": iso(day), "time": None}
    else:
        due = None
    rrule = f"FREQ=WEEKLY;BYDAY={BYDAY[day.weekday()]}" if weekly and day else None
    return {"now": now.strftime("%Y-%m-%dT%H:%M"), "text": text,
            "expected": {"title": title, "due": due, "rrule": rrule}}


cases = []
for n, now in enumerate(NOWS):
    today = now.date()
    t = TITLES[n % len(TITLES)]
    t2 = TITLES[(n + 1) % len(TITLES)]
    rel = [("dziś", 0), ("dzisiaj", 0), ("jutro", 1), ("pojutrze", 2), ("na jutro", 1), ("dzis", 0)]
    for word, k in rel:
        cases.append(case(now, f"{t} {word}", t, today + timedelta(days=k)))
        cases.append(case(now, f"{word} {t2}", t2, today + timedelta(days=k)))
    for word, wd in WEEKDAYS:
        cases.append(case(now, f"{t} {word}", t, weekday_date(today, wd)))
    for word, wd in WEEKDAYS[:7]:
        cases.append(case(now, f"{t2} {word} o 18", t2, weekday_date(today, wd), (18, 0)))
    for (d, m) in [(1, 1), (15, 10), (6, 10), (29, 2), (31, 12), (3, 5)]:
        exp = no_year_date(today, d, m)
        cases.append(case(now, f"{t} {d} {MONTHS_GEN[m - 1]}", t, exp))
        cases.append(case(now, f"{t} {d}.{m:02d}", t, exp))
        cases.append(case(now, f"{t} na {d}.{m}", t, exp))
    for (d, m, y) in [(15, 10, 2027), (1, 1, 2026), (29, 2, 2028)]:
        cases.append(case(now, f"{t} {d}.{m:02d}.{y}", t, date(y, m, d)))
        cases.append(case(now, f"{t} {d} {MONTHS_GEN[m - 1]} {y}", t, date(y, m, d)))
    for (txt, hm) in [("o 7", (7, 0)), ("o 9:30", (9, 30)), ("o 11", (11, 0)), ("o 12", (12, 0)),
                      ("o 15", (15, 0)), ("o 17.45", (17, 45)), ("o godz. 8", (8, 0)), ("o godzinie 6", (6, 0)),
                      ("o 0", (0, 0)), ("o 23:59", (23, 59)), ("20:15", (20, 15)),
                      # Kropka bez „o” (Poradnia PWN: kropka to częstszy separator); minuty 00 i 13–59 nie są miesiącem.
                      ("22.00", (22, 0)), ("18.30", (18, 30)), ("7.45", (7, 45)), ("0.00", (0, 0))]:
        cases.append(case(now, f"{t} {txt}", t, None, hm))
        cases.append(case(now, f"{t} dziś {txt}", t, today, hm))
        cases.append(case(now, f"{t} jutro {txt}", t, today + timedelta(days=1), hm))
    cases.append(case(now, f"{t} co tydzień", t, None, weekly=True))
    cases.append(case(now, f"{t} w piątek co tydzień", t, weekday_date(today, 4), weekly=True))
    cases.append(case(now, f"{t} jutro o 17 co tydzień", t, today + timedelta(days=1), (17, 0), weekly=True))
    cases.append(case(now, f"{t} co tydzien o 8", t, None, (8, 0), weekly=True))
    # Bezpiecznik dnia (M-23): dzień nazwany, ale nierozpoznany — nie zgadujemy go z godziny ani ze startu serii.
    for txt in ["w przyszły wtorek o 15", "w następną sobotę o 9:30", "piątek o 18", "w przyszłym tygodniu o 8",
                "w środy co tydzień o 17", "co tydzień w następny poniedziałek", "niedziela 20:15", "czwartek"]:
        cases.append(unrecognized(now, f"{t} {txt}"))
    # Data rozpoznana — słowo dnia obok niej nic nie zmienia (pierwsza data wygrywa, reszta zostaje w tytule).
    cases.append(case(now, f"{t} jutro o 17 zamiast we wtorek", f"{t} zamiast we wtorek", today + timedelta(days=1), (17, 0)))
    cases.append(case(now, f"{t} w piątek o 18, nie w przyszły czwartek", f"{t}, nie w przyszły czwartek",
                      weekday_date(today, 4), (18, 0)))
    # Bez rozpoznawalnych fragmentów: tytuł bez zmian, brak terminu.
    for txt in [t, f"{t} do piątku", f"{t} 2 litry", f"{t} 31.04", f"{t} jutrzejsze", f"{t} 24.00", f"{t} 18.60"]:
        cases.append(case(now, txt, txt, None))

# Każda forma ze słownika raz (jedna chwila): z godziną i bez niej.
for form in sorted(DAY_WORDS):
    cases.append(unrecognized(NOWS[0], f"{TITLES[0]} {form} o 15"))
    cases.append(unrecognized(NOWS[0], f"{form} {TITLES[1]} o 7:30 co tydzień"))

json.dump(cases, sys.stdout, ensure_ascii=False, indent=1)
sys.stdout.write("\n")
print(f"{len(cases)} przypadków", file=sys.stderr)
