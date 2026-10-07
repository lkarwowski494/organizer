/**
 * Kontrast kolorów według WCAG 2.2 (https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio):
 * „contrast ratio (L1 + 0.05) / (L2 + 0.05), where L1 is the relative luminance of the lighter of the colors”.
 * Luminancja względna (https://www.w3.org/TR/WCAG22/#dfn-relative-luminance):
 * „L = 0.2126 * R + 0.7152 * G + 0.0722 * B … if RsRGB <= 0.04045 then R = RsRGB/12.92
 * else R = ((RsRGB+0.055)/1.055) ^ 2.4”.
 */
const HEX = /^#[0-9a-fA-F]{6}$/;

function channel(v8: number): number {
  const s = v8 / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  if (!HEX.test(hex)) throw new Error(`contrast: oczekiwano koloru #RRGGBB, jest ${hex}`);
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16))) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
