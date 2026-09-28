/**
 * Iso-lines of a scalar field sampled on a regular grid (marching squares), joined into
 * polylines so they stroke with clean joins. Pure module: coordinates are in grid units, the
 * caller scales them to its own space.
 */

export type Field = {
  readonly cols: number;
  readonly rows: number;
  /** Row-major samples, `cols * rows` values. */
  readonly values: Float32Array;
};

/** Samples `fn(x, y)` on a grid covering [0, width] x [0, height] every `step` units. */
export const sampleField = (
  width: number,
  height: number,
  step: number,
  fn: (x: number, y: number) => number,
): Field => {
  const cols = Math.ceil(width / step) + 1;
  const rows = Math.ceil(height / step) + 1;
  const values = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      values[j * cols + i] = fn(i * step, j * step);
    }
  }
  return { cols, rows, values };
};

// Edge ids: horizontal edge from (i, j) to (i + 1, j) is 2k, vertical edge to (i, j + 1) is 2k + 1.
const hEdge = (cols: number, i: number, j: number) => (j * cols + i) * 2;
const vEdge = (cols: number, i: number, j: number) => (j * cols + i) * 2 + 1;

/**
 * Polylines of `field = level`, as flat [x0, y0, x1, y1, ...] arrays in grid units.
 * Closed loops repeat their first point at the end.
 */
export const isolines = (field: Field, level: number): number[][] => {
  const { cols, rows, values } = field;
  const point = new Map<number, readonly [number, number]>();
  const links = new Map<number, number[]>();
  const segments: [number, number][] = [];

  const cross = (edge: number): number => {
    if (!point.has(edge)) {
      const k = edge >> 1;
      const i = k % cols;
      const j = Math.floor(k / cols);
      const a = values[k];
      const b = edge & 1 ? values[k + cols] : values[k + 1];
      const t = a === b ? 0.5 : (level - a) / (b - a);
      point.set(edge, edge & 1 ? [i, j + t] : [i + t, j]);
    }
    return edge;
  };
  const link = (e0: number, e1: number) => {
    const id = segments.length;
    segments.push([cross(e0), cross(e1)]);
    for (const e of [e0, e1]) {
      const list = links.get(e);
      if (list) {
        list.push(id);
      } else {
        links.set(e, [id]);
      }
    }
  };

  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = values[j * cols + i];
      const b = values[j * cols + i + 1];
      const c = values[(j + 1) * cols + i + 1];
      const d = values[(j + 1) * cols + i];
      const code =
        (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
      if (code === 0 || code === 15) {
        continue;
      }
      const top = hEdge(cols, i, j);
      const right = vEdge(cols, i + 1, j);
      const bottom = hEdge(cols, i, j + 1);
      const left = vEdge(cols, i, j);
      switch (code) {
        case 1:
        case 14:
          link(left, bottom);
          break;
        case 2:
        case 13:
          link(bottom, right);
          break;
        case 3:
        case 12:
          link(left, right);
          break;
        case 4:
        case 11:
          link(top, right);
          break;
        case 6:
        case 9:
          link(top, bottom);
          break;
        case 7:
        case 8:
          link(left, top);
          break;
        case 5:
        case 10: {
          // Saddle: the cell center decides which corners connect.
          const center = (a + b + c + d) / 4 > level;
          if ((code === 5) === center) {
            link(left, top);
            link(bottom, right);
          } else {
            link(left, bottom);
            link(top, right);
          }
          break;
        }
      }
    }
  }

  const used = new Uint8Array(segments.length);
  const walk = (start: number, fromEdge: number): number[] => {
    const out: number[] = [];
    let seg = start;
    let edge = fromEdge;
    const [x0, y0] = point.get(edge)!;
    out.push(x0, y0);
    for (;;) {
      used[seg] = 1;
      const [e0, e1] = segments[seg];
      edge = e0 === edge ? e1 : e0;
      const [x, y] = point.get(edge)!;
      out.push(x, y);
      const next = links.get(edge)?.find((s) => !used[s]);
      if (next === undefined) {
        return out;
      }
      seg = next;
    }
  };

  const lines: number[][] = [];
  // Open chains start at edges touched by a single segment (the grid border).
  for (const [edge, list] of links) {
    if (list.length === 1 && !used[list[0]]) {
      lines.push(walk(list[0], edge));
    }
  }
  for (let s = 0; s < segments.length; s++) {
    if (!used[s]) {
      lines.push(walk(s, segments[s][0]));
    }
  }
  return lines;
};

/** Chaikin corner cutting: rounds the facets of a polyline, keeping its endpoints. */
export const chaikin = (line: readonly number[], iterations = 1): number[] => {
  let pts = line.slice();
  for (let it = 0; it < iterations; it++) {
    const n = pts.length / 2;
    if (n < 3) {
      return pts;
    }
    const closed = pts[0] === pts[pts.length - 2] && pts[1] === pts[pts.length - 1];
    const out: number[] = closed ? [] : [pts[0], pts[1]];
    for (let k = 0; k < n - 1; k++) {
      const x0 = pts[2 * k];
      const y0 = pts[2 * k + 1];
      const x1 = pts[2 * k + 2];
      const y1 = pts[2 * k + 3];
      out.push(
        0.75 * x0 + 0.25 * x1,
        0.75 * y0 + 0.25 * y1,
        0.25 * x0 + 0.75 * x1,
        0.25 * y0 + 0.75 * y1,
      );
    }
    if (closed) {
      out.push(out[0], out[1]);
    } else {
      out.push(pts[pts.length - 2], pts[pts.length - 1]);
    }
    pts = out;
  }
  return pts;
};

/** SVG path data of polylines, scaled by `k` and offset by (ox, oy). */
export const polylinesToPath = (lines: readonly (readonly number[])[], k = 1, ox = 0, oy = 0) => {
  let d = "";
  for (const line of lines) {
    for (let p = 0; p < line.length; p += 2) {
      d += `${p === 0 ? "M" : "L"}${(ox + line[p] * k).toFixed(1)} ${(oy + line[p + 1] * k).toFixed(1)}`;
    }
  }
  return d;
};
