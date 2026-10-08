# ADR 0005 — Motyw „Linie” (7.10.2026)

Status: przyjęte (D50, decyzja właściciela). Kod: `src/config/theme.ts`, kontrast: `src/domain/contrast.ts`.
Makiety: https://claude.ai/artifact/UXcjuXUntnGC5FfUFDtXre (A · Linie).

| ID | Pytanie | Decyzja | Odrzucone |
|---|---|---|---|
| D50 | Kierunek wyglądu i motyw marki | A · Linie: każda grupa to kolorowa linia z kropkami-stacjami, „Dotyczy mnie” to przesiadka; jasne chłodne tło, Schibsted Grotesk + Atkinson Hyperlegible Next → motyw i kroje zastąpione przez D72 i D74 (ADR 0014: „Wstążki”, Bricolage Grotesque); „Dotyczy mnie” to dziś „Moje sprawy” (D89). | B · Lodówka (magnesy i kartki na ciepłym papierze) |

## Progi i poprawki po pomiarze (moje, według źródeł)
Progi: WCAG 2.2 SC 1.4.3 (tekst ≥ 4,5:1), SC 1.4.11 (elementy sterujące i grafika ≥ 3:1), Apple HIG
(cel dotyku 44 × 44 pt, tekst podstawowy 17 pt). Wzór kontrastu z definicji WCAG 2.2, sprawdzony
niezależną implementacją w Pythonie (`scripts/gen-contrast-corpus.py`).

Pomiar makiety wykazał i poprawił:
- obwódka pola do odhaczania #94A3B8: 2,56:1 do bieli → #64748B (4,76:1);
- bursztynowa linia #D97706: 2,95:1 do tła → usunięta z palety (zostaje 8 linii);
- szary nieaktywnej zakładki #64748B: 4,40:1 do tła → wolno go używać tylko na białym pasku (4,76:1).

## Otwarte (produktowe)
- Tryb ciemny: nie jest jeszcze zaprojektowany. → rozstrzygnięte przez D51 (ADR 0006).
