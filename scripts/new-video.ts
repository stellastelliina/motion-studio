/**
 * Scaffolds a new video from `templates/video/` and registers it.
 *
 *   pnpm new-video <id> [--title="Launch Teaser"] [--format=landscape|vertical|square]
 *
 * Creates `src/videos/<id>/`, adds it to `src/videos/registry.ts` and renders its first
 * soundtrack, so `pnpm dev` shows it right away with picture and sound.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { FORMATS, type Format, scaffoldVideo, videoNames } from "./lib/video-template";

const fail = (message: string): never => {
  console.error(`new-video: ${message}`);
  process.exit(1);
};

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith("--"));
if (!id || !/^[a-z][a-z0-9-]*$/.test(id)) {
  fail('usage: pnpm new-video <kebab-id> [--title="Title"] [--format=landscape|vertical|square]');
}
const option = (name: string) =>
  args
    .find((a) => a.startsWith(`--${name}=`))
    ?.slice(name.length + 3)
    .replace(/^"|"$/g, "");
const format = (option("format") ?? "landscape") as Format;
if (!(format in FORMATS)) {
  fail(`unknown format "${format}"`);
}
const names = videoNames(id!, option("title"));
const { camel } = names;

const target = path.join("src", "videos", id!);
if (existsSync(target)) {
  fail(`${target} already exists`);
}

scaffoldVideo(target, id!, names, format);

// Register: one import and one array entry.
const registryPath = path.join("src", "videos", "registry.ts");
const registry = readFileSync(registryPath, "utf8");
const importLine = `import { ${camel} } from "./${id}";\n`;
const lastImport = registry.lastIndexOf("import ");
const importEnd = registry.indexOf("\n", lastImport) + 1;
const withImport = registry.slice(0, importEnd) + importLine + registry.slice(importEnd);
const updated = withImport.replace(
  /export const VIDEOS: readonly VideoDefinition\[] = \[([^\]]*)\];/,
  (_, list: string) => {
    // The first video goes into an empty list: no leading comma, which would leave a hole.
    const entries = [list.trim(), camel].filter(Boolean).join(", ");
    return `export const VIDEOS: readonly VideoDefinition[] = [${entries}];`;
  },
);
if (updated === withImport) {
  fail("could not find the VIDEOS array in src/videos/registry.ts");
}
writeFileSync(registryPath, updated);

if (existsSync(path.join(target, "score.ts"))) {
  execFileSync("pnpm", ["audio", id!], { stdio: "inherit" });
}

console.log(`created ${target} (${format}, ${FORMATS[format].width}x${FORMATS[format].height})`);
console.log(
  "next: edit timeline.ts (BPM, scenes), cues.ts, then the scenes; preview with pnpm dev",
);
