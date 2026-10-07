#!/usr/bin/env python3
"""Korpus kontrastu WCAG 2.2 z NIEZALEŻNEJ implementacji (Python, colorsys nie liczy luminancji WCAG,
więc wzór jest przepisany wprost ze specyfikacji: https://www.w3.org/TR/WCAG22/#dfn-relative-luminance).
Uruchomienie: python3 -I scripts/gen-contrast-corpus.py > src/domain/__tests__/fixtures/contrast.json
"""
import json
import random
from fractions import Fraction


def lin(v8):
    # Rachunek na ułamkach, potem potęga w float — inny tor obliczeń niż w TypeScript.
    s = Fraction(v8, 255)
    if s <= Fraction(4045, 100000):
        return float(s / Fraction(1292, 100))
    return ((float(s) + 0.055) / 1.055) ** 2.4


def lum(h):
    r, g, b = (lin(int(h[i:i + 2], 16)) for i in (1, 3, 5))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ratio(a, b):
    hi, lo = max(lum(a), lum(b)), min(lum(a), lum(b))
    return (hi + 0.05) / (lo + 0.05)


rnd = random.Random(20261007)
colors = ['#000000', '#FFFFFF', '#0A0A0A', '#0B0B0B', '#777777', '#767676', '#808080']
colors += ['#%06X' % rnd.randrange(0x1000000) for _ in range(200)]
pairs = [(a, b) for a, b in zip(colors, colors[1:] + colors[:1])]
print(json.dumps([{'a': a, 'b': b, 'ratio': round(ratio(a, b), 10)} for a, b in pairs], indent=0))
