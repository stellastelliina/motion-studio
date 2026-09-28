import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createGrid } from "@/framework/time/grid";
import { defineStoryboard } from "@/framework/time/storyboard";

describe("grid", () => {
  const grid = createGrid({ fps: 60, bpm: 128 });

  it("maps 32 beats at 128 BPM to exactly 15 s = 900 frames", () => {
    assert.equal(grid.beat(32), 900);
    assert.equal(grid.seconds(32), 15);
    assert.equal(grid.framesPerBeat, 28.125);
  });

  it("rounds fractional beats to the nearest frame and keeps bars consistent", () => {
    assert.equal(grid.beat(1), 28);
    assert.equal(grid.bar(1), grid.beat(4));
    assert.equal(grid.bar(1, 2), grid.beat(6));
  });

  it("spans tile with no gaps", () => {
    const total = [0, 1, 2, 3, 4, 5, 6, 7].reduce((acc, b) => acc + grid.span(b * 4, b * 4 + 4), 0);
    assert.equal(total, grid.beat(32));
  });

  it("inverts beatExact with beatAt", () => {
    assert.equal(grid.beatAt(grid.beatExact(13.5)), 13.5);
  });

  it("rejects nonsense", () => {
    assert.throws(() => createGrid({ fps: 0, bpm: 120 }));
  });
});

describe("storyboard", () => {
  const grid = createGrid({ fps: 30, bpm: 120 });

  it("computes frames and total duration", () => {
    const sb = defineStoryboard(grid, [
      { id: "a", title: "A", start: 0, length: 4 },
      { id: "b", title: "B", start: 4, length: 2, lead: 5 },
    ]);
    assert.equal(sb.durationInFrames, 90);
    assert.equal(sb.scene("b").from, 60);
    assert.equal(sb.scene("b").durationInFrames, 30);
    assert.equal(sb.scene("b").lead, 5);
  });

  it("refuses gaps, overlaps, duplicates and unknown ids", () => {
    assert.throws(() =>
      defineStoryboard(grid, [
        { id: "a", title: "A", start: 0, length: 4 },
        { id: "b", title: "B", start: 5, length: 2 },
      ]),
    );
    assert.throws(() =>
      defineStoryboard(grid, [
        { id: "a", title: "A", start: 0, length: 4 },
        { id: "a", title: "A2", start: 4, length: 2 },
      ]),
    );
    const sb = defineStoryboard(grid, [{ id: "a", title: "A", start: 0, length: 1 }]);
    assert.throws(() => sb.scene("missing"));
  });

  it("refuses a lead that starts before frame 0", () => {
    assert.throws(() =>
      defineStoryboard(grid, [{ id: "a", title: "A", start: 0, length: 4, lead: 3 }]),
    );
  });
});
