/**
 * __TITLE__ soundtrack: a starting sketch placed on the grid and on the cues. Replace the notes
 * and the arrangement, keep the habit: every hit comes from `cues.ts`.
 * Render with `pnpm audio __ID__` (add `--verbose` for balance and onset checks).
 */

import { defineScore } from "@/framework/audio";
import { cues } from "./cues";
import { grid, storyboard } from "./timeline";

export default defineScore({
  id: "__ID__",
  durationSec: storyboard.durationInFrames / grid.fps,
  grid,
  seed: 1,
  buses: {
    drums: { gain: -4, sends: { room: -16 } },
    bass: { gain: -7, monoBelow: 160, sidechain: { key: "kick", depth: 8 } },
    music: { gain: -11, eq: [{ type: "highpass", freq: 150 }], sends: { hall: -8 } },
    sfx: { gain: -6, sends: { room: -14 } },
  },
  effects: {
    room: { type: "reverb", decay: 0.7, size: 0.35 },
    hall: { type: "reverb", decay: 2.2, size: 1 },
  },
  build: (s) => {
    const statement = storyboard.scene("statement");
    const end = storyboard.scene("end");
    const grooveFrom = statement.startBeat;
    const grooveTo = end.startBeat;

    // Title: a pad breathes in under the line, the pluck lands with the word.
    s.pad(0, grooveFrom, { notes: ["C3", "Eb3", "G3", "Bb3"], gain: -8 });
    s.pluck(cues.titleHit, { note: "G4" });

    // Statement: four on the floor, offbeat hats, a sub that follows the chord.
    for (let b = grooveFrom; b < grooveTo; b++) {
      s.kick(b);
      s.hat(b + 0.5, { gain: -8 });
    }
    s.sub(grooveFrom, { note: "C2", length: grooveTo - grooveFrom, gain: -4 });
    cues.statementHits.forEach((hit, i) => {
      s.stab(hit, { notes: i % 2 === 0 ? ["C4", "Eb4", "G4"] : ["Bb3", "D4", "F4"], gain: -6 });
    });
    s.riser(grooveTo - 2, grooveTo, { gain: -8 });

    // End card: one impact, a held chord, then the tail dies on its own.
    s.impact(cues.endHit);
    s.pad(cues.endHit, cues.endHit + 4, { notes: ["Ab2", "C3", "Eb3", "G3"], gain: -6 });
    s.mark("end hit", cues.endHit, "sfx");
  },
});
