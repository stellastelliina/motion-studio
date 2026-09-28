/**
 * Typechecks and lints what `pnpm new-video` generates, so a framework change that breaks the
 * template fails `make check` instead of the next new video.
 *
 *   pnpm check-template
 *
 * The raw template is not valid code until new-video fills its placeholders (`__WIDTH__` is an
 * undefined name, `__COMPONENT__` breaks the hook rules), so it is scaffolded into
 * out/template-check/ (ignored by git, tsc and ESLint) and checked there with the project's
 * compiler options and lint rules. The folder is deleted when both pass and kept for inspection
 * when one fails.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { scaffoldVideo, videoNames } from "./lib/video-template";

const ID = "template-check";
const dir = path.join("out", "template-check");
const target = path.join(dir, ID);

const fail = (message: string): never => {
  console.error(`check-template: ${message}`);
  process.exit(1);
};

rmSync(dir, { recursive: true, force: true });
scaffoldVideo(target, ID, videoNames(ID), "landscape");

// A placeholder new-video does not know would reach the new video as-is.
const files = (from: string): string[] =>
  readdirSync(from).flatMap((entry) => {
    const file = path.join(from, entry);
    return statSync(file).isDirectory() ? files(file) : [file];
  });
const leftovers = files(target).flatMap((file) =>
  [...readFileSync(file, "utf8").matchAll(/__[A-Z][A-Z_]*__/g)].map((m) => `${file}: ${m[0]}`),
);
if (leftovers.length > 0) {
  fail(`unfilled placeholders:\n${leftovers.join("\n")}`);
}

// The root config with this folder as its only input; its `paths` (@/*) still resolve to src/.
writeFileSync(
  path.join(dir, "tsconfig.json"),
  JSON.stringify({ extends: "../../tsconfig.json", include: [`${ID}/**/*`], exclude: [] }),
);
const run = (args: string[]) => spawnSync("pnpm", ["exec", ...args], { stdio: "inherit" });
const types = run(["tsc", "-p", path.join(dir, "tsconfig.json")]).status === 0;
// --no-ignore: out/ is ignored by the lint config, the rules still apply.
const lint = run(["eslint", "--no-ignore", target]).status === 0;
if (!types || !lint) {
  fail(
    `the scaffolded template fails ${types ? "lint" : lint ? "tsc" : "tsc and lint"}; see ${dir}/`,
  );
}
rmSync(dir, { recursive: true, force: true });
console.log("check-template: the scaffolded template typechecks and lints");
