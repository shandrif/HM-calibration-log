import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { adminApi, ApiError, type AdminOverview, type AdminStore } from '../lib/api';
import { Logo } from '../components/Logo';
import { Sheet } from '../components/Sheet';
import { LogView } from '../components/LogView';
import { getFix } from '../lib/geo';
import { setServerNow, shortDuration } from '../lib/time';
import type { StoreInfo } from '../../shared/config';
import { WastePanel } from './Waste';
import { ChecksPanel } from './Checks';
import { formatGrams, dripTenths, tanksFor, DEFAULT_TANKS, MAX_TANKS } from '../../shared/config';
import { BatchesPanel } from './Batches';

// Head-office screen. English only (internal tool).

export function Admin() {
  const [state, setState] = useState<'loading' | 'login' | 'ready'>('loading');
  const [data, setData] = useState<AdminOverview | null>(null);
  const [edit, setEdit] = useState<Partial<AdminStore> | null>(null);
  const [viewing, setViewing] = useState<AdminStore | null>(null);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'stores' | 'waste' | 'batches' | 'checks'>('stores');
  const [filter, setFilter] = useState({ city: '', rom: '', area_manager: '' });
  const [pinList, setPinList] = useState<{ code: string; name: string; pin: string }[] | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await adminApi.overview();
      setServerNow(d.now);
      setData(d);
      setState('ready');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setState('login');
      else toast.error('Could not load');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const s = q.trim().toLowerCase();
    return data.stores.filter(
      (x) =>
        (!s || [x.code, x.name, x.name_ar, x.city, x.area_manager, x.rom, x.syrve_code].some((v) => (v || '').toLowerCase().includes(s))) &&
        (!filter.city || x.city === filter.city) &&
        (!filter.rom || x.rom === filter.rom) &&
        (!filter.area_manager || x.area_manager === filter.area_manager),
    );
  }, [data, q, filter]);

  const options = useMemo(() => {
    const uniq = (k: 'city' | 'rom' | 'area_manager') => [...new Set((data?.stores ?? []).map((s) => s[k]).filter(Boolean))].sort();
    return { city: uniq('city'), rom: uniq('rom'), area_manager: uniq('area_manager') };
  }, [data]);

  const generatePins = async (body: { ids?: number[]; onlyMissing?: boolean }) => {
    try {
      const r = await adminApi.pins(body);
      if (!r.pins.length) return toast('Every active store already has a PIN.');
      setPinList(r.pins);
      void load();
    } catch {
      toast.error('Could not generate PINs');
    }
  };

  if (state === 'loading') return <div className="splash"><Logo size={56} /></div>;
  if (state === 'login') return <AdminLogin onDone={load} />;
  if (!data) return null;

  const stat = (id: number) => data.stats.find((s) => s.id === id);

  return (
    <div className="admin" dir="ltr" lang="en">
      <header className="admin-top">
        <Logo size={34} />
        <div className="topbar-title">
          <div className="topbar-store">Head office</div>
          <div className="topbar-sub">Calibration Log · {data.stores.length} stores</div>
        </div>
        <button
          className="btn btn-ghost"
          onClick={async () => {
            await adminApi.logout().catch(() => {});
            setState('login');
          }}
        >
          Sign out
        </button>
      </header>

      <main className="admin-main">
        <div className="segmented admin-tabs">
          <button data-active={tab === 'stores' || undefined} onClick={() => setTab('stores')}>
            Stores
          </button>
          <button data-active={tab === 'waste' || undefined} onClick={() => setTab('waste')}>
            Bean waste
          </button>
          <button data-active={tab === 'batches' || undefined} onClick={() => setTab('batches')}>
            Batches
          </button>
          <button data-active={tab === 'checks' || undefined} onClick={() => setTab('checks')}>
            Grind checks
          </button>
        </div>

        {tab === 'checks' ? (
          <ChecksPanel stores={filtered} today={data.today} filterNote={[filter.city, filter.rom, filter.area_manager, q.trim()].filter(Boolean).join(' · ')} />
        ) : tab === 'batches' ? (
          <BatchesPanel stores={filtered} today={data.today} />
        ) : tab === 'waste' ? (
          <WastePanel stores={filtered} today={data.today} filterNote={[filter.city, filter.rom, filter.area_manager, q.trim()].filter(Boolean).join(' · ')} />
        ) : (
          <>
        <Usage data={data} onRefresh={load} />

        <section className="card">
          <div className="admin-row">
            <h2 className="card-title">
              Stores <span className="muted small">{filtered.length} of {data.stores.length}</span>
            </h2>
            <input className="input admin-search" placeholder="Search code, name, manager" value={q} onChange={(e) => setQ(e.target.value)} />
            {data.stores.some((s) => s.active && !s.has_pin) && (
              <button className="btn btn-ghost" onClick={() => generatePins({ onlyMissing: true })}>
                Generate missing PINs ({data.stores.filter((s) => s.active && !s.has_pin).length})
              </button>
            )}
            <button className="btn btn-primary" onClick={() => setEdit({ espresso_mode: 'pair', radius_m: 500, active: 1 })}>
              Add store
            </button>
          </div>
          <div className="filters">
            {(
              [
                ['city', 'All cities'],
                ['rom', 'All ROMs'],
                ['area_manager', 'All area managers'],
              ] as const
            ).map(([k, all]) => (
              <select key={k} className="input select" value={filter[k]} onChange={(e) => setFilter((f) => ({ ...f, [k]: e.target.value }))}>
                <option value="">{all}</option>
                {options[k].map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ))}
            {(filter.city || filter.rom || filter.area_manager) && (
              <button className="btn btn-ghost" onClick={() => setFilter({ city: '', rom: '', area_manager: '' })}>
                Clear
              </button>
            )}
          </div>
          {filtered.length === 0 ? (
            <p className="empty">No stores yet. Add the first one.</p>
          ) : (
            <div className="store-grid">
              {filtered.map((s, i) => {
                const st = stat(s.id);
                const lastAgo = st?.last_at ? data.now - st.last_at : null;
                const stale = lastAgo == null || lastAgo > 90 * 60 * 1000;
                return (
                  <motion.div
                    key={s.id}
                    className="store-card"
                    data-inactive={!s.active || undefined}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: Math.min(i, 10) * 0.02, ease: [0.23, 1, 0.32, 1] }}
                  >
                    <div className="store-card-head">
                      <span className="store-code">
                        {s.code}
                        {s.syrve_code && <span className="muted small"> · {s.syrve_code}</span>}
                      </span>
                      {!s.has_pin ? (
                        <span className="status-chip" data-warn>No PIN</span>
                      ) : (
                      <span className="status-chip" data-on={!stale || undefined} title="Last log">
                        {lastAgo == null ? 'No logs today' : lastAgo < 60000 ? 'Just now' : `${shortDuration(lastAgo, 'min')} ago`}
                      </span>
                      )}
                    </div>
                    <div className="store-name">{s.name}</div>
                    {s.name_ar && <div className="store-name-ar" dir="rtl">{s.name_ar}</div>}
                    {(s.city || s.area_manager) && (
                      <div className="store-people">
                        {s.city && <span>{s.city}</span>}
                        {s.area_manager && <span>AM: {titleCase(s.area_manager)}</span>}
                        {s.rom && <span>ROM: {titleCase(s.rom)}</span>}
                      </div>
                    )}
                    <div className="store-meta">
                      <span>{st?.logs ?? 0} logs</span>
                      <span>{formatGrams(dripTenths(st?.discarded_ml ?? 0))} drip discarded</span>
                      <span title={s.coord_evidence}>{s.lat != null ? `GPS ${s.radius_m} m${s.coord_evidence && s.coord_evidence !== 'Confirmed' ? ' (unconfirmed)' : ''}` : 'No GPS lock'}</span>
                      <span>{s.espresso_mode === 'single' ? '1 espresso' : 'Hot + cold'}</span>
                    </div>
                    <div className="btn-row">
                      <button className="btn btn-ghost" onClick={() => setViewing(s)}>
                        Logs & PDF
                      </button>
                      <button className="btn btn-ghost" onClick={() => setEdit(s)}>
                        Edit
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
          <p className="footnote">Store list, cities, area managers and ROMs sync weekly from Master_Location_Mapping.xlsx.</p>
        </section>
          </>
        )}
      </main>

      <Sheet open={!!pinList} onOpenChange={(o) => !o && setPinList(null)} title="New store PINs">
        {pinList && (
          <div className="sheet-body sheet-scroll" dir="ltr">
            <p className="sheet-text">
              These PINs are shown <b>only once</b>. Download the list now and send each store its own PIN.
            </p>
            <button
              className="btn btn-primary btn-lg"
              onClick={() => {
                const csv = ['Store code,Store name,PIN', ...pinList.map((p) => `"${p.code}","${p.name.replace(/"/g, '""')}","${p.pin}"`)].join('\n');
                const a = document.createElement('a');
                a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
                a.download = `HM-store-PINs-${data.today}.csv`;
                a.click();
              }}
            >
              Download PINs (CSV)
            </button>
            <div className="pin-list">
              {pinList.map((p) => (
                <div key={p.code} className="pin-row">
                  <span className="store-code">{p.code}</span>
                  <span className="pin-name">{p.name}</span>
                  <span className="num pin">{p.pin}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Sheet>

      <StoreEditor
        value={edit}
        onClose={() => setEdit(null)}
        onSaved={() => {
          setEdit(null);
          void load();
        }}
      />

      <Sheet open={!!viewing} onOpenChange={(o) => !o && setViewing(null)} title={viewing ? `${viewing.code} · ${viewing.name}` : ''}>
        {viewing && (
          <div className="sheet-body sheet-scroll">
            <LogView store={toInfo(viewing)} fetchDay={(d) => adminApi.log(viewing.id, d)} fetchDays={() => adminApi.logDays(viewing.id)} />
          </div>
        )}
      </Sheet>
    </div>
  );
}

function titleCase(s: string) {
  return s.toLowerCase().replace(/(^|[\s(-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
}

function toInfo(s: AdminStore): StoreInfo {
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    name_ar: s.name_ar,
    espresso_mode: s.espresso_mode,
    staff: [],
    last_doses: {},
    geofence: s.lat != null,
    beans: {},
    tanks: (() => { try { return JSON.parse(s.tanks || '{}'); } catch { return {}; } })(),
  };
}

function Usage({ data, onRefresh }: { data: AdminOverview; onRefresh: () => void }) {
  const u = data.usage;
  const rows = u
    ? [
        { label: 'Requests today (whole account)', used: u.requests, limit: data.limits.requests, fmt: (n: number) => n.toLocaleString() },
        { label: 'Database rows written today', used: u.rowsWritten, limit: data.limits.rowsWritten, fmt: (n: number) => n.toLocaleString() },
        { label: 'Database rows read today', used: u.rowsRead, limit: data.limits.rowsRead, fmt: (n: number) => n.toLocaleString() },
        { label: 'Database storage', used: u.storageBytes, limit: data.limits.storageBytes, fmt: (n: number) => `${(n / 1024 ** 2).toFixed(1)} MB` },
      ]
    : [];
  const hot = rows.filter((r) => r.used / r.limit >= data.warnAt);
  return (
    <section className="card">
      <div className="admin-row">
        <h2 className="card-title">Free-tier usage</h2>
        {data.analyticsConfigured && (
          <button
            className="btn btn-ghost"
            onClick={async () => {
              try {
                await adminApi.refreshUsage();
                onRefresh();
              } catch {
                toast.error('Could not refresh usage');
              }
            }}
          >
            Refresh
          </button>
        )}
      </div>
      {hot.length > 0 && (
        <div className="warn" role="alert">
          ⚠️ {hot.map((h) => h.label).join(', ')} {hot.length > 1 ? 'are' : 'is'} above {Math.round(data.warnAt * 100)}% of the free limit. Plan the move to Workers Paid ($5/month).
        </div>
      )}
      {!data.analyticsConfigured ? (
        <p className="card-text muted">Usage tracking is off. Add an ANALYTICS_TOKEN secret (Cloudflare token with Account Analytics: Read) to turn it on.</p>
      ) : !u ? (
        <p className="card-text muted">First reading arrives within the hour.</p>
      ) : (
        <>
          {u.error && <p className="card-text muted">Last check failed: {u.error}</p>}
          <div className="meters">
            {rows.map((r) => {
              const pct = Math.min(1, r.used / r.limit);
              return (
                <div className="meter" key={r.label} data-level={pct >= data.warnAt ? 'warn' : pct >= 0.5 ? 'mid' : 'ok'}>
                  <div className="meter-head">
                    <span>{r.label}</span>
                    <span className="num">{Math.round(pct * 100)}%</span>
                  </div>
                  <div className="meter-track">
                    <motion.div className="meter-fill" initial={{ scaleX: 0 }} animate={{ scaleX: pct }} transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1] }} />
                  </div>
                  <div className="meter-foot num">
                    {r.fmt(r.used)} / {r.fmt(r.limit)}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="footnote">
            Limits reset daily at 03:00 store time (00:00 UTC). Checked {shortDuration(Date.now() - u.at, 'min')} ago.
          </p>
        </>
      )}
    </section>
  );
}

function AdminLogin({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="login" dir="ltr">
      <div className="liquid-blob" aria-hidden />
      <motion.form
        className="login-card"
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45, ease: [0.23, 1, 0.32, 1] }}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMsg('');
          try {
            await adminApi.login(pw);
            onDone();
          } catch {
            setMsg('Wrong password.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <Logo size={56} />
        <h1 className="login-title">Head office</h1>
        <label className="field">
          <span>Admin password</span>
          <input className="input input-lg" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required />
        </label>
        {msg && <p className="login-msg">{msg}</p>}
        <button className="btn btn-primary btn-lg" disabled={busy || !pw}>
          Sign in
        </button>
      </motion.form>
    </div>
  );
}

function parseLocation(input: string): { lat: number; lng: number } | null {
  // accepts "24.71, 46.67" or a Google Maps link containing @lat,lng or q=lat,lng
  const m = input.match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

const DRIP_SLOTS = ['hot_drip:ethiopian', 'hot_drip:brazilian', 'iced_drip:ethiopian', 'iced_drip:brazilian'];

function StoreEditor({ value, onClose, onSaved }: { value: Partial<AdminStore> | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Partial<AdminStore> & { pin?: string; loc?: string }>({});
  const [busy, setBusy] = useState(false);
  const [tanks, setTanks] = useState<Record<string, number>>({});
  useEffect(() => {
    if (value) setF({ ...value, pin: '', loc: value.lat != null ? `${value.lat}, ${value.lng}` : '' });
    if (value) {
      let saved: Record<string, number> = {};
      try {
        saved = JSON.parse(value.tanks || '{}');
      } catch {
        /* keep defaults */
      }
      setTanks(Object.fromEntries(DRIP_SLOTS.map((k) => [k, tanksFor(saved, k)])));
    }
  }, [value]);
  const creating = !value?.id;
  const set = (k: string, v: unknown) => setF((x) => ({ ...x, [k]: v }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const loc = f.loc?.trim() ? parseLocation(f.loc) : null;
    if (f.loc?.trim() && !loc) return toast.error('Location must look like "24.7136, 46.6753" or be a Google Maps link.');
    const body = {
      code: f.code,
      name: f.name,
      name_ar: f.name_ar ?? '',
      lat: loc?.lat ?? null,
      lng: loc?.lng ?? null,
      radius_m: Number(f.radius_m) || 500,
      espresso_mode: f.espresso_mode,
      tanks,
      active: !!f.active,
      ...(value?.source === 'master' ? {} : { city: f.city ?? '', area_manager: f.area_manager ?? '', rom: f.rom ?? '' }),
      ...(f.pin ? { pin: f.pin } : {}),
    };
    setBusy(true);
    try {
      if (creating) await adminApi.createStore({ ...body, pin: f.pin ?? '' });
      else await adminApi.updateStore(value!.id!, body);
      toast.success(creating ? 'Store added' : 'Store saved');
      onSaved();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'failed';
      toast.error(
        {
          bad_code: 'Code: 2–16 letters, numbers or dashes.',
          bad_pin: 'PIN: 4–8 digits.',
          bad_name: 'Name is required.',
          code_taken: 'That store code already exists.',
          bad_radius: 'Radius: 50–5000 m.',
          bad_tanks: `Drip tanks: 1–${MAX_TANKS} each.`,
        }[code] ?? 'Could not save.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={!!value} onOpenChange={(o) => !o && onClose()} title={creating ? 'Add store' : `Edit ${value?.code ?? ''}`}>
      <form className="sheet-body form-grid" onSubmit={save} dir="ltr">
        <label className="field">
          <span>Store code</span>
          <input className="input" value={f.code ?? ''} onChange={(e) => set('code', e.target.value.toUpperCase())} required placeholder="RIY031" disabled={value?.source === 'master'} />
        </label>
        <label className="field">
          <span>{creating ? 'PIN' : 'New PIN (leave empty to keep; changing signs out the store)'}</span>
          <div className="add-row">
            <input className="input num" inputMode="numeric" value={f.pin ?? ''} onChange={(e) => set('pin', e.target.value.replace(/\D/g, ''))} maxLength={8} required={creating} />
            <button type="button" className="btn btn-ghost" onClick={() => set('pin', String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000)))}>
              Random
            </button>
          </div>
        </label>
        <label className="field">
          <span>Name (English)</span>
          <input className="input" value={f.name ?? ''} onChange={(e) => set('name', e.target.value)} required />
        </label>
        <label className="field">
          <span>Name (Arabic)</span>
          <input className="input" dir="rtl" value={f.name_ar ?? ''} onChange={(e) => set('name_ar', e.target.value)} />
        </label>
        <label className="field field-wide">
          <span>Store location (lat, lng or Google Maps link) — empty = no location lock</span>
          <div className="add-row">
            <input className="input" value={f.loc ?? ''} onChange={(e) => set('loc', e.target.value)} placeholder="24.7136, 46.6753" />
            <button
              type="button"
              className="btn btn-ghost"
              onClick={async () => {
                try {
                  const fix = await getFix(15000);
                  if (fix) set('loc', `${fix.lat.toFixed(6)}, ${fix.lng.toFixed(6)}`);
                  else toast.error('Could not get location');
                } catch {
                  toast.error('Location permission denied');
                }
              }}
            >
              Use my location
            </button>
          </div>
        </label>
        {(['city', 'area_manager', 'rom'] as const).map((k) => (
          <label className="field" key={k}>
            <span>{{ city: 'City', area_manager: 'Area manager', rom: 'ROM' }[k]}{value?.source === 'master' ? ' (from master file)' : ''}</span>
            <input className="input" value={(f[k] as string) ?? ''} onChange={(e) => set(k, e.target.value)} disabled={value?.source === 'master'} />
          </label>
        ))}
        <label className="field">
          <span>Allowed radius (m)</span>
          <input className="input num" inputMode="numeric" value={f.radius_m ?? 500} onChange={(e) => set('radius_m', e.target.value.replace(/\D/g, ''))} />
        </label>
        <div className="field">
          <span>Espresso machines</span>
          <div className="segmented">
            <button type="button" data-active={f.espresso_mode !== 'single' || undefined} onClick={() => set('espresso_mode', 'pair')}>
              Hot + cold
            </button>
            <button type="button" data-active={f.espresso_mode === 'single' || undefined} onClick={() => set('espresso_mode', 'single')}>
              One for both
            </button>
          </div>
        </div>
        <div className="field field-wide">
          <span>Drip tanks — how many tanks each drip coffee can be brewed into at the same time</span>
          <div className="tank-settings">
            {DRIP_SLOTS.map((k) => {
              const n = tanks[k] ?? DEFAULT_TANKS;
              const [station, bean] = k.split(':');
              return (
                <div className="tank-setting" key={k}>
                  <span>
                    {station === 'hot_drip' ? 'Hot' : 'Iced'} · {bean === 'ethiopian' ? 'Ethiopian' : 'Brazilian'}
                  </span>
                  <div className="tank-stepper">
                    <button type="button" className="counter-btn" aria-label="Fewer tanks" disabled={n <= 1} onClick={() => setTanks((x) => ({ ...x, [k]: n - 1 }))}>
                      −
                    </button>
                    <b className="num">{n}</b>
                    <button type="button" className="counter-btn" aria-label="More tanks" disabled={n >= MAX_TANKS} onClick={() => setTanks((x) => ({ ...x, [k]: n + 1 }))}>
                      +
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <label className="field field-check">
          <input type="checkbox" checked={!!f.active} onChange={(e) => set('active', e.target.checked)} />
          <span>Active</span>
        </label>
        <button className="btn btn-primary btn-lg field-wide" disabled={busy}>
          {creating ? 'Add store' : 'Save'}
        </button>
      </form>
    </Sheet>
  );
}
