/** __TITLE__ definition: the full edit plus one Studio composition per scene. */

import { defineVideo } from "@/framework/video/define-video";
import { scenePreview } from "@/framework/video/scene";
import { SCENES } from "./scenes";
import { __COMPONENT__ } from "./Video";
import { DURATION, FPS, HEIGHT, WIDTH, storyboard } from "./timeline";

export const __CAMEL__ = defineVideo({
  id: "__ID__",
  component: __COMPONENT__,
  width: WIDTH,
  height: HEIGHT,
  fps: FPS,
  durationInFrames: DURATION,
  scenes: SCENES.map(({ id, Scene }) => scenePreview(storyboard, id, Scene)),
});
