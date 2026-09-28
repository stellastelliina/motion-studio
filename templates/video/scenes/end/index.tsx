/** End card: the dot comes back to the center and the sign-off settles under it. */

import { AbsoluteFill } from "remotion";
import { springAt, springs } from "@/framework/motion/spring";
import { FONT } from "@/framework/type/fonts";
import { useScene } from "@/framework/video/scene";
import { cues } from "../../cues";
import { DOT } from "../../layout";
import { C } from "../../theme";
import { FPS } from "../../timeline";

export const Scene: React.FC = () => {
  const { frame, at } = useScene();
  const hit = at(cues.endHit);
  const pop = springAt(frame, FPS, hit, springs.bouncy);
  const text = springAt(frame, FPS, hit + 8, springs.smooth);
  return (
    <AbsoluteFill style={{ backgroundColor: C.ink }}>
      <div
        style={{
          position: "absolute",
          left: DOT.x - DOT.r,
          top: DOT.y - DOT.r,
          width: DOT.r * 2,
          height: DOT.r * 2,
          borderRadius: DOT.r,
          backgroundColor: C.accent,
          scale: pop,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: DOT.y + 60,
          width: "100%",
          textAlign: "center",
          fontFamily: FONT.serif,
          fontStyle: "italic",
          fontSize: 72,
          color: C.paper,
          opacity: text,
          translate: `0px ${(1 - text) * 30}px`,
        }}
      >
        __TITLE__
      </div>
    </AbsoluteFill>
  );
};
