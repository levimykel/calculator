/**
 * Key sounds, synthesized with the Web Audio API.
 *
 * Nothing is loaded from disk: every sound is built from a filtered noise
 * transient plus a short low "body", which is what a mechanical switch
 * actually sounds like — a click with a bit of weight behind it, not a tone.
 * That keeps the app tiny and keeps the feedback working offline.
 *
 * Everything is deliberately quiet. These sit under the sound of a fingertip
 * on glass; they should register without ever being the loudest thing around.
 */

const STORAGE_KEY = 'calcutron.sound';

/**
 * Master trim per level. These are the dials to turn if the clicks are the
 * wrong loudness; every voice scales with them.
 */
export const LEVELS = { off: 0, soft: 0.16, loud: 0.45 };

/** Tapping the speaker button walks this order. */
export const LEVEL_ORDER = ['soft', 'loud', 'off'];

/**
 * A voice is a click (bandpassed noise) plus a body (a brief low sine).
 * `tick` adds a second, smaller click just behind the first — the sound of a
 * switch bottoming out and releasing.
 */
export const VOICES = {
  key: {
    click: { freq: 2200, q: 1.0, gain: 0.26, decay: 0.020 },
    body: { freq: 190, gain: 0.022, decay: 0.032 },
  },
  fn: {
    click: { freq: 2700, q: 1.2, gain: 0.22, decay: 0.017 },
    body: { freq: 240, gain: 0.018, decay: 0.028 },
  },
  operator: {
    click: { freq: 3100, q: 1.3, gain: 0.24, decay: 0.016 },
    body: { freq: 265, gain: 0.018, decay: 0.026 },
  },
  // Heavier and lower than the rest, so a result lands with some finality.
  equals: {
    click: { freq: 1500, q: 0.9, gain: 0.24, decay: 0.024 },
    body: { freq: 120, gain: 0.028, decay: 0.060 },
    tick: { freq: 2100, q: 1.1, gain: 0.14, decay: 0.012, delay: 0.032 },
  },
};

/* Click gains look large next to the body gains because a narrow bandpass
   throws away most of the noise it is given — roughly 70% of it at these
   settings. The numbers that matter are the rendered levels, which the test
   suite measures and pins. */

let ctx = null;
let master = null;
let level = readPreference();
let broken = false;

const noiseBuffers = new WeakMap();

function readPreference() {
  let stored = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    return 'soft'; // Private browsing can throw on storage access.
  }
  if (stored in LEVELS) return stored;
  // Earlier versions stored a plain on/off flag.
  if (stored === 'off') return 'off';
  return 'soft';
}

export function soundLevel() {
  return level;
}

export function setSoundLevel(next) {
  level = next in LEVELS ? next : 'soft';
  try {
    localStorage.setItem(STORAGE_KEY, level);
  } catch {
    /* Preference just will not persist; the control still works this session. */
  }
  if (level === 'off') return;
  const audio = ensureContext();
  if (audio) master.gain.value = LEVELS[level];
}

/** Advance to the next level and return it. */
export function cycleSoundLevel() {
  const at = LEVEL_ORDER.indexOf(level);
  const next = LEVEL_ORDER[(at + 1) % LEVEL_ORDER.length];
  setSoundLevel(next);
  return next;
}

/** White noise, made once per context and shared by every click. */
function noiseFor(audio) {
  let buffer = noiseBuffers.get(audio);
  if (buffer) return buffer;

  const frames = Math.floor(audio.sampleRate * 0.12);
  buffer = audio.createBuffer(1, frames, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;

  noiseBuffers.set(audio, buffer);
  return buffer;
}

/**
 * Build one voice onto any context. Kept separate from playback so the sounds
 * can be rendered offline and measured rather than only listened to.
 */
export function buildVoice(audio, destination, name, at) {
  const voice = VOICES[name] ?? VOICES.key;
  click(audio, destination, at, voice.click);
  if (voice.tick) click(audio, destination, at + voice.tick.delay, voice.tick);
  if (voice.body) body(audio, destination, at, voice.body);
}

function click(audio, destination, at, { freq, q, gain, decay }) {
  const src = audio.createBufferSource();
  const filter = audio.createBiquadFilter();
  const amp = audio.createGain();

  src.buffer = noiseFor(audio);
  // Bandpass rather than lowpass: the narrow band is what reads as a
  // switch click instead of a dull thud or a hiss.
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = q;

  // No attack ramp at all — the abruptness is the click.
  amp.gain.setValueAtTime(gain, at);
  amp.gain.exponentialRampToValueAtTime(0.00001, at + decay);

  src.connect(filter).connect(amp).connect(destination);
  src.start(at);
  src.stop(at + decay + 0.01);
}

function body(audio, destination, at, { freq, gain, decay }) {
  const osc = audio.createOscillator();
  const amp = audio.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, at);

  amp.gain.setValueAtTime(gain, at);
  amp.gain.exponentialRampToValueAtTime(0.00001, at + decay);

  osc.connect(amp).connect(destination);
  osc.start(at);
  osc.stop(at + decay + 0.01);
}

/**
 * Build the live audio graph. Must happen inside a user gesture the first
 * time, which is why it is triggered by the first key press rather than load.
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
  master.gain.value = LEVELS[level];
  master.connect(ctx.destination);
  return ctx;
}

/** Called on the first gesture so iOS lifts its autoplay suspension early. */
export function warmUp() {
  const audio = ensureContext();
  if (audio && audio.state === 'suspended') audio.resume().catch(() => {});
}

export function play(voiceName) {
  if (level === 'off') return;
  const audio = ensureContext();
  if (!audio) return;
  if (audio.state === 'suspended') audio.resume().catch(() => {});

  buildVoice(audio, master, voiceName, audio.currentTime);
}
