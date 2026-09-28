import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defineScore, renderScore, type Stereo } from "@/framework/audio";
import { createGrid } from "@/framework/time/grid";

const SR = 48000;
const grid = createGrid({ fps: 60, bpm: 100 });

/** A steady 200 Hz tone on the "music" bus for the whole score, ducked on `spans`. */
const render = (spans: readonly { start: number; end: number }[]) =>
  renderScore(
    defineScore({
      durationSec: 6,
      grid,
      buses: { music: {} },
      master: { targetLufs: -20, glue: null, fadeIn: 1, fadeOut: 1 },
      build: (s) => {
        s.voice(
          0,
          (env) => {
            const l = new Float32Array(6 * env.sampleRate);
            for (let i = 0; i < l.length; i++) {
              l[i] = 0.3 * Math.sin((2 * Math.PI * 200 * i) / env.sampleRate);
            }
            return { l, r: l };
          },
          { bus: "music" },
        );
        s.duck("music", spans, { depth: 12, attack: 0.25, release: 0.5 });
      },
    }),
  ).output;

const rmsDb = (s: Stereo, fromBeat: number, toBeat: number) => {
  const a = Math.round(grid.seconds(fromBeat) * SR);
  const b = Math.round(grid.seconds(toBeat) * SR);
  let e = 0;
  for (let i = a; i < b; i++) {
    e += s.l[i] ** 2;
  }
  return 10 * Math.log10(e / (b - a));
};

describe("duck", () => {
  it("takes a bus down by its depth during a span and brings it back after the release", () => {
    const out = render([{ start: 3, end: 5 }]);
    const open = rmsDb(out, 0.5, 2.5);
    assert.ok(Math.abs(rmsDb(out, 3.2, 4.8) - (open - 12)) < 0.5, "12 dB down inside");
    assert.ok(Math.abs(rmsDb(out, 6, 8) - open) < 0.3, "back up after the release");
    const fade = rmsDb(out, 2.8, 2.95);
    assert.ok(fade < open - 1 && fade > open - 12, `fades in before the span: ${fade - open} dB`);
  });

  it("merges spans closer than attack plus release instead of pumping", () => {
    const out = render([
      { start: 3, end: 4 },
      { start: 4.5, end: 5.5 },
    ]);
    const open = rmsDb(out, 0.5, 2.5);
    assert.ok(Math.abs(rmsDb(out, 4.05, 4.45) - (open - 12)) < 0.5, "stays down in the breath");
  });

  it("rejects an unknown bus", () => {
    assert.throws(
      () =>
        renderScore(
          defineScore({
            durationSec: 1,
            grid,
            buses: { music: {} },
            build: (s) => s.duck("drums" as "music", [{ start: 0, end: 1 }], { depth: 6 }),
          }),
        ),
      /unknown bus/,
    );
  });
});
