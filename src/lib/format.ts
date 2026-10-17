const SUFFIXES = ['', 'K', 'M', 'B', 'T'];

/**
 * GDD §5 display: K, M, B, T, then scientific notation.
 * Floors rather than rounds so the HUD never shows more than the player has.
 */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return n > 0 ? '∞' : n < 0 ? '-∞' : '—';
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);

  if (a < 100) return sign + trimZeros(floorTo(a, 1).toFixed(1));
  if (a < 1000) return sign + String(Math.floor(a));

  const tier = Math.floor(Math.log10(a) / 3 + 1e-12);
  if (tier >= SUFFIXES.length) {
    const exp = Math.floor(Math.log10(a) + 1e-12);
    const mant = floorTo(a / Math.pow(10, exp), 2);
    return `${sign}${mant.toFixed(2)}e${exp}`;
  }
  const scaled = a / Math.pow(1000, tier);
  const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return sign + floorTo(scaled, digits).toFixed(digits) + SUFFIXES[tier];
}

function floorTo(x: number, digits: number): number {
  const p = Math.pow(10, digits);
  return Math.floor(x * p + 1e-6) / p;
}

function trimZeros(s: string): string {
  return s.replace(/\.0$/, '');
}
