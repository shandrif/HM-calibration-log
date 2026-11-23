import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { adminApi, type AdminStore, type WasteResponse } from '../lib/api';
import { addDays } from '../lib/time';

type GroupBy = 'store' | 'area_manager' | 'rom' | 'city';
const RANGES = [
  { key: 'today', label: 'Today', days: 1 },
  { key: '7', label: '7 days', days: 7 },
  { key: '30', label: '30 days', days: 30 },
  { key: '92', label: '92 days', days: 92 },
] as const;

const L = (ml: number) => (ml / 1000).toFixed(ml % 1000 === 0 ? 0 : 2).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');

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
        });
      groups.get(key)!.stores++;
    }
    for (const [sid, slots] of Object.entries(data.totals)) {
      const s = byId.get(sid);
      if (!s) continue;
      const key = groupBy === 'store' ? sid : (s[groupBy] || 'Unassigned').trim();
      const g = groups.get(key);
      if (!g) continue;
      for (const [slot, [ml, n, batches, w1 = 0, w2 = 0]] of Object.entries(slots)) {
        g.w1 += w1;
        g.w2 += w2;
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
    (t, r) => ({ eth: t.eth + r.eth, bra: t.bra + r.bra, ethHot: t.ethHot + r.ethHot, ethIced: t.ethIced + r.ethIced, braHot: t.braHot + r.braHot, braIced: t.braIced + r.braIced, events: t.events + r.events, w1: t.w1 + r.w1, w2: t.w2 + r.w2 }),
    { eth: 0, bra: 0, ethHot: 0, ethIced: 0, braHot: 0, braIced: 0, events: 0, w1: 0, w2: 0 },
  );
  const max = Math.max(1, ...rows.map((r) => r.eth + r.bra));
  const withWaste = rows.filter((r) => r.eth + r.bra + r.w1 + r.w2 > 0);
  const storesWithWaste = groupBy === 'store' ? withWaste.length : rows.filter((r) => r.eth + r.bra > 0).reduce((a, r) => a + r.stores, 0);

  const exportCsv = () => {
    const head = ['Group', 'Detail', 'Ethiopian L', 'Ethiopian hot L', 'Ethiopian iced L', 'Brazilian L', 'Brazilian hot L', 'Brazilian iced L', 'Total drip L', 'Drip discard events', 'Drip batches', 'Espresso dose 1 shots thrown', 'Espresso dose 2 shots thrown'];
    const lines = rows.map((r) => [r.label, r.sub, L(r.eth), L(r.ethHot), L(r.ethIced), L(r.bra), L(r.braHot), L(r.braIced), L(r.eth + r.bra), r.events, r.batches, r.w1, r.w2]);
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
          <div className="waste-total-label">Total discarded</div>
          <div className="waste-total-value num">{data ? L(total.eth + total.bra) : '–'} <small>L</small></div>
          <div className="waste-total-sub">
            {total.events} discards · {storesWithWaste} of {stores.length} stores
          </div>
        </div>
        <div className="waste-total" data-tone="esp">
          <div className="waste-total-label">
            <i className="dot-esp" /> Espresso shots thrown
          </div>
          <div className="waste-total-value num">{data ? total.w1 + total.w2 : '–'}</div>
          <div className="waste-total-sub num">
            Dose 1: {total.w1} · Dose 2: {total.w2}
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
        <span><i className="dot-esp" /> Espresso shots</span>
        <span className="muted">Drip is split by bean; espresso shows shots thrown while calibrating. Reset batches are excluded.</span>
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
            <span className="num">Drip total</span>
            <span className="num">Shots D1 / D2</span>
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
              <span className="num" title={`Hot ${L(r.ethHot)} L · Iced ${L(r.ethIced)} L`}>{L(r.eth)} L</span>
              <span className="num" title={`Hot ${L(r.braHot)} L · Iced ${L(r.braIced)} L`}>{L(r.bra)} L</span>
              <span className="num"><b>{L(r.eth + r.bra)} L</b></span>
              <span className="num" title="Espresso shots thrown: dose 1 / dose 2">{r.w1} / {r.w2}</span>
              <span className="waste-bar-col">
                <span className="waste-bar" style={{ width: `${((r.eth + r.bra) / max) * 100}%` }}>
                  <span className="seg-eth" style={{ flexGrow: r.eth }} />
                  <span className="seg-bra" style={{ flexGrow: r.bra }} />
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
        {loading ? '–' : L(ml)} <small>L</small>
      </div>
      <div className="waste-total-sub num">
        Hot {L(hot)} L · Iced {L(iced)} L
      </div>
    </div>
  );
}
