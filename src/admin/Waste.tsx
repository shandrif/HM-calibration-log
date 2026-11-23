import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { adminApi, type AdminStore, type WasteResponse } from '../lib/api';
import { addDays } from '../lib/time';
import { formatGrams, dripTenths } from '../../shared/config';

type GroupBy = 'store' | 'area_manager' | 'rom' | 'city';
const RANGES = [
  { key: 'today', label: 'Today', days: 1 },
  { key: '7', label: '7 days', days: 7 },
  { key: '30', label: '30 days', days: 30 },
  { key: '92', label: '92 days', days: 92 },
] as const;

/** Drip ml → coffee weight text (1 L = 70 g). */
const G = (ml: number) => formatGrams(dripTenths(ml));
const g1 = (tenths: number) => (tenths / 10).toFixed(1);

interface Row {
  key: string;
  label: string;
  sub: string;
  eth: number;
  bra: number;
  ethHot: number;
  ethIced: number;
  braHot: number;
  braIced: number;
  events: number;
  batches: number;
  stores: number;
  w1: number;
  w2: number;
  wg: number;
}

export function WastePanel({ stores, today, filterNote }: { stores: AdminStore[]; today: string; filterNote?: string }) {
  const [range, setRange] = useState<(typeof RANGES)[number]['key']>('7');
  const [groupBy, setGroupBy] = useState<GroupBy>('store');
  const [data, setData] = useState<WasteResponse | null>(null);

  useEffect(() => {
    const days = RANGES.find((r) => r.key === range)!.days;
    setData(null);
    adminApi
      .waste(addDays(today, -(days - 1)), today)
      .then(setData)
      .catch(() => toast.error('Could not load waste'));
  }, [range, today]);

  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    const byId = new Map(stores.map((s) => [String(s.id), s]));
    const groups = new Map<string, Row>();
    for (const s of stores) {
      const key = groupBy === 'store' ? String(s.id) : (s[groupBy] || 'Unassigned').trim();
      if (!groups.has(key))
        groups.set(key, {
          key,
          label: groupBy === 'store' ? s.name : key,
          sub: groupBy === 'store' ? [s.code, s.city, s.area_manager].filter(Boolean).join(' · ') : '',
          eth: 0,
          bra: 0,
          ethHot: 0,
          ethIced: 0,
          braHot: 0,
          braIced: 0,
          events: 0,
          batches: 0,
          stores: 0,
          w1: 0,
          w2: 0,
          wg: 0,
        });
      groups.get(key)!.stores++;
    }
    for (const [sid, slots] of Object.entries(data.totals)) {
      const s = byId.get(sid);
      if (!s) continue;
      const key = groupBy === 'store' ? sid : (s[groupBy] || 'Unassigned').trim();
      const g = groups.get(key);
      if (!g) continue;
      for (const [slot, [ml, n, batches, w1 = 0, w2 = 0, wg = 0]] of Object.entries(slots)) {
        g.w1 += w1;
        g.w2 += w2;
        g.wg += wg;
        if (slot.startsWith('espresso')) continue;
        g.batches += batches;
        if (!ml) continue;
        g.events += n;
        if (slot === 'hot_drip:ethiopian') (g.eth += ml), (g.ethHot += ml);
        if (slot === 'iced_drip:ethiopian') (g.eth += ml), (g.ethIced += ml);
        if (slot === 'hot_drip:brazilian') (g.bra += ml), (g.braHot += ml);
        if (slot === 'iced_drip:brazilian') (g.bra += ml), (g.braIced += ml);
      }
    }
    return [...groups.values()].sort((a, b) => b.eth + b.bra - (a.eth + a.bra) || a.label.localeCompare(b.label));
  }, [data, stores, groupBy]);

  const total = rows.reduce(
    (t, r) => ({ eth: t.eth + r.eth, bra: t.bra + r.bra, ethHot: t.ethHot + r.ethHot, ethIced: t.ethIced + r.ethIced, braHot: t.braHot + r.braHot, braIced: t.braIced + r.braIced, events: t.events + r.events, w1: t.w1 + r.w1, w2: t.w2 + r.w2, wg: t.wg + r.wg }),
    { eth: 0, bra: 0, ethHot: 0, ethIced: 0, braHot: 0, braIced: 0, events: 0, w1: 0, w2: 0, wg: 0 },
  );
  const grams = (r: { eth: number; bra: number; wg: number }) => dripTenths(r.eth) + dripTenths(r.bra) + r.wg;
  const max = Math.max(1, ...rows.map(grams));
  const withWaste = rows.filter((r) => r.eth + r.bra + r.w1 + r.w2 > 0);
  const storesWithWaste = groupBy === 'store' ? withWaste.length : rows.filter((r) => r.eth + r.bra > 0).reduce((a, r) => a + r.stores, 0);

  const exportCsv = () => {
    const head = ['Group', 'Detail', 'Ethiopian g', 'Ethiopian hot g', 'Ethiopian iced g', 'Brazilian g', 'Brazilian hot g', 'Brazilian iced g', 'Drip total g', 'Drip discard events', 'Drip batches', 'Espresso dose 1 shots thrown', 'Espresso dose 2 shots thrown', 'Espresso thrown g', 'Total coffee wasted g'];
    const d = (ml: number) => g1(dripTenths(ml));
    const lines = rows.map((r) => [r.label, r.sub, d(r.eth), d(r.ethHot), d(r.ethIced), d(r.bra), d(r.braHot), d(r.braIced), d(r.eth + r.bra), r.events, r.batches, r.w1, r.w2, g1(r.wg), g1(grams(r))]);
    const csv = [head, ...lines].map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `HM-drip-waste-${groupBy}-${data?.from}-to-${data?.to}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  return (
    <section className="card">
      <div className="admin-row">
        <h2 className="card-title">Waste by bean</h2>
        <div className="segmented">
          {RANGES.map((r) => (
            <button key={r.key} data-active={range === r.key || undefined} onClick={() => setRange(r.key)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="waste-totals">
        <Total label="Ethiopian" ml={total.eth} hot={total.ethHot} iced={total.ethIced} tone="eth" loading={!data} />
        <Total label="Brazilian" ml={total.bra} hot={total.braHot} iced={total.braIced} tone="bra" loading={!data} />
        <div className="waste-total">
          <div className="waste-total-label">Total coffee wasted</div>
          <div className="waste-total-value num">{data ? formatGrams(grams(total)) : '–'}</div>
          <div className="waste-total-sub">
            Drip {G(total.eth + total.bra)} · Espresso {formatGrams(total.wg)} · {storesWithWaste} of {stores.length} stores
          </div>
        </div>
        <div className="waste-total" data-tone="esp">
          <div className="waste-total-label">
            <i className="dot-esp" /> Espresso thrown
          </div>
          <div className="waste-total-value num">{data ? formatGrams(total.wg) : '–'}</div>
          <div className="waste-total-sub num">
            Dose 1 ×{total.w1} (18.8 g) · Dose 2 ×{total.w2} (25.8 g)
          </div>
        </div>
      </div>

      <div className="admin-row">
        <span className="muted small">Group by</span>
        <div className="segmented">
          {(
            [
              ['store', 'Store'],
              ['area_manager', 'Area manager'],
              ['rom', 'ROM'],
              ['city', 'City'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} data-active={groupBy === k || undefined} onClick={() => setGroupBy(k)}>
              {label}
            </button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <button className="btn btn-ghost" onClick={exportCsv} disabled={!data}>
          Export CSV
        </button>
      </div>

      <div className="waste-legend">
        <span><i className="dot-eth" /> Ethiopian</span>
        <span><i className="dot-bra" /> Brazilian</span>
        <span><i className="dot-esp" /> Espresso</span>
        <span className="muted">All in coffee weight. Drip: 1 L brewed = 70 g. Espresso: dose 1 = 18.8 g, dose 2 = 25.8 g per shot thrown. Reset batches are excluded.</span>
        {filterNote && <span className="status-chip" data-warn>Filtered: {filterNote}</span>}
      </div>

      {!data ? (
        <div className="skeleton-list">{[0, 1, 2, 3].map((i) => <div className="skeleton" key={i} />)}</div>
      ) : withWaste.length === 0 ? (
        <p className="empty">Nothing was discarded in this period.</p>
      ) : (
        <div className="waste-table" role="table">
          <div className="waste-tr waste-th" role="row">
            <span>{groupBy === 'store' ? 'Store' : groupBy === 'rom' ? 'ROM' : groupBy === 'city' ? 'City' : 'Area manager'}</span>
            <span className="num">Ethiopian</span>
            <span className="num">Brazilian</span>
            <span className="num">Espresso</span>
            <span className="num">Total</span>
            <span className="waste-bar-col" />
          </div>
          {withWaste.map((r, i) => (
            <motion.div
              key={r.key}
              className="waste-tr"
              role="row"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: Math.min(i, 12) * 0.015, ease: [0.23, 1, 0.32, 1] }}
            >
              <span className="waste-name">
                <b>{r.label}</b>
                <small>{groupBy === 'store' ? r.sub : `${r.stores} stores`}</small>
              </span>
              <span className="num" title={`Hot ${G(r.ethHot)} · Iced ${G(r.ethIced)}`}>{r.eth ? G(r.eth) : '–'}</span>
              <span className="num" title={`Hot ${G(r.braHot)} · Iced ${G(r.braIced)}`}>{r.bra ? G(r.bra) : '–'}</span>
              <span className="num" title={`Dose 1 ×${r.w1} · Dose 2 ×${r.w2}`}>{r.wg ? formatGrams(r.wg) : '–'}</span>
              <span className="num"><b>{formatGrams(grams(r))}</b></span>
              <span className="waste-bar-col">
                <span className="waste-bar" style={{ width: `${(grams(r) / max) * 100}%` }}>
                  <span className="seg-eth" style={{ flexGrow: dripTenths(r.eth) }} />
                  <span className="seg-bra" style={{ flexGrow: dripTenths(r.bra) }} />
                  <span className="seg-esp" style={{ flexGrow: r.wg }} />
                </span>
              </span>
            </motion.div>
          ))}
        </div>
      )}
      {data && <p className="footnote">{data.from === data.to ? data.from : `${data.from} → ${data.to}`} · store time</p>}
    </section>
  );
}

function Total({ label, ml, hot, iced, tone, loading }: { label: string; ml: number; hot: number; iced: number; tone: 'eth' | 'bra'; loading: boolean }) {
  return (
    <div className="waste-total" data-tone={tone}>
      <div className="waste-total-label">
        <i className={`dot-${tone}`} /> {label}
      </div>
      <div className="waste-total-value num">
        {loading ? '–' : G(ml)}
      </div>
      <div className="waste-total-sub num">
        Hot {G(hot)} · Iced {G(iced)}
      </div>
    </div>
  );
}
