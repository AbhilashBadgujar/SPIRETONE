/** mulberry32: small seeded PRNG whose whole state is one int, so it saves cleanly. */
export function nextRandom(holder: { rngSeed: number }): number {
  let t = (holder.rngSeed = (holder.rngSeed + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
