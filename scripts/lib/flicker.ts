/**
 * Flicker in a rendered file: runs of one to twelve frames whose mean luminance jumps away from
 * both neighbours and comes back. That is the signature of a frame drawn wrong in the full render
 * (the Lens capture dropping an element for an instant) and contact sheets or single stills miss
 * it, because they render each frame on its own. A hard cut jumps and stays, so it is not flicker;
 * an intended one-frame flash is, and the report says where to look.
 */

import { spawnSync } from "node:child_process";

/** Mean-luminance jump, on the 0-255 scale, that counts as leaving the neighbours. */
export const THRESHOLD = 1.2;

/** Longest run that still counts as flicker; longer ones are content changes. */
export const MAX_RUN = 12;

export type FlickerRun = {
  readonly from: number;
  readonly to: number;
  readonly before: number;
  readonly inside: readonly number[];
  readonly after: number;
};

/** The flicker runs in a sequence of per-frame mean luminances. */
export const flickerRuns = (luma: readonly number[]): FlickerRun[] => {
  const runs: FlickerRun[] = [];
  for (let i = 1; i < luma.length - 1; i++) {
    for (let run = 1; run <= MAX_RUN && i + run < luma.length; run++) {
      const before = luma[i - 1];
      const after = luma[i + run];
      const inside = luma.slice(i, i + run);
      const away = inside.every(
        (v) => Math.abs(v - before) > THRESHOLD && Math.abs(v - after) > THRESHOLD,
      );
      if (away && Math.abs(before - after) < THRESHOLD) {
        runs.push({ from: i, to: i + run - 1, before, inside, after });
        break;
      }
    }
  }
  return runs;
};

/** Mean luminance of every frame of a video file, via ffmpeg's signalstats. */
export const lumaOf = (file: string): number[] => {
  const r = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      file,
      "-vf",
      "signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8", maxBuffer: 1 << 28 },
  );
  if (r.status !== 0) {
    throw new Error(`ffmpeg failed on ${file}: ${r.stderr.trim()}`);
  }
  return [...r.stdout.matchAll(/YAVG=([\d.]+)/g)].map((m) => Number(m[1]));
};

export const describeRun = ({ from, to, before, inside, after }: FlickerRun): string =>
  `frames ${from}-${to}: ${before.toFixed(2)} -> ${inside.map((v) => v.toFixed(2)).join(", ")} -> ${after.toFixed(2)}`;
