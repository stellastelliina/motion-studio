/**
 * __TITLE__: scenes on the storyboard filmed through the Lens; the soundtrack stays outside
 * the Lens (motion blur samples would duplicate it).
 */

import { Audio } from "@remotion/media";
import { AbsoluteFill, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Lens } from "@/framework/fx/Lens";
import { loadFonts } from "@/framework/type/fonts";
import { SceneSlot } from "@/framework/video/scene";
import { createVideoLook } from "./look";
import { SCENES, SCENE_LOOKS } from "./scenes";
import { C } from "./theme";
import { storyboard } from "./timeline";

loadFonts();

const lookAt = createVideoLook(SCENE_LOOKS);

export const __COMPONENT__: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const look = lookAt(frame);
  return (
    <AbsoluteFill style={{ backgroundColor: C.ink }}>
      <Lens
        width={width}
        height={height}
        samples={look.samples}
        shutter={look.shutter}
        effects={look.effects}
        grain={look.grain}
      >
        <AbsoluteFill style={{ backgroundColor: C.ink }}>
          {SCENES.map(({ id, Scene }) => (
            <SceneSlot key={id} storyboard={storyboard} id={id}>
              <Scene />
            </SceneSlot>
          ))}
        </AbsoluteFill>
      </Lens>
      <Audio src={staticFile("audio/__ID__.wav")} />
    </AbsoluteFill>
  );
};
