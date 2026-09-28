/**
 * Palette colors for shader uniforms. Shaders light in linear space and encode to sRGB by hand
 * (see GLSL_SRGB), so uniforms carry the linear value of the CSS hex.
 */

import { Vector3 } from "three";

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** "#RRGGBB" to linear RGB in [0, 1]. */
export const linearRgb = (hex: string): Vector3 => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) {
    throw new Error(`linearRgb: expected #RRGGBB, got "${hex}"`);
  }
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => toLinear(Number.parseInt(h, 16) / 255));
  return new Vector3(r, g, b);
};
