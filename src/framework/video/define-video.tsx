/**
 * Video registry types and the Root helper that turns definitions into Studio compositions.
 * Each video gets a Studio folder with the full edit plus one composition per scene.
 */

import { Composition, Folder } from "remotion";

export type SceneComposition = {
  readonly id: string;
  readonly component: React.FC;
  readonly durationInFrames: number;
};

export type VideoDefinition = {
  /** Composition id and folder name: kebab-case, also the name of `src/videos/<id>/`. */
  readonly id: string;
  readonly component: React.FC;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly durationInFrames: number;
  readonly scenes?: readonly SceneComposition[];
};

export const defineVideo = (video: VideoDefinition): VideoDefinition => {
  if (!/^[a-z0-9-]+$/.test(video.id)) {
    throw new Error(`Video id "${video.id}" must be kebab-case`);
  }
  return video;
};

export const VideoCompositions: React.FC<{ readonly videos: readonly VideoDefinition[] }> = ({
  videos,
}) => (
  <>
    {videos.map((v) => (
      <Folder key={v.id} name={v.id}>
        <Composition
          id={v.id}
          component={v.component}
          width={v.width}
          height={v.height}
          fps={v.fps}
          durationInFrames={v.durationInFrames}
        />
        {v.scenes?.map((s) => (
          <Composition
            key={s.id}
            id={`${v.id}-${s.id}`}
            component={s.component}
            width={v.width}
            height={v.height}
            fps={v.fps}
            durationInFrames={s.durationInFrames}
          />
        ))}
      </Folder>
    ))}
  </>
);
