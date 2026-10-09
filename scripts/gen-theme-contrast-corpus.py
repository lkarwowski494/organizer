#!/usr/bin/env python3
"""Korpus kontrastu par kolorów motywu (audyt 3, N-68, N-200) z NIEZALEŻNEJ implementacji (Python, rachunek na
ułamkach jak w gen-contrast-corpus.py). Czyta kolory wprost z src/config/theme.ts (palettes, highContrast, groupLines),
więc test motywu porównuje progi z wartościami policzonymi poza TypeScriptem — dla każdego motywu: jasny, ciemny,
jasny i ciemny z „Zwiększ kontrast”.

WCAG 2.1, „contrast ratio” (https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio): „(L1 + 0.05) / (L2 + 0.05), where L1 is
the relative luminance of the lighter of the colors, and L2 is the relative luminance of the darker of the colors”;
luminancja względna (https://www.w3.org/TR/WCAG21/#dfn-relative-luminance).

Uruchomienie: python3 -I scripts/gen-theme-contrast-corpus.py > src/config/__tests__/fixtures/theme-contrast.json
"""
import json
import pathlib
import re
from fractions import Fraction

SRC = pathlib.Path(__file__).resolve().parent.parent / 'src' / 'config' / 'theme.ts'
HEX = re.compile(r"(\w+): '(#[0-9A-Fa-f]{6})'")


def lin(v8):
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


def block(text, start):
    """Treść od `start` do domykającego nawiasu klamrowego (bez zagnieżdżeń w paletach)."""
    i = text.index('{', start)
    return text[i + 1:text.index('}', i)]


def section(text, name):
    i = text.index(f'export const {name}')
    return text[i:]


src = SRC.read_text(encoding='utf-8')
pal_src = section(src, 'palettes')
hc_src = section(src, 'highContrast')
palettes = {s: dict(HEX.findall(block(pal_src, pal_src.index(f'{s}: {{')))) for s in ('light', 'dark')}
high = {s: dict(HEX.findall(block(hc_src, hc_src.index(f'{s}: {{')))) for s in ('light', 'dark')}
gl_src = section(src, 'groupLines')
gl_src = gl_src[:gl_src.index('] as const')]
lines = {s: re.findall(rf"{s}: {{ line: '(#[0-9A-Fa-f]{{6}})', ink: '(#[0-9A-Fa-f]{{6}})' }}", gl_src) for s in ('light', 'dark')}
assert all(len(v) == 8 for v in lines.values()), 'groupLines: oczekiwano 8 linii w każdym trybie'
# Każda paleta ma wszystkie klucze typu Palette — inaczej regex coś zgubił (zmienił się zapis theme.ts).
type_src = src[src.index('export type Palette'):]
palette_keys = set(re.findall(r'^\s+(\w+): string;', block(type_src, 0), re.M))
assert palette_keys and all(set(v) == palette_keys for v in palettes.values()), 'palettes: klucze różne od typu Palette'
assert all(set(v) <= palette_keys for v in high.values()), 'highContrast: klucz spoza typu Palette'


def key(a, b):
    a, b = sorted((a.upper(), b.upper()))
    return f'{a} {b}'


out = {}
for scheme in ('light', 'dark'):
    for increased in (False, True):
        p = {**palettes[scheme], **(high[scheme] if increased else {})}
        colors = sorted({v.upper() for v in p.values()})
        pairs = {key(a, b): round(ratio(a, b), 10) for i, a in enumerate(colors) for b in colors[i + 1:]}
        for line, ink in lines[scheme]:
            for bg in (p['ground'], p['surface']):
                for fg in (line, ink):
                    pairs[key(fg, bg)] = round(ratio(fg, bg), 10)
        out[f'{scheme}{"+hc" if increased else ""}'] = dict(sorted(pairs.items()))
print(json.dumps(out, indent=0, ensure_ascii=False))
