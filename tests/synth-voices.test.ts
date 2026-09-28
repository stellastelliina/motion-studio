import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  Drift,
  LowPass24,
  Svf,
  analogPad,
  analogPluck,
  bell,
  choir,
  defineScore,
  firstInvalid,
  fm,
  hz,
  peakOf,
  renderScore,
  rim,
  shaker,
  type Stereo,
} from "@/framework/audio";
import { createGrid } from "@/framework/time/grid";

const SR = 48000;
const env = (seed = 1) => ({ sampleRate: SR, seed });
const at = (seconds: number) => Math.round(seconds * SR);

const rmsDb = (x: Float32Array, from = 0, to = x.length) => {
  let e = 0;
  for (let i = from; i < to; i++) {
    e += (x[i] ?? 0) ** 2;
  }
  return 10 * Math.log10(e / Math.max(1, to - from) + 1e-30);
};

/** Largest sample-to-sample step in [from, to): a click shows up as a jump here. */
const maxStep = (x: Float32Array, from: number, to: number) => {
  let m = 0;
  for (let i = Math.max(1, from); i < Math.min(x.length, to); i++) {
    m = Math.max(m, Math.abs(x[i] - x[i - 1]));
  }
  return m;
};

/** Amplitude of the component at `freq` in a Hann-windowed frame. */
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

/** Spectral centroid of a Hann-windowed frame up to 12 kHz. */
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

/** Every voice buffer: finite, audible, under full scale, starting and ending without a click. */
const assertClean = (s: Stereo, tag: string) => {
  assert.equal(firstInvalid(s), -1, `${tag}: NaN or Infinity`);
  const peak = peakOf(s);
  assert.ok(peak > 1e-4 && peak < 1, `${tag}: peak ${peak}`);
  for (const ch of [s.l, s.r]) {
    assert.ok(ch[ch.length - 1] === 0, `${tag}: the buffer ends in exact zero`);
    assert.ok(Math.abs(ch[0]) < 0.02 * peak + 1e-6, `${tag}: starts at ${ch[0]}`);
    const tail = maxStep(ch, ch.length - at(0.01), ch.length);
    assert.ok(tail < 0.05 * peak + 1e-6, `${tag}: step ${tail} in the last 10 ms`);
  }
};

describe("filters", () => {
  it("LowPass24 passes DC and falls about 24 dB per octave", () => {
    const gainAt = (freq: number) => {
      const f = new LowPass24(SR, 1000);
      let peak = 0;
      for (let i = 0; i < at(0.5); i++) {
        const y = f.process(Math.sin((2 * Math.PI * freq * i) / SR));
        if (i > at(0.3)) {
          peak = Math.max(peak, Math.abs(y));
        }
      }
      return 20 * Math.log10(peak);
    };
    assert.ok(Math.abs(gainAt(50)) < 0.2, `50 Hz ${gainAt(50)} dB`);
    const slope = gainAt(4000) - gainAt(8000);
    assert.ok(slope > 21 && slope < 27, `slope ${slope} dB/oct`);
  });

  it("the SVF stays finite and bounded under audio-rate cutoff modulation", () => {
    const f = new Svf("lowpass", SR, 1000, 4);
    let peak = 0;
    for (let i = 0; i < at(1); i++) {
      f.set(2000 + 1900 * Math.sin((2 * Math.PI * 300 * i) / SR), 4);
      const y = f.process(i % 97 < 48 ? 1 : -1);
      assert.ok(Number.isFinite(y));
      peak = Math.max(peak, Math.abs(y));
    }
    assert.ok(peak < 10, `peak ${peak}`);
  });

  it("Drift is deterministic, bounded and slow", () => {
    const a = new Drift(5, 0.2, SR);
    const b = new Drift(5, 0.2, SR);
    let maxDiff = 0;
    let prev = a.next();
    b.next();
    for (let i = 0; i < at(20); i++) {
      const x = a.next();
      assert.equal(x, b.next());
      assert.ok(Math.abs(x) <= 1);
      maxDiff = Math.max(maxDiff, Math.abs(x - prev));
      prev = x;
    }
    assert.ok(maxDiff < 1e-3, `largest step ${maxDiff}`);
  });
});

describe("analog pad", () => {
  const chord = ["D3", "A3", "C#4", "E4"].map(hz);

  it("is deterministic and clean, with a slow swell", () => {
    const a = analogPad({ freqs: chord, length: 2 }, env(3));
    const b = analogPad({ freqs: chord, length: 2 }, env(3));
    assert.deepEqual(a.l, b.l);
    assertClean(a, "pad");
    assert.ok(rmsDb(a.l, 0, at(0.1)) < rmsDb(a.l, at(1.2), at(1.4)) - 15, "attack is slow");
    assert.ok(a.l.length === at(2) + at(1.8), `release tail ${a.l.length / SR - 2} s`);
    assert.notDeepEqual(a.l, a.r, "stereo");
  });

  it("gets brighter with the cutoff and glides toward cutoffTo", () => {
    const dark = analogPad({ freqs: chord, length: 3, cutoff: 500 }, env());
    const bright = analogPad({ freqs: chord, length: 3, cutoff: 3000 }, env());
    assert.ok(centroid(bright.l, at(1.5)) > centroid(dark.l, at(1.5)) * 1.4);
    const glide = analogPad(
      { freqs: chord, length: 4, cutoff: 400, cutoffTo: 4000, lfoDepth: 0 },
      env(),
    );
    assert.ok(centroid(glide.l, at(3.6)) > centroid(glide.l, at(1.3)) * 1.3);
  });

  it("keeps its air layer above the speech band", () => {
    const air = analogPad({ freqs: [hz("D2")], length: 2, cutoff: 200, air: 1 }, env());
    const none = analogPad({ freqs: [hz("D2")], length: 2, cutoff: 200, air: 0 }, env());
    const diff = air.l.map((x, i) => x - none.l[i]);
    assert.ok(level(diff, at(1), 8000) > 20 * level(diff, at(1), 1000), "air sits above 5 kHz");
  });
});

describe("analog pluck", () => {
  it("is deterministic and clean over its range and velocities", () => {
    for (const note of ["C2", "A3", "E5", "C7"]) {
      for (const velocity of [0.05, 0.6, 1]) {
        const s = analogPluck({ freq: hz(note), velocity }, env(2));
        assertClean(s, `${note} v${velocity}`);
      }
    }
    const a = analogPluck({ freq: hz("A4") }, env(8));
    assert.deepEqual(a.l, analogPluck({ freq: hz("A4") }, env(8)).l);
  });

  it("starts bright and settles, brighter with velocity", () => {
    const s = analogPluck({ freq: hz("A3"), velocity: 0.9 }, env());
    assert.ok(centroid(s.l, at(0.002)) > centroid(s.l, at(0.3)) * 1.5);
    const soft = analogPluck({ freq: hz("A3"), velocity: 0.2 }, env());
    assert.ok(centroid(s.l, at(0.002)) > centroid(soft.l, at(0.002)) * 1.15);
  });

  it("stops over the release when the gate closes", () => {
    const ring = analogPluck({ freq: hz("A3"), decay: 2 }, env());
    const gated = analogPluck({ freq: hz("A3"), decay: 2, length: 0.2, release: 0.1 }, env());
    assert.ok(gated.l.length < ring.l.length / 4);
    assertClean(gated, "gated");
  });
});

describe("fm", () => {
  it("a lone carrier is a sine at the note", () => {
    const s = fm(
      { freq: 440, operators: [{ ratio: 1, level: 0.5 }], length: 0.5, spread: 0 },
      env(),
    );
    assertClean(s, "sine");
    assert.ok(level(s.l, at(0.1), 440) > 100 * level(s.l, at(0.1), 880));
  });

  it("a modulator adds sidebands at the carrier plus and minus its frequency", () => {
    const plain = fm(
      { freq: 400, operators: [{ ratio: 1, level: 0.5 }], length: 0.5, spread: 0 },
      env(),
    );
    const mod = fm(
      {
        freq: 400,
        operators: [
          { ratio: 1, level: 0.5 },
          { ratio: 3.5, level: 1.5 },
        ],
        length: 0.5,
        spread: 0,
      },
      env(),
    );
    const side = level(mod.l, at(0.1), 400 * 4.5);
    assert.ok(side > 30 * level(plain.l, at(0.1), 400 * 4.5), "upper sideband at 4.5 f");
    assert.ok(level(mod.l, at(0.1), 400 * 2.5) > 30 * level(plain.l, at(0.1), 400 * 2.5));
  });

  it("validates its algorithm", () => {
    assert.throws(() => fm({ freq: 440, operators: [], length: 1 }, env()), /1 to 4/);
    assert.throws(
      () =>
        fm(
          { freq: 440, operators: [{ level: 1 }, { level: 1 }], routes: [[0, 1]], length: 1 },
          env(),
        ),
      /invalid route/,
    );
    assert.throws(() => fm({ freq: 440, operators: [{ level: 1 }] }, env()), /gate/);
  });

  it("is deterministic and clean, gated or ringing out", () => {
    const o = {
      freq: 330,
      operators: [
        { ratio: 1, level: 0.6, decay: 1.2 },
        { ratio: 2, level: 2, decay: 0.2, feedback: 0.3 },
      ],
    };
    const a = fm(o, env(4));
    assert.deepEqual(a.l, fm(o, env(4)).l);
    assertClean(a, "ring");
    assertClean(fm({ ...o, length: 0.3 }, env(4)), "gated");
  });
});

describe("bell", () => {
  it("strikes inharmonic and rings out nearly pure", () => {
    const f = hz("A5");
    const s = bell({ freq: f, decay: 5 }, env());
    assertClean(s, "bell");
    const early = level(s.l, at(0.005), 2.5 * f) / level(s.l, at(0.005), f);
    const late = level(s.l, at(2.5), 2.5 * f) / level(s.l, at(2.5), f);
    assert.ok(early > 0.1, `2.5 f at the strike ${early}`);
    assert.ok(late < early / 10, `2.5 f late ${late}`);
    assert.ok(rmsDb(s.l, at(3), at(3.2)) > rmsDb(s.l, 0, at(0.2)) - 40, "long ring");
  });

  it("is deterministic and bounded over its range", () => {
    for (const note of ["C4", "A5", "C7"]) {
      assertClean(bell({ freq: hz(note), velocity: 1, brightness: 1 }, env()), note);
    }
    assert.deepEqual(bell({ freq: 880 }, env(2)).r, bell({ freq: 880 }, env(2)).r);
  });
});

describe("choir", () => {
  it("is deterministic and clean", () => {
    const o = {
      freqs: ["D4", "A4"].map(hz),
      length: 1.5,
      vowel: "u" as const,
      vowelTo: "a" as const,
    };
    const a = choir(o, env(6));
    assert.deepEqual(a.l, choir(o, env(6)).l);
    assertClean(a, "choir");
  });

  it("holds the same loudness across registers and vowels", () => {
    const levels: number[] = [];
    for (const note of ["D3", "A3", "D4", "A4", "E5", "A5"]) {
      for (const vowel of ["a", "u", "i"] as const) {
        levels.push(
          rmsDb(choir({ freqs: [hz(note)], length: 1.5, vowel }, env()).l, at(0.9), at(1.5)),
        );
      }
    }
    const spread = Math.max(...levels) - Math.min(...levels);
    assert.ok(spread < 4, `spread ${spread} dB`);
  });

  it("follows the vowel: 'ah' carries far more energy near 1.1 kHz than 'oo'", () => {
    const f = hz("A3");
    const band = (vowel: "a" | "u") => {
      const s = choir({ freqs: [f], length: 1.5, vowel, vibrato: 0 }, env()).l;
      let e = 0;
      for (let h = 4; h <= 6; h++) {
        e += level(s, at(1), h * f, 8192) ** 2;
      }
      return e;
    };
    assert.ok(band("a") > 5 * band("u"));
  });
});

describe("shaker and rim", () => {
  it("are deterministic and clean", () => {
    for (const velocity of [0.2, 1]) {
      assertClean(shaker({ velocity }, env()), `shaker ${velocity}`);
      assertClean(rim({ velocity }, env()), `rim ${velocity}`);
    }
    assert.deepEqual(shaker({}, env(3)).l, shaker({}, env(3)).l);
  });

  it("the shaker lives above 3 kHz, the rim rings at its tune", () => {
    const s = shaker({ velocity: 1 }, env()).l;
    assert.ok(centroid(s, at(0.005), 1024) > 4000);
    const r = rim({ tune: 480 }, env()).l;
    assert.ok(level(r, 0, 480, 2048) > 3 * level(r, 0, 1000, 2048));
  });
});

describe("new voices in a score", () => {
  it("land on their family buses and render deterministically", () => {
    const score = defineScore({
      durationSec: 4,
      grid: createGrid({ fps: 60, bpm: 100 }),
      buses: { music: {}, drums: {}, bass: {} },
      build: (s) => {
        s.analogPad(0, 4, { notes: ["D3", "A3", "E4"] });
        s.choir(0, 3, { notes: ["A3", "E4"], vowel: "u", vowelTo: "a" });
        s.pattern("x.x. x.x. x.x.", { from: 0, step: 0.25 }, (h) => {
          s.analogPluck(h.beat, { note: "F#4", velocity: h.velocity });
          s.shaker(h.beat, { velocity: h.velocity });
        });
        s.rim(1);
        s.fm(2, {
          note: "E5",
          operators: [
            { level: 0.5, decay: 1 },
            { ratio: 2, level: 1, decay: 0.2 },
          ],
        });
        s.fm(3, { note: "A4", length: 1, operators: [{ level: 0.5 }] });
        s.bell(4, { note: "C#6" });
      },
    });
    const a = renderScore(score);
    const b = renderScore(score);
    assert.deepEqual(a.output.l, b.output.l);
    assert.ok(Number.isFinite(a.stats.integrated));
  });
});
