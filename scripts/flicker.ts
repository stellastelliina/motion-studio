/**
 * Flicker scan of a rendered file (see lib/flicker.ts). `pnpm render` runs it on every master;
 * this is for drafts and files rendered by hand.
 *
 *   pnpm flicker <video | file.mp4>
 *
 * With a video id it reads out/<video>/<video>.mp4, or the draft if there is no master. Exits 1
 * when it finds a run.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { describeRun, flickerRuns, lumaOf } from "./lib/flicker";
import { outDir } from "./lib/paths";

const fail = (message: string): never => {
  console.error(`flicker: ${message}`);
  process.exit(1);
};

const arg = process.argv[2] ?? fail("usage: pnpm flicker <video | file.mp4>");
const file = existsSync(arg)
  ? arg
  : ([`${arg}.mp4`, `${arg}-draft.mp4`]
      .map((name) => path.join(outDir(arg), name))
      .find((f) => existsSync(f)) ?? fail(`no file "${arg}" and no render in ${outDir(arg)}/`));

const luma = lumaOf(file);
const runs = flickerRuns(luma);
console.log(`${file}: ${luma.length} frames, ${runs.length} flicker run(s)`);
runs.forEach((r) => console.log(`  ${describeRun(r)}`));
process.exitCode = runs.length ? 1 : 0;
