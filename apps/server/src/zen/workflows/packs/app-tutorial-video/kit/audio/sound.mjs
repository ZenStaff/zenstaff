// Music beds and sound accents made from code (no samples, no third-party recordings), so every
// video can be posted and sold without a music license. makeScore() returns one stereo WAV with
// the bed (cut to the beat, a riser and a hit on the end card) and the accents mixed in;
// MOODS[mood].bpm is the tempo the templates snap their cuts to.

export const SR = 44100;

export const MOODS = {
  upbeat: {
    bpm: 116,
    key: 57,
    prog: [
      [0, 3, 7],
      [-4, 0, 3],
      [3, 7, 10],
      [-2, 2, 5],
    ],
    kick: [0, 1, 2, 3],
    clap: [1, 3],
    hats: "16th",
    pluck: "8th",
    pad: 0.08,
    bass: "pulse",
  },
  warm: {
    bpm: 98,
    key: 55,
    prog: [
      [0, 4, 7, 11],
      [-3, 0, 4, 7],
      [5, 9, 12, 16],
      [7, 11, 14, 17],
    ],
    kick: [0, 2.5],
    clap: [1, 3],
    hats: "8th",
    pluck: "strum",
    pad: 0.11,
    bass: "round",
  },
  calm: {
    bpm: 84,
    key: 62,
    prog: [
      [0, 4, 7, 11],
      [5, 9, 12, 16],
      [9, 12, 16, 19],
      [7, 11, 14, 17],
    ],
    kick: [0],
    clap: [],
    hats: "soft",
    pluck: "sparse",
    pad: 0.15,
    bass: "round",
  },
  bright: {
    bpm: 124,
    key: 60,
    prog: [
      [0, 4, 7],
      [7, 11, 14],
      [9, 12, 16],
      [5, 9, 12],
    ],
    kick: [0, 1, 2, 3],
    clap: [1, 3],
    hats: "16th",
    pluck: "8th",
    pad: 0.07,
    bass: "pulse",
  },
};

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

function makeSynth(random) {
  const pluck = (freq, dur, bright = 0.5) => {
    const len = Math.max(2, Math.round(SR / freq));
    const ring = new Float32Array(len);
    for (let i = 0; i < len; i++) ring[i] = (random() * 2 - 1) * (0.6 + bright * 0.4);
    const out = new Float32Array(Math.round(dur * SR));
    let index = 0;
    let last = 0;
    for (let i = 0; i < out.length; i++) {
      const next = (index + 1) % len;
      const value = 0.4975 * (ring[index] + ring[next]) * (0.996 + bright * 0.003);
      ring[index] = value;
      index = next;
      last = last + 0.55 * (value - last);
      out[i] = last;
    }
    return out;
  };
  const pad = (freqs, dur) => {
    const out = new Float32Array(Math.round(dur * SR));
    const attack = 0.3 * SR;
    const release = 0.6 * SR;
    let lp = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / SR;
      const env = Math.min(1, i / attack) * Math.min(1, (out.length - i) / release);
      let v = 0;
      for (const f of freqs) {
        // Two detuned saws, softened: a warm analog-style pad.
        const a = ((f * t) % 1) * 2 - 1;
        const b = ((f * 1.004 * t) % 1) * 2 - 1;
        v += (a + b) * 0.5;
      }
      lp += 0.06 * (v / freqs.length - lp);
      out[i] = lp * env;
    }
    return out;
  };
  const bass = (freq, dur, kind) => {
    const out = new Float32Array(Math.round(dur * SR));
    for (let i = 0; i < out.length; i++) {
      const t = i / SR;
      const env = Math.min(1, i / 120) * (kind === "pulse" ? Math.exp(-t * 6) : Math.exp(-t * 2.4));
      out[i] =
        (Math.sin(2 * Math.PI * freq * t) +
          0.3 * Math.sin(4 * Math.PI * freq * t) +
          0.12 * Math.sin(6 * Math.PI * freq * t)) *
        env;
    }
    return out;
  };
  const kick = (punch = 1) => {
    const out = new Float32Array(Math.round(0.4 * SR));
    let phase = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / SR;
      phase += (2 * Math.PI * (46 + 120 * punch * Math.exp(-t * 34))) / SR;
      out[i] = Math.tanh(Math.sin(phase) * Math.exp(-t * 8.5) * 1.6);
    }
    return out;
  };
  const noise = (dur, decay, hp) => {
    const out = new Float32Array(Math.round(dur * SR));
    let prev = 0;
    let prevOut = 0;
    for (let i = 0; i < out.length; i++) {
      const x = random() * 2 - 1;
      const y = hp * (prevOut + x - prev);
      prev = x;
      prevOut = y;
      out[i] = y * Math.exp((-i / SR) * decay);
    }
    return out;
  };
  const clap = () => {
    const out = new Float32Array(Math.round(0.25 * SR));
    const bursts = [0, 0.011, 0.022];
    for (let i = 0; i < out.length; i++) {
      const t = i / SR;
      let env = 0;
      for (const b of bursts)
        if (t >= b) env = Math.max(env, Math.exp(-(t - b) * (b === 0.022 ? 18 : 90)));
      out[i] = (random() * 2 - 1) * env;
    }
    // band-pass-ish: difference of two one-pole lowpasses
    let a = 0;
    let b = 0;
    for (let i = 0; i < out.length; i++) {
      a += 0.45 * (out[i] - a);
      b += 0.08 * (out[i] - b);
      out[i] = a - b;
    }
    return out;
  };
  return { pluck, pad, bass, kick, noise, clap };
}

/** Sound accents. Each returns a mono Float32Array. */
export function makeSfx(kind, seed = 3) {
  const random = rng(seed);
  const n = (sec) => new Float32Array(Math.round(sec * SR));
  if (kind === "whoosh") {
    // Filtered noise sweeping up then down, with a fast attack: a camera whip.
    const out = n(0.42);
    let lp = 0;
    let lp2 = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / out.length;
      const cutoff = 0.02 + 0.35 * Math.sin(Math.PI * Math.min(1, t * 1.3));
      const x = random() * 2 - 1;
      lp += cutoff * (x - lp);
      lp2 += cutoff * (lp - lp2);
      const env = Math.sin(Math.PI * t) ** 1.6;
      out[i] = (lp - lp2 * 0.6) * env * 3.2;
    }
    return out;
  }
  if (kind === "click") {
    const out = n(0.07);
    for (let i = 0; i < out.length; i++) {
      const t = i / SR;
      out[i] =
        (Math.sin(2 * Math.PI * 2400 * t) * 0.6 + (random() * 2 - 1) * 0.4) * Math.exp(-t * 140);
    }
    return out;
  }
  if (kind === "pop") {
    const out = n(0.16);
    let phase = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / SR;
      phase += (2 * Math.PI * (380 + 900 * Math.exp(-t * 40))) / SR;
      out[i] = Math.sin(phase) * Math.exp(-t * 26) * 0.9;
    }
    return out;
  }
  if (kind === "impact") {
    const out = n(1.4);
    let phase = 0;
    let lp = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / SR;
      phase += (2 * Math.PI * (38 + 70 * Math.exp(-t * 18))) / SR;
      lp += 0.05 * (random() * 2 - 1 - lp);
      out[i] =
        Math.tanh(Math.sin(phase) * Math.exp(-t * 3.2) * 2) * 0.9 + lp * Math.exp(-t * 9) * 1.4;
    }
    return out;
  }
  if (kind === "riser") {
    const out = n(1.6);
    let lp = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / out.length;
      const cutoff = 0.01 + 0.25 * t * t;
      lp += cutoff * (random() * 2 - 1 - lp);
      const tone = Math.sin(2 * Math.PI * (220 + 660 * t * t) * (i / SR)) * 0.25;
      out[i] = (lp * 2.2 + tone) * t ** 2.2;
    }
    return out;
  }
  if (kind === "tick") {
    const out = n(0.04);
    for (let i = 0; i < out.length; i++)
      out[i] = (random() * 2 - 1) * Math.exp((-i / SR) * 260) * 0.7;
    return out;
  }
  if (kind === "shimmer") {
    const out = n(1.2);
    for (let i = 0; i < out.length; i++) {
      const t = i / SR;
      out[i] =
        [1, 1.5, 2, 3].reduce((v, h) => v + Math.sin(2 * Math.PI * 880 * h * t) / h, 0) *
        Math.exp(-t * 3) *
        0.25;
    }
    return out;
  }
  return n(0.01);
}

export const SFX_KINDS = ["whoosh", "click", "pop", "impact", "riser", "tick", "shimmer"];
const SFX_GAIN = {
  whoosh: 0.32,
  click: 0.38,
  pop: 0.3,
  impact: 0.55,
  riser: 0.26,
  tick: 0.25,
  shimmer: 0.18,
};

/**
 * mood: a MOODS key or "none" (accents only). seconds: total length. endAt: when the end card
 * starts (riser before it, a hit on it). cues: [{ t, kind }] accents in seconds.
 */
export function makeScore({
  mood = "upbeat",
  seconds = 20,
  endAt = null,
  cues = [],
  seed = 7,
  musicGain = 1,
}) {
  const m = MOODS[mood] ?? null;
  const total = Math.round(seconds * SR);
  const n = total + SR;
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const duck = new Float32Array(n).fill(1);
  const random = rng(seed);
  const S = makeSynth(random);
  const add = (buffer, start, data, gain) => {
    const offset = Math.round(start * SR);
    for (let i = 0; i < data.length && offset + i < n; i++)
      if (offset + i >= 0) buffer[offset + i] += data[i] * gain;
  };
  const addStereo = (start, data, gain, pan = 0) => {
    add(L, start, data, gain * Math.min(1, 1 - pan));
    add(R, start, data, gain * Math.min(1, 1 + pan));
  };
  const bpm = m?.bpm ?? 110;
  const beat = 60 / bpm;
  if (m) {
    const bar = beat * 4;
    const bars = Math.ceil(seconds / bar) + 1;
    const pump = new Float32Array(n).fill(1);
    const endBar = endAt == null ? Infinity : Math.round(endAt / bar);
    for (let b = 0; b < bars; b++) {
      const start = b * bar;
      if (start > seconds) break;
      const chord = m.prog[b % m.prog.length];
      const root = m.key + chord[0];
      const tones = chord.map((c) => mtof(m.key + c));
      const outro = b >= endBar;
      addStereo(start, S.pad(tones, bar + 0.6), m.pad * (outro ? 1.4 : 1), 0);
      if (!outro) {
        const bassNotes = m.bass === "pulse" ? [0, 0.5, 1.5, 2, 2.5, 3.5] : [0, 2];
        for (const at of bassNotes)
          addStereo(
            start + at * beat,
            S.bass(mtof(root - 24), beat * (m.bass === "pulse" ? 0.45 : 1.8), m.bass),
            0.3,
            0,
          );
        const arp = chord.map((c) => m.key + 12 + c);
        if (m.pluck === "8th") {
          [0, 1, 2, 1, 0, 2, 1, 2].forEach((p, i) =>
            addStereo(
              start + (i * beat) / 2,
              S.pluck(mtof(arp[p % arp.length]), beat * 1.1, 0.6),
              0.17,
              i % 2 ? 0.35 : -0.35,
            ),
          );
        } else if (m.pluck === "strum") {
          for (const at of [0, 1.5, 2, 3]) {
            chord.forEach((c, i) =>
              addStereo(
                start + at * beat + i * 0.016,
                S.pluck(mtof(m.key + c), beat * 1.6, 0.4),
                0.14,
                (i - 1) * 0.3,
              ),
            );
          }
        } else {
          [0, 1.5, 2.5].forEach((at, i) =>
            addStereo(
              start + at * beat,
              S.pluck(mtof(arp[i % arp.length] + 12), beat * 2.5, 0.3),
              0.13,
              i % 2 ? 0.4 : -0.4,
            ),
          );
        }
        for (const k of m.kick) {
          addStereo(start + k * beat, S.kick(), 0.5, 0);
          // Sidechain pump: the pad and plucks breathe with the kick.
          const i0 = Math.round((start + k * beat) * SR);
          for (let i = 0; i < 0.22 * SR && i0 + i < n; i++)
            pump[i0 + i] = Math.min(pump[i0 + i], 0.55 + 0.45 * (i / (0.22 * SR)));
        }
        for (const c of m.clap) addStereo(start + c * beat, S.clap(), 0.2, 0.05);
        const hatSteps = m.hats === "16th" ? 16 : m.hats === "8th" ? 8 : m.hats === "soft" ? 4 : 0;
        for (let h = 0; h < hatSteps; h++) {
          const off =
            m.hats === "8th" || m.hats === "soft"
              ? (h * 4) / hatSteps + (m.hats === "soft" ? 0.5 : 0)
              : (h * 4) / 16;
          const accent = h % 2 === 1 ? 1 : 0.55;
          addStereo(start + off * beat, S.noise(0.05, 80, 0.97), 0.06 * accent, 0.25);
        }
      }
    }
    for (let i = 0; i < n; i++) {
      L[i] *= pump[i];
      R[i] *= pump[i];
    }
    // The hook lands on a hit: kick + impact on the very first frame.
    addStereo(0, makeSfx("impact", seed), 0.5, 0);
    if (endAt != null && endAt < seconds) {
      addStereo(Math.max(0, endAt - 1.55), makeSfx("riser", seed + 1), 0.32, 0);
      addStereo(endAt, makeSfx("impact", seed + 2), 0.6, 0);
      addStereo(endAt, makeSfx("shimmer", seed + 3), 0.3, 0);
    }
    for (let i = 0; i < n; i++) {
      L[i] *= musicGain;
      R[i] *= musicGain;
    }
  }
  // Accents, with the music ducked 4 dB under them so they read without being loud.
  const accents = { L: new Float32Array(n), R: new Float32Array(n) };
  for (const cue of cues) {
    const data = makeSfx(cue.kind, Math.round(cue.t * 100) + 11);
    const gain = (SFX_GAIN[cue.kind] ?? 0.3) * (cue.gain ?? 1);
    const pan = cue.pan ?? 0;
    add(accents.L, cue.t, data, gain * Math.min(1, 1 - pan));
    add(accents.R, cue.t, data, gain * Math.min(1, 1 + pan));
    const i0 = Math.round(cue.t * SR);
    for (let i = 0; i < data.length && i0 + i < n; i++)
      if (i0 + i >= 0) duck[i0 + i] = Math.min(duck[i0 + i], 0.63);
  }
  let d = 1;
  for (let i = 0; i < n; i++) {
    d += (duck[i] < d ? 0.01 : 0.0004) * (duck[i] - d);
    L[i] = L[i] * d + accents.L[i];
    R[i] = R[i] * d + accents.R[i];
  }
  // Master: soft saturation, short fade-in, fade-out over the last 1.2 s, peak at -3 dBFS.
  // The final loudness (-14 LUFS) is set by FFmpeg after the render.
  const fadeOut = 1.2 * SR;
  let peak = 0;
  for (let i = 0; i < total; i++) {
    const env = Math.min(1, i / (0.004 * SR)) * Math.max(0, Math.min(1, (total - i) / fadeOut));
    L[i] = Math.tanh(L[i] * 1.15) * env;
    R[i] = Math.tanh(R[i] * 1.15) * env;
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  const gain = peak > 0 ? 0.7 / peak : 1;
  return { wav: wavBuffer(L, R, total, gain), bpm, beat };
}

export function wavBuffer(L, R, frames, gain = 1) {
  const pcm = Buffer.alloc(44 + frames * 4);
  pcm.write("RIFF", 0);
  pcm.writeUInt32LE(36 + frames * 4, 4);
  pcm.write("WAVEfmt ", 8);
  pcm.writeUInt32LE(16, 16);
  pcm.writeUInt16LE(1, 20);
  pcm.writeUInt16LE(2, 22);
  pcm.writeUInt32LE(SR, 24);
  pcm.writeUInt32LE(SR * 4, 28);
  pcm.writeUInt16LE(4, 32);
  pcm.writeUInt16LE(16, 34);
  pcm.write("data", 36);
  pcm.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) {
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * gain)) * 32767), 44 + i * 4);
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * gain)) * 32767), 46 + i * 4);
  }
  return pcm;
}
