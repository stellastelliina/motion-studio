/**
 * Loudness envelope of a soundtrack, one value per video frame: RMS over each frame's samples,
 * smoothed like a meter (fast attack, slow release), in dBFS. Frames of true digital silence
 * report SILENCE_DB, so a hard cut to silence reads as a notch. Pure module.
 */

/** Level reported for digital silence. */
export const SILENCE_DB = -120;

export type EnvelopeOptions = {
  readonly fps: number;
  readonly frames: number;
  /** Meter ballistics in frames: time to rise / fall by about 63%. */
  readonly attack?: number;
  readonly release?: number;
};

export const rmsEnvelopeDb = (
  channels: readonly Float32Array[],
  sampleRate: number,
  { fps, frames, attack = 1.5, release = 6 }: EnvelopeOptions,
): Float32Array => {
  if (channels.length === 0) {
    throw new Error("rmsEnvelopeDb() needs at least one channel");
  }
  const perFrame = sampleRate / fps;
  const power = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const from = Math.floor(f * perFrame);
    const to = Math.min(channels[0].length, Math.floor((f + 1) * perFrame));
    let sum = 0;
    let count = 0;
    for (const ch of channels) {
      for (let s = from; s < to; s++) {
        sum += ch[s] * ch[s];
      }
      count += Math.max(0, to - from);
    }
    power[f] = count > 0 ? sum / count : 0;
  }
  const up = 1 - Math.exp(-1 / Math.max(attack, 1e-3));
  const down = 1 - Math.exp(-1 / Math.max(release, 1e-3));
  const metered = new Float32Array(frames);
  let level = power[0];
  for (let f = 0; f < frames; f++) {
    level += (power[f] - level) * (power[f] > level ? up : down);
    metered[f] = level > 1e-12 ? 10 * Math.log10(level) : SILENCE_DB;
  }
  // A light symmetric pass cleans single-frame spikes; true digital silence stays a hard notch.
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const prev = metered[Math.max(0, f - 1)];
    const next = metered[Math.min(frames - 1, f + 1)];
    out[f] = power[f] === 0 ? SILENCE_DB : 0.25 * prev + 0.5 * metered[f] + 0.25 * next;
  }
  return out;
};

/** Maps dBFS to 0-1 between `floor` and `ceil`, clamped. */
export const dbToUnit = (db: number, floor = -48, ceil = 0): number =>
  Math.min(1, Math.max(0, (db - floor) / (ceil - floor)));
