#!/usr/bin/env python3
"""Korpus animacji przy starcie „Splątane i się rozplatają” (ADR-0045) z NIEZALEŻNEJ implementacji (Python).

Czyta liczby wprost z src/config/brand-icon.ts (ścieżki, kolory), src/config/intro.ts (czasy, układ startowy) i
src/config/theme.ts (tła motywów), a liczy innymi metodami niż TypeScript (src/domain/bezier.ts, src/domain/intro.ts):
  - długość łuku: łamana wpisana w krzywą Béziera (punkty z wzoru Bernsteina) z ekstrapolacją Richardsona
    L ≈ (4·L(2N) − L(N)) / 3 (błąd łamanej ~ h², https://en.wikipedia.org/wiki/Richardson_extrapolation) — w TS kwadratura
    Gaussa–Legendre'a;
  - punkt w odległości s wzdłuż łuku: interpolacja na gęstej łamanej — w TS bisekcja po parametrze;
  - wygaszenie: wzór Easing.inOut(Easing.cubic) z React Native (t < 0,5 ? cubic(2t)/2 : 1 − cubic((1−t)·2)/2,
    https://github.com/facebook/react-native/blob/main/packages/react-native/Libraries/Animated/Easing.js);
  - położenie: macierze 3×3 listy przekształceń SVG translate(c+dx c+dy) rotate(θ) scale(s) translate(−c −c)
    (https://www.w3.org/TR/SVG11/coords.html#TransformAttribute) — w TS wzór zamknięty;
  - kontrast wstążek do teł motywów: WCAG 2.1 (https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio), rachunek jak w
    gen-contrast-corpus.py.

Uruchomienie: python3 -I scripts/gen-intro-corpus.py > src/domain/__tests__/fixtures/intro.json
"""
import json
import math
import pathlib
import re
from fractions import Fraction

ROOT = pathlib.Path(__file__).resolve().parent.parent
icon_src = (ROOT / 'src/config/brand-icon.ts').read_text(encoding='utf-8')
intro_src = (ROOT / 'src/config/intro.ts').read_text(encoding='utf-8')
theme_src = (ROOT / 'src/config/theme.ts').read_text(encoding='utf-8')

VIEWBOX = int(re.search(r'VIEWBOX: (\d+),', icon_src).group(1))
STROKE = int(re.search(r'STROKE_WIDTH: (\d+),', icon_src).group(1))
RIB = re.compile(r"key: '(\w+)',\s*color: '(#[0-9A-Fa-f]{6})',\s*path: \{\s*start: \[(-?[\d.]+), (-?[\d.]+)\],\s*curves: \[(.*?)\]\s*,?\s*\}", re.S)
ribbons = []
for key, color, sx, sy, curves in RIB.findall(icon_src):
    nums = [float(v) for v in re.findall(r'-?[\d.]+', curves)]
    assert len(nums) % 6 == 0, key
    segs = [tuple((nums[i + 2 * j], nums[i + 2 * j + 1]) for j in range(3)) for i in range(0, len(nums), 6)]
    ribbons.append({'key': key, 'color': color.upper(), 'start': (float(sx), float(sy)), 'curves': segs})
assert [r['key'] for r in ribbons] == ['blue', 'orange', 'terracotta'], [r['key'] for r in ribbons]

num = lambda name: int(re.search(rf'{name}: ([\d_]+),', intro_src).group(1).replace('_', ''))
TOTAL, FADE, RIBBON, STAGGER = num('TOTAL_MS'), num('FADE_MS'), num('RIBBON_MS'), num('STAGGER_MS')
TG = re.compile(r'\{ from: (-?[\d.]+), length: (-?[\d.]+), dx: (-?[\d.]+), dy: (-?[\d.]+), rotate: (-?[\d.]+), scale: (-?[\d.]+) \}')
tangles = [dict(zip(('from', 'length', 'dx', 'dy', 'rotate', 'scale'), map(float, m))) for m in TG.findall(intro_src)]
assert len(tangles) == len(ribbons), 'intro.tangles: jeden układ na wstążkę'

grounds = re.findall(r"ground: '(#[0-9A-Fa-f]{6})'", theme_src[theme_src.index('export const palettes'):])[:2]


def bez(c, u):
    v = 1 - u
    return tuple(v ** 3 * c[0][i] + 3 * v * v * u * c[1][i] + 3 * v * u * u * c[2][i] + u ** 3 * c[3][i] for i in (0, 1))


def cubic_list(r):
    out, f = [], r['start']
    for c1, c2, e in r['curves']:
        out.append((f, c1, c2, e))
        f = e
    return out


def polyline_length(c, n):
    pts = [bez(c, i / n) for i in range(n + 1)]
    return math.fsum(math.dist(a, b) for a, b in zip(pts, pts[1:]))


def arc_length(c, n=1 << 12):
    return (4 * polyline_length(c, 2 * n) - polyline_length(c, n)) / 3


def dense(r, n=1 << 15):
    """Gęsta łamana całej ścieżki z długościami narastającymi (do punktu w odległości s)."""
    pts = [r['start']]
    for c in cubic_list(r):
        pts += [bez(c, i / n) for i in range(1, n + 1)]
    cum = [0.0]
    for a, b in zip(pts, pts[1:]):
        cum.append(cum[-1] + math.dist(a, b))
    return pts, cum


def at_length(pts, cum, s, total):
    s = min(max(s, 0.0), cum[-1])
    s *= cum[-1] / total if total else 1  # ta sama względna pozycja na łamanej (łamana jest minimalnie krótsza od łuku)
    lo, hi = 0, len(cum) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if cum[mid] < s:
            lo = mid
        else:
            hi = mid
    seg = cum[hi] - cum[lo]
    k = 0 if seg == 0 else (s - cum[lo]) / seg
    a, b = pts[lo], pts[hi]
    return (a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k)


def cubic_ease(t):
    return t * t * t


def in_out_cubic(t):
    return cubic_ease(t * 2) / 2 if t < 0.5 else 1 - cubic_ease((1 - t) * 2) / 2


def mat_mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]


def svg_matrix(dx, dy, deg, s):
    c = VIEWBOX / 2
    th = math.radians(deg)
    tr1 = [[1, 0, c + dx], [0, 1, c + dy], [0, 0, 1]]
    rot = [[math.cos(th), -math.sin(th), 0], [math.sin(th), math.cos(th), 0], [0, 0, 1]]
    sc = [[s, 0, 0], [0, s, 0], [0, 0, 1]]
    tr2 = [[1, 0, -c], [0, 1, -c], [0, 0, 1]]
    return mat_mul(mat_mul(mat_mul(tr1, rot), sc), tr2)


def apply(m, p):
    return (m[0][0] * p[0] + m[0][1] * p[1] + m[0][2], m[1][0] * p[0] + m[1][1] * p[1] + m[1][2])


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


r10 = lambda v: round(v, 10)
lengths = [math.fsum(arc_length(c) for c in cubic_list(r)) for r in ribbons]
denses = [dense(r) for r in ribbons]
move = TOTAL - FADE
frames = []
for t in list(range(-50, TOTAL + 101, 25)):
    rows = []
    for i, (r, tg) in enumerate(zip(ribbons, tangles)):
        q = min(1.0, max(0.0, (t - i * STAGGER) / RIBBON))
        e = in_out_cubic(q)
        total = lengths[i]
        start = tg['from'] * total * (1 - e)
        visible = total * (tg['length'] + (1 - tg['length']) * e)
        m = svg_matrix(tg['dx'] * (1 - e), tg['dy'] * (1 - e), tg['rotate'] * (1 - e), 1 + (tg['scale'] - 1) * (1 - e))
        pts, cum = denses[i]
        ends = [apply(m, at_length(pts, cum, s, total)) for s in (start, start + visible / 2, start + visible)]
        rows.append({'q': r10(q), 'eased': r10(e), 'start': r10(start), 'visible': r10(visible), 'points': [[r10(x), r10(y)] for x, y in ends]})
    opacity = 1.0 if t <= move else max(0.0, 1 - (t - move) / FADE)
    frames.append({'t': t, 'opacity': r10(opacity), 'ribbons': rows})

print(json.dumps({
    'viewBox': VIEWBOX,
    'strokeWidth': STROKE,
    'lengths': [r10(v) for v in lengths],
    'contrast': {r['key']: {'light': r10(ratio(r['color'], grounds[0])), 'dark': r10(ratio(r['color'], grounds[1]))} for r in ribbons},
    'frames': frames,
}, indent=0, ensure_ascii=False))
