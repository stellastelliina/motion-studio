/**
 * Core types and helpers of the audio engine: stereo buffers, gain math, panning, fades.
 * Pure module (no DOM, no Node APIs): safe in the Remotion bundle and in the offline renderer.
 */

/** Stereo signal. A mono signal is a Stereo whose `l` and `r` are the same array. */
export type Stereo = { readonly l: Float32Array; readonly r: Float32Array };

export const TAU = Math.PI * 2;

export const createStereo = (length: number): Stereo => ({
  l: new Float32Array(length),
  r: new Float32Array(length),
});

/** Wraps a mono signal: mixers treat it as a point source and pan it with equal power. */
export const fromMono = (mono: Float32Array): Stereo => ({ l: mono, r: mono });

export const isMono = (s: Stereo): boolean => s.l === s.r;

export const lengthOf = (s: Stereo): number => s.l.length;

export const dbToGain = (db: number): number => Math.pow(10, db / 20);

export const gainToDb = (gain: number): number => (gain > 0 ? 20 * Math.log10(gain) : -Infinity);

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Exponential interpolation, the natural one for frequencies. */
export const expLerp = (a: number, b: number, t: number): number => a * Math.pow(b / a, t);

export const toSamples = (seconds: number, sampleRate: number): number =>
  Math.round(seconds * sampleRate);

/** Equal-power pan law: -1 hard left, 0 center (-3 dB per side), 1 hard right. */
export const panGains = (pan: number): readonly [number, number] => {
  const theta = ((clamp(pan, -1, 1) + 1) * Math.PI) / 4;
  return [Math.cos(theta), Math.sin(theta)];
};

/** Balance law for stereo sources: unity at center, the far side fades out with equal power. */
export const balanceGains = (pan: number): readonly [number, number] => {
  const [l, r] = panGains(pan);
  return [Math.min(1, l * Math.SQRT2), Math.min(1, r * Math.SQRT2)];
};

/**
 * Mixes `src` into `dst` at sample `offset` (may be negative), clipped to `dst` bounds.
 * Mono sources are panned with equal power, stereo sources are balanced.
 */
export const mixInto = (dst: Stereo, src: Stereo, offset: number, gain = 1, pan = 0): void => {
  const [gl, gr] = isMono(src) ? panGains(pan) : balanceGains(pan);
  const from = Math.max(0, -offset);
  const to = Math.min(src.l.length, dst.l.length - offset);
  const sl = src.l;
  const sr = src.r;
  const dl = dst.l;
  const dr = dst.r;
  const al = gain * gl;
  const ar = gain * gr;
  for (let i = from; i < to; i++) {
    dl[i + offset] += sl[i] * al;
    dr[i + offset] += sr[i] * ar;
  }
};

/** Adds a mono signal into a mono channel at `offset`. */
export const addMono = (dst: Float32Array, src: Float32Array, offset: number, gain = 1): void => {
  const from = Math.max(0, -offset);
  const to = Math.min(src.length, dst.length - offset);
  for (let i = from; i < to; i++) {
    dst[i + offset] += src[i] * gain;
  }
};

export const scale = (s: Stereo, gain: number): void => {
  forEachChannel(s, (ch) => {
    for (let i = 0; i < ch.length; i++) {
      ch[i] *= gain;
    }
  });
};

/** Runs `fn` once per distinct channel (once for mono buffers). */
export const forEachChannel = (s: Stereo, fn: (ch: Float32Array, index: number) => void): void => {
  fn(s.l, 0);
  if (!isMono(s)) {
    fn(s.r, 1);
  }
};

/** Deep copy; a mono buffer stays mono. */
export const cloneStereo = (s: Stereo): Stereo => {
  const l = s.l.slice();
  return isMono(s) ? { l, r: l } : { l, r: s.r.slice() };
};

/** Converts to a true stereo buffer (two arrays), copying when the input is mono. */
export const toStereo = (s: Stereo): Stereo => (isMono(s) ? { l: s.l, r: s.l.slice() } : s);

export const reverse = (s: Stereo): Stereo => {
  const l = s.l.slice().reverse();
  return isMono(s) ? { l, r: l } : { l, r: s.r.slice().reverse() };
};

/** Raised-cosine gain ramp shape, 0 to 1. */
export const cosRamp = (t: number): number => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));

/**
 * Applies a raised-cosine fade in place over `[from, from + length)`.
 * `out` fades to exactly zero at the last sample of the range and zeroes everything after it
 * when `zeroAfter` is set.
 */
export const fade = (
  s: Stereo,
  from: number,
  length: number,
  direction: "in" | "out",
  zeroAfter = false,
): void => {
  forEachChannel(s, (ch) => {
    const n = Math.max(1, length);
    for (let k = 0; k < n; k++) {
      const i = from + k;
      if (i < 0 || i >= ch.length) {
        continue;
      }
      const t = n === 1 ? 1 : k / (n - 1);
      ch[i] *= direction === "in" ? cosRamp(t) : cosRamp(1 - t);
    }
    if (direction === "out" && zeroAfter) {
      ch.fill(0, Math.max(0, from + n));
    }
  });
};

/** Largest absolute sample value. */
export const peakOf = (s: Stereo): number => {
  let p = 0;
  forEachChannel(s, (ch) => {
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i]);
      if (a > p) {
        p = a;
      }
    }
  });
  return p;
};

/** Index of the first NaN or infinite sample, or -1. */
export const firstInvalid = (s: Stereo): number => {
  let found = -1;
  forEachChannel(s, (ch) => {
    for (let i = 0; i < ch.length && found < 0; i++) {
      if (!Number.isFinite(ch[i])) {
        found = i;
      }
    }
  });
  return found;
};
