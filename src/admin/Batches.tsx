import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { adminApi, type AdminStore, type BatchesResponse } from '../lib/api';
import { addDays } from '../lib/time';
import { formatDose, formatGrams, beanOf, type BeanKey } from '../../shared/config';
import { Sheet } from '../components/Sheet';

const RANGES = [
  { key: '7', label: '7 days', days: 7 },
  { key: '30', label: '30 days', days: 30 },
  { key: '92', label: '92 days', days: 92 },
] as const;
const BEAN_LABEL: Record<BeanKey, string> = { espresso: 'Espresso', ethiopian: 'Ethiopian', brazilian: 'Brazilian' };
const BEAN_ORDER: Record<BeanKey, number> = { espresso: 0, ethiopian: 1, brazilian: 2 };

interface StoreAgg {
  sid: number;
  logs: number;
  ml: number;
  wg: number;
  w1: number;
  w2: number;
  first: string;
  last: string;
}
interface BatchAgg {
  key: string;
  bn: string;
  bean: BeanKey;
  stores: Map<number, StoreAgg>;
  logs: number;
  hotLogs: number;
  icedLogs: number;
  ml: number;
  mlHot: number;
  mlIced: number;
  discards: number;
  w1: number;
  w2: number;
  wg: number;
  espLogs: number;
  sd1: number;
  sd2: number;
  mn1: number | null;
  mx1: number | null;
  mn2: number | null;
  mx2: number | null;
  first: string;
  last: string;
}

const L = (ml: number) => (ml / 1000).toFixed(2).replace(/\.?0+$/, '') || '0';
/** Average grinder setting rounded to the 5-step scale (6:33 → 6:35). */
const avgDose = (sum: number, n: number) => (n ? formatDose(Math.round(sum / n / 5) * 5) : '–');

export function BatchesPanel({ stores, today }: { stores: AdminStore[]; today: string }) {
  const [range, setRange] = useState<(typeof RANGES)[number]['key']>('30');
  const [bean, setBean] = useState<BeanKey | 'all'>('all');
  const [q, setQ] = useState('');
  const [data, setData] = useState<BatchesResponse | null>(null);
  const [open, setOpen] = useState<BatchAgg | null>(null);

  useEffect(() => {
    const days = RANGES.find((r) => r.key === range)!.days;
    setData(null);
    adminApi
      .batches(addDays(today, -(days - 1)), today)
      .then(setData)
      .catch(() => toast.error('Could not load batches'));
  }, [range, today]);

  const storeById = useMemo(() => new Map(stores.map((s) => [s.id, s])), [stores]);

  const batches = useMemo(() => {
    if (!data) return [];
    const allowed = new Set(stores.map((s) => s.id));
    const m = new Map<string, BatchAgg>();
    for (const r of data.rows) {
      if (!allowed.has(r.sid)) continue;
      const b = beanOf(r.slot);
      const key = `${b}|${r.bn}`;
      let a = m.get(key);
      if (!a)
        m.set(
          key,
          (a = { key, bn: r.bn, bean: b, stores: new Map(), logs: 0, hotLogs: 0, icedLogs: 0, ml: 0, mlHot: 0, mlIced: 0, discards: 0, w1: 0, w2: 0, wg: 0, espLogs: 0, sd1: 0, sd2: 0, mn1: null, mx1: null, mn2: null, mx2: null, first: r.first, last: r.last }),
        );
      const [logs, ml, n, w1, w2, wg, sd1, sd2] = r.v;
      a.logs += logs;
      a.ml += ml;
      a.discards += n;
      a.w1 += w1;
      a.w2 += w2;
      a.wg += wg;
      if (r.slot.startsWith('iced')) (a.icedLogs += logs), (a.mlIced += ml);
      else if (r.slot.startsWith('hot')) (a.hotLogs += logs), (a.mlHot += ml);
      if (b === 'espresso') {
        a.espLogs += logs;
        a.sd1 += sd1;
        a.sd2 += sd2;
        a.mn1 = a.mn1 == null ? r.mn1 : r.mn1 == null ? a.mn1 : Math.min(a.mn1, r.mn1);
        a.mx1 = a.mx1 == null ? r.mx1 : r.mx1 == null ? a.mx1 : Math.max(a.mx1, r.mx1);
        a.mn2 = a.mn2 == null ? r.mn2 : r.mn2 == null ? a.mn2 : Math.min(a.mn2, r.mn2);
        a.mx2 = a.mx2 == null ? r.mx2 : r.mx2 == null ? a.mx2 : Math.max(a.mx2, r.mx2);
      }
      if (r.first < a.first) a.first = r.first;
      if (r.last > a.last) a.last = r.last;
      const s = a.stores.get(r.sid) ?? { sid: r.sid, logs: 0, ml: 0, wg: 0, w1: 0, w2: 0, first: r.first, last: r.last };
      s.logs += logs;
      s.ml += ml;
      s.wg += wg;
      s.w1 += w1;
      s.w2 += w2;
      if (r.first < s.first) s.first = r.first;
      if (r.last > s.last) s.last = r.last;
      a.stores.set(r.sid, s);
    }
    const needle = q.trim().toUpperCase();
    return [...m.values()]
      .filter((a) => (bean === 'all' || a.bean === bean) && (!needle || a.bn.includes(needle)))
      .sort((x, y) => BEAN_ORDER[x.bean] - BEAN_ORDER[y.bean] || wastePer(y) - wastePer(x) || y.logs - x.logs);
  }, [data, stores, bean, q]);

  const exportCsv = () => {
    const head = ['Batch', 'Bean', 'Stores', 'Calibrations', 'Drip discarded L', 'Drip L per batch brewed', 'Espresso thrown g', 'Espresso g per calibration', 'Dose 1 avg', 'Dose 1 range', 'Dose 2 avg', 'Dose 2 range', 'First day', 'Last day'];
    const lines = batches.map((a) => [
      a.bn,
      BEAN_LABEL[a.bean],
      a.stores.size,
      a.logs,
      a.bean === 'espresso' ? '' : L(a.ml),
      a.bean === 'espresso' ? '' : L(a.logs ? a.ml / a.logs : 0),
      a.bean === 'espresso' ? (a.wg / 10).toFixed(1) : '',
      a.bean === 'espresso' && a.logs ? (a.wg / 10 / a.logs).toFixed(1) : '',
      a.bean === 'espresso' ? avgDose(a.sd1, a.espLogs) : '',
      a.bean === 'espresso' && a.mn1 != null ? `${formatDose(a.mn1)}–${formatDose(a.mx1)}` : '',
      a.bean === 'espresso' ? avgDose(a.sd2, a.espLogs) : '',
      a.bean === 'espresso' && a.mn2 != null ? `${formatDose(a.mn2)}–${formatDose(a.mx2)}` : '',
      a.first,
      a.last,
    ]);
    const csv = [head, ...lines].map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const el = document.createElement('a');
    el.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    el.download = `HM-batches-${data?.from}-to-${data?.to}.csv`;
    el.click();
  };

  return (
    <section className="card">
      <div className="admin-row">
        <h2 className="card-title">Results by bean batch</h2>
        <div className="segmented">
          {RANGES.map((r) => (
            <button key={r.key} data-active={range === r.key || undefined} onClick={() => setRange(r.key)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div className="admin-row">
        <div className="segmented">
          {(['all', 'espresso', 'ethiopian', 'brazilian'] as const).map((b) => (
            <button key={b} data-active={bean === b || undefined} onClick={() => setBean(b)}>
              {b === 'all' ? 'All beans' : BEAN_LABEL[b]}
            </button>
          ))}
        </div>
        <input className="input admin-search" placeholder="Search batch number" value={q} onChange={(e) => setQ(e.target.value)} />
        <span style={{ flex: 1 }} />
        <button className="btn btn-ghost" onClick={exportCsv} disabled={!batches.length}>
          Export CSV
        </button>
      </div>
      <p className="muted small" style={{ marginTop: 0 }}>
        Grouped by bean, highest waste per calibration first. Tap a batch to see each store. Drip: litres thrown per batch brewed. Espresso: grams thrown per calibration and the grinder settings used.
      </p>

      {!data ? (
        <div className="skeleton-list">{[0, 1, 2].map((i) => <div className="skeleton" key={i} />)}</div>
      ) : batches.length === 0 ? (
        <p className="empty">No calibrations with a batch number in this period yet.</p>
      ) : (
        <div className="batch-table">
          <div className="batch-tr batch-th">
            <span>Batch</span>
            <span>Stores</span>
            <span className="num">Calibr.</span>
            <span className="num">Waste</span>
            <span className="num">Per calibr.</span>
            <span>Grinder (avg)</span>
            <span>Used</span>
          </div>
          {batches.map((a, i) => (
            <motion.button
              key={a.key}
              className="batch-tr"
              onClick={() => setOpen(a)}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: Math.min(i, 12) * 0.015, ease: [0.23, 1, 0.32, 1] }}
            >
              <span className="batch-name">
                <b className="num">#{a.bn}</b>
                <small>
                  <i className={a.bean === 'espresso' ? 'dot-esp' : a.bean === 'ethiopian' ? 'dot-eth' : 'dot-bra'} /> {BEAN_LABEL[a.bean]}
                </small>
              </span>
              <span>{a.stores.size}</span>
              <span className="num">{a.logs}</span>
              <span className="num">{a.bean === 'espresso' ? formatGrams(a.wg) : `${L(a.ml)} L`}</span>
              <span className="num">
                <b>{a.bean === 'espresso' ? (a.logs ? formatGrams(Math.round(a.wg / a.logs)) : '–') : `${L(a.logs ? a.ml / a.logs : 0)} L`}</b>
              </span>
              <span className="num">{a.bean === 'espresso' ? `${avgDose(a.sd1, a.espLogs)} · ${avgDose(a.sd2, a.espLogs)}` : '—'}</span>
              <span className="num small muted">{a.first === a.last ? a.first.slice(5) : `${a.first.slice(5)} → ${a.last.slice(5)}`}</span>
            </motion.button>
          ))}
        </div>
      )}

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)} title={open ? `#${open.bn} · ${BEAN_LABEL[open.bean]}` : ''}>
        {open && (
          <div className="sheet-body sheet-scroll" dir="ltr">
            <div className="batch-kpis">
              <Kpi label="Stores" value={String(open.stores.size)} />
              <Kpi label="Calibrations" value={String(open.logs)} />
              {open.bean === 'espresso' ? (
                <>
                  <Kpi label="Thrown" value={formatGrams(open.wg)} sub={`D1 ×${open.w1} · D2 ×${open.w2}`} />
                  <Kpi label="Dose 1 avg" value={avgDose(open.sd1, open.espLogs)} sub={open.mn1 != null ? `${formatDose(open.mn1)} – ${formatDose(open.mx1)}` : ''} />
                  <Kpi label="Dose 2 avg" value={avgDose(open.sd2, open.espLogs)} sub={open.mn2 != null ? `${formatDose(open.mn2)} – ${formatDose(open.mx2)}` : ''} />
                </>
              ) : (
                <>
                  <Kpi label="Discarded" value={`${L(open.ml)} L`} sub={`Hot ${L(open.mlHot)} · Iced ${L(open.mlIced)}`} />
                  <Kpi label="Per batch brewed" value={`${L(open.logs ? open.ml / open.logs : 0)} L`} sub={`${open.discards} discards`} />
                </>
              )}
            </div>
            <div className="batch-stores">
              {[...open.stores.values()]
                .sort((x, y) => (open.bean === 'espresso' ? y.wg - x.wg : y.ml - x.ml) || y.logs - x.logs)
                .map((s) => {
                  const st = storeById.get(s.sid);
                  return (
                    <div className="batch-store" key={s.sid}>
                      <span className="batch-name">
                        <b>{st?.name ?? s.sid}</b>
                        <small>{[st?.code, st?.city, st?.area_manager].filter(Boolean).join(' · ')}</small>
                      </span>
                      <span className="num">{s.logs} calibr.</span>
                      <span className="num">
                        <b>{open.bean === 'espresso' ? formatGrams(s.wg) : `${L(s.ml)} L`}</b>
                      </span>
                      <span className="num small muted">{s.first === s.last ? s.first.slice(5) : `${s.first.slice(5)} → ${s.last.slice(5)}`}</span>
                    </div>
                  );
                })}
            </div>
          </div>
        )}
      </Sheet>
    </section>
  );
}

function wastePer(a: BatchAgg) {
  if (!a.logs) return 0;
  return a.bean === 'espresso' ? a.wg / a.logs : a.ml / a.logs;
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="batch-kpi">
      <div className="muted small">{label}</div>
      <div className="batch-kpi-value num">{value}</div>
      {sub && <div className="muted small num">{sub}</div>}
    </div>
  );
}
