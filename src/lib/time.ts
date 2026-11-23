import { useEffect, useState, useSyncExternalStore } from 'react';

// Server clock offset so a wrong device clock never affects countdowns.
let offset = 0;
export function setServerNow(serverNow: number) {
  offset = serverNow - Date.now();
}
export const nowMs = () => Date.now() + offset;

// One shared 1-second ticker for the whole app.
const listeners = new Set<() => void>();
let timer: number | undefined;
let current = nowMs();
function tick() {
  current = nowMs();
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  if (!timer) {
    // align to the next whole second so all tiles change together
    timer = window.setTimeout(function loop() {
      tick();
      timer = window.setTimeout(loop, 1000 - (nowMs() % 1000) + 5);
    }, 1000 - (nowMs() % 1000) + 5);
  }
  return () => {
    listeners.delete(l);
    if (!listeners.size && timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
}
export function useNow(): number {
  return useSyncExternalStore(subscribe, () => current);
}

// Store time (Asia/Riyadh, UTC+3, no daylight saving)
export const TZ_OFFSET_MIN = 180;
export function dayKey(ms: number) {
  return new Date(ms + TZ_OFFSET_MIN * 60000).toISOString().slice(0, 10);
}
export function clock(ms: number, withSeconds = false) {
  const d = new Date(ms + TZ_OFFSET_MIN * 60000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return withSeconds ? `${hh}:${mm}:${String(d.getUTCSeconds()).padStart(2, '0')}` : `${hh}:${mm}`;
}
/** 1:02:05, 12:05, 0:09 */
export function countdown(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
export function shortDuration(ms: number, minLabel: string) {
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m} ${minLabel}`;
  return `${Math.floor(m / 60)}h ${m % 60}${minLabel === 'min' ? 'm' : ' ' + minLabel}`;
}
export function addDays(day: string, n: number) {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function formatDay(day: string, lang: 'en' | 'ar') {
  const d = new Date(day + 'T12:00:00Z');
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA-u-nu-latn-ca-gregory' : 'en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

export function useDebounced<T>(v: T, ms: number) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}
