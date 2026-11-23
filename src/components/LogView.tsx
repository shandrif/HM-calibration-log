import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { type Batch, type StoreInfo, formatDose, thrownTenths } from '../../shared/config';
import { Grams } from './Grams';
import { useI18n, slotLabel } from '../lib/i18n';
import { addDays, clock, dayKey, formatDay, nowMs } from '../lib/time';
import { batchOutcome, discardByBean, litres } from '../lib/board';
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
    <div className="logview">
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
                {batches ? litres(byBean[bean].hot + byBean[bean].iced) : '–'} <small>{t.litres}</small>
              </div>
              <div className="bean-split num">
                <span>
                  {t.hotShort} <b>{litres(byBean[bean].hot)}</b>
                </span>
                <span>
                  {t.icedShort} <b>{litres(byBean[bean].iced)}</b>
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

      {!batches ? (
        <div className="skeleton-list">
          {[0, 1, 2, 3].map((i) => (
            <div className="skeleton" key={i} />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <p className="empty">{t.noEntries}</p>
      ) : (
        <ol className="timeline">
          {sorted.map((b, i) => {
            const l = slotLabel(t, b.s);
            const outcome = batchOutcome(b, sorted, now);
            return (
              <motion.li
                key={b.id}
                className="entry"
                data-outcome={outcome}
                data-station={b.s.split(':')[0].startsWith('espresso') ? 'espresso' : b.s.split(':')[0]}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '0px 0px -40px 0px' }}
                transition={{ duration: 0.3, delay: Math.min(i, 6) * 0.03, ease: [0.23, 1, 0.32, 1] }}
              >
                <div className="entry-time num">{clock(b.t)}</div>
                <div className="entry-dot" aria-hidden />
                <div className="entry-body">
                  <div className="entry-title">
                    {l.group} · {l.item}
                    {outcome !== 'active' && <span className="tag" data-kind={outcome}>{t[outcome === 'voided' ? 'voided' : outcome === 'replaced' ? 'replaced' : 'expired']}</span>}
                  </div>
                  <div className="entry-meta">
                    <span>{b.n}</span>
                    {b.bn && (
                      <span className="entry-batch num" dir="ltr">
                        #{b.bn}
                      </span>
                    )}
                    {b.d1 != null && (
                      <span className="num" dir="ltr">
                        {formatDose(b.d1)} · {formatDose(b.d2)}
                      </span>
                    )}
                    <span className="num">
                      {t.ends} {clock(b.x)}
                    </span>
                    {!!(b.w1 || b.w2) && (
                      <span className="entry-disc num">
                        {t.thrown}: {t.dose1} ×{b.w1 ?? 0} · {t.dose2} ×{b.w2 ?? 0} · <Grams tenths={b.wg ?? thrownTenths(b.w1, b.w2)} lang={lang} />
                      </span>
                    )}
                    {!!b.dl && (
                      <span className="entry-disc num">
                        <IconDrop /> {b.dl / 1000} {t.litres}
                      </span>
                    )}
                  </div>
                </div>
              </motion.li>
            );
          })}
        </ol>
      )}
      <p className="footnote">{t.storeTime}</p>
    </div>
  );
}
