/**
 * __TITLE__ clock. Pick the BPM of the soundtrack first: everything is placed on its grid.
 * Duration = beats * 60 / BPM (at 120 BPM, 24 beats = 12 s).
 */

import { createGrid } from "@/framework/time/grid";
import { defineStoryboard } from "@/framework/time/storyboard";

export const WIDTH = __WIDTH__;
export const HEIGHT = __HEIGHT__;
export const FPS = 60;
export const BPM = 120;

export const grid = createGrid({ fps: FPS, bpm: BPM });

export const storyboard = defineStoryboard(grid, [
  { id: "title", title: "01 Title", start: 0, length: 8 },
  { id: "statement", title: "02 Statement", start: 8, length: 8 },
  { id: "end", title: "03 End", start: 16, length: 8 },
]);

export const DURATION = storyboard.durationInFrames;
