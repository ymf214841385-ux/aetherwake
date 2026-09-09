/** Procedural mixer: unlock on first gesture, buses, sparse pentatonic pad. */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;
let windGain: GainNode | null = null;
let muted = false;
let padStarted = false;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  ctx = new AC({ latencyHint: "interactive" });
  master = ctx.createGain();
  sfxBus = ctx.createGain();
  musicBus = ctx.createGain();
  windGain = ctx.createGain();
  master.gain.value = 0.7;
  sfxBus.gain.value = 0.9;
  musicBus.gain.value = 0.22;
  windGain.gain.value = 0;
  sfxBus.connect(master);
  musicBus.connect(master);
  windGain.connect(master);
  master.connect(ctx.destination);
  return ctx;
}

export function unlockAudio() {
  const c = ensure();
  if (c.state === "suspended") void c.resume();
  startPad();
  startWind();
}

export function resumeAudio() {
  if (ctx && ctx.state === "suspended") void ctx.resume();
}

export function setMuted(v: boolean) {
  muted = v;
  if (master) master.gain.setTargetAtTime(v ? 0 : 0.7, ctx?.currentTime ?? 0, 0.04);
}

export function isMuted() {
  return muted;
}

function envGain(duration: number, peak: number, when?: number) {
  const c = ensure();
  const g = c.createGain();
  const t = when ?? c.currentTime;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  g.connect(sfxBus!);
  return { g, t, c };
}

export function sfx(kind: string) {
  const c = ensure();
  if (c.state !== "running") return;
  const t = c.currentTime;
  switch (kind) {
    case "swing": {
      const o = c.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(180, t);
      o.frequency.exponentialRampToValueAtTime(70, t + 0.16);
      const { g } = envGain(0.18, 0.12);
      o.connect(g);
      o.start(t);
      o.stop(t + 0.2);
      break;
    }
    case "hit": {
      const o = c.createOscillator();
      o.type = "square";
      o.frequency.value = 90 + Math.random() * 30;
      const { g } = envGain(0.14, 0.16);
      o.connect(g);
      o.start(t);
      o.stop(t + 0.16);
      noiseBurst(0.08, 0.18, 400);
      break;
    }
    case "bow": {
      const o = c.createOscillator();
      o.type = "triangle";
      o.frequency.setValueAtTime(520, t);
      o.frequency.exponentialRampToValueAtTime(180, t + 0.12);
      const { g } = envGain(0.14, 0.1);
      o.connect(g);
      o.start(t);
      o.stop(t + 0.14);
      break;
    }
    case "explode":
      noiseBurst(0.45, 0.4, 200);
      boom(70);
      break;
    case "ui": {
      const o = c.createOscillator();
      o.type = "sine";
      o.frequency.value = 660;
      const { g } = envGain(0.08, 0.06);
      o.connect(g);
      o.start(t);
      o.stop(t + 0.1);
      break;
    }
    case "pickup": {
      const o = c.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(520, t);
      o.frequency.exponentialRampToValueAtTime(880, t + 0.16);
      const { g } = envGain(0.2, 0.1);
      o.connect(g);
      o.start(t);
      o.stop(t + 0.22);
      break;
    }
    case "orb": {
      const o = c.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(330, t);
      o.frequency.exponentialRampToValueAtTime(660, t + 0.4);
      const { g } = envGain(0.5, 0.12);
      o.connect(g);
      o.start(t);
      o.stop(t + 0.5);
      break;
    }
    case "tower":
      boom(90);
      {
        const o = c.createOscillator();
        o.type = "sine";
        o.frequency.setValueAtTime(220, t);
        o.frequency.exponentialRampToValueAtTime(440, t + 0.8);
        const { g } = envGain(0.9, 0.1);
        o.connect(g);
        o.start(t);
        o.stop(t + 1);
      }
      break;
    case "jump": {
      const o = c.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(240, t);
      o.frequency.exponentialRampToValueAtTime(140, t + 0.1);
      const { g } = envGain(0.1, 0.06);
      o.connect(g);
      o.start(t);
      o.stop(t + 0.12);
      break;
    }
    case "hurt": {
      const o = c.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(160, t);
      o.frequency.exponentialRampToValueAtTime(60, t + 0.22);
      const { g } = envGain(0.24, 0.14);
      o.connect(g);
      o.start(t);
      o.stop(t + 0.24);
      break;
    }
    case "cook":
      noiseBurst(0.3, 0.08, 1200);
      break;
    case "step":
      noiseBurst(0.04, 0.05 + Math.random() * 0.02, 600, 0.7 + Math.random() * 0.2);
      break;
    default:
      break;
  }
}

function boom(freq: number) {
  const c = ensure();
  const t = c.currentTime;
  const o = c.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(40, t + 0.4);
  const { g } = envGain(0.45, 0.22);
  o.connect(g);
  o.start(t);
  o.stop(t + 0.45);
}

function noiseBurst(dur: number, peak: number, hp: number, rate = 1) {
  const c = ensure();
  const n = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
  const d = n.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = c.createBufferSource();
  src.buffer = n;
  src.playbackRate.value = rate;
  const f = c.createBiquadFilter();
  f.type = "highpass";
  f.frequency.value = hp;
  const { g } = envGain(dur, peak);
  src.connect(f);
  f.connect(g);
  src.start();
}

function startWind() {
  if (!ctx || !windGain) return;
  const c = ctx;
  const n = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
  const d = n.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = n;
  src.loop = true;
  const f = c.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = 800;
  f.Q.value = 0.6;
  src.connect(f);
  f.connect(windGain);
  src.start();
}

export function setWind(amount: number) {
  if (!windGain || !ctx) return;
  windGain.gain.setTargetAtTime(Math.min(0.18, amount * 0.18), ctx.currentTime, 0.2);
}

function startPad() {
  if (padStarted || !ctx || !musicBus) return;
  padStarted = true;
  const c = ctx;
  const notes = [146.83, 220, 293.66, 329.63]; // D3 A3 D4 E4
  notes.forEach((freq, i) => {
    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.value = freq;
    const g = c.createGain();
    g.gain.value = 0;
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.07 + i * 0.02;
    const lg = c.createGain();
    lg.gain.value = 0.012;
    lfo.connect(lg);
    lg.connect(g.gain);
    o.connect(g);
    g.connect(musicBus!);
    o.start();
    lfo.start();
    g.gain.setTargetAtTime(0.035 / (i + 1), c.currentTime, 2);
  });
  scheduleMelody();
}

function scheduleMelody() {
  if (!ctx || !musicBus) return;
  const c = ctx;
  const scale = [293.66, 329.63, 349.23, 392.0, 440.0, 523.25];
  const play = () => {
    if (!ctx || ctx.state !== "running") {
      setTimeout(play, 4000);
      return;
    }
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = scale[(Math.random() * scale.length) | 0]!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.045, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    o.connect(g);
    g.connect(musicBus!);
    o.start(t);
    o.stop(t + 1.7);
    setTimeout(play, 2800 + Math.random() * 4200);
  };
  setTimeout(play, 1800);
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") resumeAudio();
  });
}
