/**
 * Handoff contracts between scenes: positions and sizes both sides of a cut read from here,
 * so a match cut stays exact when one side changes.
 */

import { HEIGHT, WIDTH } from "./timeline";

export const CENTER = { x: WIDTH / 2, y: HEIGHT / 2 } as const;

/** The accent dot: end of the title, bullet of the end card. */
export const DOT = { x: CENTER.x, y: CENTER.y, r: 18 } as const;
