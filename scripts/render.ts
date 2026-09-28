/**
 * Final render of a video. The soundtrack is regenerated first because the edit embeds it:
 * rendering never ships a stale mix.
 *
 *   pnpm render <video> [--draft] [--prores] [--frames=a-b]
 *
 * Master:  out/<video>/<video>.mp4, H.264 High, yuv420p, CRF 16, PNG intermediate frames, AAC 320 kb/s.
 * Share:   out/<video>/<video>-web.mp4, HEVC CRF 24 from the master, about 40% of its size.
 * --prores also writes out/<video>/<video>.mov (ProRes 422 HQ) for grading or editing elsewhere.
 * --draft  writes out/<video>/<video>-draft.mp4: half scale, JPEG frames, CRF 24, fast preset.
 * A full render also writes out/<video>/<video>-poster.png, the last frame, for thumbnails and pages.
 * Every output is probed with ffprobe: codec, size, frame rate and duration are printed, and a
 * missing video or audio stream fails the render. The first output is then scanned for flicker
 * (scripts/lib/flicker.ts): a run is reported, not fatal, because a one-frame flash may be intended.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { describeRun, flickerRuns, lumaOf } from "./lib/flicker";
import { outDir } from "./lib/paths";

const fail = (message: string): never => {
  console.error(`render: ${message}`);
  process.exit(1);
};

const args = process.argv.slice(2);
const video =
  args.find((a) => !a.startsWith("--")) ??
  fail("usage: pnpm render <video> [--draft] [--prores] [--frames=a-b]");
const draft = args.includes("--draft");
const prores = args.includes("--prores");
const frames = args.find((a) => a.startsWith("--frames="));
const unknown = args.filter(
  (a) => a.startsWith("--") && !["--draft", "--prores"].includes(a) && !a.startsWith("--frames="),
);
if (unknown.length > 0) {
  fail(`unknown option(s): ${unknown.join(" ")}`);
}

const run = (cmd: string, cmdArgs: string[]) => execFileSync(cmd, cmdArgs, { stdio: "inherit" });

const probe = (file: string) => {
  const json = execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,codec_name,r_frame_rate,width,height:format=duration",
      "-of",
      "json",
      file,
    ],
    { encoding: "utf8" },
  );
  return JSON.parse(json) as {
    streams: {
      codec_type: string;
      codec_name: string;
      r_frame_rate?: string;
      width?: number;
      height?: number;
    }[];
    format: { duration: string };
  };
};

mkdirSync(outDir(video), { recursive: true });
const started = Date.now();

// 1. Soundtrack, always fresh.
if (existsSync(path.join("src", "videos", video!, "score.ts"))) {
  run("pnpm", ["audio", video!]);
} else {
  console.warn(`render: no score for "${video}", rendering without a generated soundtrack`);
}

// 2. Picture (+ embedded audio).
const common = [
  "exec",
  "remotion",
  "render",
  video!,
  "--audio-codec=aac",
  "--audio-bitrate=320k",
  "--enforce-audio-track",
  "--log=info",
  ...(frames ? [frames] : []),
];
const outputs: string[] = [];
if (draft) {
  const out = path.join(outDir(video), `${video}-draft.mp4`);
  run("pnpm", [
    ...common,
    out,
    "--codec=h264",
    "--crf=24",
    "--scale=0.5",
    "--image-format=jpeg",
    "--x264-preset=veryfast",
  ]);
  outputs.push(out);
} else {
  const out = path.join(outDir(video), `${video}.mp4`);
  run("pnpm", [
    ...common,
    out,
    "--codec=h264",
    "--crf=16",
    "--pixel-format=yuv420p",
    "--image-format=png",
    "--x264-preset=slow",
  ]);
  outputs.push(out);
  // Share copy: grain and particles are expensive for H.264 (a 9 Mbit/s cap smears them), HEVC
  // keeps them at about 40% of the master's size. Tagged hvc1 for QuickTime and browsers.
  const web = path.join(outDir(video), `${video}-web.mp4`);
  run("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    out,
    "-c:v",
    "libx265",
    "-preset",
    "slow",
    "-crf",
    "24",
    "-tag:v",
    "hvc1",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    web,
  ]);
  outputs.push(web);
  if (prores) {
    const mov = path.join(outDir(video), `${video}.mov`);
    run("pnpm", [...common, mov, "--codec=prores", "--prores-profile=hq", "--image-format=png"]);
    outputs.push(mov);
  }
}

// 3. Poster: the last frame is designed to hold as a still.
if (!draft && !frames) {
  const probeFrames = execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-count_packets",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=nb_read_packets",
      "-of",
      "csv=p=0",
      outputs[0],
    ],
    { encoding: "utf8" },
  );
  const last = Number.parseInt(probeFrames.trim(), 10) - 1;
  const poster = path.join(outDir(video), `${video}-poster.png`);
  run("pnpm", ["exec", "remotion", "still", video!, poster, `--frame=${last}`, "--log=error"]);
  console.log(`${poster}: frame ${last}`);
}

// 4. Verify what we ship.
for (const out of outputs) {
  const info = probe(out);
  const v = info.streams.find((s) => s.codec_type === "video") ?? fail(`${out}: no video stream`);
  const a = info.streams.find((s) => s.codec_type === "audio") ?? fail(`${out}: no audio stream`);
  const mb = (statSync(out).size / 1024 / 1024).toFixed(1);
  console.log(
    `${out}: ${v.codec_name} ${v.width}x${v.height} @ ${v.r_frame_rate}, ${a.codec_name}, ` +
      `${Number(info.format.duration).toFixed(3)} s, ${mb} MB`,
  );
}
// 5. Flicker: frames drawn wrong only in the full render, which no still shows.
const runs = flickerRuns(lumaOf(outputs[0]));
if (runs.length > 0) {
  console.warn(
    `render: ${runs.length} flicker run(s) in ${outputs[0]}, check each one is intended:`,
  );
  runs.forEach((r) => console.warn(`  ${describeRun(r)}`));
} else {
  console.log(`${outputs[0]}: no flicker`);
}
console.log(`done in ${((Date.now() - started) / 1000).toFixed(0)} s`);
