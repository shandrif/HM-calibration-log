import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { adminApi, type AdminStore, type BatchesResponse } from '../lib/api';
import { addDays } from '../lib/time';
import { formatDose, formatGrams, beanOf, dripTenths, type BeanKey } from '../../shared/config';
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

/** Drip ml → coffee weight text (1 L = 70 g). */
const G = (ml: number) => formatGrams(dripTenths(ml));
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

  const exportXlsx = async () => {
    if (!data) return;
    const grams = (a: { bean: BeanKey; ml: number; wg: number }) => (a.bean === 'espresso' ? a.wg / 10 : dripTenths(a.ml) / 10);
    const kg = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)} kg` : `${v.toFixed(1)} g`);
    const period = data.from === data.to ? data.from : `${data.from} → ${data.to}`;
    const byBean = (b: BeanKey) => batches.filter((a) => a.bean === b);
    const sumOf = (list: BatchAgg[], f: (a: BatchAgg) => number) => list.reduce((x, a) => x + f(a), 0);
    const drip = batches.filter((a) => a.bean !== 'espresso');
    const esp = byBean('espresso');
    const ranked = [...batches].filter((a) => a.logs).sort((x, y) => grams(y) / y.logs - grams(x) / x.logs).slice(0, 12);
    const { hBars, donut, BEAN_COLOR } = await import('./charts');
    const { exportReport } = await import('./xlsx');
    const beans: BeanKey[] = ['espresso', 'ethiopian', 'brazilian'];
    await exportReport({
      file: `HM-batches-${data.from}-to-${data.to}.xlsx`,
      title: 'Results by bean batch',
      period,
      filters: [bean !== 'all' ? BEAN_LABEL[bean] : '', q.trim()].filter(Boolean).join(' · ') || undefined,
      kpis: [
        { label: 'Batches tracked', value: String(batches.length), sub: beans.map((b) => `${BEAN_LABEL[b]} ${byBean(b).length}`).join(' · '), tone: 'plain' },
        { label: 'Calibrations', value: String(sumOf(batches, (a) => a.logs)), sub: beans.map((b) => `${BEAN_LABEL[b]} ${sumOf(byBean(b), (a) => a.logs)}`).join(' · '), tone: 'good' },
        { label: 'Drip discarded', value: kg(sumOf(drip, grams)), sub: `Ethiopian ${kg(sumOf(byBean('ethiopian'), grams))} · Brazilian ${kg(sumOf(byBean('brazilian'), grams))}`, tone: 'eth' },
        { label: 'Espresso thrown', value: kg(sumOf(esp, grams)), sub: `Dose 1 ×${sumOf(esp, (a) => a.w1)} · Dose 2 ×${sumOf(esp, (a) => a.w2)}`, tone: 'esp' },
      ],
      charts: [
        donut({
          title: 'Calibrations by bean',
          parts: beans.map((b) => ({ name: BEAN_LABEL[b], color: BEAN_COLOR[b], value: sumOf(byBean(b), (a) => a.logs) })),
          fmt: (v) => String(Math.round(v)),
        }),
        donut({
          title: 'Waste by bean',
          sub: 'Coffee weight',
          parts: beans.map((b) => ({ name: BEAN_LABEL[b], color: BEAN_COLOR[b], value: sumOf(byBean(b), grams) })),
          fmt: kg,
        }),
        hBars({
          title: 'Highest waste per calibration',
          sub: 'Top batches · grams wasted per calibration',
          labels: ranked.map((a) => `${a.bn} · ${BEAN_LABEL[a.bean]}`),
          series: beans.map((b) => ({ name: BEAN_LABEL[b], color: BEAN_COLOR[b], values: ranked.map((a) => (a.bean === b ? grams(a) / a.logs : 0)) })),
          fmt: (v) => `${v.toFixed(1)} g`,
          w: 1120,
        }),
      ],
      notes: [
        'Waste is coffee weight: drip 1 L brewed = 70 g; espresso dose 1 = 18.8 g, dose 2 = 25.8 g per shot thrown.',
        'Dose settings are the grinder settings logged at calibration (average rounded to the 5-step scale).',
        'Only calibrations with a batch number are included. Reset batches are excluded.',
      ],
      sheets: [
        {
          name: 'Batches',
          title: `Bean batches · ${period}`,
          columns: [
            { header: 'Batch', key: 'bn', width: 16 },
            { header: 'Bean', key: 'bean', width: 12, bean: true },
            { header: 'Stores', key: 'stores', fmt: '0', width: 9 },
            { header: 'Calibrations', key: 'logs', fmt: '0', width: 12 },
            { header: 'Waste g', key: 'g', fmt: '#,##0.0', bar: '#C2564A', width: 12 },
            { header: 'g per calibration', key: 'per', fmt: '#,##0.0', bar: '#A9793B', width: 15 },
            { header: 'Drip discards', key: 'discards', fmt: '0', width: 12 },
            { header: 'Dose 1 shots thrown', key: 'w1', fmt: '0', width: 13 },
            { header: 'Dose 2 shots thrown', key: 'w2', fmt: '0', width: 13 },
            { header: 'Dose 1 avg', key: 'd1', width: 11 },
            { header: 'Dose 1 range', key: 'r1', width: 14 },
            { header: 'Dose 2 avg', key: 'd2', width: 11 },
            { header: 'Dose 2 range', key: 'r2', width: 14 },
            { header: 'First day', key: 'first', width: 12 },
            { header: 'Last day', key: 'last', width: 12 },
          ],
          rows: batches.map((a) => ({
            bn: a.bn, bean: BEAN_LABEL[a.bean], stores: a.stores.size, logs: a.logs, g: grams(a), per: a.logs ? grams(a) / a.logs : 0,
            discards: a.bean === 'espresso' ? null : a.discards, w1: a.bean === 'espresso' ? a.w1 : null, w2: a.bean === 'espresso' ? a.w2 : null,
            d1: a.bean === 'espresso' ? avgDose(a.sd1, a.espLogs) : '', r1: a.bean === 'espresso' && a.mn1 != null ? `${formatDose(a.mn1)}–${formatDose(a.mx1)}` : '',
            d2: a.bean === 'espresso' ? avgDose(a.sd2, a.espLogs) : '', r2: a.bean === 'espresso' && a.mn2 != null ? `${formatDose(a.mn2)}–${formatDose(a.mx2)}` : '',
            first: a.first, last: a.last,
          })),
        },
        {
          name: 'Batch by store',
          title: `Each batch per store · ${period}`,
          columns: [
            { header: 'Batch', key: 'bn', width: 16 },
            { header: 'Bean', key: 'bean', width: 12, bean: true },
            { header: 'Store', key: 'store', width: 30 },
            { header: 'Code', key: 'code', width: 10 },
            { header: 'City', key: 'city', width: 14 },
            { header: 'Area manager', key: 'am', width: 22 },
            { header: 'Calibrations', key: 'logs', fmt: '0', width: 12 },
            { header: 'Waste g', key: 'g', fmt: '#,##0.0', bar: '#C2564A', width: 12 },
            { header: 'g per calibration', key: 'per', fmt: '#,##0.0', width: 15 },
            { header: 'First day', key: 'first', width: 12 },
            { header: 'Last day', key: 'last', width: 12 },
          ],
          rows: batches.flatMap((a) =>
            [...a.stores.values()].map((st) => {
              const s = storeById.get(st.sid);
              const g = a.bean === 'espresso' ? st.wg / 10 : dripTenths(st.ml) / 10;
              return { bn: a.bn, bean: BEAN_LABEL[a.bean], store: s?.name ?? `#${st.sid}`, code: s?.code ?? '', city: s?.city ?? '', am: s?.area_manager ?? '', logs: st.logs, g, per: st.logs ? g / st.logs : 0, first: st.first, last: st.last };
            }),
          ),
        },
      ],
    });
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
        <button className="btn btn-ghost" onClick={() => void exportXlsx().catch(() => toast.error('Could not export'))} disabled={!batches.length}>
          Export Excel
        </button>
      </div>
      <p className="muted small" style={{ marginTop: 0 }}>
        Grouped by bean, highest waste per calibration first. Tap a batch to see each store. All waste in coffee weight (drip 1 L = 70 g). Espresso also shows the grinder settings used.
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
              <span className="num">{a.bean === 'espresso' ? formatGrams(a.wg) : G(a.ml)}</span>
              <span className="num">
                <b>{a.logs ? formatGrams(Math.round((a.bean === 'espresso' ? a.wg : dripTenths(a.ml)) / a.logs)) : '–'}</b>
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
                  <Kpi label="Discarded" value={G(open.ml)} sub={`Hot ${G(open.mlHot)} · Iced ${G(open.mlIced)}`} />
                  <Kpi label="Per batch brewed" value={open.logs ? formatGrams(Math.round(dripTenths(open.ml) / open.logs)) : '–'} sub={`${open.discards} discards`} />
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
                        <b>{open.bean === 'espresso' ? formatGrams(s.wg) : G(s.ml)}</b>
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
  return (a.bean === 'espresso' ? a.wg : dripTenths(a.ml)) / a.logs;
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
