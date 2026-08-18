/**
 * Key sounds, synthesized with the Web Audio API.
 *
 * Nothing is loaded from disk: every sound is a short shaped tone plus a
 * filtered noise transient, which keeps the app tiny and keeps the feedback
 * working offline. The voices are deliberately quiet and short — the point is
 * a tactile "tock", not a beep.
 */

const STORAGE_KEY = 'calcutron.sound';

const VOICES = {
  // freq -> bend gives the little downward pitch drop that reads as a click.
  key:      { freq: 540, bend: 400, dur: 0.05, gain: 0.075, type: 'triangle', noise: 0.05 },
  fn:       { freq: 640, bend: 470, dur: 0.05, gain: 0.07, type: 'triangle', noise: 0.045 },
  operator: { freq: 720, bend: 540, dur: 0.05, gain: 0.07, type: 'triangle', noise: 0.045 },
  // Equals resolves rather than clicks: a soft C5 with a G5 just behind it.
  equals:   { freq: 523.25, dur: 0.14, gain: 0.075, type: 'sine', noise: 0.03, second: { freq: 783.99, delay: 0.045, dur: 0.18, gain: 0.06 } },
};

let ctx = null;
let master = null;
let noise = null;
let enabled = readPreference();
let broken = false;

function readPreference() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true; // Private browsing can throw on storage access.
  }
}

export function soundEnabled() {
  return enabled;
}

export function setSoundEnabled(value) {
  enabled = value;
  try {
    localStorage.setItem(STORAGE_KEY, value ? 'on' : 'off');
  } catch {
    /* Preference just will not persist; the toggle still works this session. */
  }
  if (value) ensureContext();
}

/**
 * Build the audio graph. Must be called from inside a user gesture the first
 * time, which is why it happens on the first key press rather than at load.
 */
function ensureContext() {
  if (ctx || broken) return ctx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) { broken = true; return null; }

  try {
    ctx = new Ctor({ latencyHint: 'interactive' });
  } catch {
    broken = true;
    return null;
  }

  master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);

  // One short burst of white noise, reused for every click transient.
  const frames = Math.floor(ctx.sampleRate * 0.03);
  noise = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < frames; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  }

  return ctx;
}

/** Called on the first gesture so iOS lifts its autoplay suspension early. */
export function warmUp() {
  const audio = ensureContext();
  if (audio && audio.state === 'suspended') audio.resume().catch(() => {});
}

export function play(voiceName) {
  if (!enabled) return;
  const audio = ensureContext();
  if (!audio) return;
  if (audio.state === 'suspended') audio.resume().catch(() => {});

  const voice = VOICES[voiceName] ?? VOICES.key;
  const now = audio.currentTime;

  tone(now, voice);
  if (voice.second) tone(now + voice.second.delay, { ...voice, ...voice.second, noise: 0 });
  if (voice.noise) transient(now, voice.noise);
}

function tone(at, { freq, bend, dur, gain, type }) {
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();

  osc.type = type ?? 'triangle';
  osc.frequency.setValueAtTime(freq, at);
  if (bend) osc.frequency.exponentialRampToValueAtTime(bend, at + dur);

  // Tiny attack avoids the click of starting at full amplitude; the
  // exponential tail is what makes it read as soft rather than digital.
  amp.gain.setValueAtTime(0.0001, at);
  amp.gain.exponentialRampToValueAtTime(gain, at + 0.004);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + dur);

  osc.connect(amp).connect(master);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

function transient(at, gain) {
  const src = ctx.createBufferSource();
  const amp = ctx.createGain();
  const filter = ctx.createBiquadFilter();

  src.buffer = noise;
  filter.type = 'lowpass';
  filter.frequency.value = 2400;

  amp.gain.setValueAtTime(gain, at);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + 0.028);

  src.connect(filter).connect(amp).connect(master);
  src.start(at);
  src.stop(at + 0.03);
}
