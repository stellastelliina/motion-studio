/**
 * Per-frame loudness envelope of an audio file, loaded once per tab and held with delayRender.
 * A missing or undecodable file does not fail the render: the hook reports `missing` so the
 * caller can draw a clearly marked placeholder until the file exists.
 */

import { getAudioData } from "@remotion/media-utils";
import { useEffect, useState } from "react";
import { useDelayRender } from "remotion";
import { rmsEnvelopeDb, type EnvelopeOptions } from "./envelope";

export type AudioEnvelope =
  | { readonly status: "ready"; readonly db: Float32Array }
  | { readonly status: "missing"; readonly reason: string };

const pending = new Map<string, Promise<AudioEnvelope>>();
const settled = new Map<string, AudioEnvelope>();

const keyOf = (src: string, o: EnvelopeOptions) =>
  [src, o.fps, o.frames, o.attack ?? "", o.release ?? ""].join("|");

const load = (src: string, options: EnvelopeOptions): Promise<AudioEnvelope> => {
  const key = keyOf(src, options);
  let job = pending.get(key);
  if (!job) {
    job = getAudioData(src)
      .then(
        (audio): AudioEnvelope => ({
          status: "ready",
          db: rmsEnvelopeDb(audio.channelWaveforms, audio.sampleRate, options),
        }),
      )
      .catch(
        (err: unknown): AudioEnvelope => ({
          status: "missing",
          reason: err instanceof Error ? err.message : String(err),
        }),
      )
      .then((result) => {
        settled.set(key, result);
        return result;
      });
    pending.set(key, job);
  }
  return job;
};

/** Null until the envelope is known; the frame is held until then. */
export const useAudioEnvelope = (src: string, options: EnvelopeOptions): AudioEnvelope | null => {
  const key = keyOf(src, options);
  const [result, setResult] = useState<AudioEnvelope | null>(() => settled.get(key) ?? null);
  const { delayRender, continueRender } = useDelayRender();
  const { fps, frames, attack, release } = options;

  useEffect(() => {
    if (result) {
      return;
    }
    let alive = true;
    const handle = delayRender(`Loading the loudness envelope of ${src}`);
    load(src, { fps, frames, attack, release }).then((r) => {
      if (alive) {
        setResult(r);
      }
      continueRender(handle);
    });
    return () => {
      alive = false;
      continueRender(handle);
    };
  }, [result, src, fps, frames, attack, release, delayRender, continueRender]);

  return result;
};
