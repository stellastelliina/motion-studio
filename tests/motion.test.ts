import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ease, steps } from "@/framework/motion/easing";
import { pulse, lastHit } from "@/framework/motion/pulse";
import { prng, rand } from "@/framework/motion/random";
import { keys, progress, stagger, tween } from "@/framework/motion/tween";

describe("tween", () => {
  it("clamps progress and handles degenerate ranges", () => {
    assert.equal(progress(-5, 0, 10), 0);
    assert.equal(progress(15, 0, 10), 1);
    assert.equal(progress(10, 10, 10), 1);
    assert.equal(progress(9, 10, 10), 0);
  });

  it("tweens with easing end points exact", () => {
    assert.equal(tween(0, 0, 10, 5, 50, ease.out), 5);
    assert.equal(tween(10, 0, 10, 5, 50, ease.out), 50);
  });

  it("keyframes hold outside and interpolate inside", () => {
    const k = [
      [10, 0],
      [20, 100, ease.linear],
      [30, 50, ease.linear],
    ] as const;
    assert.equal(keys(0, k), 0);
    assert.equal(keys(15, k), 50);
    assert.equal(keys(25, k), 75);
    assert.equal(keys(99, k), 50);
    assert.throws(() => keys(0, []));
  });

  it("staggers linearly", () => {
    assert.equal(stagger(3, 2, 10), 16);
  });

  it("steps quantize", () => {
    assert.equal(steps(4)(0.3), 0.25);
    assert.equal(steps(4)(1), 1);
  });
});

describe("pulse", () => {
  it("peaks on hits and decays to about 5% after `decay` frames", () => {
    assert.equal(pulse(10, [10], 12), 1);
    assert.ok(Math.abs(pulse(22, [10], 12) - Math.exp(-3)) < 1e-9);
    assert.equal(pulse(5, [10], 12), 0);
    assert.equal(lastHit(15, [0, 10, 20]), 1);
    assert.equal(lastHit(-1, [0, 10, 20]), -1);
  });
});

describe("random", () => {
  it("is deterministic", () => {
    assert.equal(rand("a", 0, 10), rand("a", 0, 10));
    const a = prng(42);
    const b = prng(42);
    assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  });
});
