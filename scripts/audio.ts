/**
 * Renders video soundtracks to public/audio/<id>.wav (24-bit PCM, stereo). A video with a
 * narrator (src/videos/<id>/voice.ts) gets its voice track first, with `pnpm voice <id>`: the
 * score reads the voice timing, and the render and the Studio need both WAVs, so every command
 * that builds the audio (pnpm dev, pnpm render) builds the voice too, even on a fresh clone.
 *
 *   pnpm audio                 every src/videos/<id>/score.ts (default export = defineScore(...))
 *   pnpm audio my-video        one video
 *   --verbose                  loudness per bar and bus, onset check of the score marks, silences
 *   --stems                    float WAV per bus and effect return into out/<id>/audio-debug/
 *
 * Exits non-zero on NaN/Infinity, clipping, a true peak over the ceiling, a wrong length, or a file
 * that ffprobe does not decode as pcm_s24le. The previous WAV is only replaced by a verified one.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import {
  encodeWav,
  findOnset,
  firstInvalid,
  isScore,
  loudnessMeter,
  peakDbIn,
  renderScore,
  type RenderResult,
  type Score,
} from "../src/framework/audio";
import { outDir } from "./lib/paths";

const root = process.cwd();
const videosDir = path.join(root, "src", "videos");
const audioDir = path.join(root, "public", "audio");
const ONSET_TOLERANCE_MS = 10;

const fmt = (x: number, digits = 2) => (Number.isFinite(x) ? x.toFixed(digits) : String(x));
const pad = (s: string, n: number) => s.padEnd(n);

/** Decodes the header with ffprobe: the file must be what Chrome and Remotion will read. */
const probeWav = (file: string, sampleRate: number, frames: number): string | null => {
  const args = [
    "-v",
    "error",
    "-select_streams",
    "a:0",
    "-show_entries",
    "stream=codec_name,sample_rate,channels,duration_ts",
    "-of",
    "json",
    file,
  ];
  let res = spawnSync("ffprobe", args, { encoding: "utf8" });
  if (res.error) {
    res = spawnSync("/opt/homebrew/bin/ffprobe", args, { encoding: "utf8" });
  }
  if (res.error) {
    console.warn("  warning         ffprobe not found, decode check skipped");
    return null;
  }
  const stream = (JSON.parse(res.stdout || "{}") as { streams?: Record<string, unknown>[] })
    .streams?.[0];
  const expected = {
    codec_name: "pcm_s24le",
    sample_rate: String(sampleRate),
    channels: 2,
    duration_ts: frames,
  };
  const mismatches = Object.entries(expected).filter(([k, v]) => stream?.[k] !== v);
  return mismatches.length === 0
    ? null
    : `ffprobe: ${mismatches.map(([k, v]) => `${k}=${String(stream?.[k])} (expected ${v})`).join(", ")}`;
};

const printBalance = (score: Score, result: RenderResult) => {
  const secondsPerBar = score.grid.secondsPerBeat * score.grid.beatsPerBar;
  const bars = Math.ceil(score.durationSec / secondsPerBar - 1e-9);
  const header = Array.from({ length: bars }, (_, b) => `bar${b}`.padStart(7)).join("");
  console.log(`\n  loudness per bar (LUFS, ungated)\n  ${pad("", 12)}${header}`);
  const rows: [string, (typeof result)["output"]][] = [["MASTER", result.output], ...result.stems];
  for (const [name, s] of rows) {
    const meter = loudnessMeter(s, result.sampleRate);
    const cells = Array.from({ length: bars }, (_, b) => {
      const v = meter.range(
        b * secondsPerBar,
        Math.min(score.durationSec, (b + 1) * secondsPerBar),
      );
      return (Number.isFinite(v) && v > -70 ? v.toFixed(1) : "-").padStart(7);
    }).join("");
    console.log(`  ${pad(name, 12)}${cells}`);
  }
};

const checkMarks = (result: RenderResult): number => {
  let misses = 0;
  if (result.marks.length === 0) {
    return 0;
  }
  console.log("\n  onsets at score marks (tolerance 10 ms)");
  for (const m of result.marks) {
    const s = m.bus ? (result.stems.get(m.bus) ?? result.output) : result.output;
    const r = findOnset(s, result.sampleRate, m.time);
    const ok = r.errorMs !== null && Math.abs(r.errorMs) <= ONSET_TOLERANCE_MS;
    misses += ok ? 0 : 1;
    console.log(
      `  ${ok ? "ok  " : "MISS"} ${pad(m.label, 26)} ${pad(m.bus ?? "master", 8)} ` +
        `at ${fmt(m.time, 4)} s  onset ${r.detected === null ? "none" : fmt(r.detected, 4)} s  ` +
        `error ${r.errorMs === null ? "-" : fmt(r.errorMs, 2)} ms  rise ${fmt(r.riseDb, 1)} dB`,
    );
  }
  return misses;
};

const renderOne = async (id: string, flags: Set<string>): Promise<string[]> => {
  if (existsSync(path.join(videosDir, id, "voice.ts"))) {
    const voice = spawnSync("pnpm", ["voice", id], { stdio: "inherit" });
    if (voice.status !== 0) {
      return [`${id}: pnpm voice ${id} failed, score not rendered`];
    }
  }
  const file = path.join(videosDir, id, "score.ts");
  const mod = (await import(pathToFileURL(file).href)) as { default?: unknown };
  const score = mod.default;
  if (!isScore(score)) {
    return [`src/videos/${id}/score.ts must default-export defineScore(...)`];
  }
  const verbose = flags.has("--verbose");
  const t0 = performance.now();
  const result = renderScore(
    { ...score, id: score.id ?? id },
    { stems: verbose || flags.has("--stems") },
  );
  const renderMs = performance.now() - t0;
  const { stats, sampleRate, output } = result;
  const ceiling = score.master?.ceiling ?? -1;
  const expected = Math.round(score.durationSec * sampleRate);
  const problems: string[] = [];
  const bad = firstInvalid(output);
  if (bad >= 0) {
    problems.push(`NaN or Infinity at sample ${bad}`);
  }
  if (output.l.length !== expected || output.r.length !== expected) {
    problems.push(`length ${output.l.length} frames, expected ${expected}`);
  }
  if (stats.samplePeak >= 0) {
    problems.push(`clipping: sample peak ${fmt(stats.samplePeak)} dBFS`);
  }
  if (stats.truePeak > ceiling + 0.05) {
    problems.push(`true peak ${fmt(stats.truePeak)} dBTP over the ${ceiling} dBTP ceiling`);
  }

  console.log(`\n${id}`);
  console.log(
    `  duration        ${fmt(output.l.length / sampleRate, 3)} s (${output.l.length} frames @ ${sampleRate} Hz)`,
  );
  console.log(
    `  integrated      ${fmt(stats.integrated)} LUFS (target ${score.master?.targetLufs ?? -14})`,
  );
  console.log(
    `  momentary max   ${fmt(stats.momentaryMax)} LUFS   short-term max ${fmt(stats.shortTermMax)} LUFS   LRA ${fmt(stats.loudnessRange, 1)} LU`,
  );
  console.log(
    `  true peak       ${fmt(stats.truePeak)} dBTP   sample peak ${fmt(stats.samplePeak)} dBFS`,
  );
  console.log(
    `  limiter         ${fmt(stats.limiterReduction)} dB max GR   glue ${fmt(stats.glueReduction)} dB max GR`,
  );
  console.log(
    `  dc offset       L ${stats.dc[0].toExponential(2)}  R ${stats.dc[1].toExponential(2)}`,
  );
  console.log(
    `  render          ${fmt(renderMs / 1000, 2)} s (${stats.iterations} loudness passes)`,
  );

  if (verbose) {
    printBalance(score, result);
    const misses = checkMarks(result);
    if (misses > 0) {
      console.log(`  ${misses} mark(s) without an onset within tolerance`);
    }
    for (const s of result.silences) {
      const p = peakDbIn(output, sampleRate, s.from, s.to);
      console.log(
        `\n  silence ${fmt(s.from, 4)}-${fmt(s.to, 4)} s: peak ${fmt(p)} dBFS ${p === -Infinity ? "(digital zero)" : "(NOT SILENT)"}`,
      );
    }
    const end = output.l.length / sampleRate;
    console.log(
      `  first sample ${output.l[0]}, ${output.r[0]}; last sample ${output.l[output.l.length - 1]}, ${output.r[output.r.length - 1]}`,
    );
    console.log(
      `  peak before the tail fade (${fmt(end - 0.3, 2)}-${fmt(end - 0.1, 2)} s): ${fmt(peakDbIn(output, sampleRate, end - 0.3, end - 0.1))} dBFS`,
    );
  }

  if (problems.length > 0) {
    return problems.map((p) => `${id}: ${p}`);
  }
  mkdirSync(audioDir, { recursive: true });
  const out = path.join(audioDir, `${id}.wav`);
  const tmp = `${out}.tmp`;
  writeFileSync(tmp, encodeWav(output, sampleRate, "pcm24"));
  const probeError = probeWav(tmp, sampleRate, expected);
  if (probeError) {
    rmSync(tmp);
    return [`${id}: ${probeError}`];
  }
  renameSync(tmp, out);
  console.log(`  wrote           ${path.relative(root, out)} (pcm_s24le verified by ffprobe)`);
  if (verbose) {
    const ref = spawnSync(
      "ffmpeg",
      [
        "-hide_banner",
        "-nostats",
        "-i",
        out,
        "-af",
        "ebur128=peak=true:framelog=quiet",
        "-f",
        "null",
        "-",
      ],
      { encoding: "utf8" },
    );
    const pick = (label: string) =>
      new RegExp(`^\\s+${label}:\\s+(-?[\\d.]+)`, "m").exec(ref.stderr ?? "")?.[1] ?? "?";
    console.log(
      `  ffmpeg ebur128  I ${pick("I")} LUFS   LRA ${pick("LRA")} LU   true peak ${pick("Peak")} dBFS`,
    );
  }
  if (result.stems.size > 0) {
    const debugDir = path.join(root, outDir(id, "audio-debug"));
    mkdirSync(debugDir, { recursive: true });
    for (const [name, s] of result.stems) {
      writeFileSync(path.join(debugDir, `${id}-${name}.wav`), encodeWav(s, sampleRate, "float32"));
    }
    console.log(`  stems           ${path.relative(root, debugDir)}/${id}-*.wav`);
  }
  return [];
};

const main = async () => {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const ids = args.filter((a) => !a.startsWith("--"));
  const available = readdirSync(videosDir).filter((d) =>
    existsSync(path.join(videosDir, d, "score.ts")),
  );
  const unknown = ids.filter((id) => !available.includes(id));
  if (unknown.length > 0) {
    throw new Error(
      `No score for: ${unknown.join(", ")} (available: ${available.join(", ") || "none"})`,
    );
  }
  const problems: string[] = [];
  for (const id of ids.length > 0 ? ids : available) {
    problems.push(...(await renderOne(id, flags)));
  }
  if (problems.length > 0) {
    console.error(`\nFAILED, nothing written for these scores:\n  ${problems.join("\n  ")}`);
    process.exitCode = 1;
  }
};

main().catch((err: unknown) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exitCode = 1;
});
