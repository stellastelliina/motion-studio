/**
 * The video template and its placeholders, shared by `pnpm new-video` (scaffolds into
 * src/videos/) and `scripts/check-template.ts` (scaffolds into out/ to typecheck the result), so
 * the check always sees exactly what a new video gets.
 */

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export const TEMPLATE_DIR = path.join("templates", "video");

export const FORMATS = {
  landscape: { width: 1920, height: 1080 },
  vertical: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
} as const;

export type Format = keyof typeof FORMATS;

export type VideoNames = { title: string; pascal: string; camel: string };

/** Display title, component name and export name derived from a kebab-case id. */
export const videoNames = (id: string, title?: string): VideoNames => {
  const words = id.split("-").map((w) => w[0].toUpperCase() + w.slice(1));
  const pascal = words.join("");
  return {
    title: title ?? words.join(" "),
    pascal,
    camel: pascal[0].toLowerCase() + pascal.slice(1),
  };
};

/** Copies the template into `target`, filling every placeholder. */
export const scaffoldVideo = (target: string, id: string, names: VideoNames, format: Format) => {
  const replacements: Record<string, string> = {
    __ID__: id,
    __TITLE__: names.title,
    __TITLE_UPPER__: names.title.toUpperCase(),
    __COMPONENT__: names.pascal,
    __CAMEL__: names.camel,
    __WIDTH__: String(FORMATS[format].width),
    __HEIGHT__: String(FORMATS[format].height),
  };
  const copy = (from: string, to: string) => {
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from)) {
      const src = path.join(from, entry);
      const dst = path.join(to, entry);
      if (statSync(src).isDirectory()) {
        copy(src, dst);
        continue;
      }
      let text = readFileSync(src, "utf8");
      for (const [key, value] of Object.entries(replacements)) {
        text = text.split(key).join(value);
      }
      writeFileSync(dst, text);
    }
  };
  copy(TEMPLATE_DIR, target);
};
