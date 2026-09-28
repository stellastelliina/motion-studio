/**
 * WAV encoder: plain 16-byte fmt chunk, WAVE_FORMAT_PCM 24-bit (what ffmpeg, Chrome and Remotion
 * all read) or WAVE_FORMAT_IEEE_FLOAT 32-bit for debug stems. Returns bytes; writing them to disk
 * is the caller's job.
 */

import type { Stereo } from "./core";

export type WavFormat = "pcm24" | "float32";

const HEADER_BYTES = 44;

export const encodeWav = (
  s: Stereo,
  sampleRate: number,
  format: WavFormat = "pcm24",
): Uint8Array => {
  const channels = 2;
  const bytesPerSample = format === "pcm24" ? 3 : 4;
  const frames = s.l.length;
  const dataSize = frames * channels * bytesPerSample;
  const out = new Uint8Array(HEADER_BYTES + dataSize + (dataSize % 2));
  const view = new DataView(out.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      out[offset + i] = text.charCodeAt(i);
    }
  };
  ascii(0, "RIFF");
  view.setUint32(4, out.length - 8, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, format === "pcm24" ? 1 : 3, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);
  ascii(36, "data");
  view.setUint32(40, dataSize, true);
  let p = HEADER_BYTES;
  for (let i = 0; i < frames; i++) {
    for (const ch of [s.l, s.r]) {
      const x = ch[i];
      if (format === "float32") {
        view.setFloat32(p, x, true);
        p += 4;
        continue;
      }
      const clamped = x > 1 ? 1 : x < -1 ? -1 : x;
      const v = Math.round(clamped * 8388607);
      out[p] = v & 0xff;
      out[p + 1] = (v >> 8) & 0xff;
      out[p + 2] = (v >> 16) & 0xff;
      p += 3;
    }
  }
  return out;
};

/** Quantizes to the 24-bit grid in place, so meters read exactly what the file will contain. */
export const quantize24 = (s: Stereo): void => {
  for (const ch of s.l === s.r ? [s.l] : [s.l, s.r]) {
    for (let i = 0; i < ch.length; i++) {
      const x = ch[i] > 1 ? 1 : ch[i] < -1 ? -1 : ch[i];
      ch[i] = Math.round(x * 8388607) / 8388607;
    }
  }
};
