export interface SpotlightSoundTrack {
  id: string;
  title: string;
  subtitle: string;
  bpm: number;
}

export const SPOTLIGHT_SOUND_TRACKS: SpotlightSoundTrack[] = [
  {
    id: 'original',
    title: 'Original Video Sound',
    subtitle: 'Audio recorded inside your video',
    bpm: 0,
  },
  {
    id: 'lofi',
    title: 'Midnight Lo-Fi · Chill Beats',
    subtitle: 'Warm Rhodes & boom-bap groove',
    bpm: 84,
  },
  {
    id: 'synthwave',
    title: 'Neon Drive · Synthwave',
    subtitle: 'Driving retro bass & synth arp',
    bpm: 108,
  },
  {
    id: 'bounce',
    title: 'Summer Bounce · Pop Beat',
    subtitle: 'Upbeat tropical plucks & 4/4 kick',
    bpm: 118,
  },
  {
    id: 'trap',
    title: 'Hype 808 · Night Club',
    subtitle: 'Deep 808 sub & crisp trap hats',
    bpm: 132,
  },
  {
    id: 'acoustic',
    title: 'Golden Hour · Acoustic',
    subtitle: 'Soft plucked chords & shaker',
    bpm: 96,
  },
];

let sharedCtx: AudioContext | null = null;
let stepTimer: number | null = null;
let currentTrackId: string | null = null;
let unlockListenerAttached = false;

function attachGestureUnlock() {
  if (typeof window === 'undefined' || unlockListenerAttached) return;
  unlockListenerAttached = true;
  const unlock = () => {
    unlockListenerAttached = false;
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
    if (sharedCtx && sharedCtx.state === 'suspended') {
      void sharedCtx.resume().catch(() => {});
    }
  };
  window.addEventListener('pointerdown', unlock, { capture: true, once: true });
  window.addEventListener('keydown', unlock, { capture: true, once: true });
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedCtx || sharedCtx.state === 'closed') {
    sharedCtx = new Ctor();
  }
  if (sharedCtx.state === 'suspended') {
    void sharedCtx.resume().catch(() => {});
    attachGestureUnlock();
  }
  return sharedCtx;
}

export function resumeSpotlightAudioContext(): Promise<void> {
  const ctx = getAudioContext();
  if (!ctx) return Promise.resolve();
  if (ctx.state === 'suspended') {
    return ctx.resume().catch(() => {});
  }
  return Promise.resolve();
}

export function isSpotlightAudioSuspended(): boolean {
  return sharedCtx?.state === 'suspended';
}

function playKick(ctx: AudioContext, time: number, gainPeak = 0.42, subDecay = 0.18) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(135, time);
  osc.frequency.exponentialRampToValueAtTime(42, time + subDecay);
  gain.gain.setValueAtTime(gainPeak, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + subDecay);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(time);
  osc.stop(time + subDecay + 0.02);
}

function playSnare(ctx: AudioContext, time: number, level = 0.22) {
  const bufferSize = Math.floor(ctx.sampleRate * 0.12);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.35));
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.setValueAtTime(900, time);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(level, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  noise.start(time);
}

function playHat(ctx: AudioContext, time: number, level = 0.07) {
  const bufferSize = Math.floor(ctx.sampleRate * 0.035);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.25));
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.setValueAtTime(6500, time);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(level, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.035);

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  noise.start(time);
}

function playNote(
  ctx: AudioContext,
  freq: number,
  time: number,
  duration: number,
  type: OscillatorType = 'triangle',
  volume = 0.11
) {
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, time);

  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(type === 'sawtooth' ? 1800 : 2800, time);

  gain.gain.setValueAtTime(0.001, time);
  gain.gain.linearRampToValueAtTime(volume, time + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  osc.start(time);
  osc.stop(time + duration + 0.02);
}

function playChord(
  ctx: AudioContext,
  freqs: number[],
  time: number,
  duration: number,
  type: OscillatorType = 'triangle',
  volume = 0.06
) {
  for (const f of freqs) {
    playNote(ctx, f, time, duration, type, volume);
  }
}

export function stopSpotlightTrack(): void {
  if (stepTimer !== null) {
    window.clearInterval(stepTimer);
    stepTimer = null;
  }
  currentTrackId = null;
}

export function startSpotlightTrack(trackId: string | undefined): void {
  const cleanId = trackId || 'original';
  if (cleanId === 'original') {
    stopSpotlightTrack();
    return;
  }

  const meta = SPOTLIGHT_SOUND_TRACKS.find((t) => t.id === cleanId);
  if (!meta) {
    stopSpotlightTrack();
    return;
  }

  if (currentTrackId === cleanId && stepTimer !== null) {
    resumeSpotlightAudioContext();
    return;
  }

  stopSpotlightTrack();
  const ctx = getAudioContext();
  if (!ctx) return;

  currentTrackId = cleanId;
  const stepMs = (60 / meta.bpm / 4) * 1000; // 16th-note resolution
  let step = 0;

  const scheduleStep = () => {
    if (currentTrackId !== cleanId) return;
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }
    const now = ctx.currentTime + 0.02;
    const barStep = step % 16;
    const chordIdx = Math.floor(step / 16) % 4;

    if (cleanId === 'lofi') {
      const chords = [
        [261.63, 329.63, 392.0, 493.88], // Cmaj7
        [220.0, 261.63, 329.63, 392.0], // Am7
        [174.61, 220.0, 261.63, 329.63], // Fmaj7
        [196.0, 246.94, 293.66, 349.23], // G7
      ];
      if (barStep === 0) playChord(ctx, chords[chordIdx], now, 1.8, 'sine', 0.065);
      if (barStep === 0 || barStep === 10) playKick(ctx, now, 0.36, 0.22);
      if (barStep === 4 || barStep === 12) playSnare(ctx, now, 0.16);
      if (barStep % 2 === 0) playHat(ctx, now, 0.045);
    } else if (cleanId === 'synthwave') {
      const bass = [110.0, 87.31, 98.0, 82.41]; // A2 F2 G2 E2
      const arps = [440, 523.25, 659.25, 523.25];
      if (barStep % 2 === 0) playNote(ctx, bass[chordIdx], now, 0.22, 'sawtooth', 0.1);
      playNote(ctx, arps[barStep % 4], now, 0.14, 'triangle', 0.065);
      if (barStep % 4 === 0) playKick(ctx, now, 0.4, 0.16);
      if (barStep === 4 || barStep === 12) playSnare(ctx, now, 0.24);
      if (barStep % 2 === 1) playHat(ctx, now, 0.065);
    } else if (cleanId === 'bounce') {
      const melody = [523.25, 0, 659.25, 587.33, 523.25, 0, 783.99, 659.25];
      const note = melody[barStep % 8];
      if (note > 0 && barStep % 2 === 0) playNote(ctx, note, now, 0.16, 'sine', 0.11);
      if (barStep % 4 === 0) playKick(ctx, now, 0.42, 0.15);
      if (barStep === 4 || barStep === 12) playSnare(ctx, now, 0.2);
      if (barStep % 2 === 1) playHat(ctx, now, 0.06);
      if (barStep === 0) playNote(ctx, 130.81, now, 0.6, 'triangle', 0.12);
    } else if (cleanId === 'trap') {
      const subs = [65.41, 65.41, 58.27, 73.42];
      if (barStep === 0 || barStep === 6 || barStep === 10) {
        playKick(ctx, now, 0.48, 0.34);
        playNote(ctx, subs[chordIdx], now, 0.38, 'sine', 0.2);
      }
      if (barStep === 8) playSnare(ctx, now, 0.28);
      if (barStep % 2 === 0 || barStep === 13 || barStep === 14 || barStep === 15) {
        playHat(ctx, now, 0.08);
      }
      if (barStep === 0 || barStep === 12) {
        playNote(ctx, 523.25, now, 0.25, 'triangle', 0.07);
      }
    } else if (cleanId === 'acoustic') {
      const chords = [
        [293.66, 369.99, 440.0], // D
        [220.0, 277.18, 329.63], // A
        [246.94, 293.66, 369.99], // Bm
        [196.0, 246.94, 293.66], // G
      ];
      const pattern = chords[chordIdx];
      if (barStep === 0 || barStep === 6 || barStep === 10) {
        playNote(ctx, pattern[0], now, 0.45, 'triangle', 0.09);
      }
      if (barStep === 2 || barStep === 8 || barStep === 12) {
        playNote(ctx, pattern[1], now, 0.35, 'triangle', 0.08);
      }
      if (barStep === 4 || barStep === 14) {
        playNote(ctx, pattern[2], now, 0.35, 'triangle', 0.08);
      }
      if (barStep % 4 === 2) playHat(ctx, now, 0.04);
    }

    step += 1;
  };

  scheduleStep();
  stepTimer = window.setInterval(scheduleStep, stepMs);
}
