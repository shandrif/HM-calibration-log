import { type Batch, type SlotDef, SOON_MS } from '../../shared/config';

export type Phase = 'none' | 'brewing' | 'fresh' | 'soon' | 'expired';

/** One drip tank (or the single espresso machine): its latest batch and live state. */
export interface TankView {
  tank: number; // 1, 2, 3…
  current?: Batch;
  phase: Phase;
  remaining: number; // ms to the next milestone (ready or expiry); negative once expired
  progress: number; // 0..1 of the current phase
}

export interface SlotView {
  def: SlotDef;
  current?: Batch; // the batch the big timer shows (most urgent tank)
  phase: Phase;
  remaining: number;
  progress: number;
  tanks: TankView[]; // one entry per tank (1 for espresso)
  latest?: Batch; // most recently started non-reset batch in any tank (for Undo)
}

const STALE_MS = 18 * 3600 * 1000; // older batches are shown as "not started"

/** Tank number of a batch; batches logged before tanks existed count as tank 1. */
export const tankOf = (b: Batch) => b.k ?? 1;

function phaseOf(def: SlotDef, b: Batch | undefined, now: number, tank: number): TankView {
  if (!b || now - b.x > STALE_MS) return { tank, phase: 'none', remaining: 0, progress: 0 };
  if (def.kind === 'drip' && now < b.r) return { tank, current: b, phase: 'brewing', remaining: b.r - now, progress: (now - b.t) / Math.max(1, b.r - b.t) };
  const left = b.x - now;
  if (left <= 0) return { tank, current: b, phase: 'expired', remaining: left, progress: 1 };
  return { tank, current: b, phase: left <= SOON_MS ? 'soon' : 'fresh', remaining: left, progress: 1 - left / Math.max(1, b.x - b.r) };
}

const URGENCY: Record<Phase, number> = { expired: 0, soon: 1, brewing: 2, fresh: 3, none: 4 };

export function slotView(def: SlotDef, batches: Batch[], now: number, tankCount = 1): SlotView {
  const live = batches.filter((b) => b.s === def.slot && !b.v).sort((a, b) => b.t - a.t);
  const n = def.kind === 'drip' ? Math.max(1, tankCount) : 1;
  const tanks: TankView[] = [];
  for (let k = 1; k <= n; k++) tanks.push(phaseOf(def, def.kind === 'drip' ? live.find((b) => tankOf(b) === k) : live[0], now, k));
  // a batch in a tank number above the current setting still needs watching
  if (def.kind === 'drip') {
    for (const b of live) if (tankOf(b) > n && !tanks.some((x) => x.tank === tankOf(b))) {
      const v = phaseOf(def, b, now, tankOf(b));
      if (v.phase !== 'none') tanks.push(v);
    }
  }
  // the big timer follows the most urgent tank: expired first, then whichever runs out soonest
  const active = tanks.filter((x) => x.phase !== 'none');
  const urgent = active.sort((a, b) => URGENCY[a.phase] - URGENCY[b.phase] || a.remaining - b.remaining)[0];
  const latest = live[0] && now - live[0].x <= STALE_MS ? live[0] : undefined;
  if (!urgent) return { def, phase: 'none', remaining: 0, progress: 0, tanks, latest };
  return { def, current: urgent.current, phase: urgent.phase, remaining: urgent.remaining, progress: urgent.progress, tanks, latest };
}

/** Final status of a batch for the log/PDF. "Replaced" only when a newer batch went into the same tank. */
export function batchOutcome(b: Batch, all: Batch[], now: number): 'voided' | 'replaced' | 'expired' | 'active' {
  if (b.v) return 'voided';
  const next = all.find((o) => o.s === b.s && tankOf(o) === tankOf(b) && !o.v && o.t > b.t);
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

/** Drip discarded per bean (ml), split hot / iced. Reset batches are ignored. */
export function discardByBean(batches: Batch[]) {
  const out = { ethiopian: { hot: 0, iced: 0 }, brazilian: { hot: 0, iced: 0 } };
  for (const b of batches) {
    if (b.v || !b.dl) continue;
    const [station, bean] = b.s.split(':');
    if (bean !== 'ethiopian' && bean !== 'brazilian') continue;
    out[bean][station === 'iced_drip' ? 'iced' : 'hot'] += b.dl;
  }
  return out;
}

/** 1500 → "1.5", 250 → "0.25", 0 → "0" */
export function litres(ml: number) {
  return (ml / 1000).toFixed(2).replace(/\.?0+$/, '') || '0';
}
