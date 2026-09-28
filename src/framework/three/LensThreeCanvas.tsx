/**
 * A ThreeCanvas that can be filmed through the Lens (HtmlInCanvas).
 *
 * The Lens records the scene's DOM when the document paints, and Chrome reuses an element's
 * recorded image until that element is invalidated: redrawing a canvas's pixels (WebGL or 2D)
 * does not invalidate it. R3F also draws late (its updates are reconciled asynchronously and its
 * frame renderer runs in a passive effect). Filmed through the Lens, a plain ThreeCanvas shows
 * its first frame forever.
 *
 * Here each frame is drawn inside react-dom's commit: the scene objects are plain three.js
 * objects the parent mutates while rendering, a layout effect renders them and copies the WebGL
 * canvas into one of two 2D mirrors, then swaps which mirror is visible. The visibility swap is
 * what forces Chrome to record the fresh pixels; the frame is held until the Lens has painted.
 * R3F still owns the WebGL context and mounts the objects (pass them in as <primitive>), but
 * its own late render is disabled.
 *
 * Outside a Lens (scene previews) the visible mirror is simply what gets screenshotted.
 */

import { ThreeCanvas } from "@remotion/three";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useDelayRender } from "remotion";
import type { Camera, WebGLRenderer } from "three";

type ThreeCanvasProps = React.ComponentProps<typeof ThreeCanvas>;

type LayoutCanvas = HTMLCanvasElement & { requestPaint?: () => void };

type Stage = { readonly draw: () => void; readonly renderer: WebGLRenderer };

export const LensThreeCanvas: React.FC<
  Omit<ThreeCanvasProps, "camera" | "onCreated"> & {
    readonly camera: Camera;
    /** Redraw key: the frame being rendered. */
    readonly frame: number;
  }
> = ({ width, height, camera, frame, style, gl, children, ...props }) => {
  const mirrorA = useRef<HTMLCanvasElement>(null);
  const mirrorB = useRef<HTMLCanvasElement>(null);
  const front = useRef(0);
  const stageRef = useRef<Stage | null>(null);
  const [created, setCreated] = useState(false);
  const { delayRender, continueRender } = useDelayRender();
  const [firstFrame] = useState(() => delayRender("LensThreeCanvas: creating the WebGL stage"));
  const firstDrawn = useRef(false);

  const onCreated = useCallback<NonNullable<ThreeCanvasProps["onCreated"]>>((state) => {
    const renderer = state.gl;
    const render = renderer.render.bind(renderer);
    // R3F's frame renderer runs after the paint: it must not be the one that draws.
    renderer.render = () => undefined;
    stageRef.current = { renderer, draw: () => render(state.scene, state.camera) };
    setCreated(true);
  }, []);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    const back = (front.current === 0 ? mirrorB : mirrorA).current;
    const shown = (front.current === 0 ? mirrorA : mirrorB).current;
    if (!created || !stage || !back || !shown) {
      return;
    }
    stage.draw();
    const ctx = back.getContext("2d", { alpha: false });
    if (!ctx) {
      throw new Error("LensThreeCanvas: 2D context unavailable for the mirror");
    }
    ctx.drawImage(stage.renderer.domElement, 0, 0, back.width, back.height);
    back.style.visibility = "visible";
    shown.style.visibility = "hidden";
    front.current = 1 - front.current;

    // Inside a Lens (the closest canvas ancestor laying out its children), hold the frame until
    // the Lens has painted with this mirror.
    const layout = back.parentElement?.closest("canvas") as LayoutCanvas | null;
    if (layout?.requestPaint) {
      const handle = delayRender("LensThreeCanvas: waiting for the Lens to capture the frame");
      layout.addEventListener("paint", () => continueRender(handle), { once: true });
      layout.requestPaint();
    }
    if (!firstDrawn.current) {
      firstDrawn.current = true;
      continueRender(firstFrame);
    }
  }, [created, frame, continueRender, delayRender, firstFrame]);

  const mirrorStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    width,
    height,
    zIndex: 1,
    visibility: "hidden",
  };

  // The mirrors come first so their refs exist before R3F creates its root; the WebGL canvas
  // under them stays invisible.
  return (
    <div style={{ position: "relative", width, height, ...style }}>
      <canvas ref={mirrorA} width={width} height={height} style={mirrorStyle} />
      <canvas ref={mirrorB} width={width} height={height} style={mirrorStyle} />
      <ThreeCanvas
        width={width}
        height={height}
        {...props}
        camera={camera as ThreeCanvasProps["camera"]}
        gl={{ ...(typeof gl === "object" ? gl : {}), preserveDrawingBuffer: true }}
        frameloop="demand"
        onCreated={onCreated}
        style={{ position: "absolute", inset: 0, opacity: 0 }}
      >
        {children}
      </ThreeCanvas>
    </div>
  );
};
