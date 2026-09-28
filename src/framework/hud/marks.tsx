/**
 * Broadcast furniture: crop marks, timecode and frame counters for HUD overlays.
 */

export type Corner = { readonly x: "left" | "right"; readonly y: "top" | "bottom" };

export const CORNERS: readonly Corner[] = [
  { x: "left", y: "top" },
  { x: "right", y: "top" },
  { x: "left", y: "bottom" },
  { x: "right", y: "bottom" },
];

type CropMarkProps = Corner & {
  /** Arm length (px). */
  readonly arm: number;
  readonly stroke: number;
  /** Distance of the corner point from the frame edges (px). */
  readonly insetX: number;
  readonly insetY: number;
  /** Draw-on progress of the arms, 0-1 (values above 1 extend them). */
  readonly t?: number;
  readonly color: string;
};

/** An L-shaped crop mark whose corner point sits `insetX`/`insetY` from the frame edges. */
export const CropMark: React.FC<CropMarkProps> = ({
  x,
  y,
  arm,
  stroke,
  insetX,
  insetY,
  t = 1,
  color,
}) => {
  const len = arm * t;
  const base: React.CSSProperties = { position: "absolute", backgroundColor: color };
  const hx = x === "left" ? { left: insetX } : { right: insetX };
  const vy = y === "top" ? { top: insetY } : { bottom: insetY };
  return (
    <>
      <div style={{ ...base, ...hx, ...vy, width: len, height: stroke }} />
      <div style={{ ...base, ...hx, ...vy, width: stroke, height: len }} />
    </>
  );
};

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** SMPTE-style timecode hh:mm:ss:ff. */
export const timecode = (frame: number, fps: number) => {
  const f = Math.floor(frame);
  const s = Math.floor(f / fps);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(f % fps)}`;
};

/** 1-based frame counter "0421 / 0900": the last frame reads total/total. */
export const frameCounter = (frame: number, total: number) => {
  const digits = Math.max(4, String(total).length);
  return `${pad(Math.floor(frame) + 1, digits)} / ${pad(total, digits)}`;
};
