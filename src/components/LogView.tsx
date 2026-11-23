import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { type Batch, type StoreInfo, formatDose, formatGrams, thrownTenths } from '../../shared/config';
import { useI18n, slotLabel } from '../lib/i18n';
import { addDays, clock, dayKey, formatDay, nowMs } from '../lib/time';
import { batchOutcome } from '../lib/board';
import { buildPdf, canShareFile, downloadFile } from '../lib/pdf';
import { IconChevron, IconDownload, IconShare, IconDrop } from './Icons';

const RETENTION = 92;

export function LogView({
  store,
  fetchDay,
  liveBatches,
  onAuthError,
}: {
  store: StoreInfo;
  fetchDay: (day: string) => Promise<{ batches: Batch[] }>;
  liveBatches?: Batch[];
  onAuthError?: (e: unknown) => boolean;
}) {
  const { t, lang } = useI18n();
  const today = dayKey(nowMs());
  const [day, setDay] = useState(today);
  const [fetched, setFetched] = useState<{ day: string; batches: Batch[] } | null>(null);
  const [busy, setBusy] = useState<'pdf' | 'share' | null>(null);

  const useLive = !!liveBatches && day === today;
  useEffect(() => {
    if (useLive) return;
    let cancelled = false;
    setFetched(null);
    fetchDay(day)
      .then((r) => !cancelled && setFetched({ day, batches: r.batches }))
      .catch((e) => {
        if (!onAuthError?.(e)) toast.error(t.failed);
      });
    return () => {
      cancelled = true;
    };
  }, [day, useLive, fetchDay, onAuthError, t]);

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
  const discarded = live.reduce((a, b) => a + (b.dl ?? 0), 0);
  const thrownG = live.reduce((a, b) => a + (b.wg ?? thrownTenths(b.w1, b.w2)), 0);

  return (
    <div className="logview">
      <div className="daynav">
        <button className="icon-btn" onClick={() => setDay(addDays(day, -1))} disabled={day <= oldest} aria-label={t.prevDay}>
          <IconChevron dir={lang === 'ar' ? 'right' : 'left'} />
        </button>
        <label className="daynav-label">
          <span>{day === today ? t.today : formatDay(day, lang)}</span>
          <input type="date" value={day} min={oldest} max={today} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label={t.today} />
        </label>
        <button className="icon-btn" onClick={() => setDay(addDays(day, 1))} disabled={day >= today} aria-label={t.nextDay}>
          <IconChevron dir={lang === 'ar' ? 'left' : 'right'} />
        </button>
      </div>

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
          <div className="summary-value num">
            {batches ? (discarded / 1000).toFixed(2).replace(/\.?0+$/, '') || '0' : '–'} <small>{t.litres}</small>
          </div>
          <div className="summary-label">{t.discarded}</div>
        </div>
        <div className="summary-item">
          <div className="summary-value num">{batches ? formatGrams(thrownG) : '–'}</div>
          <div className="summary-label">{t.espressoThrown}</div>
        </div>
      </div>

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
                        {t.thrown}: {t.dose1} ×{b.w1 ?? 0} · {t.dose2} ×{b.w2 ?? 0} · {formatGrams(b.wg ?? thrownTenths(b.w1, b.w2))}
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
