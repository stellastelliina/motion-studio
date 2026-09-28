/**
 * Voice-over on the musical grid. A video with a narrator is timed by the voice, but picture
 * and music live on beats: every line starts on a grid subdivision (the first one free after the
 * previous line plus its pause), so scenes, cues and score keep speaking in beats and the music
 * lands its downbeats with the words.
 *
 * Pure module: `scripts/voice.ts` measures the recorded lines and calls `layoutVoice`; the
 * result is written to the video folder as `voice.timing.ts` and read by scenes and score.
 */

import type { Grid } from "@/framework/time/grid";

export type VoiceLine = {
  /** Stable id used by scenes and score, kebab-case. */
  readonly id: string;
  /** Prefix of the recorded file name inside the take folder (e.g. "01"). */
  readonly file: string;
  /** What is said, for subtitles and for reading the timeline. */
  readonly text: string;
  /** Minimum silence before the line, in beats (default: the plan's `gap`). */
  readonly gapBefore?: number;
};

export type VoicePlan = {
  /** Folder under assets/<video>/voice/ with one file per line. */
  readonly take: string;
  /** Beat of the first line: the picture before it runs without voice. */
  readonly firstBeat: number;
  /** Line starts snap up to multiples of this many beats. */
  readonly quantum: number;
  /** Default pause between lines, in beats. */
  readonly gap: number;
  /** Beats kept after the last line (end card, music tail). */
  readonly tail: number;
  /** Loudness of every line after levelling, LUFS (gain only, no dynamics). */
  readonly lufs: number;
  readonly lines: readonly VoiceLine[];
};

export const defineVoice = (plan: VoicePlan): VoicePlan => {
  const ids = new Set<string>();
  for (const line of plan.lines) {
    if (!/^[a-z0-9-]+$/.test(line.id)) {
      throw new Error(`Voice line id "${line.id}" must be kebab-case`);
    }
    if (ids.has(line.id)) {
      throw new Error(`Voice line id "${line.id}" is used twice`);
    }
    ids.add(line.id);
  }
  if (plan.quantum <= 0 || plan.gap < 0 || plan.tail < 0 || plan.firstBeat < 0) {
    throw new Error("Voice plan: quantum must be positive, gap, tail and firstBeat not negative");
  }
  return plan;
};

/** A stretch of speech between two pauses inside a line, in beats. */
export type Phrase = { readonly start: number; readonly end: number };

export type LineTiming = {
  readonly id: string;
  readonly text: string;
  /** Beat where the first sound of the line lands. */
  readonly start: number;
  /** Fractional beat where the line ends (not quantized). */
  readonly end: number;
  readonly seconds: number;
  /**
   * The line split at its inner pauses, in order: "Entriamo in azienda, formiamo le persone"
   * gives one phrase per pause-delimited part, so a scene can hit the second part on time.
   */
  readonly phrases: readonly Phrase[];
};

/** A recorded line as measured: its length and its speech stretches, in seconds from its start. */
export type LineMeasure = {
  readonly seconds: number;
  readonly phrases?: readonly (readonly [number, number])[];
};

export type VoiceTiming = {
  readonly bpm: number;
  readonly lines: readonly LineTiming[];
  /** Beat where the video ends: last line end plus the tail, rounded up to a whole beat. */
  readonly endBeat: number;
};

const EPS = 1e-9;

/** Places the lines on the grid from their measured lengths (seconds, or full measures). */
export const layoutVoice = (
  grid: Grid,
  plan: VoicePlan,
  measures: Readonly<Record<string, number | LineMeasure>>,
): VoiceTiming => {
  const beatsOf = (s: number) => s / grid.secondsPerBeat;
  const lines: LineTiming[] = [];
  let cursor = plan.firstBeat;
  plan.lines.forEach((line, i) => {
    const raw = measures[line.id];
    const measure: LineMeasure | undefined = typeof raw === "number" ? { seconds: raw } : raw;
    const length = measure?.seconds;
    if (measure === undefined || length === undefined || !(length > 0)) {
      throw new Error(`Voice line "${line.id}" has no measured length`);
    }
    const earliest = i === 0 ? plan.firstBeat : cursor + (line.gapBefore ?? plan.gap);
    const start = Math.ceil(earliest / plan.quantum - EPS) * plan.quantum;
    const end = start + beatsOf(length);
    const phrases = (measure.phrases ?? [[0, length]]).map(([a, b]) => ({
      start: start + beatsOf(a),
      end: start + beatsOf(b),
    }));
    lines.push({ id: line.id, text: line.text, start, end, seconds: length, phrases });
    cursor = end;
  });
  return { bpm: grid.bpm, lines, endBeat: Math.ceil(cursor + plan.tail - EPS) };
};

/** Lookup by id for scenes and score: `line("sfida").start` is a beat, like a cue. */
export const voiceLines = (timing: VoiceTiming) => {
  const byId = new Map(timing.lines.map((l) => [l.id, l]));
  return (id: string): LineTiming => {
    const l = byId.get(id);
    if (!l) {
      throw new Error(`Unknown voice line "${id}"`);
    }
    return l;
  };
};
