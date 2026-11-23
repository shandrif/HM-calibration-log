import { type Batch, type SlotDef, SOON_MS } from '../../shared/config';

export type Phase = 'none' | 'brewing' | 'fresh' | 'soon' | 'expired';

export interface SlotView {
  def: SlotDef;
  current?: Batch; // latest non-reset batch
  previous?: Batch; // the one before it
  phase: Phase;
  remaining: number; // ms to the next milestone (ready or expiry)
  progress: number; // 0..1 of the current phase
}

const STALE_MS = 18 * 3600 * 1000; // older batches are shown as "not started"

export function slotView(def: SlotDef, batches: Batch[], now: number): SlotView {
  const live = batches.filter((b) => b.s === def.slot && !b.v).sort((a, b) => b.t - a.t);
  const current = live[0];
  const previous = live[1];
  if (!current || now - current.x > STALE_MS) return { def, phase: 'none', remaining: 0, progress: 0, previous: current };
  if (now < current.r) {
    return { def, current, previous, phase: 'brewing', remaining: current.r - now, progress: (now - current.t) / Math.max(1, current.r - current.t) };
  }
  const left = current.x - now;
  const life = current.x - current.r;
  if (left <= 0) return { def, current, previous, phase: 'expired', remaining: left, progress: 1 };
  return { def, current, previous, phase: left <= SOON_MS ? 'soon' : 'fresh', remaining: left, progress: 1 - left / life };
}

/** Final status of a batch for the log/PDF. */
export function batchOutcome(b: Batch, all: Batch[], now: number): 'voided' | 'replaced' | 'expired' | 'active' {
  if (b.v) return 'voided';
  const next = all.find((o) => o.s === b.s && !o.v && o.t > b.t);
  if (next && next.t < b.x) return 'replaced';
  if (now >= b.x) return 'expired';
  return 'active';
}

const ACK_KEY = 'hm_ack';
export function loadAcks(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(ACK_KEY) || '[]'));
  } catch {
    return new Set();
  }
}
export function saveAcks(s: Set<string>) {
  try {
    localStorage.setItem(ACK_KEY, JSON.stringify([...s].slice(-200)));
  } catch {
    /* ignore */
  }
}

export function ls(key: string, fallback = ''): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
export function lsSet(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* ignore */
  }
}
