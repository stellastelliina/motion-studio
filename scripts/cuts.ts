/**
 * Continuity check of every cut of a video: renders the last frame before and the first frame
 * after each scene boundary, measures their similarity (SSIM, via ffmpeg) and tiles the pairs
 * into one sheet. A match cut should score high; a hard cut scores low on purpose.
 *
 *   pnpm cuts <video>
 *
 * Output: a table in the terminal and out/<video>/cuts/sheet.jpg (one row per cut, before and
 * after side by side).
 */

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Storyboard } from "@/framework/time/storyboard";
import { outDir } from "./lib/paths";

const fail = (message: string): never => {
  console.error(`cuts: ${message}`);
  process.exit(1);
};

const main = async () => {
  const video = process.argv[2] ?? fail("usage: pnpm cuts <video>");
  const timelinePath = path.resolve("src", "videos", video, "timeline.ts");
  const { storyboard } = (await import(pathToFileURL(timelinePath).href)) as {
    storyboard?: Storyboard;
  };
  if (!storyboard) {
    fail(`${timelinePath} does not export a storyboard`);
  }
  const cuts = storyboard!.scenes.slice(1).map((s, i) => ({
    from: storyboard!.scenes[i].title,
    to: s.title,
    beat: s.startBeat,
    before: s.from - 1,
    after: s.from,
  }));

  const dir = outDir(video, "cuts");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const frames = cuts.flatMap((c) => [c.before, c.after]);
  execFileSync(
    "pnpm",
    [
      "exec",
      "remotion",
      "render",
      video,
      dir,
      `--frames=${frames.join(",")}`,
      "--image-format=png",
      "--muted",
      "--log=error",
    ],
    { stdio: "inherit" },
  );

  // Remotion pads frame numbers to the digits of the last frame (element-0467.png in a video of
  // 4968 frames): match files by number, not by name.
  const byFrame = new Map(
    readdirSync(dir)
      .map((f) => [/^element-(\d+)\.png$/.exec(f), f] as const)
      .filter(([m]) => m !== null)
      .map(([m, f]) => [Number(m![1]), path.join(dir, f)]),
  );
  const file = (frame: number) =>
    byFrame.get(frame) ?? fail(`frame ${frame} was not rendered into ${dir}`);

  /** Structural similarity of two images (1 = identical). ffmpeg reports it on stderr. */
  const ssim = (a: string, b: string): number => {
    const res = spawnSync(
      "ffmpeg",
      ["-hide_banner", "-i", a, "-i", b, "-lavfi", "ssim", "-f", "null", "-"],
      {
        encoding: "utf8",
      },
    );
    const match = /All:([\d.]+)/.exec(res.stderr ?? "");
    if (res.status !== 0 || !match) {
      fail(`ffmpeg could not compare ${a} and ${b}`);
    }
    return Number(match![1]);
  };

  const rows = cuts.map((c) => {
    const score = ssim(file(c.before), file(c.after));
    const verdict = score >= 0.9 ? "match" : score >= 0.6 ? "soft" : "hard";
    return { ...c, score, verdict };
  });

  const label = (r: (typeof rows)[number]) =>
    `beat ${String(r.beat).padStart(5)}  ${r.from} -> ${r.to}`;
  const width = Math.max(...rows.map((r) => label(r).length)) + 2;
  for (const r of rows) {
    console.log(
      label(r).padEnd(width) +
        `frames ${r.before}/${r.after}  SSIM ${r.score.toFixed(3)}  ${r.verdict}`,
    );
  }

  const sheet = path.join(dir, "sheet.jpg");
  const inputs = frames.flatMap((f) => ["-i", file(f)]);
  const layout = frames.map((_, i) => `${(i % 2) * 640}_${Math.floor(i / 2) * 364}`).join("|");
  const scaled = frames.map((_, i) => `[${i}:v]scale=636:-1[s${i}]`).join(";");
  const stack = `${frames.map((_, i) => `[s${i}]`).join("")}xstack=inputs=${frames.length}:layout=${layout}:fill=0x222222`;
  execFileSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      ...inputs,
      "-filter_complex",
      `${scaled};${stack}`,
      "-frames:v",
      "1",
      "-q:v",
      "3",
      sheet,
    ],
    { stdio: "inherit" },
  );
  console.log(`sheet: ${sheet}`);
};

main().catch((err: unknown) => fail(String(err)));
