/** Statement: one word per beat, each replacing the last with a hard cut and a small push. */

import { AbsoluteFill } from "remotion";
import { ease } from "@/framework/motion/easing";
import { lastHit } from "@/framework/motion/pulse";
import { tween } from "@/framework/motion/tween";
import { FONT, axes } from "@/framework/type/fonts";
import { useScene } from "@/framework/video/scene";
import { cues } from "../../cues";
import { C } from "../../theme";

const WORDS = ["MAKE", "IT", "MOVE", "WELL"];

export const Scene: React.FC = () => {
  const { frame, at } = useScene();
  const hits = cues.statementHits.map(at);
  const i = lastHit(frame, hits);
  if (i < 0) {
    return <AbsoluteFill style={{ backgroundColor: C.paper }} />;
  }
  const age = frame - hits[i];
  return (
    <AbsoluteFill
      style={{ backgroundColor: C.paper, justifyContent: "center", alignItems: "center" }}
    >
      <div
        style={{
          fontFamily: FONT.display,
          fontSize: 260,
          color: C.ink,
          ...axes(900, tween(age, 0, 18, 70, 110, ease.out)),
          scale: tween(age, 0, 30, 1.08, 1, ease.out),
        }}
      >
        {WORDS[i]}
      </div>
    </AbsoluteFill>
  );
};
