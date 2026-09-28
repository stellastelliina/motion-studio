/**
 * Where the tools read and write, per video. Everything generated for a video lives under
 * out/<video>/ (deletable at any time), everything external it reads under assets/<video>/
 * (outside git). The rules and their reasons are in docs/CONVENTIONS.md, "Dove va cosa".
 */

import { readdirSync } from "node:fs";
import path from "node:path";

const VIDEOS_DIR = path.join("src", "videos");

/** The ids of every video: the folder names under src/videos/. */
export const videoIds = (): string[] =>
  readdirSync(VIDEOS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

/**
 * The video a composition belongs to: compositions are `<video>` or `<video>-<scene>`, so the
 * longest video id the composition starts with wins (a video id may contain dashes).
 */
export const videoOf = (composition: string): string => {
  const match = videoIds()
    .filter((id) => composition === id || composition.startsWith(`${id}-`))
    .sort((a, b) => b.length - a.length)[0];
  if (!match) {
    throw new Error(`"${composition}" is not a composition of any video in ${VIDEOS_DIR}/`);
  }
  return match;
};

/** Generated output of a video: renders at the root, one folder per tool below. */
export const outDir = (video: string, ...sub: string[]) => path.join("out", video, ...sub);

/** External input of a video: voice takes, references. */
export const assetsDir = (video: string, ...sub: string[]) => path.join("assets", video, ...sub);
