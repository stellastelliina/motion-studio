import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createStereo,
  defineScore,
  encodeWav,
  integratedLoudness,
  renderScore,
  truePeak,
} from "@/framework/audio";
import { createGrid } from "@/framework/time/grid";

const SR = 48000;

const sine = (freq: number, amplitude: number, seconds: number) => {
  const s = createStereo(Math.round(seconds * SR));
  for (let i = 0; i < s.l.length; i++) {
    const v = amplitude * Math.sin((2 * Math.PI * freq * i) / SR);
    s.l[i] = v;
    s.r[i] = v;
  }
  return s;
};

describe("wav", () => {
  it("writes a plain 24-bit PCM stereo header", () => {
    const bytes = encodeWav(sine(440, 0.5, 0.01), SR);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const ascii = (at: number) => String.fromCharCode(...bytes.slice(at, at + 4));
    assert.equal(ascii(0), "RIFF");
    assert.equal(ascii(8), "WAVE");
    assert.equal(ascii(12), "fmt ");
    assert.equal(view.getUint16(20, true), 1, "WAVE_FORMAT_PCM");
    assert.equal(view.getUint16(22, true), 2, "channels");
    assert.equal(view.getUint32(24, true), SR, "sample rate");
    assert.equal(view.getUint16(34, true), 24, "bits");
    assert.equal(ascii(36), "data");
    assert.equal(view.getUint32(40, true), 480 * 2 * 3, "data size");
    assert.equal(bytes.byteLength, 44 + 480 * 2 * 3);
  });
});

describe("meter", () => {
  it("follows the BS.1770 reference: a 0 dBFS 997 Hz sine reads -3.01 LKFS on one channel", () => {
    const left = sine(997, 1, 3);
    left.r.fill(0);
    const lufs = integratedLoudness(left, SR);
    assert.ok(Math.abs(lufs - -3.01) < 0.15, `got ${lufs}`);
    // On both channels the power doubles: 0 LKFS.
    const both = integratedLoudness(sine(997, 1, 3), SR);
    assert.ok(Math.abs(both) < 0.15, `got ${both}`);
  });

  it("scales with the signal: -20 dB of amplitude is -20 LU", () => {
    const loud = integratedLoudness(sine(997, 1, 3), SR);
    const soft = integratedLoudness(sine(997, 0.1, 3), SR);
    assert.ok(Math.abs(loud - soft - 20) < 0.05, `got ${loud - soft}`);
  });

  it("finds the true peak of a sine close to its amplitude", () => {
    const peak = truePeak(sine(1000, 0.5, 0.2));
    assert.ok(Math.abs(peak - 0.5) < 0.01, `got ${peak}`);
  });
});

describe("score", () => {
  const grid = createGrid({ fps: 60, bpm: 120 });
  const score = defineScore({
    id: "test",
    durationSec: 4,
    grid,
    seed: 7,
    buses: { drums: {}, music: { sends: { room: -10 } }, sfx: {} },
    effects: { room: { type: "reverb", decay: 0.8, size: 0.4 } },
    build: (s) => {
      for (let b = 0; b < 8; b++) {
        s.kick(b);
        s.hat(b + 0.5, { gain: -8 });
      }
      s.pluck(2, { note: "A4" });
      s.impact(6);
    },
  });

  it("renders deterministically, at the requested length, within the ceiling", () => {
    const a = renderScore(score);
    const b = renderScore(score);
    assert.equal(a.frames, 4 * SR);
    assert.equal(a.output.l.length, 4 * SR);
    assert.deepEqual(a.output.l, b.output.l);
    assert.deepEqual(a.output.r, b.output.r);
    assert.ok(truePeak(a.output) <= Math.pow(10, -1 / 20) + 1e-3, "true peak above -1 dBTP");
  });
});
