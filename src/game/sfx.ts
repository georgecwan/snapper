let ctx: AudioContext | null = null;
let enabled = true;

export function setSoundEnabled(on: boolean) {
  enabled = on;
}

export function soundEnabled() {
  return enabled;
}

export function unlockSound() {
  if (typeof window === "undefined") return;
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
}

function ac(): AudioContext | null {
  if (!enabled || typeof window === "undefined") return null;
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(freq: number, dur: number, type: OscillatorType, gain: number, slideTo?: number) {
  const audio = ac();
  if (!audio) return;
  const o = audio.createOscillator();
  const g = audio.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, audio.currentTime);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, audio.currentTime + dur);
  g.gain.setValueAtTime(0.0001, audio.currentTime);
  g.gain.exponentialRampToValueAtTime(gain, audio.currentTime + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur);
  o.connect(g);
  g.connect(audio.destination);
  o.start();
  o.stop(audio.currentTime + dur + 0.02);
}

export function playBuzz() {
  tone(196, 0.14, "square", 0.06, 98);
}

export function playGood() {
  tone(523, 0.12, "triangle", 0.06);
  window.setTimeout(() => tone(659, 0.16, "triangle", 0.05), 90);
}

export function playBad() {
  tone(146, 0.2, "sawtooth", 0.035, 90);
}
