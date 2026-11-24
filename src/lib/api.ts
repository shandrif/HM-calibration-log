import type { Batch, StateResponse, StoreInfo } from '../../shared/config';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public data: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'offline');
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, String(data.error ?? 'failed'), data);
  return data as T;
}

export type Fix = { lat: number; lng: number; acc: number } | undefined;

export const api = {
  login: (code: string, pin: string, fix: Fix) => req<{ ok: true }>('POST', '/api/login', { code, pin, fix }),
  logout: () => req('POST', '/api/logout'),
  state: () => req<StateResponse>('GET', '/api/state'),
  start: (body: { slot: string; staff: string; d1?: number; d2?: number; w1?: number; w2?: number; k?: number; fix: Fix }) =>
    req<{ now: number; day: string; batch: Batch }>('POST', '/api/batches', body),
  void: (id: string, day: string) => req('POST', `/api/batches/${id}/void`, { day }),
  discard: (id: string, day: string, ml: number) => req('POST', `/api/batches/${id}/discard`, { day, ml }),
  staff: (names: string[]) => req<{ staff: string[] }>('PUT', '/api/staff', { names }),
  setBean: (bean: string, batch: string, by: string) => req<{ beans: StoreInfo['beans'] }>('PUT', '/api/beans', { bean, batch, by }),
  log: (day: string) => req<{ day: string; store: StoreInfo; batches: Batch[] }>('GET', `/api/log?day=${day}`),
  logDays: () => req<{ days: Record<string, number> }>('GET', '/api/log/days'),
  subscribe: (sub: PushSubscriptionJSON) => req('POST', '/api/push/subscribe', sub),
  unsubscribe: (endpoint: string) => req('POST', '/api/push/unsubscribe', { endpoint }),
  testPush: () => req('POST', '/api/push/test'),
};

export const adminApi = {
  login: (password: string) => req('POST', '/api/admin/login', { password }),
  logout: () => req('POST', '/api/admin/logout'),
  overview: () => req<AdminOverview>('GET', '/api/admin/overview'),
  createStore: (s: StoreBody & { pin: string }) => req<{ id: number }>('POST', '/api/admin/stores', s),
  updateStore: (id: number, s: StoreBody & { pin?: string }) => req('PUT', `/api/admin/stores/${id}`, s),
  log: (store: number, day: string) => req<{ day: string; store: StoreInfo; batches: Batch[] }>('GET', `/api/admin/log?store=${store}&day=${day}`),
  logDays: (store: number) => req<{ days: Record<string, number> }>('GET', `/api/admin/log/days?store=${store}`),
  refreshUsage: () => req('POST', '/api/admin/usage/refresh'),
  waste: (from: string, to: string) => req<WasteResponse>('GET', `/api/admin/waste?from=${from}&to=${to}`),
  batches: (from: string, to: string) => req<BatchesResponse>('GET', `/api/admin/batches?from=${from}&to=${to}`),
  pins: (body: { ids?: number[]; onlyMissing?: boolean }) =>
    req<{ pins: { id: number; code: string; name: string; pin: string }[] }>('POST', '/api/admin/pins', body),
};

export interface BatchesResponse {
  from: string;
  to: string;
  rows: {
    sid: number;
    bn: string;
    slot: string;
    v: number[]; // logs, discardMl, discards, w1, w2, wgTenths, sumD1, sumD2
    mn1: number | null;
    mx1: number | null;
    mn2: number | null;
    mx2: number | null;
    first: string;
    last: string;
  }[];
}

export interface WasteResponse {
  from: string;
  to: string;
  today: string;
  totals: Record<string, Record<string, number[]>>; // storeId -> slot -> [ml, discards, batches, dose1 thrown, dose2 thrown, thrown 0.1 g]
}

type StoreBody = Omit<Partial<AdminStore>, 'tanks'> & { tanks?: Record<string, number> };

export interface AdminStore {
  id: number;
  code: string;
  name: string;
  name_ar: string;
  lat: number | null;
  lng: number | null;
  radius_m: number;
  espresso_mode: 'pair' | 'single';
  active: number | boolean;
  syrve_code: string;
  city: string;
  region: string;
  zone: string;
  sub_zone: string;
  area_manager: string;
  rom: string;
  location_type: string;
  drive_thru: string;
  coord_evidence: string;
  opening_date: string;
  source: 'manual' | 'master';
  synced_at: number;
  has_pin: number;
  tanks: string;
}
export interface AdminOverview {
  now: number;
  today: string;
  stores: AdminStore[];
  stats: { id: number; logs: number; voided: number; discarded_ml: number; last_at: number | null }[];
  usage: null | {
    at: number;
    day: string;
    requests: number;
    rowsRead: number;
    rowsWritten: number;
    storageBytes: number;
    byScript: Record<string, number>;
    error?: string;
  };
  limits: { requests: number; rowsRead: number; rowsWritten: number; storageBytes: number };
  warnAt: number;
  analyticsConfigured: boolean;
}
