import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { type Batch, type StoreInfo, formatDose, thrownTenths, slotsFor, dripTenths, tanksFor } from '../../shared/config';
import { Grams } from './Grams';
import { useI18n, slotLabel, type Strings } from '../lib/i18n';
import { addDays, clock, dayKey, formatDay, nowMs } from '../lib/time';
import { batchOutcome, discardByBean, slotView, tankOf } from '../lib/board';
import { buildPdf, canShareFile, downloadFile } from '../lib/pdf';
import { IconChevron, IconDownload, IconShare, IconDrop, IconCalendar } from './Icons';
import { CalendarSheet } from './CalendarSheet';

const RETENTION = 92;

export function LogView({
  store,
  fetchDay,
  fetchDays,
  liveBatches,
  onAuthError,
}: {
  store: StoreInfo;
  fetchDay: (day: string) => Promise<{ batches: Batch[] }>;
  fetchDays?: () => Promise<{ days: Record<string, number> }>;
  liveBatches?: Batch[];
  onAuthError?: (e: unknown) => boolean;
}) {
  const { t, lang } = useI18n();
  const today = dayKey(nowMs());
  const [day, setDay] = useState(today);
  const [fetched, setFetched] = useState<{ day: string; batches: Batch[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<'pdf' | 'share' | null>(null);

  // Parents pass new function objects on every render (the board clock ticks each second),
  // so keep them in refs: the effect below must only run when the selected day changes.
  const fetchRef = useRef(fetchDay);
  const authRef = useRef(onAuthError);
  const failedText = useRef(t.failed);
  fetchRef.current = fetchDay;
  authRef.current = onAuthError;
  failedText.current = t.failed;

  // Calendar: opened from the date; per-day counts are loaded each time it opens (≤ 92 rows).
  const [calOpen, setCalOpen] = useState(false);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const fetchDaysRef = useRef(fetchDays);
  fetchDaysRef.current = fetchDays;
  const openCalendar = () => {
    setCalOpen(true);
    fetchDaysRef.current?.()
      .then((r) => setCounts(r.days))
      .catch(() => {});
  };

  // Past days don't change, so each one is fetched once per visit and then served from memory.
  const cache = useRef(new Map<string, Batch[]>());

  const useLive = !!liveBatches && day === today;
  useEffect(() => {
    if (useLive) return;
    const hit = cache.current.get(day);
    if (hit) {
      setFetched({ day, batches: hit });
      if (day !== today) return; // today's list (admin) is refreshed below while the cached copy shows
    }
    let cancelled = false;
    setLoading(true);
    fetchRef
      .current(day)
      .then((r) => {
        cache.current.set(day, r.batches);
        if (!cancelled) setFetched({ day, batches: r.batches });
      })
      .catch((e) => {
        if (!cancelled && !authRef.current?.(e)) toast.error(failedText.current);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [day, useLive, today]);

  const batches = useLive ? liveBatches!.filter((b) => dayKey(b.t) === day) : fetched?.day === day ? fetched.batches : null;
  const oldest = addDays(today, -RETENTION + 1);
  const now = nowMs();

  const exportPdf = async (mode: 'pdf' | 'share') => {
    if (!batches) return;
    setBusy(mode);
    const id = toast.loading(t.preparing);
    try {
      const file = await buildPdf({ t, lang, store, day, batches });
      toast.dismiss(id);
      if (mode === 'share' && canShareFile(file)) {
        await navigator.share({ files: [file], title: file.name }).catch(() => {});
      } else downloadFile(file);
    } catch (e) {
      console.error(e);
      toast.error(t.failed, { id });
    } finally {
      setBusy(null);
    }
  };

  const sorted = batches ? [...batches].sort((a, b) => b.t - a.t) : [];
  const live = sorted.filter((b) => !b.v);
  const byBean = discardByBean(live);
  const thrownG = live.reduce((a, b) => a + (b.wg ?? thrownTenths(b.w1, b.w2)), 0);

  return (
    <div className="log-cq">
    <div className="logview">
      <div className="log-side">
      <div className="daynav">
        <button className="icon-btn" onClick={() => setDay(addDays(day, -1))} disabled={day <= oldest} aria-label={t.prevDay}>
          <IconChevron dir={lang === 'ar' ? 'right' : 'left'} />
        </button>
        <button className="daynav-label" data-loading={loading || undefined} onClick={openCalendar} aria-haspopup="dialog">
          <IconCalendar />
          <span>{day === today ? t.today : formatDay(day, lang)}</span>
          <IconChevron dir="down" />
        </button>
        <button className="icon-btn" onClick={() => setDay(addDays(day, 1))} disabled={day >= today} aria-label={t.nextDay}>
          <IconChevron dir={lang === 'ar' ? 'left' : 'right'} />
        </button>
      </div>

      <CalendarSheet open={calOpen} onOpenChange={setCalOpen} value={day} min={oldest} max={today} counts={counts} onSelect={setDay} />

      <div className="summary">
        <div className="summary-item">
          <div className="summary-value num">{batches ? live.length : '–'}</div>
          <div className="summary-label">{t.calibrations}</div>
        </div>
        <div className="summary-item">
          <div className="summary-value num">{batches ? live.filter((b) => batchOutcome(b, sorted, now) === 'expired').length : '–'}</div>
          <div className="summary-label">{t.expiredCount}</div>
        </div>
        <div className="summary-item">
          <div className="summary-value num">{batches ? <Grams tenths={thrownG} lang={lang} /> : '–'}</div>
          <div className="summary-label">{t.espressoThrown}</div>
        </div>
      </div>

      <section className="beans-card" aria-label={t.dripDiscarded}>
        <div className="beans-title">{t.dripDiscarded}</div>
        <div className="beans">
          {(['ethiopian', 'brazilian'] as const).map((bean) => (
            <div className="bean" data-bean={bean} key={bean}>
              <div className="bean-name">
                <i className={bean === 'ethiopian' ? 'dot-eth' : 'dot-bra'} /> {t[bean]}
              </div>
              <div className="bean-value num">
                {batches ? <Grams tenths={dripTenths(byBean[bean].hot + byBean[bean].iced)} lang={lang} /> : '–'}
              </div>
              <div className="bean-split num">
                <span>
                  {t.hotShort} <b><Grams tenths={dripTenths(byBean[bean].hot)} lang={lang} /></b>
                </span>
                <span>
                  {t.icedShort} <b><Grams tenths={dripTenths(byBean[bean].iced)} lang={lang} /></b>
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="export-row">
        <button className="btn btn-primary" onClick={() => exportPdf('pdf')} disabled={!batches || !!busy}>
          <IconDownload /> {t.downloadPdf}
        </button>
        <button className="btn btn-ghost" onClick={() => exportPdf('share')} disabled={!batches || !!busy}>
          <IconShare /> {t.share}
        </button>
      </div>

      </div>
      <div className="log-main">
        {batches && <LastCalibrations store={store} batches={sorted} day={day} isToday={day === today} now={now} />}
        {!batches ? (
          <div className="skeleton-list">
            {[0, 1, 2, 3].map((i) => (
              <div className="skeleton" key={i} />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <p className="empty">{t.noEntries}</p>
        ) : (
          <LogSections batches={sorted} now={now} tanks={store.tanks} />
        )}
        <p className="footnote">{t.storeTime}</p>
      </div>
    </div>
    </div>
  );
}

// ---------------------------------------------------------------- last calibration per item

const STATION_OF = (slot: string) => (slot.startsWith('espresso') ? 'espresso' : (slot.split(':')[0] as 'hot_drip' | 'iced_drip'));

function ago(ms: number, t: Strings) {
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 1) return t.justNow;
  if (m < 60) return `${m}${t.minShort}`;
  return `${Math.floor(m / 60)}${t.hourShort} ${String(m % 60).padStart(2, '0')}${t.minShort}`;
}

function LastCalibrations({ store, batches, day, isToday, now }: { store: StoreInfo; batches: Batch[]; day: string; isToday: boolean; now: number }) {
  const { t } = useI18n();
  const slots = slotsFor(store.espresso_mode);
  return (
    <section className="last-card" aria-label={t.lastCalibration}>
      <div className="last-title">{isToday ? t.lastCalibration : `${t.lastCalibration} · ${day.slice(5)}`}</div>
      <div className="last-table" role="table">
        <div className="last-row last-head" role="row">
          <span>{t.item}</span>
          <span>{t.time}</span>
          <span>{t.agoCol}</span>
          <span>{t.by}</span>
          <span>{t.batch}</span>
          <span>{t.status}</span>
        </div>
        {slots.flatMap((def) => {
          const n = tanksFor(store.tanks, def.slot);
          return Array.from({ length: n }, (_, i) => ({ def, tank: i + 1, n }));
        }).map(({ def, tank, n }) => {
          const l = slotLabel(t, def.slot);
          const key = `${def.slot}#${tank}`;
          const tankLabel = n > 1 ? <span className="tank-sub num">{t.tank} {tank}</span> : null;
          // batches are newest first
          const last = batches.find((b) => b.s === def.slot && !b.v && (def.kind !== 'drip' || tankOf(b) === tank));
          if (!last)
            return (
              <div className="last-row" role="row" key={key} data-empty>
                <span className="last-item">
                  <i className={`st-dot st-${STATION_OF(def.slot)}`} />
                  <span className="last-label">
                    <b>{l.group}</b> · {l.item}
                    {tankLabel}
                  </span>
                </span>
                <span className="last-none">{isToday ? t.notYetToday : t.noneThatDay}</span>
              </div>
            );
          let status: { key: string; label: string };
          if (isToday) {
            const sv = slotView(def, batches, now, n);
            const v = sv.tanks.find((x) => x.tank === tank) ?? sv;
            status = { key: v.phase, label: v.phase === 'brewing' ? t.brewing : v.phase === 'soon' ? t.soon : v.phase === 'expired' ? t.expired : v.phase === 'none' ? '—' : t.freshStatus };
          } else {
            const o = batchOutcome(last, batches, now);
            status = { key: o === 'expired' ? 'expired' : 'done', label: o === 'expired' ? t.expired : t.done };
          }
          return (
            <div className="last-row" role="row" key={key}>
              <span className="last-item">
                <i className={`st-dot st-${STATION_OF(def.slot)}`} />
                <span className="last-label">
                  <b>{l.group}</b> · {l.item}
                  {tankLabel}
                </span>
              </span>
              <span className="num last-time">{clock(last.t)}</span>
              <span className="num last-ago">{isToday ? ago(now - last.t, t) : '—'}</span>
              <span className="last-by">{last.n}</span>
              <span className="num last-bn" dir="ltr">{last.bn ? `#${last.bn}` : '—'}</span>
              <span className="last-status">
                <span className="status-pill" data-kind={status.key}>
                  {status.label}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- full log, grouped by station

type StationKey = 'espresso' | 'hot_drip' | 'iced_drip';

const showTank = (tanks: StoreInfo['tanks'], b: Batch) => b.s.includes('_drip') && (tanksFor(tanks, b.s) > 1 || tankOf(b) > 1);

function LogSections({ batches, now, tanks }: { batches: Batch[]; now: number; tanks: StoreInfo['tanks'] }) {
  const { t, lang } = useI18n();
  const [filter, setFilter] = useState<'all' | StationKey>('all');
  const latestIds = new Set<string>();
  const seen = new Set<string>();
  // the newest batch of every item *and tank* is the one still being served
  for (const b of batches) if (!b.v && !seen.has(b.s + '#' + tankOf(b))) (seen.add(b.s + '#' + tankOf(b)), latestIds.add(b.id));
  const groups: StationKey[] = ['espresso', 'hot_drip', 'iced_drip'];
  return (
    <div className="log-sections">
      <div className="segmented log-filter" role="tablist">
        {(['all', ...groups] as const).map((k) => (
          <button key={k} role="tab" aria-selected={filter === k} data-active={filter === k || undefined} onClick={() => setFilter(k)}>
            {k === 'all' ? t.all : t[k]}
          </button>
        ))}
      </div>
      {groups
        .filter((g) => filter === 'all' || filter === g)
        .map((g) => {
          const rows = batches.filter((b) => STATION_OF(b.s) === g);
          if (!rows.length) return null;
          return (
            <section className="log-group" key={g} data-station={g}>
              <h3 className="log-group-head">
                <i className={`st-dot st-${g}`} />
                {t[g]}
                <span className="log-count num">{rows.filter((r) => !r.v).length}</span>
              </h3>
              <div className="log-table" role="table">
                <div className="log-row log-head" role="row">
                  <span className="c-t">{t.time}</span>
                  <span className="c-i">{t.item}</span>
                  <span className="c-b">{t.by}</span>
                  <span className="c-n">{t.batch}</span>
                  <span className="c-d">{t.details}</span>
                  <span className="c-s">{t.status}</span>
                </div>
                {rows.map((b, i) => {
                  const l = slotLabel(t, b.s);
                  const outcome = batchOutcome(b, batches, now);
                  const latest = latestIds.has(b.id);
                  const statusKey = b.v ? 'voided' : latest ? (outcome === 'expired' ? 'expired' : 'latest') : outcome;
                  const statusLabel =
                    statusKey === 'voided' ? t.voided : statusKey === 'latest' ? t.latest : statusKey === 'expired' ? t.expired : statusKey === 'replaced' ? t.replaced : t.done;
                  return (
                    <motion.div
                      key={b.id}
                      className="log-row"
                      role="row"
                      data-outcome={b.v ? 'voided' : outcome}
                      data-latest={latest || undefined}
                      initial={{ opacity: 0, y: 6 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true, margin: '0px 0px -30px 0px' }}
                      transition={{ duration: 0.25, delay: Math.min(i, 6) * 0.02, ease: [0.23, 1, 0.32, 1] }}
                    >
                      <span className="c-t num">{clock(b.t)}</span>
                      <span className="c-i">
                        <span className="c-i-name">{l.item}</span>
                        {showTank(tanks, b) && <span className="tank-sub num">{t.tank} {tankOf(b)}</span>}
                      </span>
                      <span className="c-b">{b.n}</span>
                      <span className="c-n num" dir="ltr">{b.bn ? `#${b.bn}` : '—'}</span>
                      <span className="c-d num">
                        {b.d1 != null && (
                          <span dir="ltr">
                            {formatDose(b.d1)} · {formatDose(b.d2)}
                          </span>
                        )}
                        {!!(b.w1 || b.w2) && (
                          <span className="c-d-waste">
                            <bdi dir="ltr">D1×{b.w1 ?? 0} D2×{b.w2 ?? 0}</bdi> · <Grams tenths={b.wg ?? thrownTenths(b.w1, b.w2)} lang={lang} />
                          </span>
                        )}
                        {!!b.dl && (
                          <span className="c-d-waste">
                            <IconDrop /> <Grams tenths={dripTenths(b.dl)} lang={lang} />
                          </span>
                        )}
                        {b.d1 == null && !b.dl && <span className="muted">—</span>}
                      </span>
                      <span className="c-s">
                        <span className="status-pill" data-kind={statusKey}>
                          {statusLabel}
                        </span>
                      </span>
                    </motion.div>
                  );
                })}
              </div>
            </section>
          );
        })}
    </div>
  );
}
