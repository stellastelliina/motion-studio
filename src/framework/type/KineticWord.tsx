/**
 * A word split into letters that keep the browser's exact shaping (kerning, letter-spacing),
 * anchored on its baseline, each letter styled by a per-frame function. With `mask` the word
 * is clipped at the baseline, so letters can rise out of a line.
 */

import type { CSSProperties } from "react";
import { baselineOffset, measureGlyphs, type TextStyle, useFontsReady } from "./measure";

type KineticWordProps = {
  readonly text: string;
  readonly font: TextStyle;
  /** Left edge of the word (px). */
  readonly x: number;
  /** Alphabetic baseline (px). */
  readonly baseline: number;
  readonly color: string;
  /** Clip everything below the baseline. */
  readonly mask?: boolean;
  /** Extra style per letter (transforms, opacity, color). */
  readonly letter?: (index: number, count: number) => CSSProperties;
};

export const KineticWord: React.FC<KineticWordProps> = ({
  text,
  font,
  x,
  baseline,
  color,
  mask = false,
  letter,
}) => {
  const ready = useFontsReady();
  if (!ready) {
    return null;
  }
  const glyphs = measureGlyphs(text, font);
  const line = font.fontSize;
  const ascent = baselineOffset(font, line);
  // Room above the baseline for overshoot and accents; below it only when unmasked.
  const above = font.fontSize * 1.6;
  const below = mask ? 0 : font.fontSize * 0.6;
  const last = glyphs[glyphs.length - 1];
  const width = last ? last.x + last.width : 0;

  return (
    <div
      style={{
        position: "absolute",
        left: x - font.fontSize,
        top: baseline - above,
        width: width + font.fontSize * 2,
        height: above + below,
        overflow: mask ? "hidden" : "visible",
        pointerEvents: "none",
      }}
    >
      {glyphs.map((g, i) => (
        <span
          key={`${g.char}-${i}`}
          style={{
            position: "absolute",
            left: font.fontSize + g.x,
            top: above - ascent,
            lineHeight: `${line}px`,
            whiteSpace: "pre",
            fontFamily: font.fontFamily,
            fontSize: font.fontSize,
            fontWeight: font.fontWeight ?? 400,
            fontStretch: `${font.fontStretch ?? 100}%`,
            fontStyle: font.fontStyle ?? "normal",
            letterSpacing: font.letterSpacing ?? 0,
            color,
            transformOrigin: "50% 100%",
            ...letter?.(i, glyphs.length),
          }}
        >
          {g.char}
        </span>
      ))}
    </div>
  );
};
