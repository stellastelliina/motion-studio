/**
 * Glitch: stutter a region of a bus by repeating its first slice, optionally accelerating
 * (each half of the remaining region halves the slice), pitching up and crushing.
 */

import { dbToGain, forEachChannel, type Stereo } from "./core";
import { bitcrush } from "./effects";

export type StutterOptions = {
  /** Slice length in samples at the start of the region. */
  readonly slice: number;
  /** Halve the slice as the region runs out: a roll that speeds up. */
  readonly accelerate?: boolean;
  /** Shortest slice in samples. */
  readonly minSlice?: number;
  /** Pitch rise across the region in semitones (slices are resampled). */
  readonly pitch?: number;
  /** Gain ramp across the region in dB. */
  readonly gainFrom?: number;
  readonly gainTo?: number;
  /** Bit depth for a crush over the region (0 = off). */
  readonly crush?: number;
  /** Edge fade of each slice in samples. */
  readonly fade?: number;
};

export const stutter = (s: Stereo, from: number, to: number, o: StutterOptions): void => {
  const end = Math.min(to, s.l.length);
  if (end <= from) {
    return;
  }
  const total = end - from;
  const fade = Math.max(1, o.fade ?? 48);
  const minSlice = Math.max(fade * 2 + 1, o.minSlice ?? 64);
  forEachChannel(s, (ch) => {
    const source = ch.slice(from, from + o.slice);
    let pos = from;
    let level = 0;
    while (pos < end) {
      if (o.accelerate) {
        while (
          end - pos <= total / Math.pow(2, level + 1) &&
          o.slice / Math.pow(2, level + 1) >= minSlice
        ) {
          level++;
        }
      }
      const len = Math.min(Math.max(minSlice, Math.round(o.slice / Math.pow(2, level))), end - pos);
      const x = (pos - from) / total;
      const ratio = Math.pow(2, ((o.pitch ?? 0) * x) / 12);
      const gain = dbToGain((o.gainFrom ?? 0) + ((o.gainTo ?? 0) - (o.gainFrom ?? 0)) * x);
      for (let i = 0; i < len; i++) {
        const p = i * ratio;
        const j = Math.floor(p);
        const f = p - j;
        const a = j < source.length ? source[j] : 0;
        const b = j + 1 < source.length ? source[j + 1] : 0;
        const w = Math.min(1, i / fade, (len - 1 - i) / fade);
        ch[pos + i] = (a + (b - a) * f) * w * gain;
      }
      pos += len;
    }
  });
  if (o.crush && o.crush > 0) {
    bitcrush(s, { bits: o.crush, downsample: 2, mix: 0.6 }, from, end);
  }
};
