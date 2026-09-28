/**
 * Pitch helpers: note names, MIDI numbers, frequencies, chords, Shepard layers.
 * A note is either a name ("F4", "Ab3", "C#5") or a MIDI number (60 = C4).
 */

export type NoteInput = string | number;

const PITCH_CLASS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** MIDI number of a note name or MIDI number. Octaves follow the C4 = 60 convention. */
export const midi = (note: NoteInput): number => {
  if (typeof note === "number") {
    return note;
  }
  const match = /^([A-Ga-g])([#b]{0,2})(-?\d+)$/.exec(note.trim());
  if (!match) {
    throw new Error(`Invalid note name "${note}"`);
  }
  const [, letter, accidentals, octave] = match;
  let pc = PITCH_CLASS[letter.toUpperCase()];
  for (const a of accidentals) {
    pc += a === "#" ? 1 : -1;
  }
  return (Number(octave) + 1) * 12 + pc;
};

export const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/** Frequency in Hz of a note name or MIDI number. */
export const hz = (note: NoteInput): number => mtof(midi(note));

export const transpose = (notes: readonly number[], semitones: number): number[] =>
  notes.map((n) => n + semitones);

/** Chord intervals by quality suffix. */
const QUALITIES: Record<string, readonly number[]> = {
  "": [0, 4, 7],
  maj: [0, 4, 7],
  m: [0, 3, 7],
  "5": [0, 7],
  "6": [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  "69": [0, 4, 7, 9, 14],
  "7": [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  "9": [0, 4, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
  m9: [0, 3, 7, 10, 14],
  m11: [0, 3, 7, 10, 14, 17],
  add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
};

/**
 * MIDI notes of a chord symbol with its root in `octave`: `chord("Dbmaj7", 3)` is Db3 F3 Ab3 C4.
 * Supported suffixes: see QUALITIES (maj7, m9, add9, sus4, 69, ...).
 */
export const chord = (symbol: string, octave = 3): number[] => {
  const match = /^([A-G][#b]?)(.*)$/.exec(symbol.trim());
  const intervals = match ? QUALITIES[match[2]] : undefined;
  if (!match || !intervals) {
    throw new Error(`Unknown chord "${symbol}"`);
  }
  const root = midi(`${match[1]}${octave}`);
  return intervals.map((i) => root + i);
};

/** Moves the lowest `n` notes up an octave (positive n) or the highest down (negative n). */
export const invert = (notes: readonly number[], n: number): number[] => {
  const out = [...notes].sort((a, b) => a - b);
  for (let i = 0; i < Math.abs(n); i++) {
    if (n > 0) {
      out.push((out.shift() as number) + 12);
    } else {
      out.unshift((out.pop() as number) - 12);
    }
  }
  return out;
};

export type ShepardLayer = { readonly midi: number; readonly gain: number };

/**
 * Shepard-tone layers of a pitch class: octave copies weighted by a bell over log frequency, so a
 * rising line keeps rising in feel while its spectral center stays put.
 */
export const shepard = (
  note: NoteInput,
  {
    center = 66,
    spread = 14,
    octaves = 4,
  }: { center?: number; spread?: number; octaves?: number } = {},
): ShepardLayer[] => {
  const m = midi(note);
  const pc = ((m % 12) + 12) % 12;
  const base = center - (octaves * 12) / 2;
  const first = base + ((pc - (base % 12) + 12) % 12);
  const layers: ShepardLayer[] = [];
  for (let k = 0; k < octaves; k++) {
    const n = first + k * 12;
    const d = (n - center) / spread;
    layers.push({ midi: n, gain: Math.exp(-0.5 * d * d * 4) });
  }
  return layers;
};
