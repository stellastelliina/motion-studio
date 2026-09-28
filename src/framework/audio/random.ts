/**
 * Deterministic randomness. Every noise source in the engine draws from a seeded generator, so the
 * same score always renders to the same samples.
 */

/** FNV-1a 32-bit hash of the parts, used to derive stable seeds from names and positions. */
export const hashSeed = (...parts: readonly (string | number)[]): number => {
  const text = parts.join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

/** SplitMix32 generator: tiny state, good distribution, plenty for audio noise. */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x9e3779b9) | 0;
    let t = this.state ^ (this.state >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    t ^= t >>> 15;
    return (t >>> 0) / 4294967296;
  }

  /** Uniform in [-1, 1). */
  bipolar(): number {
    return this.next() * 2 - 1;
  }

  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Independent child generator, stable for a given parent state and label. */
  fork(label: string | number): Rng {
    return new Rng(hashSeed(Math.floor(this.next() * 4294967296), label));
  }
}
