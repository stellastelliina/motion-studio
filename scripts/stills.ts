/**
 * Visual QA: renders selected frames of a composition and tiles them into one contact sheet.
 *
 *   pnpm stills <composition> [--frames=0,30,90 | --every=15 | --range=100-200:5]
 *                             [--cols=6] [--width=480] [--out=out/<video>/stills]
 *
 * Without a frame selection it samples 24 frames evenly. Each tile is one frame, left to
 * right and top to bottom in ascending order; the frame list is printed so tiles can be mapped
 * back. Single frames stay in `<out>/<composition>/` for close inspection.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { outDir, videoOf } from "./lib/paths";

type Options = {
  composition: string;
  frames?: number[];
  every?: number;
  range?: { from: number; to: number; step: number };
  cols: number;
  width: number;
  out: string;
};

const fail = (message: string): never => {
  console.error(`stills: ${message}`);
  process.exit(1);
};

const parseArgs = (argv: string[]): Options => {
  const [composition, ...rest] = argv;
  if (!composition || composition.startsWith("--")) {
    fail("usage: pnpm stills <composition> [--frames=a,b,c | --every=n | --range=a-b:step]");
  }
  const opts: Options = {
    composition,
    cols: 6,
    width: 480,
    out: outDir(videoOf(composition), "stills"),
  };
  for (const arg of rest) {
    const [key, value = ""] = arg.replace(/^--/, "").split("=");
    if (key === "frames") {
      opts.frames = value.split(",").map((v) => Number.parseInt(v, 10));
    } else if (key === "every") {
      opts.every = Number.parseInt(value, 10);
    } else if (key === "range") {
      const m = /^(\d+)-(\d+)(?::(\d+))?$/.exec(value) ?? fail(`bad --range "${value}"`);
      opts.range = { from: Number(m[1]), to: Number(m[2]), step: Number(m[3] ?? 1) };
    } else if (key === "cols") {
      opts.cols = Number.parseInt(value, 10);
    } else if (key === "width") {
      opts.width = Number.parseInt(value, 10);
    } else if (key === "out") {
      opts.out = value;
    } else {
      fail(`unknown option --${key}`);
    }
  }
  return opts;
};

const durationOf = (composition: string): number => {
  // The CLI prints a table: id, fps, WxH, frames, (seconds).
  const table = execFileSync("pnpm", ["exec", "remotion", "compositions"], { encoding: "utf8" });
  const line = table.split("\n").find((l) => l.trim().split(/\s+/)[0] === composition);
  const frames = Number.parseInt(line?.trim().split(/\s+/)[3] ?? "", 10);
  if (!Number.isFinite(frames)) {
    fail(`composition "${composition}" not found`);
  }
  return frames;
};

const selectFrames = (opts: Options): number[] => {
  if (opts.frames) {
    return opts.frames;
  }
  if (opts.range) {
    const { from, to, step } = opts.range;
    const list: number[] = [];
    for (let f = from; f <= to; f += step) {
      list.push(f);
    }
    return list;
  }
  const total = durationOf(opts.composition);
  if (opts.every) {
    const list: number[] = [];
    for (let f = 0; f < total; f += opts.every) {
      list.push(f);
    }
    return list;
  }
  return Array.from({ length: 24 }, (_, i) => Math.round((i * (total - 1)) / 23));
};

const main = () => {
  const opts = parseArgs(process.argv.slice(2));
  const frames = [...new Set(selectFrames(opts))].sort((a, b) => a - b);
  if (frames.length === 0 || frames.some((f) => !Number.isInteger(f) || f < 0)) {
    fail(`invalid frame selection: ${frames.join(",")}`);
  }
  const dir = path.join(opts.out, opts.composition);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const started = Date.now();
  execFileSync(
    "pnpm",
    [
      "exec",
      "remotion",
      "render",
      opts.composition,
      dir,
      `--frames=${frames.join(",")}`,
      "--image-format=jpeg",
      "--muted",
      "--log=error",
    ],
    { stdio: "inherit" },
  );

  const files = readdirSync(dir)
    .filter((f) => /^element-\d+\.jpe?g$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  if (files.length !== frames.length) {
    fail(`expected ${frames.length} frames, found ${files.length} in ${dir}`);
  }

  const cols = Math.min(opts.cols, files.length);
  const rows = Math.ceil(files.length / cols);
  const sheet = path.join(opts.out, `${opts.composition}-sheet.jpg`);
  const listFile = path.join(dir, "frames.txt");
  execFileSync("bash", [
    "-c",
    `printf "file '%s'\\n" ${files.map((f) => `'${path.resolve(dir, f)}'`).join(" ")} > '${listFile}'`,
  ]);
  execFileSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listFile,
      "-vf",
      `scale=${opts.width}:-1,tile=${cols}x${rows}:padding=4:color=0x222222`,
      "-frames:v",
      "1",
      "-q:v",
      "3",
      sheet,
    ],
    { stdio: "inherit" },
  );
  if (!existsSync(sheet)) {
    fail("ffmpeg did not produce the contact sheet");
  }
  console.log(`frames: ${frames.join(",")}`);
  console.log(
    `sheet:  ${sheet} (${cols}x${rows}, ${((Date.now() - started) / 1000).toFixed(1)} s)`,
  );
};

main();
