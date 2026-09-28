import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defineScore,
  firstInvalid,
  hz,
  marimba,
  peakOf,
  renderScore,
  vibraphone,
  type MalletHardness,
  type MarimbaOptions,
  type VibraphoneOptions,
} from "@/framework/audio";
import { createGrid } from "@/framework/time/grid";

const SR = 48000;
const MALLETS: readonly MalletHardness[] = ["soft", "medium", "hard"];

const mar = (note: string, o: Omit<MarimbaOptions, "freq"> = {}, seed = 1) =>
  marimba({ ...o, freq: hz(note) }, { sampleRate: SR, seed });
const vib = (note: string, o: Omit<VibraphoneOptions, "freq"> = {}, seed = 1) =>
  vibraphone({ ...o, freq: hz(note) }, { sampleRate: SR, seed });

const at = (seconds: number) => Math.round(seconds * SR);

const rmsDb = (x: Float32Array, from: number, to: number) => {
  let e = 0;
  for (let i = from; i < to; i++) {
    e += (x[i] ?? 0) ** 2;
  }
  return 10 * Math.log10(e / (to - from) + 1e-30);
};

/** Seconds until the 20 ms RMS falls `drop` dB below its loudest point in the first 300 ms. */
const decayTime = (x: Float32Array, drop: number) => {
  const win = at(0.02);
  let start = -Infinity;
  for (let i = 0; i + win <= Math.min(x.length, at(0.3)); i += win) {
    start = Math.max(start, rmsDb(x, i, i + win));
  }
  for (let i = at(0.02); i + win <= x.length; i += win) {
    if (rmsDb(x, i, i + win) < start - drop) {
      return i / SR;
    }
  }
  return x.length / SR;
};

/** Largest sample-to-sample step in [from, to): a click shows up as a jump here. */
const maxStep = (x: Float32Array, from: number, to: number) => {
  let m = 0;
  for (let i = Math.max(1, from); i < Math.min(x.length, to); i++) {
    m = Math.max(m, Math.abs(x[i] - x[i - 1]));
  }
  return m;
};

/** Amplitude of the component at `freq` in a Hann-windowed frame (Goertzel-style DFT bin). */
const level = (x: Float32Array, from: number, freq: number, size = 4096) => {
  let re = 0;
  let im = 0;
  for (let i = 0; i < size; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
    const v = (x[from + i] ?? 0) * w;
    const ph = (2 * Math.PI * freq * i) / SR;
    re += v * Math.cos(ph);
    im -= v * Math.sin(ph);
  }
  return Math.hypot(re, im);
};

/** Spectral centroid of a Hann-windowed frame (plain DFT up to 12 kHz). */
const centroid = (x: Float32Array, from: number, size = 2048) => {
  let num = 0;
  let den = 0;
  for (let k = 1; k < size / 2 && (k * SR) / size < 12000; k++) {
    const f = (k * SR) / size;
    const m = level(x, from, f, size);
    num += f * m;
    den += m;
  }
  return num / den;
};

describe("marimba", () => {
  it("is deterministic: same trigger, same samples", () => {
    const a = mar("E4", { velocity: 0.7, mallet: "hard" }, 42);
    const b = mar("E4", { velocity: 0.7, mallet: "hard" }, 42);
    assert.deepEqual(a.l, b.l);
    assert.deepEqual(a.r, b.r);
  });

  it("varies from stroke to stroke, within a fraction of a dB", () => {
    const a = mar("A4", { velocity: 0.6 }, 1);
    const b = mar("A4", { velocity: 0.6 }, 2);
    assert.notDeepEqual(a.l, b.l);
    const d = Math.abs(rmsDb(a.l, 0, at(0.3)) - rmsDb(b.l, 0, at(0.3)));
    assert.ok(d > 0.01 && d < 1.5, `level difference ${d} dB`);
  });

  it("stays finite and bounded over five octaves, every mallet and velocity", () => {
    for (const note of ["C2", "F2", "C4", "A5", "C7"]) {
      for (const mallet of MALLETS) {
        for (const velocity of [0.02, 0.5, 1]) {
          const s = mar(note, { velocity, mallet, position: 0.6 });
          const tag = `${note} ${mallet} v${velocity}`;
          assert.equal(firstInvalid(s), -1, tag);
          const peak = peakOf(s);
          assert.ok(peak > 1e-5 && peak < 1, `${tag} peak ${peak}`);
          assert.equal(s.l[s.l.length - 1], 0, `${tag}: the buffer ends in exact zero`);
          assert.equal(s.r[s.r.length - 1], 0, `${tag}: the buffer ends in exact zero`);
        }
      }
    }
  });

  it("rings longer in the bass: about 2 s at C2, under half a second at C6", () => {
    const low = decayTime(mar("C2").l, 60);
    const mid = decayTime(mar("C4").l, 60);
    const high = decayTime(mar("C6").l, 60);
    assert.ok(low > mid && mid > high, `C2 ${low} s, C4 ${mid} s, C6 ${high} s`);
    assert.ok(low > 1.5 && low < 3, `C2 ${low} s`);
    assert.ok(high > 0.25 && high < 0.6, `C6 ${high} s`);
  });

  it("gets brighter with velocity and with a harder mallet", () => {
    for (const note of ["C3", "C5"]) {
      const soft = centroid(mar(note, { velocity: 0.3 }).l, at(0.003));
      const hard = centroid(mar(note, { velocity: 0.9 }).l, at(0.003));
      assert.ok(hard > soft * 1.1, `${note}: centroid ${soft} Hz soft, ${hard} Hz hard`);
      const yarn = centroid(mar(note, { mallet: "soft" }).l, at(0.003));
      const rubber = centroid(mar(note, { mallet: "hard" }).l, at(0.003));
      assert.ok(rubber > yarn * 1.15, `${note}: centroid ${yarn} Hz soft, ${rubber} Hz hard`);
    }
  });

  it("follows the striking point: the center of the bar barely excites the second mode", () => {
    const f = hz("C4");
    const ratio = (position: number) => {
      const s = mar("C4", { position, mallet: "hard" }).l;
      return level(s, at(0.01), 4 * f) / level(s, at(0.01), f);
    };
    assert.ok(ratio(1) > 3 * ratio(0), `edge ${ratio(1)}, center ${ratio(0)}`);
  });

  it("keeps its partials near 1 : 4 : 10", () => {
    const f = hz("C3");
    const s = mar("C3", { mallet: "hard", position: 0.8 }).l;
    const peakNear = (target: number) => {
      let best = target;
      let bestLevel = 0;
      for (let c = -60; c <= 60; c += 2) {
        const g = target * Math.pow(2, c / 1200);
        const l = level(s, at(0.005), g, 8192);
        if (l > bestLevel) {
          bestLevel = l;
          best = g;
        }
      }
      return best / f;
    };
    assert.ok(Math.abs(peakNear(4 * f) - 4) < 0.08, `second mode at ${peakNear(4 * f)}`);
    assert.ok(Math.abs(peakNear(10 * f) - 10) < 0.35, `third mode at ${peakNear(10 * f)}`);
  });
});

describe("vibraphone", () => {
  it("is deterministic and varies from stroke to stroke", () => {
    const a = vib("A4", { length: 1, motor: 4 }, 9);
    const b = vib("A4", { length: 1, motor: 4 }, 9);
    const c = vib("A4", { length: 1, motor: 4 }, 10);
    assert.deepEqual(a.l, b.l);
    assert.notDeepEqual(a.l, c.l);
  });

  it("stays finite and bounded over its range, pedal and motor included", () => {
    for (const note of ["C3", "F3", "C5", "F6", "C7"]) {
      for (const mallet of MALLETS) {
        for (const velocity of [0.02, 0.5, 1]) {
          const s = vib(note, { velocity, mallet, length: 0.5, motor: 6, maxLength: 4 });
          const tag = `${note} ${mallet} v${velocity}`;
          assert.equal(firstInvalid(s), -1, tag);
          const peak = peakOf(s);
          assert.ok(peak > 1e-5 && peak < 1, `${tag} peak ${peak}`);
          assert.equal(s.l[s.l.length - 1], 0, `${tag}: the buffer ends in exact zero`);
        }
      }
    }
  });

  it("sustains for seconds, longer in the low register", () => {
    const low = decayTime(vib("F3", { maxLength: 40 }).l, 30);
    const high = decayTime(vib("F6", { maxLength: 40 }).l, 30);
    assert.ok(low > 2 * high, `F3 ${low} s, F6 ${high} s`);
    assert.ok(high > 2, `F6 ${high} s`);
  });

  it("damps without a click when the pedal comes up", () => {
    for (const note of ["F3", "C5"]) {
      const s = vib(note, { length: 0.6, velocity: 0.8 });
      const gate = at(0.6);
      const before = maxStep(s.l, gate - at(0.1), gate);
      const after = maxStep(s.l, gate, gate + at(0.08));
      assert.ok(after <= before * 1.05, `${note}: ${after} after vs ${before} before`);
      assert.ok(s.l.length < at(1.4), `${note}: ${s.l.length / SR} s after a 0.6 s pedal`);
    }
  });

  it("pulses with the motor, and only then", () => {
    const swing = (motor: number) => {
      const s = vib("C4", { motor, depth: 0.8, maxLength: 3 }).l;
      const levels: number[] = [];
      for (let i = at(1); i + at(0.02) <= at(2); i += at(0.02)) {
        levels.push(rmsDb(s, i, i + at(0.02)));
      }
      // Remove the natural decay (a straight line in dB) before measuring the swing.
      const n = levels.length;
      const mx = (n - 1) / 2;
      const my = levels.reduce((a, b) => a + b, 0) / n;
      let sxy = 0;
      let sxx = 0;
      levels.forEach((y, x) => {
        sxy += (x - mx) * (y - my);
        sxx += (x - mx) ** 2;
      });
      const residual = levels.map((y, x) => y - my - (sxy / sxx) * (x - mx));
      return Math.max(...residual) - Math.min(...residual);
    };
    assert.ok(swing(5) > 4, `motor on: ${swing(5)} dB`);
    assert.ok(swing(0) < 1, `motor off: ${swing(0)} dB`);
  });

  it("gets brighter with velocity", () => {
    const soft = centroid(vib("C5", { velocity: 0.3 }).l, at(0.003));
    const hard = centroid(vib("C5", { velocity: 0.9 }).l, at(0.003));
    assert.ok(hard > soft * 1.1, `centroid ${soft} Hz soft, ${hard} Hz hard`);
  });
});

describe("mallets in a score", () => {
  it("land on the music bus and render deterministically", () => {
    const score = defineScore({
      durationSec: 3,
      grid: createGrid({ fps: 60, bpm: 100 }),
      buses: { music: {} },
      build: (s) => {
        s.pattern("x.x. X.x.", { from: 0, step: 0.25 }, (h) =>
          s.marimba(h.beat, { note: "D5", velocity: h.velocity }),
        );
        s.vibes(2, { note: "F#4", length: 1.5, motor: 3 });
      },
    });
    const a = renderScore(score);
    const b = renderScore(score);
    assert.deepEqual(a.output.l, b.output.l);
    assert.ok(Number.isFinite(a.stats.integrated));
  });
});
