/**
 * Local font registry. Files live in `public/fonts/` (OFL, license next to each family).
 * Variable faces declare their full axis ranges, so `fontWeight` and `fontStretch` drive the
 * `wght` and `wdth` axes continuously and the browser never synthesizes a fake bold.
 *
 * `loadFont()` holds the render with delayRender until each face is ready.
 */

import { loadFont } from "@remotion/fonts";
import type { CSSProperties } from "react";
import { staticFile } from "remotion";

export const FONT = {
  /** Archivo: grotesque, wght 100-900, wdth 62-125. */
  display: "Archivo",
  /** Instrument Serif: regular and italic, single weight. */
  serif: "Instrument Serif",
  /** Geist Mono: wght 100-900. */
  mono: "Geist Mono",
  /** Manrope: geometric grotesque for headings, wght 200-800. */
  manrope: "Manrope",
  /** Figtree: humanist geometric for text and labels, wght 300-900. */
  figtree: "Figtree",
  /** JetBrains Mono: coding mono, wght 100-800. */
  jetbrains: "JetBrains Mono",
} as const;

export type FontFamily = (typeof FONT)[keyof typeof FONT];

const FACES = [
  {
    family: FONT.display,
    url: "fonts/archivo/Archivo-Variable.ttf",
    weight: "100 900",
    stretch: "62% 125%",
    style: "normal",
  },
  {
    family: FONT.display,
    url: "fonts/archivo/Archivo-Italic-Variable.ttf",
    weight: "100 900",
    stretch: "62% 125%",
    style: "italic",
  },
  {
    family: FONT.serif,
    url: "fonts/instrument-serif/InstrumentSerif-Regular.ttf",
    weight: "400",
    style: "normal",
  },
  {
    family: FONT.serif,
    url: "fonts/instrument-serif/InstrumentSerif-Italic.ttf",
    weight: "400",
    style: "italic",
  },
  {
    family: FONT.mono,
    url: "fonts/geist-mono/GeistMono-Variable.ttf",
    weight: "100 900",
    style: "normal",
  },
  {
    family: FONT.manrope,
    url: "fonts/manrope/Manrope-Variable.ttf",
    weight: "200 800",
    style: "normal",
  },
  {
    family: FONT.jetbrains,
    url: "fonts/jetbrains-mono/JetBrainsMono-Variable.ttf",
    weight: "100 800",
    style: "normal",
  },
  {
    family: FONT.figtree,
    url: "fonts/figtree/Figtree-Variable.ttf",
    weight: "300 900",
    style: "normal",
  },
] as const;

let ready: Promise<void> | null = null;

/**
 * Idempotent: call it at module level in every video that uses these families.
 * The returned promise resolves when every face is usable (text measurement waits on it).
 */
export const loadFonts = (): Promise<void> => {
  if (!ready) {
    ready = Promise.all(FACES.map((face) => loadFont({ ...face, url: staticFile(face.url) }))).then(
      () => undefined,
    );
  }
  return ready;
};

/** Variable-axis style for Archivo-like faces: weight 100-900, width 62-125 (percent). */
export const axes = (weight: number, width = 100): CSSProperties => ({
  fontWeight: Math.round(weight),
  fontStretch: `${width.toFixed(2)}%`,
});
