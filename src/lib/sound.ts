// Alarm sound.
//
// The expiry buzzer is a generated WAV played through an <audio> element on loop. Compared with
// Web Audio oscillators this is far more reliable on phones:
//  * iPhone's silent switch mutes Web Audio but not media playback (we also set audioSession to
//    "playback" where supported),
//  * an element that has been played once inside a tap may be played again later without a tap,
//    even after the screen was locked or the app was in the background.
// Browsers only allow sound after a user gesture, so unlockAudio() runs on every tap until it works.
// Short chimes (batch ready / expiring soon) still use Web Audio.

let ctx: AudioContext | null = null;
let alarmEl: HTMLAudioElement | null = null;
let unlocked = false;
let alarmWanted = false;
const listeners = new Set<(blocked: boolean) => void>();
let blocked = false;

function setBlocked(v: boolean) {
  if (blocked === v) return;
  blocked = v;
  listeners.forEach((l) => l(v));
}
/** Subscribe to "the alarm should be sounding but the browser blocks audio". */
export function onSoundBlocked(l: (blocked: boolean) => void) {
  listeners.add(l);
  l(blocked);
  return () => {
    listeners.delete(l);
  };
}

/** 2-second loop: four loud alternating square-wave pulses, then a short pause. 16-bit mono WAV. */
function buzzerWav(): string {
  const rate = 22050;
  const seconds = 2;
  const n = rate * seconds;
  const data = new Int16Array(n);
  const pulses = [988, 740, 988, 740];
  pulses.forEach((freq, i) => {
    const start = Math.floor((0.02 + i * 0.22) * rate);
    const len = Math.floor(0.17 * rate);
    for (let k = 0; k < len; k++) {
      const t = k / rate;
      const sq = Math.sin(2 * Math.PI * freq * t) >= 0 ? 1 : -1;
      const sub = Math.sin(2 * Math.PI * (freq / 2) * t) >= 0 ? 1 : -1;
      const env = Math.min(1, k / 80, (len - k) / 80); // tiny fade to avoid clicks
      data[start + k] = Math.round((sq * 0.7 + sub * 0.3) * env * 32000);
    }
  });
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * 2, true);
  new Int16Array(buf, 44).set(data);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

function element(): HTMLAudioElement {
  if (!alarmEl) {
    alarmEl = new Audio(buzzerWav());
    alarmEl.loop = true;
    alarmEl.preload = 'auto';
    alarmEl.setAttribute('playsinline', '');
  }
  return alarmEl;
}

/** Call from a tap. Safe to call many times. */
export function unlockAudio() {
  try {
    const nav = navigator as unknown as { audioSession?: { type: string } };
    if (nav.audioSession) nav.audioSession.type = 'playback'; // iOS 17+: ignore the silent switch
  } catch {
    /* ignore */
  }
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (AC) {
    if (!ctx) ctx = new AC();
    if (ctx.state !== 'running') void ctx.resume().catch(() => {});
  }
  const el = element();
  if (alarmWanted) {
    // the alarm is due right now: start it from this tap
    void playAlarm();
    return;
  }
  if (unlocked) return;
  el.muted = true;
  el.play()
    .then(() => {
      unlocked = true;
      el.muted = false;
      if (alarmWanted) return; // an alarm started meanwhile: keep it playing
      el.pause();
      el.currentTime = 0;
    })
    .catch(() => {
      el.muted = false;
    });
}

export const audioReady = () => unlocked;

async function playAlarm() {
  const el = element();
  el.muted = false;
  el.volume = 1;
  try {
    if (el.paused) {
      el.currentTime = 0;
      await el.play();
    }
    unlocked = true;
    setBlocked(false);
  } catch {
    setBlocked(true); // the UI shows a big "tap to turn on sound" button
  }
  if ('vibrate' in navigator) navigator.vibrate?.([300, 120, 300, 120, 300]);
}

/** Loud, repeating buzzer until stopAlarm(). */
export function startAlarm() {
  alarmWanted = true;
  void playAlarm();
}

export function stopAlarm() {
  alarmWanted = false;
  setBlocked(false);
  if (alarmEl && !alarmEl.paused) alarmEl.pause();
  if (alarmEl) alarmEl.currentTime = 0;
  if ('vibrate' in navigator) navigator.vibrate?.(0);
}

/** If the page comes back to the foreground while an alarm is due, make sure it is sounding. */
export function resumeAlarmIfNeeded() {
  if (alarmWanted) void playAlarm();
}

function beep(freq: number, start: number, dur: number, type: OscillatorType = 'square', vol = 0.9) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(vol, start + 0.01);
  g.gain.setValueAtTime(vol, start + dur - 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(ctx.destination);
  o.start(start);
  o.stop(start + dur + 0.02);
}

/** Two soft notes: batch is ready / expiring soon. */
export function chime(kind: 'ready' | 'soon') {
  if (!ctx) return;
  if (ctx.state !== 'running') void ctx.resume().catch(() => {});
  const t = ctx.currentTime + 0.02;
  if (kind === 'ready') {
    beep(784, t, 0.18, 'sine', 0.5);
    beep(1175, t + 0.16, 0.35, 'sine', 0.45);
  } else {
    beep(880, t, 0.2, 'triangle', 0.6);
    beep(660, t + 0.22, 0.3, 'triangle', 0.6);
  }
}

/** Plays the real alarm for ~2 seconds (from the More screen). */
export function testSound() {
  startAlarm(); // called straight from the tap, so the browser allows it
  setTimeout(stopAlarm, 2100);
}
