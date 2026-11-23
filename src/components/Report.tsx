import type { Batch, StoreInfo } from '../../shared/config';
import { formatDose, formatGrams, thrownTenths } from '../../shared/config';
import type { Strings } from '../lib/i18n';
import { slotLabel } from '../lib/i18n';
import { batchOutcome } from '../lib/board';
import { clock, formatDay, dayKey } from '../lib/time';
import { Logo } from './Logo';

// A4 at 96 dpi. Rows have a fixed height so pages can be split without measuring.
export const PAGE_W = 794;
export const PAGE_H = 1123;
const ROW_H = 30;
const FIRST_PAGE_ROWS = 22;
const PAGE_ROWS = 30;

type Line = { kind: 'section'; title: string; count: number } | { kind: 'row'; b: Batch };

export function buildLines(t: Strings, batches: Batch[]): Line[] {
  const groups: [string, string[]][] = [
    [t.espresso, ['espresso_hot', 'espresso_cold', 'espresso']],
    [t.hot_drip, ['hot_drip:ethiopian', 'hot_drip:brazilian']],
    [t.iced_drip, ['iced_drip:ethiopian', 'iced_drip:brazilian']],
  ];
  const lines: Line[] = [];
  for (const [title, slots] of groups) {
    const rows = batches.filter((b) => slots.includes(b.s)).sort((a, b) => a.t - b.t);
    lines.push({ kind: 'section', title, count: rows.filter((r) => !r.v).length });
    rows.forEach((b) => lines.push({ kind: 'row', b }));
  }
  return lines;
}

export function paginate(lines: Line[]): Line[][] {
  const pages: Line[][] = [];
  let i = 0;
  let cap = FIRST_PAGE_ROWS;
  while (i < lines.length || pages.length === 0) {
    let chunk = lines.slice(i, i + cap);
    // never end a page with a section title
    if (chunk.length > 1 && chunk[chunk.length - 1].kind === 'section' && i + cap < lines.length) chunk = chunk.slice(0, -1);
    pages.push(chunk);
    i += chunk.length;
    cap = PAGE_ROWS;
    if (!chunk.length) break;
  }
  return pages;
}

export function ReportPages({ t, lang, store, day, batches, generatedAt }: { t: Strings; lang: 'en' | 'ar'; store: StoreInfo; day: string; batches: Batch[]; generatedAt: number }) {
  const lines = buildLines(t, batches);
  const pages = paginate(lines);
  const live = batches.filter((b) => !b.v);
  const expired = live.filter((b) => batchOutcome(b, batches, generatedAt) === 'expired').length;
  const discardedMl = live.reduce((a, b) => a + (b.dl ?? 0), 0);
  const thrownG = live.reduce((a, b) => a + (b.wg ?? thrownTenths(b.w1, b.w2)), 0);
  const name = lang === 'ar' && store.name_ar ? store.name_ar : store.name;
  return (
    <>
      {pages.map((page, pi) => (
        <div className="pdf-page" key={pi} dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang} style={{ width: PAGE_W, height: PAGE_H }}>
          {pi === 0 ? (
            <>
              <div className="pdf-head">
                <Logo size={58} />
                <div className="pdf-head-text">
                  <div className="pdf-kicker">{t.appName}</div>
                  <div className="pdf-store">{name}</div>
                  <div className="pdf-day">
                    {formatDay(day, lang)} · <span dir="ltr">{store.code}</span>
                  </div>
                </div>
              </div>
              <div className="pdf-rule" />
              <div className="pdf-stats">
                <Stat label={t.calibrations} value={String(live.length)} />
                <Stat label={t.expiredCount} value={String(expired)} tone={expired ? 'bad' : undefined} />
                <Stat label={t.discarded} value={`${(discardedMl / 1000).toFixed(2).replace(/\.?0+$/, '') || 0} ${t.litres}`} />
                <Stat label={t.espressoThrown} value={formatGrams(thrownG)} />
                <Stat label={t.voided} value={String(batches.length - live.length)} />
              </div>
            </>
          ) : (
            <div className="pdf-mini-head">
              <span>{name}</span>
              <span>{formatDay(day, lang)}</span>
            </div>
          )}
          <div className="pdf-table">
            <HeaderRow t={t} />
            {page.map((l, i) =>
              l.kind === 'section' ? (
                <div className="pdf-section" key={i} style={{ height: ROW_H + 14 }}>
                  <span>{l.title}</span>
                  <span className="pdf-count">{l.count}</span>
                </div>
              ) : (
                <Row key={i} t={t} b={l.b} all={batches} now={generatedAt} />
              ),
            )}
          </div>
          <div className="pdf-foot">
            <span>
              {t.generated} <span dir="ltr">{formatDay(dayKey(generatedAt), lang)} {clock(generatedAt)}</span> · {t.storeTime}
            </span>
            <span>
              {t.page} {pi + 1}/{pages.length}
            </span>
          </div>
        </div>
      ))}
    </>
  );
}

function HeaderRow({ t }: { t: Strings }) {
  return (
    <div className="pdf-row pdf-row-head" style={{ height: ROW_H }}>
      <span className="c-time">{t.time}</span>
      <span className="c-item">{t.item}</span>
      <span className="c-dose">{t.doses}</span>
      <span className="c-by">{t.by}</span>
      <span className="c-end">{t.ends}</span>
      <span className="c-disc">{t.discarded}</span>
      <span className="c-status">{t.status}</span>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'bad' }) {
  return (
    <div className="pdf-stat" data-tone={tone}>
      <div className="pdf-stat-value">{value}</div>
      <div className="pdf-stat-label">{label}</div>
    </div>
  );
}

function Row({ t, b, all, now }: { t: Strings; b: Batch; all: Batch[]; now: number }) {
  const outcome = batchOutcome(b, all, now);
  const label = slotLabel(t, b.s);
  const statusText = { voided: t.voided, replaced: t.replaced, expired: t.expired, active: t.active }[outcome];
  return (
    <div className="pdf-row" data-outcome={outcome} style={{ height: ROW_H }}>
      <span className="c-time" dir="ltr">{clock(b.t)}</span>
      <span className="c-item">{label.item}</span>
      <span className="c-dose" dir="ltr">{b.d1 != null ? `${formatDose(b.d1)} · ${formatDose(b.d2)}` : ''}</span>
      <span className="c-by">{b.n}</span>
      <span className="c-end" dir="ltr">{clock(b.x)}</span>
      <span className="c-disc" dir="ltr">{b.dl ? `${b.dl / 1000} ${t.litres}` : b.w1 || b.w2 ? `D1×${b.w1 ?? 0} D2×${b.w2 ?? 0} · ${formatGrams(b.wg ?? thrownTenths(b.w1, b.w2))}` : ''}</span>
      <span className="c-status">{statusText}</span>
    </div>
  );
}
