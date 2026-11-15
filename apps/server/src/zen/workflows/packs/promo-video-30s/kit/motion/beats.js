// Beat grid math, free of Remotion imports so Node scripts can share it with the templates.

/** Seconds per beat at a tempo. */
export const beatSeconds = (bpm) => 60 / bpm;

/**
 * Snaps scene lengths to the music so every cut lands on a beat, and the end card starts on a
 * bar. `seconds` are the wished lengths; returns lengths in frames.
 */
export function snapToBeats(seconds, { bpm, fps, minBeats = 3, barBeats = 4 }) {
  const beat = beatSeconds(bpm);
  const beats = seconds.map((s) => Math.max(minBeats, Math.round(s / beat)));
  const total = beats.reduce((a, b) => a + b, 0);
  const remainder = total % barBeats;
  if (remainder !== 0 && beats.length) beats[beats.length - 1] += barBeats - remainder;
  // Frames from cumulative beat times so rounding never drifts away from the grid.
  const frames = [];
  let t = 0;
  for (const count of beats) {
    const start = Math.round(t * beat * fps);
    t += count;
    frames.push(Math.round(t * beat * fps) - start);
  }
  return frames;
}
