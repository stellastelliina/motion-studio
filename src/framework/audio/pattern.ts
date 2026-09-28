/**
 * Step patterns and beat ranges. Pure data helpers, safe to import from compositions.
 *
 * Pattern syntax, one character per step: `x` hit, `X` accent, `o` ghost, `1`-`9` velocity in
 * ninths, `.` or `-` rest. Spaces and `|` are ignored, use them to group beats: "x.x. X.x. | ...".
 */

export type PatternHit = {
  readonly beat: number;
  /** Index of the step in the pattern (rests included). */
  readonly step: number;
  /** 0..1. */
  readonly velocity: number;
  readonly accent: boolean;
  readonly char: string;
};

const velocityOf = (c: string): number | null => {
  if (c === "x") {
    return 0.75;
  }
  if (c === "X") {
    return 1;
  }
  if (c === "o") {
    return 0.4;
  }
  if (c >= "1" && c <= "9") {
    return Number(c) / 9;
  }
  if (c === "." || c === "-") {
    return null;
  }
  throw new Error(`Invalid pattern step "${c}"`);
};

/** Expands a step pattern starting at beat `from`, one step every `step` beats. */
export const expandPattern = (pattern: string, from: number, step: number): PatternHit[] => {
  const steps = pattern.replace(/[\s|]/g, "");
  const hits: PatternHit[] = [];
  for (let i = 0; i < steps.length; i++) {
    const c = steps[i];
    const v = velocityOf(c);
    if (v !== null) {
      hits.push({ beat: from + i * step, step: i, velocity: v, accent: c === "X", char: c });
    }
  }
  return hits;
};

/** Beats from `from` (included) to `to` (excluded) every `step`. */
export const beatRange = (from: number, to: number, step: number): number[] => {
  const out: number[] = [];
  for (let k = 0; from + k * step < to - 1e-9; k++) {
    out.push(from + k * step);
  }
  return out;
};
