import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createGrid } from "@/framework/time/grid";
import { defineVoice, layoutVoice, voiceLines, type VoicePlan } from "@/framework/voice/layout";

// 100 BPM: one beat is 0.6 s.
const grid = createGrid({ fps: 60, bpm: 100 });

const plan = (over: Partial<VoicePlan> = {}): VoicePlan =>
  defineVoice({
    take: "test",
    firstBeat: 4,
    quantum: 0.5,
    gap: 0.75,
    tail: 8,
    lufs: -19,
    lines: [
      { id: "one", file: "01", text: "Uno." },
      { id: "two", file: "02", text: "Due." },
      { id: "three", file: "03", text: "Tre.", gapBefore: 3 },
    ],
    ...over,
  });

describe("voice layout", () => {
  it("starts the first line on firstBeat and snaps the next ones up to the quantum", () => {
    // one: 1.5 s = 2.5 beats, ends on beat 6.5; + 0.75 = 7.25, snapped up to 7.5.
    const t = layoutVoice(grid, plan(), { one: 1.5, two: 1.2, three: 0.6 });
    assert.deepEqual(
      t.lines.map((l) => l.start),
      [4, 7.5, 12.5],
    );
    // two ends on 7.5 + 2 = 9.5; + 3 = 12.5, already on the grid.
    assert.equal(t.lines[1].end, 9.5);
  });

  it("does not move a line that already lands on the quantum", () => {
    // one: 1.35 s = 2.25 beats, ends on 6.25; + 0.75 = 7 exactly.
    const t = layoutVoice(grid, plan(), { one: 1.35, two: 1, three: 1 });
    assert.equal(t.lines[1].start, 7);
  });

  it("ends the video on the whole beat after the last line plus the tail", () => {
    const t = layoutVoice(grid, plan(), { one: 1.5, two: 1.2, three: 0.6 });
    // three: 12.5 + 1 = 13.5, + 8 = 21.5, rounded up to 22.
    assert.equal(t.endBeat, 22);
    assert.equal(t.bpm, 100);
  });

  it("rejects a line without a measured length", () => {
    assert.throws(() => layoutVoice(grid, plan(), { one: 1, two: 1 }), /"three"/);
  });

  it("rejects duplicate or non-kebab ids", () => {
    const lines = [
      { id: "a", file: "01", text: "" },
      { id: "a", file: "02", text: "" },
    ];
    assert.throws(() => plan({ lines }), /used twice/);
    assert.throws(() => plan({ lines: [{ id: "Bad Id", file: "01", text: "" }] }), /kebab/);
  });

  it("places the phrases of a line on the beats of the line", () => {
    // one starts on beat 4; a pause from 0.6 s to 0.9 s splits it at beats 5 and 5.5.
    const t = layoutVoice(grid, plan(), {
      one: {
        seconds: 1.5,
        phrases: [
          [0, 0.6],
          [0.9, 1.5],
        ],
      },
      two: 1.2,
      three: 0.6,
    });
    assert.deepEqual(t.lines[0].phrases, [
      { start: 4, end: 5 },
      { start: 5.5, end: 6.5 },
    ]);
    // Without a measure of its pauses a line is one phrase.
    assert.deepEqual(t.lines[1].phrases, [{ start: 7.5, end: 9.5 }]);
  });

  it("looks lines up by id", () => {
    const line = voiceLines(layoutVoice(grid, plan(), { one: 1.5, two: 1.2, three: 0.6 }));
    assert.equal(line("two").start, 7.5);
    assert.throws(() => line("four"), /Unknown voice line/);
  });
});
