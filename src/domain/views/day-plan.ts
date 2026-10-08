/**
 * Widok dnia „lista z przerwami” (D122, ADR 0031): sprawy dnia, wydarzenia z iPhone'a wplecione według godziny
 * i przerwy „wolne …” między sprawami z godziną.
 *
 * - Najpierw wszystko bez godziny (sprawy aplikacji, potem całodniowe z iPhone'a), dalej po godzinie; przy tej samej
 *   godzinie sprawa aplikacji przed wpisem z iPhone'a.
 * - Zajęte od początku do końca; sprawa bez końca (zadanie z godziną, wydarzenie bez końca) to chwila.
 *   Nakładające się sprawy liczą się razem (zajęte do najpóźniejszego końca).
 * - Przerwa krótsza niż `config.day.GAP_MIN` nie jest pokazywana. Dziś przerwa liczy się od teraz (`nowMin`),
 *   więc minione przerwy znikają. Bez przerw (`gaps` = false): dzień miniony, tydzień i miesiąc.
 * - Wiersze z wcięciem (`depth` > 0) idą za rodzicem i nie wpływają na przerwy.
 */
import { config } from '../../config';
import { minutesOf } from '../format';

export type Span = { start: string | null; end: string | null };
export type PlanRow<E, D> = { kind: 'entry'; item: E } | { kind: 'device'; item: D } | { kind: 'gap'; key: string; minutes: number };

export function dayPlan<E extends { depth: number }, D extends { time: string | null; endTime: string | null }>(
  entries: readonly E[],
  device: readonly D[],
  spanOf: (e: E) => Span,
  opts: { nowMin: number | null; gaps: boolean },
): PlanRow<E, D>[] {
  // Grupy: rodzic z podzadaniami pod nim.
  const groups: { rows: E[]; span: Span }[] = [];
  for (const e of entries) {
    const last = groups.at(-1);
    if (e.depth > 0 && last) last.rows.push(e);
    else groups.push({ rows: [e], span: spanOf(e) });
  }
  type Block = { order: number; start: number | null; end: number | null; rows: PlanRow<E, D>[] };
  const minOr = (t: string | null) => (t === null ? null : minutesOf(t));
  const blocks: Block[] = [
    ...groups.map((g, i): Block => ({ order: i, start: minOr(g.span.start), end: minOr(g.span.end ?? g.span.start), rows: g.rows.map((item) => ({ kind: 'entry' as const, item })) })),
    ...device.map((d, i): Block => ({ order: groups.length + i, start: minOr(d.time), end: minOr(d.endTime ?? d.time), rows: [{ kind: 'device' as const, item: d }] })),
  ];
  blocks.sort((a, b) => (a.start === null ? 0 : 1) - (b.start === null ? 0 : 1) || (a.start ?? 0) - (b.start ?? 0) || a.order - b.order);

  const out: PlanRow<E, D>[] = [];
  let busy: number | null = opts.nowMin;
  for (const b of blocks) {
    if (b.start !== null && opts.gaps) {
      if (busy !== null && b.start - busy >= config.day.GAP_MIN) out.push({ kind: 'gap', key: `gap-${busy}-${b.start}`, minutes: b.start - busy });
      busy = Math.max(busy ?? b.start, b.end!);
    }
    out.push(...b.rows);
  }
  return out;
}
