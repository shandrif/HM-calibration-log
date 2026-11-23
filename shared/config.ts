// Single source of truth for stations, timings and value formats (used by the Worker and the web app).

export const BREW_MS = 5.5 * 60 * 1000; // every drip batch brews for 5:30
export const SOON_MS = 5 * 60 * 1000; // "expiring soon" window
export const UNDO_MS = 2 * 60 * 1000; // quick undo after Start
export const GEOFENCE_DEFAULT_M = 500;

export type Station = 'espresso_hot' | 'espresso_cold' | 'espresso' | 'hot_drip' | 'iced_drip';
export type Bean = 'ethiopian' | 'brazilian';
export type EspressoMode = 'pair' | 'single';

export interface SlotDef {
  slot: string; // unique key, e.g. "hot_drip:ethiopian"
  station: Station;
  bean?: Bean;
  group: 'espresso' | 'hot_drip' | 'iced_drip';
  brewMs: number;
  lifeMs: number; // counted after brewing finishes
  kind: 'drip' | 'espresso';
}

const H = 60 * 60 * 1000;
const M = 60 * 1000;

export const BEANS: Bean[] = ['ethiopian', 'brazilian'];

export function slotsFor(mode: EspressoMode): SlotDef[] {
  const espresso: SlotDef[] =
    mode === 'single'
      ? [{ slot: 'espresso', station: 'espresso', group: 'espresso', brewMs: 0, lifeMs: 3 * H, kind: 'espresso' }]
      : [
          { slot: 'espresso_hot', station: 'espresso_hot', group: 'espresso', brewMs: 0, lifeMs: 3 * H, kind: 'espresso' },
          { slot: 'espresso_cold', station: 'espresso_cold', group: 'espresso', brewMs: 0, lifeMs: 3 * H, kind: 'espresso' },
        ];
  const drip = (station: 'hot_drip' | 'iced_drip', lifeMs: number): SlotDef[] =>
    BEANS.map((bean) => ({ slot: `${station}:${bean}`, station, bean, group: station, brewMs: BREW_MS, lifeMs, kind: 'drip' }));
  return [...espresso, ...drip('hot_drip', 30 * M), ...drip('iced_drip', 60 * M)];
}

export const ALL_SLOTS: SlotDef[] = [...slotsFor('pair'), ...slotsFor('single').filter((s) => s.slot === 'espresso')];

export function slotDef(slot: string): SlotDef | undefined {
  return ALL_SLOTS.find((s) => s.slot === slot);
}

/** Grinder setting "6:30" is stored as 630. The right-hand part is 00–95 in steps of 5. */
export function isValidDose(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 99995 && (v % 100) % 5 === 0;
}
export function formatDose(v: number | null | undefined): string {
  if (v == null) return '–';
  return `${Math.floor(v / 100)}:${String(v % 100).padStart(2, '0')}`;
}
export function stepDose(v: number, part: 'major' | 'minor', dir: 1 | -1): number {
  if (part === 'major') return Math.max(0, v + dir * 100);
  const next = v + dir * 5;
  return next < 0 ? 0 : next; // carries naturally: 6:95 + 5 = 7:00
}
// note: 695 + 5 = 700 → "7:00" and 700 - 5 = 695 → "6:95" because minor is always a multiple of 5 below 100.

/** Espresso shots thrown while calibrating (per dose). */
export const MAX_THROWN = 50;
/** Drip waste is recorded in millilitres of brewed coffee and reported as coffee weight: 1 L = 70 g. */
export const DRIP_G_PER_L = 70;
/** Brewed drip (ml) → coffee weight in tenths of a gram. */
export function dripTenths(ml: number): number {
  return Math.round((ml * DRIP_G_PER_L) / 100);
}

/** Coffee weight of one shot, in tenths of a gram (18.8 g and 25.8 g). */
export const DOSE_TENTHS_G = { d1: 188, d2: 258 } as const;
/** Total coffee thrown, in tenths of a gram (stored as an integer to avoid rounding drift). */
export function thrownTenths(w1 = 0, w2 = 0): number {
  return w1 * DOSE_TENTHS_G.d1 + w2 * DOSE_TENTHS_G.d2;
}
/** 82.2 g, or 1.25 kg from 1000 g. Input in tenths of a gram. */
export function gramsParts(tenths: number, lang: 'en' | 'ar' = 'en'): { value: string; unit: string } {
  const g = tenths / 10;
  const [gU, kgU] = lang === 'ar' ? ['غ', 'كغ'] : ['g', 'kg'];
  if (g >= 1000) return { value: (g / 1000).toFixed(2).replace(/\.?0+$/, ''), unit: kgU };
  return { value: Number.isInteger(g) ? String(g) : g.toFixed(1), unit: gU };
}
export function formatGrams(tenths: number, lang: 'en' | 'ar' = 'en'): string {
  const { value, unit } = gramsParts(tenths, lang);
  return `${value} ${unit}`;
}
export function isValidThrown(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_THROWN;
}

/** Discard amount stored in millilitres. Quick picks are ¼, ½, ¾ L; "Other" steps by 0.25 L. */
export const DISCARD_QUICK_ML = [250, 500, 750];
export function isValidDiscard(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 50000 && v % 250 === 0;
}

/** One batch as stored inside the per-store-per-day JSON row (short keys keep rows small). */
export interface Batch {
  id: string;
  s: string; // slot
  t: number; // started (server ms)
  r: number; // ready (brew done)
  x: number; // expires
  n: string; // staff name
  d1?: number; // espresso dose 1
  d2?: number; // espresso dose 2
  w1?: number; // espresso: dose 1 shots thrown during calibration
  w2?: number; // espresso: dose 2 shots thrown during calibration
  wg?: number; // espresso: coffee thrown, tenths of a gram (w1 × 18.8 g + w2 × 25.8 g at the time of logging)
  bn?: string; // bean batch (lot) number in use when this was logged
  dl?: number; // ml discarded from the previous batch of this slot
  v?: number; // voided at
  m?: number; // distance from store (m) when logged
}

/** Beans that carry a batch (lot) number. Hot and cold espresso share one espresso batch;
 * hot and iced drip share the batch of their origin. */
export type BeanKey = 'espresso' | 'ethiopian' | 'brazilian';
export const BEAN_KEYS: BeanKey[] = ['espresso', 'ethiopian', 'brazilian'];
export function beanOf(slot: string): BeanKey {
  if (slot.startsWith('espresso')) return 'espresso';
  return slot.endsWith(':brazilian') ? 'brazilian' : 'ethiopian';
}
export interface BeanBatch {
  cur: string; // current batch number ('' = not set)
  recent: string[]; // previously used, newest first
  at: number;
  by: string;
}
/** Letters, digits and - _ / . — up to 30 characters, stored upper-case. */
export function normalizeBatch(v: unknown): string | null {
  const s = String(v ?? '').trim().toUpperCase().replace(/\s+/g, '');
  return /^[A-Z0-9][A-Z0-9\-_/.]{0,29}$/.test(s) ? s : null;
}

export interface StoreInfo {
  id: number;
  code: string;
  name: string;
  name_ar: string;
  espresso_mode: EspressoMode;
  staff: string[];
  last_doses: Record<string, [number, number]>;
  geofence: boolean;
  beans: Partial<Record<BeanKey, BeanBatch>>;
}

export interface StateResponse {
  now: number;
  store: StoreInfo;
  batches: Batch[]; // today + yesterday (for batches crossing midnight)
  vapid: string;
}

export function dayKey(ms: number, tzOffsetMin: number): string {
  return new Date(ms + tzOffsetMin * 60000).toISOString().slice(0, 10);
}
