/**
 * Pixel-exact perspective camera: at the neutral pose the z = 0 plane maps 1 world unit to
 * 1 px, x right and y up from the frame center. Anything placed at z = 0 lands on the same
 * pixels as the DOM, so WebGL scenes can match-cut with 2D scenes.
 *
 * Every other pose orbits and dollies around a target; returning to the neutral pose restores
 * the exact mapping.
 */

import { PerspectiveCamera, Vector3 } from "three";

export type Vec3 = readonly [x: number, y: number, z: number];

/** Distance at which a camera with vertical `fov` (degrees) sees `height` px on the z = 0 plane. */
export const pixelDistance = (fov: number, height: number) =>
  height / 2 / Math.tan((fov * Math.PI) / 360);

/** Screen px (origin top-left, y down) to world on the z = 0 plane (origin center, y up). */
export const pxToWorld = (x: number, y: number, width: number, height: number): Vec3 => [
  x - width / 2,
  height / 2 - y,
  0,
];

/**
 * World radius of a sphere centered on the optical axis at z = 0 whose silhouette measures
 * `screenR` px, seen from `distance`. The silhouette of a sphere is the tangent cone, so the
 * sphere is slightly smaller than its projected disc.
 */
export const sphereRadiusForScreen = (screenR: number, distance: number) =>
  (screenR * distance) / Math.hypot(distance, screenR);

export type OrbitPose = {
  /** Camera distance as a multiple of the pixel distance: 1 is the exact mapping. */
  readonly dolly: number;
  /** Orbit around the target, degrees: yaw turns around y, pitch raises the camera. */
  readonly yaw: number;
  readonly pitch: number;
  /** Roll around the view axis, degrees. */
  readonly roll: number;
  /** Look-at point in world units. */
  readonly target: Vec3;
};

export const NEUTRAL_POSE: OrbitPose = { dolly: 1, yaw: 0, pitch: 0, roll: 0, target: [0, 0, 0] };

export const lerpPose = (a: OrbitPose, b: OrbitPose, t: number): OrbitPose => {
  const l = (x: number, y: number) => x + (y - x) * t;
  return {
    dolly: l(a.dolly, b.dolly),
    yaw: l(a.yaw, b.yaw),
    pitch: l(a.pitch, b.pitch),
    roll: l(a.roll, b.roll),
    target: [l(a.target[0], b.target[0]), l(a.target[1], b.target[1]), l(a.target[2], b.target[2])],
  };
};

export type PixelCameraConfig = {
  readonly fov: number;
  readonly width: number;
  readonly height: number;
  readonly near?: number;
  readonly far?: number;
};

/** A camera R3F leaves alone (`manual`): aspect and projection are set here, never on resize. */
export const createPixelCamera = ({
  fov,
  width,
  height,
  near = 10,
  far = 20000,
}: PixelCameraConfig) => {
  const camera = new PerspectiveCamera(fov, width / height, near, far);
  Object.assign(camera, { manual: true });
  applyPose(camera, NEUTRAL_POSE, { fov, width, height });
  return camera;
};

const eye = new Vector3();

export const applyPose = (
  camera: PerspectiveCamera,
  pose: OrbitPose,
  { fov, width, height }: PixelCameraConfig,
) => {
  const d = pixelDistance(fov, height) * pose.dolly;
  const yaw = (pose.yaw * Math.PI) / 180;
  const pitch = (pose.pitch * Math.PI) / 180;
  const [tx, ty, tz] = pose.target;
  eye.set(
    tx + d * Math.sin(yaw) * Math.cos(pitch),
    ty + d * Math.sin(pitch),
    tz + d * Math.cos(yaw) * Math.cos(pitch),
  );
  camera.fov = fov;
  camera.aspect = width / height;
  camera.position.copy(eye);
  camera.up.set(0, 1, 0);
  camera.lookAt(tx, ty, tz);
  camera.rotateZ((pose.roll * Math.PI) / 180);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
};
