import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { adminApi, type AdminStore, type ChecksResponse } from '../lib/api';
import { addDays } from '../lib/time';

type GroupBy = 'store' | 'area_manager' | 'rom' | 'city';
const RANGES = [
  { key: 'today', label: 'Today', days: 1 },
  { key: '7', label: '7 days', days: 7 },
  { key: '30', label: '30 days', days: 30 },
  { key: '92', label: '92 days', days: 92 },
] as const;

interface Row {
  key: string;
  label: string;
  sub: string;
  stores: number;
  expected: number;
  done: number;
  passed: number;
  failing: number;
  failedFirst: number;
  coarse: number;
  fine: number;
  uneven: number;
  low: number;
  high: number;
  retested: number;
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

export function ChecksPanel({ stores, today, filterNote }: { stores: AdminStore[]; today: string; filterNote?: string }) {
  const [range, setRange] = useState<(typeof RANGES)[number]['key']>('7');
  const [groupBy, setGroupBy] = useState<GroupBy>('store');
  const [data, setData] = useState<ChecksResponse | null>(null);

  useEffect(() => {
    const days = RANGES.find((r) => r.key === range)!.days;
    setData(null);
    adminApi
      .checks(addDays(today, -(days - 1)), today)
      .then(setData)
      .catch(() => toast.error('Could not load grind checks'));
  }, [range, today]);

  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    const byId = new Map(data.rows.map((r) => [r.sid, r]));
    const groups = new Map<string, Row>();
    for (const s of stores.filter((x) => x.active)) {
      const key = groupBy === 'store' ? String(s.id) : (s[groupBy] || 'Unassigned').trim();
      let g = groups.get(key);
      if (!g) {
        g = {
          key,
          label: groupBy === 'store' ? s.name : key,
          sub: groupBy === 'store' ? [s.code, s.city, s.area_manager].filter(Boolean).join(' · ') : '',
          stores: 0, expected: 0, done: 0, passed: 0, failing: 0, failedFirst: 0, coarse: 0, fine: 0, uneven: 0, low: 0, high: 0, retested: 0,
        };
        groups.set(key, g);
      }
      g.stores++;
      g.expected += data.expected;
      const r = byId.get(s.id);
      if (!r) continue;
      g.done += r.done;
      g.passed += r.passed;
      g.failing += r.failing;
      g.failedFirst += r.failed_first;
      g.coarse += r.coarse;
      g.fine += r.fine;
      g.uneven += r.uneven;
      g.low += r.low;
      g.high += r.high;
      g.retested += r.retested;
    }
    // worst compliance first, then most failures
    return [...groups.values()].sort((a, b) => pct(a.done, a.expected) - pct(b.done, b.expected) || b.failedFirst - a.failedFirst || a.label.localeCompare(b.label));
  }, [data, stores, groupBy]);

  const total = rows.reduce(
    (t, r) => ({ expected: t.expected + r.expected, done: t.done + r.done, passed: t.passed + r.passed, failing: t.failing + r.failing, failedFirst: t.failedFirst + r.failedFirst, coarse: t.coarse + r.coarse, fine: t.fine + r.fine, uneven: t.uneven + r.uneven, low: t.low + r.low, high: t.high + r.high }),
    { expected: 0, done: 0, passed: 0, failing: 0, failedFirst: 0, coarse: 0, fine: 0, uneven: 0, low: 0, high: 0 },
  );

  const exportCsv = () => {
    const head = ['Group', 'Detail', 'Checks expected', 'Checks done', 'Done %', 'Passed', 'Still failing', 'Failed first try', 'Too coarse', 'Too fine', 'Uneven / weighing', 'TDS low', 'TDS high', 'Re-tested'];
    const lines = rows.map((r) => [r.label, r.sub, r.expected, r.done, pct(r.done, r.expected), r.passed, r.failing, r.failedFirst, r.coarse, r.fine, r.uneven, r.low, r.high, r.retested]);
    const csv = [head, ...lines].map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `HM-grind-checks-${groupBy}-${data?.from}-to-${data?.to}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  return (
    <section className="card">
      <div className="admin-row">
        <h2 className="card-title">Grind &amp; TDS checks</h2>
        <div className="segmented">
          {RANGES.map((r) => (
            <button key={r.key} data-active={range === r.key || undefined} onClick={() => setRange(r.key)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="waste-totals">
        <div className="waste-total">
          <div className="waste-total-label">Checks done</div>
          <div className="waste-total-value num">{data ? `${pct(total.done, total.expected)}%` : '–'}</div>
          <div className="waste-total-sub num">
            {total.done} of {total.expected} due · 2 shifts × 2 beans a day
          </div>
        </div>
        <div className="waste-total" data-tone="bra">
          <div className="waste-total-label">Passed</div>
          <div className="waste-total-value num">{data ? `${pct(total.passed, total.done)}%` : '–'}</div>
          <div className="waste-total-sub num">
            {total.passed} passed · {total.failing} still failing
          </div>
        </div>
        <div className="waste-total" data-tone="eth">
          <div className="waste-total-label">Grind problems (first try)</div>
          <div className="waste-total-value num">{data ? total.coarse + total.fine + total.uneven : '–'}</div>
          <div className="waste-total-sub num">
            Coarse {total.coarse} · Fine {total.fine} · Uneven {total.uneven}
          </div>
        </div>
        <div className="waste-total" data-tone="esp">
          <div className="waste-total-label">TDS problems (first try)</div>
          <div className="waste-total-value num">{data ? total.low + total.high : '–'}</div>
          <div className="waste-total-sub num">
            Low {total.low} · High {total.high}
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
        <span className="muted">
          A check is due for each bean once per shift (morning 04:00–16:00, evening 16:00–04:00) and counts as missed an hour after the shift starts. Targets: top 10–11 g, middle 4–5 g, base 4–5 g of 20 g;
          hot drip TDS 1.30–1.80 %. Worst stores first.
        </span>
        {filterNote && <span className="status-chip" data-warn>Filtered: {filterNote}</span>}
      </div>

      {!data ? (
        <div className="skeleton-list">{[0, 1, 2, 3].map((i) => <div className="skeleton" key={i} />)}</div>
      ) : rows.length === 0 ? (
        <p className="empty">No stores.</p>
      ) : total.expected === 0 && total.done === 0 ? (
        <p className="empty">No checks are due yet in this period.</p>
      ) : (
        <div className="checks-admin" role="table">
          <div className="ca-tr ca-th" role="row">
            <span>{groupBy === 'store' ? 'Store' : groupBy === 'rom' ? 'ROM' : groupBy === 'city' ? 'City' : 'Area manager'}</span>
            <span>Done</span>
            <span className="num">Passed</span>
            <span className="num">Failing</span>
            <span className="num">Coarse</span>
            <span className="num">Fine</span>
            <span className="num">Uneven</span>
            <span className="num">TDS low</span>
            <span className="num">TDS high</span>
          </div>
          {rows.map((r, i) => {
            const done = pct(r.done, r.expected);
            return (
              <motion.div
                key={r.key}
                className="ca-tr"
                role="row"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: Math.min(i, 12) * 0.015, ease: [0.23, 1, 0.32, 1] }}
              >
                <span className="waste-name">
                  <b>{r.label}</b>
                  <small>{groupBy === 'store' ? r.sub : `${r.stores} stores`}</small>
                </span>
                <span className="ca-done" data-level={done >= 90 ? 'good' : done >= 60 ? 'mid' : 'bad'}>
                  <span className="ca-bar">
                    <span style={{ width: `${Math.min(100, done)}%` }} />
                  </span>
                  <span className="num">
                    {done}% <small className="muted">{r.done}/{r.expected}</small>
                  </span>
                </span>
                <span className="num">{r.done ? `${pct(r.passed, r.done)}%` : '–'}</span>
                <span className="num" data-bad={r.failing || undefined}>{r.failing || '–'}</span>
                <span className="num">{r.coarse || '–'}</span>
                <span className="num">{r.fine || '–'}</span>
                <span className="num">{r.uneven || '–'}</span>
                <span className="num">{r.low || '–'}</span>
                <span className="num">{r.high || '–'}</span>
              </motion.div>
            );
          })}
        </div>
      )}
      {data && <p className="footnote">{data.from === data.to ? data.from : `${data.from} → ${data.to}`} · shift days, store time</p>}
    </section>
  );
}
