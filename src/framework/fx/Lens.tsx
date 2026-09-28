/**
 * The "camera" every video is filmed through: real shutter motion blur, film grain and an
 * optional WebGL post chain, in a single HtmlInCanvas pass.
 *
 * Motion blur works like a film shutter: the children are rendered `samples` times at
 * fractional frames spread over the shutter interval, then averaged. `samples` can change from
 * frame to frame, so blur is paid for only where things move fast.
 *
 * Constraints (verified on Remotion 4.0.529):
 * - HtmlInCanvas cannot be nested: scenes inside a Lens must not use HtmlInCanvas themselves.
 * - WebGL `effects` and motion blur samples do not mix: with effects in the chain the extra
 *   sample captures come back empty and only the first sample survives. The Lens therefore
 *   applies `effects` only on frames with a single sample. Grain is drawn here in 2D, so it
 *   works in both modes.
 * - Each sample mounts a full copy of the children. Keep samples at 1 while a WebGL canvas is on
 *   screen (every copy would create its own GL context) and keep <Audio> outside the Lens.
 * - Children receive fractional frames when samples > 1: anything discrete (seeds, indices,
 *   instant state changes) must decide on Math.round(frame), so every sample of a frame agrees.
 *   With floor the switch falls mid-shutter and the blur averages two states.
 * - Relies on HtmlInCanvas' internal `_remotionInternalCanvasSiblings` prop, the same mechanism
 *   as @remotion/motion-blur. Remotion is pinned: re-check this file when upgrading.
 * - Renders always support HTML-in-canvas; a Studio browser may not (Chrome needs
 *   chrome://flags/#canvas-draw-element). There the Lens steps aside and shows the plain
 *   picture, without blur, grain or post, instead of failing.
 */

import { useCallback, useRef } from "react";
import { prng } from "@/framework/motion/random";
import {
  Freeze,
  HtmlInCanvas,
  type HtmlInCanvasOnPaint,
  isHtmlInCanvasSupported,
  type HtmlInCanvasProps,
  random,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

type LensProps = {
  readonly width: number;
  readonly height: number;
  /** WebGL post chain, applied only on frames rendered with a single sample. */
  readonly effects?: HtmlInCanvasProps["effects"];
  /** Motion blur samples for this frame, 1 disables blur. */
  readonly samples?: number;
  /** Shutter angle in degrees: 180 is the classic film look, 360 a full-frame smear. */
  readonly shutter?: number;
  /** Film grain strength, 0 disables it. About 0.04-0.08 reads as fine 35 mm grain. */
  readonly grain?: number;
  readonly children: React.ReactNode;
};

const GRAIN_TILE = 256;
const GRAIN_VARIANTS = 6;
let grainTiles: OffscreenCanvas[] | null = null;

/** Gaussian-ish monochrome noise tiles, generated once and deterministically. */
const getGrainTiles = (): OffscreenCanvas[] => {
  if (grainTiles) {
    return grainTiles;
  }
  grainTiles = Array.from({ length: GRAIN_VARIANTS }, (_, v) => {
    const next = prng(0x9e3779b9 + v * 7919);
    const tile = new OffscreenCanvas(GRAIN_TILE, GRAIN_TILE);
    const ctx = tile.getContext("2d");
    if (!ctx) {
      throw new Error("Lens: cannot create the grain tile context");
    }
    const img = ctx.createImageData(GRAIN_TILE, GRAIN_TILE);
    for (let i = 0; i < GRAIN_TILE * GRAIN_TILE; i++) {
      // Sum of three uniforms: a cheap bell curve around mid-grey.
      const n = (next() + next() + next()) / 3 - 0.5;
      const value = Math.max(0, Math.min(255, 128 + n * 255 * 1.6));
      img.data[i * 4] = value;
      img.data[i * 4 + 1] = value;
      img.data[i * 4 + 2] = value;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return tile;
  });
  return grainTiles;
};

const Sample: React.FC<{
  readonly index: number;
  readonly count: number;
  readonly shutterInFrames: number;
  readonly lastFrame: number;
  readonly width: number;
  readonly height: number;
  readonly children: React.ReactNode;
}> = ({ index, count, shutterInFrames, lastFrame, width, height, children }) => {
  const frame = useCurrentFrame();
  const offset = count === 1 ? 0 : ((index + 0.5) / count - 0.5) * shutterInFrames;
  const sampleFrame = Math.max(0, Math.min(lastFrame, frame + offset));
  const primary = index === Math.floor(count / 2);
  return (
    <div
      aria-hidden={!primary}
      {...{ drawable: "" }}
      style={{
        position: "absolute",
        inset: 0,
        width,
        height,
        isolation: "isolate",
        pointerEvents: primary ? "auto" : "none",
      }}
    >
      <Freeze frame={sampleFrame}>{children}</Freeze>
    </div>
  );
};

export const Lens: React.FC<LensProps> = ({
  width,
  height,
  effects,
  samples = 1,
  shutter = 180,
  grain = 0,
  children,
}) => {
  const frame = Math.floor(useCurrentFrame());
  const { durationInFrames } = useVideoConfig();
  if (!Number.isInteger(samples) || samples < 1 || samples > 32) {
    throw new TypeError(`Lens: samples must be an integer in 1..32, got ${samples}`);
  }
  const count = shutter === 0 ? 1 : samples;
  const shutterInFrames = shutter / 360;

  // onPaint must stay referentially stable (a new callback triggers an extra paint), so the
  // per-frame values travel through a ref.
  const live = useRef({ frame, grain });
  live.current = { frame, grain };

  const onPaint: HtmlInCanvasOnPaint = useCallback(({ canvas, element, elementImage }) => {
    // Half-float accumulation: in 8 bits every sample's 1/N contribution is rounded, and with
    // 24 samples a #0E0E10 ink drifts to #191919.
    const ctx = canvas.getContext("2d", {
      colorType: "float16",
    } as CanvasRenderingContext2DSettings);
    if (!ctx) {
      throw new Error("Lens: failed to acquire a 2D context");
    }
    const layoutCanvas = element.parentElement;
    if (!(layoutCanvas instanceof HTMLCanvasElement)) {
      throw new Error("Lens: HTML-in-canvas layout canvas not found");
    }
    const captures = Array.from(layoutCanvas.children);
    const n = Math.max(1, captures.length);
    ctx.reset();
    ctx.globalCompositeOperation = n === 1 ? "source-over" : "lighter";
    ctx.globalAlpha = 1 / n;
    captures.forEach((node, i) => {
      const image = i === 0 ? elementImage : layoutCanvas.captureElementImage(node);
      try {
        const transform = ctx.drawElementImage(image, 0, 0);
        if (i === Math.floor(n / 2) && node instanceof HTMLElement) {
          node.style.transform = transform.toString();
        }
      } finally {
        if (i !== 0) {
          image.close();
        }
      }
    });

    const { frame: f, grain: amount } = live.current;
    if (amount > 0) {
      const tiles = getGrainTiles();
      const pattern = ctx.createPattern(tiles[f % tiles.length], "repeat");
      if (pattern) {
        // A fresh offset every frame so the grain never crawls in a visible direction.
        pattern.setTransform(
          new DOMMatrix().translate(
            Math.floor(random(`gx${f}`) * GRAIN_TILE),
            Math.floor(random(`gy${f}`) * GRAIN_TILE),
          ),
        );
        ctx.globalCompositeOperation = "overlay";
        ctx.globalAlpha = amount * 2.2;
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }, []);

  if (!isHtmlInCanvasSupported()) {
    return <>{children}</>;
  }

  const nodes = Array.from({ length: count }, (_, index) => (
    <Sample
      key={index}
      index={index}
      count={count}
      shutterInFrames={shutterInFrames}
      lastFrame={durationInFrames - 1}
      width={width}
      height={height}
    >
      {children}
    </Sample>
  ));

  return (
    <HtmlInCanvas
      name="<Lens>"
      width={width}
      height={height}
      effects={count === 1 ? effects : undefined}
      onPaint={onPaint}
      {...{ _remotionInternalCanvasSiblings: nodes.slice(1) }}
    >
      {nodes[0]}
    </HtmlInCanvas>
  );
};
