/**
 * Lays a recorded narration on the grid of its video.
 *
 *   pnpm voice <video> [--take=<folder>]
 *
 * Reads src/videos/<video>/voice.ts (the plan) and one file per line from
 * assets/<video>/voice/<take>/ (matched by the line's `file` prefix, any format ffmpeg reads).
 * Each line is trimmed to its sound (5 ms RMS windows above -45 dBFS, with 30 ms before and
 * 80 ms after), levelled with a plain gain to the plan's LUFS, faded 10 ms at both ends and
 * placed by `layoutVoice`. Silences of 120 ms or more inside a line split it into phrases, so
 * scenes can hit the second half of a sentence. Writes:
 *   public/audio/<video>-voice.wav          24-bit stereo, 48 kHz, the length of the video
 *   src/videos/<video>/voice.timing.ts      line starts and ends in beats, for scenes and score
 *
 * A line whose sound touches the start or the end of its file is reported: the export probably
 * cut a syllable or a breath, and only a new export can bring it back.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { encodeWav, integratedLoudness, truePeak } from "../src/framework/audio";
import type { Grid } from "../src/framework/time/grid";
import { layoutVoice, type VoicePlan } from "../src/framework/voice/layout";
import { assetsDir } from "./lib/paths";

const SR = 48000;
const THRESHOLD_DB = -45;
const WINDOW = Math.round(0.005 * SR);
const PRE = Math.round(0.03 * SR);
const POST = Math.round(0.08 * SR);
const FADE = Math.round(0.01 * SR);
/** A silence this long inside a line splits it into phrases. */
const PAUSE = Math.round(0.12 * SR);
/** Sound this close to a file edge means the export cut it. */
const EDGE = Math.round(0.015 * SR);

const fail = (message: string): never => {
  console.error(`voice: ${message}`);
  process.exit(1);
};

const [video, ...rest] = process.argv.slice(2);
if (!video || video.startsWith("--")) {
  fail("usage: pnpm voice <video> [--take=<folder>]");
}
const takeArg = rest.find((a) => a.startsWith("--take="))?.slice("--take=".length);

const root = process.cwd();
const videoDir = path.join(root, "src", "videos", video);
const planFile = path.join(videoDir, "voice.ts");
if (!existsSync(planFile)) {
  fail(`${path.relative(root, planFile)} not found`);
}

const main = async () => {
  const { voice: plan } = (await import(pathToFileURL(planFile).href)) as { voice: VoicePlan };
  const { grid } = (await import(pathToFileURL(path.join(videoDir, "timeline.ts")).href)) as {
    grid: Grid;
  };
  const take = takeArg ?? plan.take;
  const takeDir = path.join(root, assetsDir(video, "voice", take));
  if (!existsSync(takeDir)) {
    fail(`${path.relative(root, takeDir)} not found: put one file per line there`);
  }
  const available = readdirSync(takeDir).filter((f) => !f.startsWith("."));

  const decode = (file: string): Float32Array => {
    const res = spawnSync(
      "ffmpeg",
      ["-v", "error", "-i", file, "-f", "f32le", "-ac", "1", "-ar", `${SR}`, "-"],
      {
        maxBuffer: 1 << 30,
      },
    );
    if (res.status !== 0) {
      fail(`ffmpeg could not decode ${file}: ${res.stderr.toString()}`);
    }
    const buf = res.stdout;
    return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4).slice();
  };

  const db = (x: number) => 20 * Math.log10(x + 1e-12);

  type Prepared = {
    id: string;
    samples: Float32Array;
    gainDb: number;
    warnings: string[];
    /** Speech stretches between inner pauses, in seconds from the start of the trimmed line. */
    phrases: [number, number][];
  };

  const prepare = (id: string, prefix: string): Prepared => {
    const matches = available.filter(
      (f) => f.startsWith(`${prefix}_`) || f.startsWith(`${prefix}.`),
    );
    if (matches.length !== 1) {
      fail(
        `line "${id}": expected one file starting with "${prefix}" in ${take}, found ${matches.length}`,
      );
    }
    const raw = decode(path.join(takeDir, matches[0]));
    const windows = Math.floor(raw.length / WINDOW);
    const loud = (w: number) => {
      let sum = 0;
      for (let i = w * WINDOW; i < (w + 1) * WINDOW; i++) {
        sum += raw[i] * raw[i];
      }
      return db(Math.sqrt(sum / WINDOW)) > THRESHOLD_DB;
    };
    let first = 0;
    while (first < windows && !loud(first)) first++;
    let last = windows - 1;
    while (last > first && !loud(last)) last--;
    if (first >= windows) {
      fail(`line "${id}": ${matches[0]} is silent`);
    }
    const on = first * WINDOW;
    const off = (last + 1) * WINDOW;
    const warnings: string[] = [];
    if (on < EDGE) warnings.push("starts at the file edge");
    if (raw.length - off < EDGE) warnings.push("ends at the file edge");

    const cut = raw.slice(Math.max(0, on - PRE), Math.min(raw.length, off + POST));
    const measured = integratedLoudness({ l: cut, r: cut }, SR);
    const gainDb = plan.lufs - measured;
    const gain = 10 ** (gainDb / 20);
    const n = cut.length;
    for (let i = 0; i < n; i++) {
      cut[i] *= gain * Math.min(1, i / FADE, (n - 1 - i) / FADE);
    }
    // Inner pauses: PAUSE or more of windows under the threshold, between the first and last sound.
    const phrases: [number, number][] = [];
    const origin = Math.max(0, on - PRE);
    let from = first;
    let quiet = 0;
    for (let w = first; w <= last; w++) {
      if (loud(w)) {
        if (quiet * WINDOW >= PAUSE) {
          phrases.push([(from * WINDOW - origin) / SR, ((w - quiet) * WINDOW - origin) / SR]);
          from = w;
        }
        quiet = 0;
      } else {
        quiet++;
      }
    }
    phrases.push([(from * WINDOW - origin) / SR, ((last + 1) * WINDOW - origin) / SR]);
    return { id, samples: cut, gainDb, warnings, phrases };
  };

  const prepared = plan.lines.map((l) => prepare(l.id, l.file));
  const measures = Object.fromEntries(
    prepared.map((p) => [p.id, { seconds: p.samples.length / SR, phrases: p.phrases }]),
  );
  const timing = layoutVoice(grid, plan, measures);

  const total = Math.round(grid.seconds(timing.endBeat) * SR);
  const l = new Float32Array(total);
  prepared.forEach((p, i) => {
    const at = Math.round(grid.seconds(timing.lines[i].start) * SR);
    l.set(p.samples.subarray(0, Math.max(0, Math.min(p.samples.length, total - at))), at);
  });
  const track = { l, r: l };
  const peak = db(truePeak(track));
  if (peak > -1) {
    fail(`true peak ${peak.toFixed(1)} dBTP over -1: lower the plan's lufs`);
  }

  const wavFile = path.join(root, "public", "audio", `${video}-voice.wav`);
  writeFileSync(wavFile, encodeWav(track, SR));

  const timingFile = path.join(videoDir, "voice.timing.ts");
  writeFileSync(
    timingFile,
    [
      `/** Generated by \`pnpm voice ${video}\` from voice.ts and the "${take}" take: do not edit. */`,
      "",
      'import type { VoiceTiming } from "@/framework/voice/layout";',
      "",
      `export const timing: VoiceTiming = ${JSON.stringify(
        {
          bpm: timing.bpm,
          lines: timing.lines.map((t) => ({
            ...t,
            end: +t.end.toFixed(4),
            seconds: +t.seconds.toFixed(4),
            phrases: t.phrases.map((ph) => ({
              start: +ph.start.toFixed(4),
              end: +ph.end.toFixed(4),
            })),
          })),
          endBeat: timing.endBeat,
        },
        null,
        2,
      )};`,
      "",
    ].join("\n"),
  );
  spawnSync("pnpm", ["exec", "prettier", "--write", timingFile], { stdio: "ignore" });

  console.log(`\n${video} (${take})`);
  console.log("  line          start (beat / s)   length  phrases   gain   notes");
  prepared.forEach((p, i) => {
    const t = timing.lines[i];
    console.log(
      `  ${p.id.padEnd(13)} ${t.start.toFixed(1).padStart(6)} / ${grid.seconds(t.start).toFixed(2).padStart(6)}` +
        `   ${t.seconds.toFixed(2).padStart(5)} s  ${String(t.phrases.length).padStart(2)} ph  ${p.gainDb >= 0 ? "+" : ""}${p.gainDb.toFixed(1).padStart(4)}   ${p.warnings.join(", ")}`,
    );
  });
  console.log(
    `\n  duration      ${grid.seconds(timing.endBeat).toFixed(2)} s (${timing.endBeat} beats), true peak ${peak.toFixed(1)} dBTP`,
  );
  console.log(
    `  wrote         ${path.relative(root, wavFile)}, ${path.relative(root, timingFile)}`,
  );
};

main().catch((err: unknown) => fail(String(err)));
