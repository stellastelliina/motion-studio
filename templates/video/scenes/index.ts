/** Scene registry, in storyboard order. The ids must match timeline.ts. */

import type { SceneLook } from "../look";
import * as end from "./end";
import * as statement from "./statement";
import * as title from "./title";

type SceneModule = { Scene: React.FC; look?: SceneLook };

const modules: Record<string, SceneModule> = { title, statement, end };

export const SCENES = Object.entries(modules).map(([id, m]) => ({ id, Scene: m.Scene }));

export const SCENE_LOOKS: Record<string, SceneLook | undefined> = Object.fromEntries(
  Object.entries(modules).map(([id, m]) => [id, m.look]),
);
