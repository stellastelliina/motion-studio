import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_RUN, flickerRuns } from "../scripts/lib/flicker";

describe("flicker", () => {
  it("finds a single frame that jumps away and comes back", () => {
    const runs = flickerRuns([100, 100, 100, 140, 100, 100]);
    assert.deepEqual(
      runs.map((r) => [r.from, r.to]),
      [[3, 3]],
    );
  });

  it("finds a run of several frames, like an element dropped for ten frames", () => {
    const luma = [100, 100, ...Array(10).fill(92), 100, 100];
    assert.deepEqual(
      flickerRuns(luma).map((r) => [r.from, r.to]),
      [[2, 11]],
    );
  });

  it("ignores a hard cut, which jumps and stays", () => {
    assert.deepEqual(flickerRuns([100, 100, 100, 60, 60, 60]), []);
  });

  it("ignores slow fades and changes longer than the longest run", () => {
    const fade = Array.from({ length: 30 }, (_, i) => 100 - i);
    assert.deepEqual(flickerRuns(fade), []);
    const long = [100, ...Array(MAX_RUN + 1).fill(80), 100];
    assert.deepEqual(flickerRuns(long), []);
  });

  it("ignores noise under the threshold, like grain", () => {
    assert.deepEqual(flickerRuns([100, 100.5, 99.6, 100.4, 99.8, 100]), []);
  });
});
