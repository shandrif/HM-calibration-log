// Alarm sounds generated with the Web Audio API (no audio files, works offline).
// Browsers only allow sound after a tap, so unlock() is called from the "Tap to begin" screen.

let ctx: AudioContext | null = null;
let alarmTimer: number | undefined;

export function unlockAudio() {
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  if (!ctx) ctx = new AC();
  if (ctx.state === 'suspended') void ctx.resume();
  // play a silent blip so iOS fully unlocks output
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  g.gain.value = 0.0001;
  o.connect(g).connect(ctx.destination);
  o.start();
  o.stop(ctx.currentTime + 0.02);
}

export const audioReady = () => !!ctx && ctx.state === 'running';

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

/** Loud, repeating buzzer: 4 sharp pulses every 2 seconds until stopped. */
export function startAlarm() {
  if (alarmTimer || !ctx) return;
  const burst = () => {
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime + 0.02;
    for (let i = 0; i < 4; i++) {
      beep(i % 2 ? 740 : 988, t + i * 0.22, 0.17, 'square', 1);
      beep(i % 2 ? 370 : 494, t + i * 0.22, 0.17, 'sawtooth', 0.5);
    }
    if ('vibrate' in navigator) navigator.vibrate?.([200, 100, 200, 100, 200]);
  };
  burst();
  alarmTimer = window.setInterval(burst, 2000);
}
export function stopAlarm() {
  if (alarmTimer) clearInterval(alarmTimer);
  alarmTimer = undefined;
}

/** Two soft notes: batch is ready / expiring soon. */
export function chime(kind: 'ready' | 'soon') {
  if (!ctx) return;
  const t = ctx.currentTime + 0.02;
  if (kind === 'ready') {
    beep(784, t, 0.18, 'sine', 0.5);
    beep(1175, t + 0.16, 0.35, 'sine', 0.45);
  } else {
    beep(880, t, 0.2, 'triangle', 0.6);
    beep(660, t + 0.22, 0.3, 'triangle', 0.6);
  }
}

export function testSound() {
  startAlarm();
  setTimeout(stopAlarm, 2100);
}
