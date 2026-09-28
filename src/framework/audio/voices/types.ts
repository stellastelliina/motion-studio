/** What every voice receives besides its own options. */
export type VoiceEnv = {
  readonly sampleRate: number;
  /** Stable seed for this trigger: derive every noise source from it. */
  readonly seed: number;
};
