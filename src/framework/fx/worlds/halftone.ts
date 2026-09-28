/**
 * Vector halftone: a rotated screen of dots whose area follows a tone field, emitted as one SVG
 * path. Resolution independent, so it stays crisp under any zoom. Pure module.
 */

export type HalftoneOptions = {
  readonly width: number;
  readonly height: number;
  /** Distance between dot centers (px). */
  readonly pitch: number;
  /** Screen angle in degrees (45 is the classic black screen). */
  readonly angle: number;
  /** Ink coverage in [0, 1] at a point; 1 merges the dots into a solid. */
  readonly tone: (x: number, y: number) => number;
  /** Dots smaller than this radius (px) are dropped. */
  readonly minRadius?: number;
};

/** Radius at full tone: slightly past the cell diagonal so a solid tone closes up. */
const FULL = 0.74;

export const halftonePath = ({
  width,
  height,
  pitch,
  angle,
  tone,
  minRadius = 0.35,
}: HalftoneOptions): string => {
  const a = (angle * Math.PI) / 180;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const cx = width / 2;
  const cy = height / 2;
  const reach = Math.hypot(width, height) / 2 + pitch;
  const n = Math.ceil(reach / pitch);
  let d = "";
  for (let j = -n; j <= n; j++) {
    for (let i = -n; i <= n; i++) {
      const x = cx + (i * ux - j * uy) * pitch;
      const y = cy + (i * uy + j * ux) * pitch;
      if (x < -pitch || y < -pitch || x > width + pitch || y > height + pitch) {
        continue;
      }
      const t = tone(x, y);
      if (t <= 0) {
        continue;
      }
      const r = FULL * pitch * Math.sqrt(Math.min(1, t));
      if (r < minRadius) {
        continue;
      }
      const rs = r.toFixed(2);
      d += `M${(x - r).toFixed(1)} ${y.toFixed(1)}a${rs} ${rs} 0 1 0 ${(2 * r).toFixed(2)} 0a${rs} ${rs} 0 1 0 ${(-2 * r).toFixed(2)} 0`;
    }
  }
  return d;
};

/** Bilinear sample of a single-channel raster (values 0-1) stored row-major. */
export const sampleRaster = (
  data: Float32Array,
  cols: number,
  rows: number,
  x: number,
  y: number,
): number => {
  const fx = Math.min(cols - 1.001, Math.max(0, x));
  const fy = Math.min(rows - 1.001, Math.max(0, y));
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  const tx = fx - i;
  const ty = fy - j;
  const k = j * cols + i;
  const top = data[k] * (1 - tx) + data[k + 1] * tx;
  const bottom = data[k + cols] * (1 - tx) + data[k + cols + 1] * tx;
  return top * (1 - ty) + bottom * ty;
};
