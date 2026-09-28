/**
 * Text measurement in the real layout engine, for layouts that depend on glyph metrics
 * (justifying a word by animating its width axis, fitting a word to a box, framing a word).
 *
 * `useFontsReady()` holds the frame until the fonts are loaded, so measurements taken after it
 * returns true are exact and identical on every render.
 */

import { useEffect, useState } from "react";
import { useDelayRender } from "remotion";
import { loadFonts } from "./fonts";

export type TextStyle = {
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly fontWeight?: number;
  /** Width axis in percent (e.g. 62-125 for Archivo). */
  readonly fontStretch?: number;
  readonly fontStyle?: "normal" | "italic";
  readonly letterSpacing?: number;
};

export type TextBox = {
  readonly width: number;
  /** Distance from the top of the line box to the alphabetic baseline. */
  readonly ascent: number;
  /** Height of capital letters (from the baseline). */
  readonly capHeight: number;
};

const cache = new Map<string, TextBox>();
const baselineCache = new Map<string, number>();

const keyOf = (text: string, s: TextStyle) =>
  [text, s.fontFamily, s.fontSize, s.fontWeight, s.fontStretch, s.fontStyle, s.letterSpacing].join(
    "|",
  );

const applyStyle = (el: HTMLElement, style: TextStyle) => {
  Object.assign(el.style, {
    position: "absolute",
    visibility: "hidden",
    whiteSpace: "pre",
    fontFamily: style.fontFamily,
    fontSize: `${style.fontSize}px`,
    fontWeight: String(style.fontWeight ?? 400),
    fontStretch: `${style.fontStretch ?? 100}%`,
    fontStyle: style.fontStyle ?? "normal",
    letterSpacing: `${style.letterSpacing ?? 0}px`,
  });
};

export type Glyph = {
  readonly char: string;
  /** Left edge relative to the start of the word, kerning included. */
  readonly x: number;
  readonly width: number;
};

/** Per-character boxes of `text` as shaped by the browser (kerning and letter-spacing kept). */
export const measureGlyphs = (text: string, style: TextStyle): readonly Glyph[] => {
  const span = document.createElement("span");
  applyStyle(span, style);
  span.style.lineHeight = "1";
  span.textContent = text;
  document.body.appendChild(span);
  const node = span.firstChild;
  const origin = span.getBoundingClientRect().left;
  const range = document.createRange();
  const glyphs = [...text].map((char, i) => {
    if (!node) {
      return { char, x: 0, width: 0 };
    }
    range.setStart(node, i);
    range.setEnd(node, i + 1);
    const r = range.getBoundingClientRect();
    return { char, x: r.left - origin, width: r.width };
  });
  document.body.removeChild(span);
  return glyphs;
};

/** Distance from the top of a line box of height `lineHeight` to the alphabetic baseline. */
export const baselineOffset = (style: TextStyle, lineHeight = style.fontSize): number => {
  const key = `${keyOf("", style)}|${lineHeight}`;
  const hit = baselineCache.get(key);
  if (hit !== undefined) {
    return hit;
  }
  const line = document.createElement("div");
  applyStyle(line, style);
  line.style.lineHeight = `${lineHeight}px`;
  line.textContent = "H";
  const strut = document.createElement("span");
  Object.assign(strut.style, { display: "inline-block", width: "0", height: "0" });
  line.appendChild(strut);
  document.body.appendChild(line);
  const offset = strut.offsetTop;
  document.body.removeChild(line);
  baselineCache.set(key, offset);
  return offset;
};

/** Measures `text` with `style`. Only call once `useFontsReady()` is true. */
export const measureText = (text: string, style: TextStyle): TextBox => {
  const key = keyOf(text, style);
  const hit = cache.get(key);
  if (hit) {
    return hit;
  }
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const span = document.createElement("span");
  Object.assign(span.style, {
    position: "absolute",
    visibility: "hidden",
    whiteSpace: "pre",
    lineHeight: "1",
    fontFamily: style.fontFamily,
    fontSize: `${style.fontSize}px`,
    fontWeight: String(style.fontWeight ?? 400),
    fontStretch: `${style.fontStretch ?? 100}%`,
    fontStyle: style.fontStyle ?? "normal",
    letterSpacing: `${style.letterSpacing ?? 0}px`,
  });
  span.textContent = text;
  document.body.appendChild(span);
  const width = span.getBoundingClientRect().width;
  document.body.removeChild(span);

  let ascent = style.fontSize * 0.9;
  let capHeight = style.fontSize * 0.7;
  if (ctx) {
    ctx.font = `${style.fontStyle ?? "normal"} ${style.fontWeight ?? 400} ${style.fontSize}px "${style.fontFamily}"`;
    const m = ctx.measureText("H");
    capHeight = m.actualBoundingBoxAscent;
    ascent = m.fontBoundingBoxAscent;
  }
  const box = { width, ascent, capHeight };
  cache.set(key, box);
  return box;
};

/**
 * Variable-font justification: the width-axis value (within [min, max]) at which `text`
 * measures `target` px. Clamps when the target is out of reach.
 */
export const fitWidthAxis = (
  text: string,
  style: TextStyle,
  target: number,
  [min, max]: readonly [number, number],
): number => {
  let lo = min;
  let hi = max;
  if (measureText(text, { ...style, fontStretch: lo }).width >= target) {
    return lo;
  }
  if (measureText(text, { ...style, fontStretch: hi }).width <= target) {
    return hi;
  }
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (measureText(text, { ...style, fontStretch: mid }).width < target) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
};

/** True once every registered font face is loaded; holds the render until then. */
export const useFontsReady = (): boolean => {
  const [ready, setReady] = useState(false);
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  useEffect(() => {
    if (ready) {
      return;
    }
    const handle = delayRender("Waiting for fonts before measuring text");
    loadFonts()
      .then(() => {
        setReady(true);
        continueRender(handle);
      })
      .catch((err: unknown) => cancelRender(err));
  }, [ready, delayRender, continueRender, cancelRender]);
  return ready;
};
