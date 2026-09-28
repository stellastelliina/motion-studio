/**
 * Musical time grid: animation and sound are authored on the same clock.
 * Beats and bars are 0-based: `bar(0)` is frame 0, `bar(1)` is the downbeat of the second bar.
 *
 * Pure module (no DOM, no Node APIs): shared by compositions and by the audio renderer.
 */

export type GridConfig = {
  readonly fps: number;
  readonly bpm: number;
  /** Beats per bar, default 4. */
  readonly beatsPerBar?: number;
  /** Frame at which beat 0 lands, default 0. */
  readonly offset?: number;
};

export type Grid = {
  readonly fps: number;
  readonly bpm: number;
  readonly beatsPerBar: number;
  /** Frames per beat, usually fractional (128 BPM at 60 fps = 28.125). */
  readonly framesPerBeat: number;
  readonly framesPerBar: number;
  readonly secondsPerBeat: number;
  /** Integer frame where beat `b` lands. Fractional beats are fine: `beat(2.5)` is the "and" of 3. */
  readonly beat: (b: number) => number;
  /** Integer frame of bar `n`, plus `beats` inside the bar. */
  readonly bar: (n: number, beats?: number) => number;
  /** Exact fractional frame of beat `b`, for continuous math. */
  readonly beatExact: (b: number) => number;
  /** Exact time in seconds of beat `b`: the audio side schedules on this. */
  readonly seconds: (b: number) => number;
  /** Fractional beat position at frame `f`. */
  readonly beatAt: (f: number) => number;
  /** Frames between two beat positions, consistent with `beat()` rounding (sequences tile with no gaps). */
  readonly span: (fromBeat: number, toBeat: number) => number;
};

export const createGrid = ({ fps, bpm, beatsPerBar = 4, offset = 0 }: GridConfig): Grid => {
  if (fps <= 0 || bpm <= 0) {
    throw new Error(`Invalid grid: fps=${fps} bpm=${bpm}`);
  }
  const framesPerBeat = (fps * 60) / bpm;
  const beatExact = (b: number) => offset + b * framesPerBeat;
  const beat = (b: number) => Math.round(beatExact(b));

  return {
    fps,
    bpm,
    beatsPerBar,
    framesPerBeat,
    framesPerBar: framesPerBeat * beatsPerBar,
    secondsPerBeat: 60 / bpm,
    beat,
    bar: (n, beats = 0) => beat(n * beatsPerBar + beats),
    beatExact,
    seconds: (b) => beatExact(b) / fps,
    beatAt: (f) => (f - offset) / framesPerBeat,
    span: (fromBeat, toBeat) => beat(toBeat) - beat(fromBeat),
  };
};
