import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defineScore,
  firstInvalid,
  hz,
  peakOf,
  piano,
  renderScore,
  type PianoOptions,
  type PianoTimbre,
} from "@/framework/audio";
import { createGrid } from "@/framework/time/grid";

const SR = 48000;
const TIMBRES: readonly PianoTimbre[] = ["grand", "felt"];

const play = (note: string, o: Omit<PianoOptions, "freq">, seed = 1) =>
  piano({ ...o, freq: hz(note) }, { sampleRate: SR, seed });

const at = (seconds: number) => Math.round(seconds * SR);

/** Largest sample-to-sample step in [from, to): a click shows up as a jump here. */
const maxStep = (x: Float32Array, from: number, to: number) => {
  let m = 0;
  for (let i = Math.max(1, from); i < Math.min(x.length, to); i++) {
    m = Math.max(m, Math.abs(x[i] - x[i - 1]));
  }
  return m;
};

const rmsDb = (x: Float32Array, from: number, to: number) => {
  let e = 0;
  for (let i = from; i < to; i++) {
    e += (x[i] ?? 0) ** 2;
  }
  return 10 * Math.log10(e / (to - from) + 1e-30);
};

/** Seconds until the 50 ms RMS falls `drop` dB below its level at the start. */
const decayTime = (x: Float32Array, drop: number) => {
  const win = at(0.05);
  const start = rmsDb(x, at(0.02), at(0.02) + win);
  for (let i = at(0.02); i + win <= x.length; i += win) {
    if (rmsDb(x, i, i + win) < start - drop) {
      return i / SR;
    }
  }
  return x.length / SR;
};

/** Spectral centroid of a Hann-windowed frame (plain DFT up to 12 kHz). */
const centroid = (x: Float32Array, from: number, size = 2048) => {
  let num = 0;
  let den = 0;
  for (let k = 1; k < size / 2 && (k * SR) / size < 12000; k++) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < size; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
      const v = (x[from + i] ?? 0) * w;
      const ph = (2 * Math.PI * k * i) / size;
      re += v * Math.cos(ph);
      im -= v * Math.sin(ph);
    }
    const m = Math.hypot(re, im);
    num += ((k * SR) / size) * m;
    den += m;
  }
  return num / den;
};

describe("piano", () => {
  it("is deterministic: same trigger, same samples", () => {
    for (const timbre of TIMBRES) {
      const a = play("E4", { length: 1, velocity: 0.7, timbre }, 42);
      const b = play("E4", { length: 1, velocity: 0.7, timbre }, 42);
      assert.deepEqual(a.l, b.l);
      assert.deepEqual(a.r, b.r);
    }
  });

  it("stays finite and bounded across the keyboard and the velocity range", () => {
    for (const timbre of TIMBRES) {
      for (const note of ["A0", "D2", "C4", "A5", "E6", "C8"]) {
        for (const velocity of [0.02, 0.5, 1]) {
          const s = play(note, { length: 0.4, velocity, timbre, maxLength: 3 });
          assert.equal(firstInvalid(s), -1, `${timbre} ${note} v${velocity}`);
          const peak = peakOf(s);
          assert.ok(peak > 1e-4 && peak < 1.5, `${timbre} ${note} v${velocity} peak ${peak}`);
          assert.equal(Math.abs(s.l[s.l.length - 1]), 0, "the buffer ends in exact zero");
          assert.equal(Math.abs(s.r[s.r.length - 1]), 0, "the buffer ends in exact zero");
        }
      }
    }
  });

  it("releases without a click: no step at the damper larger than in the note before it", () => {
    for (const timbre of TIMBRES) {
      for (const note of ["D2", "C4", "G5"]) {
        const s = play(note, { length: 0.5, velocity: 0.8, timbre });
        const gate = at(0.5);
        for (const ch of [s.l, s.r]) {
          const before = maxStep(ch, gate - at(0.1), gate);
          const after = maxStep(ch, gate, gate + at(0.08));
          assert.ok(
            after <= before * 1.05,
            `${timbre} ${note}: ${after} after vs ${before} before`,
          );
        }
        const tail = rmsDb(s.l, s.l.length - at(0.05), s.l.length);
        assert.ok(tail < -80, `${timbre} ${note}: damped tail still at ${tail} dB`);
      }
    }
  });

  it("rings longer in the bass than in the treble", () => {
    for (const timbre of TIMBRES) {
      const low = decayTime(play("C2", { length: 10, velocity: 0.6, timbre }).l, 30);
      const mid = decayTime(play("C4", { length: 10, velocity: 0.6, timbre }).l, 30);
      const high = decayTime(play("C6", { length: 10, velocity: 0.6, timbre }).l, 30);
      assert.ok(low > mid && mid > high, `${timbre}: C2 ${low} s, C4 ${mid} s, C6 ${high} s`);
      assert.ok(low > 2 * high, `${timbre}: C2 ${low} s vs C6 ${high} s`);
    }
  });

  it("gets brighter, not only louder, with velocity", () => {
    for (const timbre of TIMBRES) {
      for (const note of ["C3", "C5"]) {
        const soft = play(note, { length: 1, velocity: 0.3, timbre });
        const hard = play(note, { length: 1, velocity: 0.9, timbre });
        const cs = centroid(soft.l, at(0.01));
        const ch = centroid(hard.l, at(0.01));
        assert.ok(ch > cs * 1.15, `${timbre} ${note}: centroid ${cs} Hz soft, ${ch} Hz hard`);
      }
    }
  });

  it("darkens as it rings: the high partials die first", () => {
    const s = play("C4", { length: 4, velocity: 0.8, timbre: "grand" });
    assert.ok(centroid(s.l, at(1.5)) < 0.7 * centroid(s.l, at(0.01)));
  });

  it("has no damper above E6: the key length does not matter", () => {
    const short = play("C7", { length: 0.05, velocity: 0.6 });
    const long = play("C7", { length: 3, velocity: 0.6 });
    assert.deepEqual(short.l, long.l);
  });

  it("plays in a score: notes and rolled chords land on the music bus", () => {
    const score = defineScore({
      durationSec: 3,
      grid: createGrid({ fps: 60, bpm: 100 }),
      buses: { music: {} },
      build: (s) => {
        s.piano(0, { note: "D4", length: 1, timbre: "felt" });
        s.pianoChord(1, { notes: ["D3", "F#3", "A3"], length: 2, roll: 0.02 });
      },
    });
    const a = renderScore(score);
    const b = renderScore(score);
    assert.deepEqual(a.output.l, b.output.l);
    assert.ok(Number.isFinite(a.stats.integrated));
  });
});
