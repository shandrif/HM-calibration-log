import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import {
  type Batch,
  type StoreInfo,
  type StateResponse,
  type EspressoMode,
  slotDef,
  isValidDose,
  isValidDiscard,
  isValidThrown,
  thrownTenths,
  dayKey,
  GEOFENCE_DEFAULT_M,
} from '../shared/config';
import { signToken, verifyToken, hashPin, randomId, safeEqual } from './lib/crypto';
import { checkGeofence, type Fix } from './lib/geo';
import { sendTickle } from './lib/push';
import { fetchUsage, FREE_LIMITS, WARN_AT, type UsageSnapshot } from './lib/usage';

export interface Env {
  DB: D1Database;
  TZ_OFFSET_MIN: string;
  RETENTION_DAYS: string;
  VAPID_PUBLIC_KEY: string;
  PUBLIC_ORIGIN?: string;
  ACCOUNT_ID?: string;
  SESSION_SECRET: string;
  ADMIN_PASSWORD: string;
  VAPID_PRIVATE_JWK?: string;
  ANALYTICS_TOKEN?: string;
}

type StoreRow = {
  id: number;
  code: string;
  name: string;
  name_ar: string;
  pin_hash: string;
  pin_salt: string;
  pin_ver: number;
  lat: number | null;
  lng: number | null;
  radius_m: number;
  espresso_mode: EspressoMode;
  staff: string;
  last_doses: string;
  active: number;
  fail_count: number;
  locked_until: number;
};

type Session = { sid: number; pv: number; iat: number };
type AppCtx = Context<{ Bindings: Env; Variables: { store: StoreRow } }>;

const STORE_COOKIE = 'hm_s';
const ADMIN_COOKIE = 'hm_a';
const COOKIE_MAX_AGE = 180 * 24 * 3600;

const app = new Hono<{ Bindings: Env; Variables: { store: StoreRow } }>();

const tz = (env: Env) => Number(env.TZ_OFFSET_MIN || 180);
const err = (c: Context, status: number, code: string, extra: object = {}) =>
  c.json({ error: code, ...extra }, status as 400);

function storeInfo(s: StoreRow): StoreInfo {
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    name_ar: s.name_ar,
    espresso_mode: s.espresso_mode,
    staff: safeJson<string[]>(s.staff, []),
    last_doses: safeJson(s.last_doses, {}),
    geofence: s.lat != null && s.lng != null,
  };
}

function safeJson<T>(s: string | null | undefined, fallback: T): T {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}

function cookieOpts(c: Context) {
  const secure = new URL(c.req.url).protocol === 'https:';
  return { httpOnly: true, secure, sameSite: 'Lax' as const, path: '/', maxAge: COOKIE_MAX_AGE };
}

async function readBody<T>(c: Context): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    return {} as T;
  }
}

function parseFix(f: unknown): Fix | undefined {
  if (!f || typeof f !== 'object') return undefined;
  const o = f as Record<string, unknown>;
  return { lat: Number(o.lat), lng: Number(o.lng), acc: Number(o.acc) };
}

async function batchesFor(env: Env, storeId: number, days: string[]): Promise<Batch[]> {
  const q = `SELECT batches FROM days WHERE store_id = ?1 AND day IN (${days.map((_, i) => `?${i + 2}`).join(',')})`;
  const { results } = await env.DB.prepare(q)
    .bind(storeId, ...days)
    .all<{ batches: string }>();
  return results.flatMap((r) => safeJson<Batch[]>(r.batches, [])).sort((a, b) => a.t - b.t);
}

function todayAndYesterday(env: Env, now: number) {
  return [dayKey(now, tz(env)), dayKey(now - 24 * 3600 * 1000, tz(env))];
}

// ---------------------------------------------------------------- store session

async function requireStore(c: AppCtx, next: () => Promise<void>) {
  const s = await verifyToken<Session>(getCookie(c, STORE_COOKIE), c.env.SESSION_SECRET);
  if (!s) return err(c, 401, 'signed_out');
  const store = await c.env.DB.prepare('SELECT * FROM stores WHERE id = ?1').bind(s.sid).first<StoreRow>();
  if (!store || !store.active || store.pin_ver !== s.pv) {
    deleteCookie(c, STORE_COOKIE, { path: '/' });
    return err(c, 401, 'signed_out');
  }
  c.set('store', store);
  await next();
}

app.post('/api/login', async (c) => {
  const body = await readBody<{ code?: string; pin?: string; fix?: unknown }>(c);
  const code = String(body.code ?? '').trim().toUpperCase();
  const pin = String(body.pin ?? '').trim();
  if (!code || !pin) return err(c, 400, 'missing');
  const store = await c.env.DB.prepare('SELECT * FROM stores WHERE code = ?1').bind(code).first<StoreRow>();
  const now = Date.now();
  if (!store || !store.active) return err(c, 401, 'bad_login');
  if (store.locked_until > now) return err(c, 429, 'locked', { until: store.locked_until });
  if (!store.pin_hash) return err(c, 401, 'no_pin');
  const hash = await hashPin(pin, store.pin_salt, c.env.SESSION_SECRET);
  if (!safeEqual(hash, store.pin_hash)) {
    const fails = store.fail_count + 1;
    const lock = fails >= 5 ? now + 15 * 60 * 1000 : 0;
    await c.env.DB.prepare('UPDATE stores SET fail_count = ?1, locked_until = ?2 WHERE id = ?3')
      .bind(lock ? 0 : fails, lock, store.id)
      .run();
    return err(c, 401, 'bad_login');
  }
  const geo = checkGeofence(store, parseFix(body.fix));
  if (!geo.ok) return err(c, 403, geo.reason, { distance: geo.distance });
  if (store.fail_count) await c.env.DB.prepare('UPDATE stores SET fail_count = 0 WHERE id = ?1').bind(store.id).run();
  const token = await signToken({ sid: store.id, pv: store.pin_ver, iat: now } satisfies Session, c.env.SESSION_SECRET);
  setCookie(c, STORE_COOKIE, token, cookieOpts(c));
  return c.json({ ok: true });
});

app.post('/api/logout', (c) => {
  deleteCookie(c, STORE_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

app.get('/api/state', requireStore, async (c) => {
  const store = c.get('store');
  const now = Date.now();
  const batches = await batchesFor(c.env, store.id, todayAndYesterday(c.env, now));
  return c.json({ now, store: storeInfo(store), batches, vapid: c.env.VAPID_PUBLIC_KEY || '' } satisfies StateResponse);
});

/** Start a batch: one row written. */
app.post('/api/batches', requireStore, async (c) => {
  const store = c.get('store');
  const body = await readBody<{ slot?: string; staff?: string; d1?: number; d2?: number; w1?: number; w2?: number; fix?: unknown }>(c);
  const def = slotDef(String(body.slot));
  if (!def) return err(c, 400, 'bad_slot');
  const espressoSlots = store.espresso_mode === 'single' ? ['espresso'] : ['espresso_hot', 'espresso_cold'];
  if (def.kind === 'espresso' && !espressoSlots.includes(def.slot)) return err(c, 400, 'bad_slot');
  const staff = String(body.staff ?? '').trim().slice(0, 40);
  if (!staff) return err(c, 400, 'no_staff');
  if (def.kind === 'espresso' && (!isValidDose(body.d1) || !isValidDose(body.d2))) return err(c, 400, 'bad_dose');
  if ((body.w1 !== undefined && !isValidThrown(body.w1)) || (body.w2 !== undefined && !isValidThrown(body.w2))) return err(c, 400, 'bad_thrown');
  const geo = checkGeofence(store, parseFix(body.fix));
  if (!geo.ok) return err(c, 403, geo.reason, { distance: geo.distance });

  const now = Date.now();
  const ready = now + def.brewMs;
  const batch: Batch = { id: randomId(), s: def.slot, t: now, r: ready, x: ready + def.lifeMs, n: staff };
  if (def.kind === 'espresso') {
    batch.d1 = body.d1;
    batch.d2 = body.d2;
    if (body.w1) batch.w1 = body.w1;
    if (body.w2) batch.w2 = body.w2;
    if (body.w1 || body.w2) batch.wg = thrownTenths(body.w1, body.w2);
  }
  if (geo.distance != null) batch.m = geo.distance;
  const day = dayKey(now, tz(c.env));
  const json = JSON.stringify(batch);
  const stmts = [
    c.env.DB.prepare(
      `INSERT INTO days (day, store_id, batches) VALUES (?1, ?2, json_array(json(?3)))
       ON CONFLICT (day, store_id) DO UPDATE SET batches = json_insert(days.batches, '$[#]', json(?3))`,
    ).bind(day, store.id, json),
  ];
  if (def.kind === 'espresso') {
    stmts.push(
      c.env.DB.prepare(`UPDATE stores SET last_doses = json_set(last_doses, '$.' || ?1, json(?2)) WHERE id = ?3`).bind(
        def.slot,
        JSON.stringify([body.d1, body.d2]),
        store.id,
      ),
    );
  }
  await c.env.DB.batch(stmts);
  return c.json({ now, day, batch });
});

/** Update one field of a batch inside the day row, atomically in SQL. */
async function patchBatch(env: Env, storeId: number, day: string, id: string, field: 'v' | 'dl', value: number, guard: string) {
  const res = await env.DB.prepare(
    `UPDATE days SET batches = json_set(batches,
        '$[' || (SELECT j.key FROM json_each(days.batches) j WHERE json_extract(j.value, '$.id') = ?3) || '].${field}', ?4)
     WHERE day = ?1 AND store_id = ?2
       AND EXISTS (SELECT 1 FROM json_each(days.batches) j WHERE json_extract(j.value, '$.id') = ?3 AND ${guard})`,
  )
    .bind(day, storeId, id, value, Date.now())
    .run();
  return res.meta.changes > 0;
}

app.post('/api/batches/:id/void', requireStore, async (c) => {
  const store = c.get('store');
  const { day } = await readBody<{ day?: string }>(c);
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return err(c, 400, 'bad_day');
  // Only a batch that has not expired yet can be reset.
  const ok = await patchBatch(c.env, store.id, day, c.req.param('id') ?? '', 'v', Date.now(), `json_extract(j.value, '$.v') IS NULL AND json_extract(j.value, '$.x') > ?5`);
  return ok ? c.json({ ok: true }) : err(c, 409, 'cannot_reset');
});

app.post('/api/batches/:id/discard', requireStore, async (c) => {
  const store = c.get('store');
  const { day, ml } = await readBody<{ day?: string; ml?: number }>(c);
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return err(c, 400, 'bad_day');
  if (!isValidDiscard(ml)) return err(c, 400, 'bad_amount');
  // Allowed for 30 minutes after the batch started.
  const ok = await patchBatch(c.env, store.id, day, c.req.param('id') ?? '', 'dl', ml, `json_extract(j.value, '$.t') > ?5 - 1800000`);
  return ok ? c.json({ ok: true }) : err(c, 409, 'too_late');
});

app.put('/api/staff', requireStore, async (c) => {
  const store = c.get('store');
  const { names } = await readBody<{ names?: unknown }>(c);
  if (!Array.isArray(names)) return err(c, 400, 'bad_names');
  const clean = [...new Set(names.map((n) => String(n).trim().slice(0, 40)).filter(Boolean))].slice(0, 60);
  await c.env.DB.prepare('UPDATE stores SET staff = ?1 WHERE id = ?2').bind(JSON.stringify(clean), store.id).run();
  return c.json({ staff: clean });
});

app.get('/api/log', requireStore, async (c) => {
  const store = c.get('store');
  const day = c.req.query('day') ?? dayKey(Date.now(), tz(c.env));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return err(c, 400, 'bad_day');
  return c.json({ day, store: storeInfo(store), batches: await batchesFor(c.env, store.id, [day]) });
});

app.post('/api/push/subscribe', requireStore, async (c) => {
  const store = c.get('store');
  const b = await readBody<{ endpoint?: string; keys?: { p256dh?: string; auth?: string } }>(c);
  if (!b.endpoint || !/^https:\/\//.test(b.endpoint) || !b.keys?.p256dh || !b.keys?.auth) return err(c, 400, 'bad_sub');
  await c.env.DB.prepare(
    `INSERT INTO push_subs (endpoint, store_id, p256dh, auth, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT (endpoint) DO UPDATE SET store_id = excluded.store_id`,
  )
    .bind(b.endpoint, store.id, b.keys.p256dh, b.keys.auth, Date.now())
    .run();
  return c.json({ ok: true });
});

/** Sends a test notification to this device's subscription. */
app.post('/api/push/test', requireStore, async (c) => {
  if (!c.env.VAPID_PRIVATE_JWK || !c.env.VAPID_PUBLIC_KEY) return err(c, 400, 'push_not_configured');
  const { results } = await c.env.DB.prepare('SELECT endpoint FROM push_subs WHERE store_id = ?1 ORDER BY created_at DESC LIMIT 10')
    .bind(c.get('store').id)
    .all<{ endpoint: string }>();
  if (!results.length) return err(c, 404, 'no_subscription');
  const subject = c.env.PUBLIC_ORIGIN || new URL(c.req.url).origin;
  let sent = 0;
  for (const { endpoint } of results) {
    try {
      if (await sendTickle(endpoint, { publicKey: c.env.VAPID_PUBLIC_KEY, privateJwk: c.env.VAPID_PRIVATE_JWK, subject })) sent++;
      else await c.env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?1').bind(endpoint).run();
    } catch {
      /* ignore one bad endpoint */
    }
  }
  return c.json({ sent });
});

app.post('/api/push/unsubscribe', requireStore, async (c) => {
  const { endpoint } = await readBody<{ endpoint?: string }>(c);
  if (endpoint) await c.env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?1 AND store_id = ?2').bind(endpoint, c.get('store').id).run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- admin (head office)

async function requireAdmin(c: Context<{ Bindings: Env }>, next: () => Promise<void>) {
  const s = await verifyToken<{ adm: number; iat: number }>(getCookie(c, ADMIN_COOKIE), c.env.SESSION_SECRET);
  if (!s?.adm || Date.now() - s.iat > 7 * 24 * 3600 * 1000) return err(c, 401, 'signed_out');
  await next();
}

app.post('/api/admin/login', async (c) => {
  const { password } = await readBody<{ password?: string }>(c);
  if (!c.env.ADMIN_PASSWORD || !password || !safeEqual(String(password), c.env.ADMIN_PASSWORD)) {
    await new Promise((r) => setTimeout(r, 800));
    return err(c, 401, 'bad_login');
  }
  setCookie(c, ADMIN_COOKIE, await signToken({ adm: 1, iat: Date.now() }, c.env.SESSION_SECRET), { ...cookieOpts(c), maxAge: 7 * 24 * 3600 });
  return c.json({ ok: true });
});

app.post('/api/admin/logout', (c) => {
  deleteCookie(c, ADMIN_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

app.get('/api/admin/overview', requireAdmin, async (c) => {
  const now = Date.now();
  const today = dayKey(now, tz(c.env));
  const [stores, stats, usageRow] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, code, name, name_ar, lat, lng, radius_m, espresso_mode, active, syrve_code, city, region, zone, sub_zone,
              area_manager, rom, location_type, drive_thru, coord_evidence, opening_date, source, synced_at,
              pin_hash != '' AS has_pin
       FROM stores ORDER BY code`,
    ).all(),
    c.env.DB.prepare(
      `SELECT d.store_id AS id,
              SUM(CASE WHEN json_extract(j.value, '$.v') IS NULL THEN 1 ELSE 0 END) AS logs,
              SUM(CASE WHEN json_extract(j.value, '$.v') IS NOT NULL THEN 1 ELSE 0 END) AS voided,
              SUM(CASE WHEN json_extract(j.value, '$.v') IS NULL THEN COALESCE(json_extract(j.value, '$.dl'), 0) ELSE 0 END) AS discarded_ml,
              MAX(json_extract(j.value, '$.t')) AS last_at
       FROM days d, json_each(d.batches) j WHERE d.day = ?1 GROUP BY d.store_id`,
    )
      .bind(today)
      .all(),
    c.env.DB.prepare(`SELECT v FROM meta WHERE k = 'usage'`).first<{ v: string }>(),
  ]);
  const usage = safeJson<UsageSnapshot | null>(usageRow?.v, null);
  return c.json({
    now,
    today,
    stores: stores.results,
    stats: stats.results,
    usage,
    limits: FREE_LIMITS,
    warnAt: WARN_AT,
    analyticsConfigured: Boolean(c.env.ANALYTICS_TOKEN && c.env.ACCOUNT_ID),
  });
});

type StoreInput = {
  code?: string;
  name?: string;
  name_ar?: string;
  pin?: string;
  lat?: number | null;
  lng?: number | null;
  radius_m?: number;
  espresso_mode?: EspressoMode;
  active?: boolean;
  city?: string;
  region?: string;
  area_manager?: string;
  rom?: string;
};

function validateStoreInput(b: StoreInput, creating: boolean): string | null {
  if (creating || b.code !== undefined) if (!/^[A-Z0-9-]{2,16}$/.test(String(b.code ?? '').toUpperCase())) return 'bad_code';
  if (creating || b.name !== undefined) if (!String(b.name ?? '').trim()) return 'bad_name';
  if (creating || b.pin) if (!/^\d{4,8}$/.test(String(b.pin ?? ''))) return 'bad_pin';
  if (b.lat != null && (typeof b.lat !== 'number' || Math.abs(b.lat) > 90)) return 'bad_location';
  if (b.lng != null && (typeof b.lng !== 'number' || Math.abs(b.lng) > 180)) return 'bad_location';
  if (b.radius_m !== undefined && !(Number.isInteger(b.radius_m) && b.radius_m >= 50 && b.radius_m <= 5000)) return 'bad_radius';
  if (b.espresso_mode !== undefined && !['pair', 'single'].includes(b.espresso_mode)) return 'bad_mode';
  return null;
}

app.post('/api/admin/stores', requireAdmin, async (c) => {
  const b = await readBody<StoreInput>(c);
  const bad = validateStoreInput(b, true);
  if (bad) return err(c, 400, bad);
  const salt = randomId(12);
  const hash = await hashPin(String(b.pin), salt, c.env.SESSION_SECRET);
  try {
    const r = await c.env.DB.prepare(
      `INSERT INTO stores (code, name, name_ar, pin_hash, pin_salt, lat, lng, radius_m, espresso_mode, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) RETURNING id`,
    )
      .bind(
        String(b.code).toUpperCase(),
        String(b.name).trim(),
        String(b.name_ar ?? '').trim(),
        hash,
        salt,
        b.lat ?? null,
        b.lng ?? null,
        b.radius_m ?? GEOFENCE_DEFAULT_M,
        b.espresso_mode ?? 'pair',
        Date.now(),
      )
      .first<{ id: number }>();
    return c.json({ id: r?.id });
  } catch (e) {
    return String(e).includes('UNIQUE') ? err(c, 409, 'code_taken') : err(c, 500, 'failed');
  }
});

app.put('/api/admin/stores/:id', requireAdmin, async (c) => {
  const id = Number(c.req.param('id'));
  const b = await readBody<StoreInput>(c);
  const bad = validateStoreInput(b, false);
  if (bad) return err(c, 400, bad);
  const sets: string[] = [];
  const vals: unknown[] = [];
  const set = (col: string, v: unknown) => {
    vals.push(v);
    sets.push(`${col} = ?${vals.length}`);
  };
  if (b.code !== undefined) set('code', String(b.code).toUpperCase());
  if (b.name !== undefined) set('name', String(b.name).trim());
  if (b.name_ar !== undefined) set('name_ar', String(b.name_ar).trim());
  if ('lat' in b) set('lat', b.lat ?? null);
  if ('lng' in b) set('lng', b.lng ?? null);
  if (b.radius_m !== undefined) set('radius_m', b.radius_m);
  if (b.espresso_mode !== undefined) set('espresso_mode', b.espresso_mode);
  if (b.active !== undefined) set('active', b.active ? 1 : 0);
  for (const k of ['city', 'region', 'area_manager', 'rom'] as const) if (b[k] !== undefined) set(k, String(b[k]).trim().slice(0, 80));
  if (b.pin) {
    const salt = randomId(12);
    set('pin_salt', salt);
    set('pin_hash', await hashPin(String(b.pin), salt, c.env.SESSION_SECRET));
    sets.push('pin_ver = pin_ver + 1', 'fail_count = 0', 'locked_until = 0'); // signs out all devices of this store
  }
  if (!sets.length) return c.json({ ok: true });
  vals.push(id);
  try {
    await c.env.DB.prepare(`UPDATE stores SET ${sets.join(', ')} WHERE id = ?${vals.length}`)
      .bind(...vals)
      .run();
  } catch (e) {
    return String(e).includes('UNIQUE') ? err(c, 409, 'code_taken') : err(c, 500, 'failed');
  }
  return c.json({ ok: true });
});

app.get('/api/admin/log', requireAdmin, async (c) => {
  const id = Number(c.req.query('store'));
  const day = c.req.query('day') ?? dayKey(Date.now(), tz(c.env));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return err(c, 400, 'bad_day');
  const store = await c.env.DB.prepare('SELECT * FROM stores WHERE id = ?1').bind(id).first<StoreRow>();
  if (!store) return err(c, 404, 'not_found');
  return c.json({ day, store: storeInfo(store), batches: await batchesFor(c.env, id, [day]) });
});

/** Give stores a new random 6-digit PIN. Returns the PINs once (they are stored hashed). */
app.post('/api/admin/pins', requireAdmin, async (c) => {
  const { ids, onlyMissing } = await readBody<{ ids?: number[]; onlyMissing?: boolean }>(c);
  const { results } = await c.env.DB.prepare(`SELECT id, code, name, pin_hash FROM stores WHERE active = 1 ORDER BY code`).all<{
    id: number;
    code: string;
    name: string;
    pin_hash: string;
  }>();
  const targets = results.filter((s) => (ids?.length ? ids.includes(s.id) : true) && (!onlyMissing || !s.pin_hash));
  const out: { id: number; code: string; name: string; pin: string }[] = [];
  const stmts: D1PreparedStatement[] = [];
  for (const s of targets) {
    const pin = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
    const salt = randomId(12);
    stmts.push(
      c.env.DB.prepare(
        `UPDATE stores SET pin_salt = ?1, pin_hash = ?2, pin_ver = pin_ver + 1, fail_count = 0, locked_until = 0 WHERE id = ?3`,
      ).bind(salt, await hashPin(pin, salt, c.env.SESSION_SECRET), s.id),
    );
    out.push({ id: s.id, code: s.code, name: s.name, pin });
  }
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json({ pins: out });
});

/** Discarded drip per store and bean, for a range of days (max 92). */
app.get('/api/admin/waste', requireAdmin, async (c) => {
  const today = dayKey(Date.now(), tz(c.env));
  const from = c.req.query('from') ?? today;
  const to = c.req.query('to') ?? today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return err(c, 400, 'bad_range');
  // per slot: [discarded ml, discard count, batches, dose-1 shots thrown, dose-2 shots thrown, espresso thrown (0.1 g)]
  const totals: Record<string, Record<string, number[]>> = {};
  const add = (sid: string, slot: string, v: number[]) => {
    const t = ((totals[sid] ??= {})[slot] ??= [0, 0, 0, 0, 0, 0]);
    for (let i = 0; i < 6; i++) t[i] += v[i] ?? 0;
  };
  // finished days come from the nightly summary (1 row per day)
  const { results } = await c.env.DB.prepare('SELECT day, data FROM stats_daily WHERE day >= ?1 AND day <= ?2')
    .bind(from, to)
    .all<{ day: string; data: string }>();
  const covered = new Set(results.map((r) => r.day));
  for (const r of results) {
    const d = safeJson<Record<string, Record<string, number[]>>>(r.data, {});
    for (const [sid, slots] of Object.entries(d)) for (const [slot, v] of Object.entries(slots)) add(sid, slot, v);
  }
  // today (and any day not summarised yet) are computed live
  const missing: string[] = [];
  for (let d = from; d <= to && missing.length < 93; d = nextDay(d)) if (!covered.has(d) && d <= today) missing.push(d);
  for (const day of missing) {
    for (const r of await aggregateDay(c.env, day)) add(String(r.sid), r.slot, [r.ml, r.n, r.batches, r.w1, r.w2, r.wg]);
  }
  return c.json({ from, to, today, totals });
});

app.post('/api/admin/usage/refresh', requireAdmin, async (c) => {
  if (!c.env.ANALYTICS_TOKEN || !c.env.ACCOUNT_ID) return err(c, 400, 'analytics_not_configured');
  const snap = await refreshUsage(c.env);
  return c.json({ usage: snap });
});

app.all('/api/*', (c) => err(c, 404, 'not_found'));

// ---------------------------------------------------------------- scheduled jobs

async function refreshUsage(env: Env): Promise<UsageSnapshot> {
  const snap = await fetchUsage(env.ACCOUNT_ID!, env.ANALYTICS_TOKEN!);
  await env.DB.prepare(`INSERT INTO meta (k, v) VALUES ('usage', ?1) ON CONFLICT (k) DO UPDATE SET v = excluded.v`)
    .bind(JSON.stringify(snap))
    .run();
  return snap;
}

async function sendExpiryPushes(env: Env, scheduled: number) {
  if (!env.VAPID_PRIVATE_JWK || !env.VAPID_PUBLIC_KEY) return;
  const end = Math.floor(scheduled / 60000) * 60000;
  const start = end - 60000;
  const [today, yesterday] = todayAndYesterday(env, end);
  // Batches that expired during the last minute and were not replaced by a newer batch of the same slot.
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT d.store_id AS sid
     FROM days d, json_each(d.batches) j
     WHERE d.day IN (?1, ?2)
       AND json_extract(j.value, '$.x') > ?3 AND json_extract(j.value, '$.x') <= ?4
       AND json_extract(j.value, '$.v') IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM json_each(d.batches) k
         WHERE json_extract(k.value, '$.s') = json_extract(j.value, '$.s')
           AND json_extract(k.value, '$.t') > json_extract(j.value, '$.t')
           AND json_extract(k.value, '$.v') IS NULL)`,
  )
    .bind(today, yesterday, start, end)
    .all<{ sid: number }>();
  if (!results.length) return;
  const ids = results.map((r) => r.sid);
  const subs = await env.DB.prepare(`SELECT endpoint FROM push_subs WHERE store_id IN (${ids.map((_, i) => `?${i + 1}`).join(',')})`)
    .bind(...ids)
    .all<{ endpoint: string }>();
  const subject = env.PUBLIC_ORIGIN || 'https://hm-calibration.workers.dev';
  const gone: string[] = [];
  await Promise.all(
    subs.results.map(async ({ endpoint }) => {
      try {
        const alive = await sendTickle(endpoint, { publicKey: env.VAPID_PUBLIC_KEY, privateJwk: env.VAPID_PRIVATE_JWK!, subject });
        if (!alive) gone.push(endpoint);
      } catch {
        /* network hiccup: try again next expiry */
      }
    }),
  );
  if (gone.length) {
    await env.DB.batch(gone.map((e) => env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?1').bind(e)));
  }
}

function nextDay(day: string) {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Totals for one day, computed inside the database (keeps Worker CPU tiny). Reset batches are ignored. */
async function aggregateDay(env: Env, day: string) {
  const { results } = await env.DB.prepare(
    `SELECT d.store_id AS sid, json_extract(j.value, '$.s') AS slot,
            SUM(COALESCE(json_extract(j.value, '$.dl'), 0)) AS ml,
            SUM(CASE WHEN COALESCE(json_extract(j.value, '$.dl'), 0) > 0 THEN 1 ELSE 0 END) AS n,
            COUNT(*) AS batches,
            SUM(COALESCE(json_extract(j.value, '$.w1'), 0)) AS w1,
            SUM(COALESCE(json_extract(j.value, '$.w2'), 0)) AS w2,
            SUM(COALESCE(json_extract(j.value, '$.wg'),
                COALESCE(json_extract(j.value, '$.w1'), 0) * 188 + COALESCE(json_extract(j.value, '$.w2'), 0) * 258)) AS wg
     FROM days d, json_each(d.batches) j
     WHERE d.day = ?1 AND json_extract(j.value, '$.v') IS NULL
     GROUP BY d.store_id, slot`,
  )
    .bind(day)
    .all<{ sid: number; slot: string; ml: number; n: number; batches: number; w1: number; w2: number; wg: number }>();
  return results;
}

/** Nightly: summarise yesterday (and fill any gaps in the last week), then delete data older than 92 days. */
async function nightly(env: Env) {
  const now = Date.now();
  const days: string[] = [];
  for (let i = 1; i <= 7; i++) days.push(dayKey(now - i * 24 * 3600 * 1000, tz(env)));
  const { results: have } = await env.DB.prepare(
    `SELECT day FROM stats_daily WHERE day IN (${days.map((_, i) => `?${i + 1}`).join(',')})`,
  )
    .bind(...days)
    .all<{ day: string }>();
  const done = new Set(have.map((r) => r.day));
  for (const day of days) {
    if (done.has(day) && day !== days[0]) continue;
    const rows = await aggregateDay(env, day);
    const data: Record<string, Record<string, number[]>> = {};
    for (const r of rows) (data[r.sid] ??= {})[r.slot] = [r.ml, r.n, r.batches, r.w1, r.w2, r.wg];
    await env.DB.prepare(`INSERT INTO stats_daily (day, data) VALUES (?1, ?2) ON CONFLICT (day) DO UPDATE SET data = excluded.data`)
      .bind(day, JSON.stringify(data))
      .run();
  }
  const keep = Number(env.RETENTION_DAYS || 92);
  const cutoff = dayKey(now - keep * 24 * 3600 * 1000, tz(env));
  await env.DB.batch([
    env.DB.prepare('DELETE FROM days WHERE day < ?1').bind(cutoff),
    env.DB.prepare('DELETE FROM stats_daily WHERE day < ?1').bind(cutoff),
  ]);
}

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (event.cron === '30 21 * * *') ctx.waitUntil(nightly(env));
    else if (event.cron === '7 * * * *') {
      if (env.ANALYTICS_TOKEN && env.ACCOUNT_ID) ctx.waitUntil(refreshUsage(env).then(() => undefined));
    } else ctx.waitUntil(sendExpiryPushes(env, event.scheduledTime));
  },
} satisfies ExportedHandler<Env>;
