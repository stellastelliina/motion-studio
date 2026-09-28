/**
 * Title: a line draws across the frame and the word rises out of it, letter by letter,
 * landing on cues.titleHit; the accent dot pops as its period.
 */

import { AbsoluteFill } from "remotion";
import { ease } from "@/framework/motion/easing";
import { springAt, springs } from "@/framework/motion/spring";
import { progress } from "@/framework/motion/tween";
import { FONT } from "@/framework/type/fonts";
import { KineticWord } from "@/framework/type/KineticWord";
import { measureText, useFontsReady } from "@/framework/type/measure";
import { useScene } from "@/framework/video/scene";
import { cues } from "../../cues";
import { DOT } from "../../layout";
import type { SceneLook } from "../../look";
import { C, SAFE } from "../../theme";
import { FPS, WIDTH } from "../../timeline";

const MAX_SIZE = 200;
const WORD = "__TITLE_UPPER__";

export const Scene: React.FC = () => {
  const { frame, at } = useScene();
  const ready = useFontsReady();
  if (!ready) {
    return <AbsoluteFill style={{ backgroundColor: C.ink }} />;
  }
  // The title never leaves the frame: shrink it to the safe width (the dot needs room too).
  const at100 = measureText(WORD, { fontFamily: FONT.display, fontSize: 100, fontWeight: 900 });
  const room = WIDTH - 2 * SAFE.x - 4 * DOT.r;
  const size = Math.min(MAX_SIZE, (100 * room) / at100.width);
  const font = { fontFamily: FONT.display, fontSize: size, fontWeight: 900, fontStretch: 100 };
  const width = measureText(WORD, font).width;
  const x = (WIDTH - width) / 2;
  const baseline = DOT.y + size * 0.34;
  const hit = at(cues.titleHit);
  const line = progress(frame, 0, hit, ease.inOut);
  const dot = springAt(frame, FPS, hit + 10, springs.bouncy);

  return (
    <AbsoluteFill style={{ backgroundColor: C.ink }}>
      <div
        style={{
          position: "absolute",
          left: x,
          top: baseline,
          width: width * line,
          height: 4,
          backgroundColor: C.accent,
        }}
      />
      <KineticWord
        text={WORD}
        font={font}
        x={x}
        baseline={baseline}
        color={C.paper}
        mask
        letter={(i) => {
          const s = springAt(frame, FPS, hit + i * 2, springs.snappy);
          return { translate: `0px ${(1 - s) * size}px` };
        }}
      />
      <div
        style={{
          position: "absolute",
          left: x + width + 14,
          top: baseline - DOT.r * 2,
          width: DOT.r * 2,
          height: DOT.r * 2,
          borderRadius: DOT.r,
          backgroundColor: C.accent,
          scale: dot,
        }}
      />
    </AbsoluteFill>
  );
};

export const look: SceneLook = () => ({ samples: 6 });
