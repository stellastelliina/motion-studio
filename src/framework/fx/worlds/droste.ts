/**
 * Droste geometry: a frame that holds a scaled copy of the next frame, which holds the next,
 * forever. Level j+1 lives in the window of level j. Every map is a similarity (translate plus
 * uniform scale), so an infinite zoom is one exponential zoom about the fixed point of the
 * parent-to-child map: the camera never pans, it only scales around that point.
 *
 * Pure module: screen transforms map a level's world coordinates (px of a full frame) to screen.
 */

export type Similarity = {
  readonly x: number;
  readonly y: number;
  /** Screen px per world px. */
  readonly s: number;
};

export type Rect = {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
};

export type DrosteSpec = {
  readonly width: number;
  readonly height: number;
  /** Window center, normalized to the parent frame. */
  readonly cx: number;
  readonly cy: number;
  /** Window width over parent width; the window keeps the parent's aspect ratio. */
  readonly ratio: number;
};

/** The child's window in the parent's world coordinates. */
export const windowRect = (spec: DrosteSpec): Rect => {
  const w = spec.width * spec.ratio;
  const h = spec.height * spec.ratio;
  return { x: spec.cx * spec.width - w / 2, y: spec.cy * spec.height - h / 2, w, h };
};

/** Screen transform of a level's child, given the level's own transform. */
export const childTransform = (parent: Similarity, spec: DrosteSpec): Similarity => {
  const win = windowRect(spec);
  return {
    x: parent.x + parent.s * win.x,
    y: parent.y + parent.s * win.y,
    s: parent.s * spec.ratio,
  };
};

/** The point that stays still while zooming from any level into its child (world px). */
export const fixedPoint = (spec: DrosteSpec): { x: number; y: number } => {
  const win = windowRect(spec);
  return { x: win.x / (1 - spec.ratio), y: win.y / (1 - spec.ratio) };
};

/**
 * Screen transform of `level` when the camera sits at fractional `depth`: at integer depth `k`,
 * level `k` exactly fills the frame. Closed form, so deep levels do not accumulate error.
 */
export const levelAtDepth = (spec: DrosteSpec, depth: number, level: number): Similarity => {
  const s = Math.pow(spec.ratio, level - depth);
  const p = fixedPoint(spec);
  return { x: p.x * (1 - s), y: p.y * (1 - s), s };
};

export const screenRect = (t: Similarity, spec: DrosteSpec): Rect => ({
  x: t.x,
  y: t.y,
  w: t.s * spec.width,
  h: t.s * spec.height,
});

/** True when the level's frame covers the whole screen (shallower levels are hidden). */
export const coversScreen = (t: Similarity, spec: DrosteSpec, eps = 0.5): boolean =>
  t.x <= eps &&
  t.y <= eps &&
  t.x + t.s * spec.width >= spec.width - eps &&
  t.y + t.s * spec.height >= spec.height - eps;

/** A keyframe of a Hermite curve: value `v` at time `t` with slope `m` (value per time unit). */
export type Knot = { readonly t: number; readonly v: number; readonly m: number };

/**
 * Cubic Hermite spline through the knots, extrapolated linearly outside them. Monotone as long
 * as each slope stays within 3x the secant of its segments (Fritsch-Carlson).
 */
export const hermite = (knots: readonly Knot[]) => {
  if (knots.length < 2) {
    throw new Error("hermite() needs at least two knots");
  }
  for (let i = 1; i < knots.length; i++) {
    if (knots[i].t <= knots[i - 1].t) {
      throw new Error("hermite() knots must have strictly increasing times");
    }
  }
  return (t: number): { value: number; slope: number } => {
    const first = knots[0];
    const last = knots[knots.length - 1];
    if (t <= first.t) {
      return { value: first.v + (t - first.t) * first.m, slope: first.m };
    }
    if (t >= last.t) {
      return { value: last.v + (t - last.t) * last.m, slope: last.m };
    }
    let i = 1;
    while (knots[i].t < t) {
      i++;
    }
    const a = knots[i - 1];
    const b = knots[i];
    const h = b.t - a.t;
    const u = (t - a.t) / h;
    const u2 = u * u;
    const u3 = u2 * u;
    const value =
      (2 * u3 - 3 * u2 + 1) * a.v +
      (u3 - 2 * u2 + u) * h * a.m +
      (-2 * u3 + 3 * u2) * b.v +
      (u3 - u2) * h * b.m;
    const slope =
      ((6 * u2 - 6 * u) * a.v) / h +
      (3 * u2 - 4 * u + 1) * a.m +
      ((-6 * u2 + 6 * u) * b.v) / h +
      (3 * u2 - 2 * u) * b.m;
    return { value, slope };
  };
};

/**
 * Landing spline: passes through the knots like `hermite()`, but between two knots the slope is
 * the straight blend of the knot slopes plus a narrow sin^4 bell sized to cover the segment.
 * The motion lingers near each knot (the landing reads) and happens mostly mid-segment (the
 * whoosh). Throws when a segment is too short for its knot slopes (the bell would go negative).
 */
export const landingSpline = (knots: readonly Knot[]) => {
  if (knots.length < 2) {
    throw new Error("landingSpline() needs at least two knots");
  }
  const bells = knots.slice(1).map((b, i) => {
    const a = knots[i];
    const h = b.t - a.t;
    if (h <= 0) {
      throw new Error("landingSpline() knots must have strictly increasing times");
    }
    // Area of sin^4 over [0, 1] is 3/8.
    const bell = ((b.v - a.v) / h - (a.m + b.m) / 2) / (3 / 8);
    if (bell < 0) {
      throw new Error(`landingSpline(): segment ${i} is too short for its knot slopes`);
    }
    return bell;
  });
  const sin4Integral = (u: number) =>
    (3 * u) / 8 -
    Math.sin(2 * Math.PI * u) / (4 * Math.PI) +
    Math.sin(4 * Math.PI * u) / (32 * Math.PI);

  return (t: number): { value: number; slope: number } => {
    const first = knots[0];
    const last = knots[knots.length - 1];
    if (t <= first.t) {
      return { value: first.v + (t - first.t) * first.m, slope: first.m };
    }
    if (t >= last.t) {
      return { value: last.v + (t - last.t) * last.m, slope: last.m };
    }
    let i = 1;
    while (knots[i].t < t) {
      i++;
    }
    const a = knots[i - 1];
    const b = knots[i];
    const bell = bells[i - 1];
    const h = b.t - a.t;
    const u = (t - a.t) / h;
    const s = Math.sin(Math.PI * u);
    const slope = a.m + (b.m - a.m) * u + bell * s * s * s * s;
    const value = a.v + h * (a.m * u + ((b.m - a.m) * u * u) / 2 + bell * sin4Integral(u));
    return { value, slope };
  };
};
