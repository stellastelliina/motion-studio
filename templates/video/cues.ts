/**
 * Picture/sound contract in beats: scenes animate on these, the score plays on these.
 * Pure data, safe to import from compositions and from the audio renderer.
 */

export const cues = {
  /** The title word lands. */
  titleHit: 1,
  /** Each word of the statement lands on a beat. */
  statementHits: [9, 10, 11, 12],
  /** The end card appears. */
  endHit: 16,
} as const;
