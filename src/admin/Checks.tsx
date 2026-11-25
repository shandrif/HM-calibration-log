import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { adminApi, type AdminStore, type ChecksResponse } from '../lib/api';
import { addDays } from '../lib/time';

type GroupBy = 'store' | 'area_manager' | 'rom' | 'city';
type Bean = 'ethiopian' | 'brazilian';
const BEANS: Bean[] = ['ethiopian', 'brazilian'];
const BEAN_LABEL: Record<Bean, string> = { ethiopian: 'Ethiopian', brazilian: 'Brazilian' };
const RANGES = [
  { key: 'today', label: 'Today', days: 1 },
  { key: '7', label: '7 days', days: 7 },
  { key: '30', label: '30 days', days: 30 },
  { key: '92', label: '92 days', days: 92 },
] as const;

interface Stats {
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
const empty = (): Stats => ({ expected: 0, done: 0, passed: 0, failing: 0, failedFirst: 0, coarse: 0, fine: 0, uneven: 0, low: 0, high: 0, retested: 0 });
const add = (a: Stats, b: Stats) => {
  for (const k of Object.keys(a) as (keyof Stats)[]) a[k] += b[k];
};

interface Row {
  key: string;
  label: string;
  sub: string;
  stores: number;
  beans: Record<Bean, Stats>;
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

  // expected checks per store and bean (the server counts both beans together)
  const perBean = data ? data.expected / BEANS.length : 0;

  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    const byKey = new Map(data.rows.map((r) => [`${r.sid}:${r.bean}`, r]));
    const groups = new Map<string, Row>();
    for (const s of stores.filter((x) => x.active)) {
      const key = groupBy === 'store' ? String(s.id) : (s[groupBy] || 'Unassigned').trim();
      let g = groups.get(key);
      if (!g) {
        g = {
          key,
          label: groupBy === 'store' ? s.name : key,
          sub: groupBy === 'store' ? [s.code, s.city, s.area_manager].filter(Boolean).join(' · ') : '',
          stores: 0,
          beans: { ethiopian: empty(), brazilian: empty() },
        };
        groups.set(key, g);
      }
      g.stores++;
      for (const bean of BEANS) {
        const st = g.beans[bean];
        st.expected += perBean;
        const r = byKey.get(`${s.id}:${bean}`);
        if (!r) continue;
        add(st, {
          expected: 0, done: r.done, passed: r.passed, failing: r.failing, failedFirst: r.failed_first,
          coarse: r.coarse, fine: r.fine, uneven: r.uneven, low: r.low, high: r.high, retested: r.retested,
        });
      }
      // a check done early (e.g. before it was due) still counts as done, never above 100 %
      for (const bean of BEANS) g.beans[bean].expected = Math.max(g.beans[bean].expected, g.beans[bean].done);
    }
    // worst first: lowest done % (nothing due yet = last), then still failing, then most problems
    const worst = (r: Row) => Math.min(...BEANS.map((b) => (r.beans[b].expected ? pct(r.beans[b].done, r.beans[b].expected) : 101)));
    const failing = (r: Row) => BEANS.reduce((a, b) => a + r.beans[b].failing, 0);
    const fails = (r: Row) => BEANS.reduce((a, b) => a + r.beans[b].failedFirst, 0);
    return [...groups.values()].sort((a, b) => worst(a) - worst(b) || failing(b) - failing(a) || fails(b) - fails(a) || a.label.localeCompare(b.label));
  }, [data, stores, groupBy, perBean]);

  const totals = useMemo(() => {
    const t: Record<Bean, Stats> = { ethiopian: empty(), brazilian: empty() };
    for (const r of rows) for (const b of BEANS) add(t[b], r.beans[b]);
    return t;
  }, [rows]);

  const exportXlsx = async () => {
    if (!data) return;
    const groupName = groupBy === 'store' ? 'Store' : groupBy === 'rom' ? 'ROM' : groupBy === 'city' ? 'City' : 'Area manager';
    const period = data.from === data.to ? data.from : `${data.from} → ${data.to}`;
    const P = (a: number, b: number) => (b ? `${pct(a, b)}%` : '–');
    const { hBars, vBars, BEAN_COLOR } = await import('./charts');
    const { exportReport } = await import('./xlsx');
    const e = totals.ethiopian;
    const b = totals.brazilian;
    const worstRows = rows
      .filter((r) => BEANS.some((x) => r.beans[x].expected))
      .slice(0, 12);
    await exportReport({
      file: `HM-grind-checks-${groupBy}-${data.from}-to-${data.to}.xlsx`,
      title: 'Grind & TDS checks',
      period: `${period} (shift days)`,
      filters: filterNote || undefined,
      kpis: [
        { label: 'Ethiopian · checks done', value: P(e.done, e.expected), sub: `${e.done} of ${e.expected} due`, tone: 'eth' },
        { label: 'Ethiopian · passed', value: P(e.passed, e.done), sub: `${e.failing} still failing · ${e.retested} re-tested`, tone: e.failing ? 'bad' : 'good' },
        { label: 'Brazilian · checks done', value: P(b.done, b.expected), sub: `${b.done} of ${b.expected} due`, tone: 'bra' },
        { label: 'Brazilian · passed', value: P(b.passed, b.done), sub: `${b.failing} still failing · ${b.retested} re-tested`, tone: b.failing ? 'bad' : 'good' },
        { label: 'Grind problems (first try)', value: String(e.coarse + e.fine + e.uneven + b.coarse + b.fine + b.uneven), sub: `Coarse ${e.coarse + b.coarse} · Fine ${e.fine + b.fine} · Uneven ${e.uneven + b.uneven}`, tone: 'plain' },
        { label: 'TDS problems (first try)', value: String(e.low + e.high + b.low + b.high), sub: `Low ${e.low + b.low} · High ${e.high + b.high}`, tone: 'plain' },
      ],
      charts: [
        vBars({
          title: 'Done and passed, by bean',
          sub: 'Share of checks due / done',
          labels: ['Ethiopian', 'Brazilian'],
          series: [
            { name: 'Done', color: '#1D1B17', values: [pct(e.done, e.expected), pct(b.done, b.expected)] },
            { name: 'Passed', color: '#2B8A74', values: [pct(e.passed, e.done), pct(b.passed, b.done)] },
          ],
          fmt: (v) => `${Math.round(v)}%`,
          max: 100,
          h: 260,
        }),
        vBars({
          title: 'Problems found, by bean',
          sub: 'First try of each check',
          labels: ['Too coarse', 'Too fine', 'Uneven', 'TDS low', 'TDS high'],
          series: [
            { name: 'Ethiopian', color: BEAN_COLOR.ethiopian, values: [e.coarse, e.fine, e.uneven, e.low, e.high] },
            { name: 'Brazilian', color: BEAN_COLOR.brazilian, values: [b.coarse, b.fine, b.uneven, b.low, b.high] },
          ],
          fmt: (v) => String(Math.round(v)),
          h: 260,
        }),
        hBars({
          title: `Lowest completion · ${groupName.toLowerCase()}s`,
          sub: 'Checks done % per bean (worst first)',
          labels: worstRows.map((r) => r.label),
          series: [
            { name: 'Ethiopian', color: BEAN_COLOR.ethiopian, values: worstRows.map((r) => pct(r.beans.ethiopian.done, r.beans.ethiopian.expected) / 2) },
            { name: 'Brazilian', color: BEAN_COLOR.brazilian, values: worstRows.map((r) => pct(r.beans.brazilian.done, r.beans.brazilian.expected) / 2) },
          ],
          fmt: (v) => `${Math.round(v)}% avg`,
          max: 100,
          w: 1120,
        }),
      ],
      notes: [
        'One check per bean per shift: morning 04:00–16:00, evening 16:00–04:00 (Riyadh). A check counts as missed an hour after the shift starts.',
        'Targets: top (>1000 µm) 10–11 g, middle (800–1000 µm) 4–5 g, base (<800 µm) 4–5 g of a 20 g sample; hot drip TDS 1.30–1.80 %.',
        'Passed / failing use the latest attempt of each check; problems count the first try.',
      ],
      sheets: [
        {
          name: 'By ' + groupName.toLowerCase(),
          title: `Grind & TDS checks by ${groupName.toLowerCase()} · ${period}`,
          columns: [
            { header: groupName, key: 'name', width: 30 },
            { header: 'Detail', key: 'sub', width: 28 },
            { header: 'Bean', key: 'bean', width: 12, bean: true },
            { header: 'Due', key: 'expected', fmt: '0', width: 8 },
            { header: 'Done', key: 'done', fmt: '0', width: 8 },
            { header: 'Done %', key: 'donePct', fmt: '0%', scale: 'goodHigh', width: 10 },
            { header: 'Passed', key: 'passed', fmt: '0', width: 9 },
            { header: 'Pass %', key: 'passPct', fmt: '0%', scale: 'goodHigh', width: 10 },
            { header: 'Still failing', key: 'failing', fmt: '0', bar: '#C2564A', width: 12 },
            { header: 'Failed first try', key: 'failedFirst', fmt: '0', width: 12 },
            { header: 'Too coarse', key: 'coarse', fmt: '0', width: 10 },
            { header: 'Too fine', key: 'fine', fmt: '0', width: 10 },
            { header: 'Uneven / weighing', key: 'uneven', fmt: '0', width: 12 },
            { header: 'TDS low', key: 'low', fmt: '0', width: 9 },
            { header: 'TDS high', key: 'high', fmt: '0', width: 9 },
            { header: 'Re-tested', key: 'retested', fmt: '0', width: 10 },
          ],
          rows: rows.flatMap((r) =>
            BEANS.map((bn) => {
              const st = r.beans[bn];
              return {
                name: r.label, sub: groupBy === 'store' ? r.sub : `${r.stores} stores`, bean: BEAN_LABEL[bn],
                expected: st.expected, done: st.done, donePct: st.expected ? st.done / st.expected : null,
                passed: st.passed, passPct: st.done ? st.passed / st.done : null, failing: st.failing, failedFirst: st.failedFirst,
                coarse: st.coarse, fine: st.fine, uneven: st.uneven, low: st.low, high: st.high, retested: st.retested,
              };
            }),
          ),
        },
      ],
    });
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

      <div className="ca-beans">
        {BEANS.map((b) => {
          const s = totals[b];
          return (
            <div className="ca-bean-card" data-bean={b} key={b}>
              <div className="ca-bean-head">
                <i className={b === 'ethiopian' ? 'dot-eth' : 'dot-bra'} /> {BEAN_LABEL[b]}
              </div>
              <div className="ca-bean-stats">
                <div>
                  <b className="num">{data && s.expected ? `${pct(s.done, s.expected)}%` : '–'}</b>
                  <small className="num">done · {s.done}/{s.expected}</small>
                </div>
                <div>
                  <b className="num">{data && s.done ? `${pct(s.passed, s.done)}%` : '–'}</b>
                  <small className="num">passed · {s.failing} still failing</small>
                </div>
                <div>
                  <b className="num">{data ? s.coarse + s.fine + s.uneven : '–'}</b>
                  <small className="num">grind · coarse {s.coarse} · fine {s.fine} · uneven {s.uneven}</small>
                </div>
                <div>
                  <b className="num">{data ? s.low + s.high : '–'}</b>
                  <small className="num">TDS · low {s.low} · high {s.high}</small>
                </div>
              </div>
            </div>
          );
        })}
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
        <button className="btn btn-ghost" onClick={() => void exportXlsx().catch(() => toast.error('Could not export'))} disabled={!data}>
          Export Excel
        </button>
      </div>

      <div className="waste-legend">
        <span className="muted">
          One check per bean per shift (morning 04:00–16:00, evening 16:00–04:00); missed an hour after the shift starts. Problems count the first try.
          Targets: top 10–11 g, middle 4–5 g, base 4–5 g of 20 g; hot drip TDS 1.30–1.80 %. Worst stores first.
        </span>
        {filterNote && <span className="status-chip" data-warn>Filtered: {filterNote}</span>}
      </div>

      {!data ? (
        <div className="skeleton-list">{[0, 1, 2, 3].map((i) => <div className="skeleton" key={i} />)}</div>
      ) : rows.length === 0 ? (
        <p className="empty">No stores.</p>
      ) : data.expected === 0 && !data.rows.length ? (
        <p className="empty">No checks are due yet in this period.</p>
      ) : (
        <div className="checks-admin" role="table">
          <div className="ca-tr ca-th" role="row">
            <span>{groupBy === 'store' ? 'Store' : groupBy === 'rom' ? 'ROM' : groupBy === 'city' ? 'City' : 'Area manager'}</span>
            <span>Bean</span>
            <span>Done</span>
            <span className="num">Passed</span>
            <span className="num">Failing</span>
            <span className="num">Coarse</span>
            <span className="num">Fine</span>
            <span className="num">Uneven</span>
            <span className="num">TDS low</span>
            <span className="num">TDS high</span>
          </div>
          {rows.map((r, i) => (
            <motion.div
              key={r.key}
              className="ca-group"
              role="rowgroup"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: Math.min(i, 12) * 0.015, ease: [0.23, 1, 0.32, 1] }}
            >
              {BEANS.map((b, bi) => {
                const s = r.beans[b];
                const done = pct(s.done, s.expected);
                return (
                  <div className="ca-tr ca-sub" role="row" key={b} data-bean={b}>
                    {bi === 0 ? (
                      <span className="waste-name ca-name">
                        <b>{r.label}</b>
                        <small>{groupBy === 'store' ? r.sub : `${r.stores} stores`}</small>
                      </span>
                    ) : (
                      <span aria-hidden />
                    )}
                    <span className="ca-bean">
                      <i className={b === 'ethiopian' ? 'dot-eth' : 'dot-bra'} /> {BEAN_LABEL[b]}
                    </span>
                    <span className="ca-done" data-level={!s.expected ? undefined : done >= 90 ? 'good' : done >= 60 ? 'mid' : 'bad'}>
                      <span className="ca-bar">
                        <span style={{ width: `${Math.min(100, done)}%` }} />
                      </span>
                      <span className="num">
                        {s.expected ? `${done}%` : '–'} <small className="muted">{s.done}/{s.expected}</small>
                      </span>
                    </span>
                    <span className="num">{s.done ? `${pct(s.passed, s.done)}%` : '–'}</span>
                    <span className="num" data-bad={s.failing || undefined}>{s.failing || '–'}</span>
                    <span className="num">{s.coarse || '–'}</span>
                    <span className="num">{s.fine || '–'}</span>
                    <span className="num">{s.uneven || '–'}</span>
                    <span className="num">{s.low || '–'}</span>
                    <span className="num">{s.high || '–'}</span>
                  </div>
                );
              })}
            </motion.div>
          ))}
        </div>
      )}
      {data && <p className="footnote">{data.from === data.to ? data.from : `${data.from} → ${data.to}`} · shift days, store time</p>}
    </section>
  );
}
