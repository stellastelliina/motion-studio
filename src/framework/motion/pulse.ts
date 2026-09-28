/**
 * Beat-reactive envelopes: react to hits coming from the grid or from the score.
 */

/** 1 on a hit, exponential decay after it (`decay` = frames to fall to about 5%). */
export const pulse = (frame: number, hits: readonly number[], decay = 12, attack = 0) => {
  let v = 0;
  for (const h of hits) {
    const d = frame - h;
    let e = 0;
    if (d >= 0) {
      e = Math.exp((-3 * d) / decay);
    } else if (attack > 0 && d > -attack) {
      e = 1 + d / attack;
    }
    if (e > v) {
      v = e;
    }
  }
  return v;
};

/** Index of the last hit at or before `frame`, -1 before the first one. */
export const lastHit = (frame: number, hits: readonly number[]) => {
  let idx = -1;
  hits.forEach((h, i) => {
    if (h <= frame) {
      idx = i;
    }
  });
  return idx;
};
