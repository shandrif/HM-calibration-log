import type { Batch, Check, Down, StoreInfo } from '../../shared/config';
import { formatDose, formatGrams, thrownTenths, dripTenths, tanksFor, fmtTds, fmtTenths, serviceTenths } from '../../shared/config';
import type { Strings } from '../lib/i18n';
import { slotLabel } from '../lib/i18n';
import { batchOutcome, discardByBean } from '../lib/board';
import { clock, formatDay, dayKey, shortDuration } from '../lib/time';
import { Logo } from './Logo';
import { Grams } from './Grams';

// A4 at 96 dpi. Rows have a fixed height so pages can be split without measuring.
export const PAGE_W = 794;
export const PAGE_H = 1123;
const ROW_H = 30;
const FIRST_PAGE_ROWS = 20;
const PAGE_ROWS = 30;

type Line = { kind: 'section'; title: string; count: number } | { kind: 'row'; b: Batch } | { kind: 'check'; c: Check; retest: boolean } | { kind: 'checkHead' } | { kind: 'downHead' } | { kind: 'down'; d: Down };

export function buildLines(t: Strings, batches: Batch[], checks: Check[] = [], downs: Down[] = []): Line[] {
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
  if (checks.length) {
    const rows = [...checks].sort((a, b) => a.at - b.at);
    lines.push({ kind: 'section', title: t.gcLogTitle, count: new Set(rows.map((c) => c.sh + c.b)).size });
    lines.push({ kind: 'checkHead' });
    const seen = new Set<string>();
    for (const c of rows) {
      lines.push({ kind: 'check', c, retest: seen.has(c.sh + c.b) });
      seen.add(c.sh + c.b);
    }
  }
  if (downs.length) {
    lines.push({ kind: 'section', title: t.machineOff, count: downs.length });
    lines.push({ kind: 'downHead' });
    [...downs].sort((a, b) => a.off - b.off).forEach((d) => lines.push({ kind: 'down', d }));
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

export function ReportPages({
  t,
  lang,
  store,
  day,
  batches,
  checks = [],
  downs = [],
  generatedAt,
}: {
  t: Strings;
  lang: 'en' | 'ar';
  store: StoreInfo;
  day: string;
  batches: Batch[];
  checks?: Check[];
  downs?: Down[];
  generatedAt: number;
}) {
  const lines = buildLines(t, batches, checks, downs);
  const pages = paginate(lines);
  const live = batches.filter((b) => !b.v);
  const expired = live.filter((b) => batchOutcome(b, batches, generatedAt) === 'expired').length;
  const byBean = discardByBean(live);
  const thrownG = live.reduce((a, b) => a + (b.wg ?? thrownTenths(b.w1, b.w2)) + serviceTenths(b), 0);
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
                <Stat label={t.espressoThrown} value={<Grams tenths={thrownG} lang={lang} />} />
                <Stat label={t.voided} value={String(batches.length - live.length)} />
              </div>
              <div className="pdf-beans">
                {(['ethiopian', 'brazilian'] as const).map((bean) => (
                  <div className="pdf-bean" data-bean={bean} key={bean}>
                    <div className="pdf-bean-head">
                      <span className="pdf-bean-name">{t[bean]}</span>
                      <span className="pdf-bean-label">{t.dripDiscarded}</span>
                    </div>
                    <div className="pdf-bean-body">
                      <span className="pdf-bean-value">
                        <Grams tenths={dripTenths(byBean[bean].hot + byBean[bean].iced)} lang={lang} />
                      </span>
                      <span className="pdf-bean-split">
                        {t.hotShort} <b><Grams tenths={dripTenths(byBean[bean].hot)} lang={lang} /></b>
                        <i />
                        {t.icedShort} <b><Grams tenths={dripTenths(byBean[bean].iced)} lang={lang} /></b>
                      </span>
                    </div>
                  </div>
                ))}
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
              ) : l.kind === 'checkHead' ? (
                <div className="pdf-crow pdf-row-head" key={i} style={{ height: ROW_H }}>
                  <span>{t.time}</span>
                  <span>{t.shiftLabel} · {t.item}</span>
                  <span>{t.gcTop} · {t.gcMid} · {t.gcBase}</span>
                  <span>TDS</span>
                  <span>{t.by}</span>
                  <span>{t.status}</span>
                </div>
              ) : l.kind === 'downHead' ? (
                <div className="pdf-crow pdf-row-head" key={i} style={{ height: ROW_H }}>
                  <span>{t.offAt}</span>
                  <span>{t.item}</span>
                  <span>{t.onAt}</span>
                  <span>{t.offFor}</span>
                  <span>{t.by}</span>
                  <span />
                </div>
              ) : l.kind === 'down' ? (
                <div className="pdf-crow" key={i} style={{ height: ROW_H }}>
                  <span dir="ltr">{clock(l.d.off)}</span>
                  <span>
                    {slotLabel(t, l.d.s).group} · {slotLabel(t, l.d.s).item}
                  </span>
                  <span dir="ltr">{l.d.on != null ? clock(l.d.on) : t.stillOff}</span>
                  <span>{shortDuration((l.d.on ?? generatedAt) - l.d.off, t.min)}</span>
                  <span>
                    {l.d.n}
                    {l.d.n2 && l.d.n2 !== l.d.n ? ` → ${l.d.n2}` : ''}
                  </span>
                  <span />
                </div>
              ) : l.kind === 'check' ? (
                <CheckRow key={i} t={t} c={l.c} retest={l.retest} />
              ) : (
                <Row key={i} t={t} b={l.b} all={batches} now={generatedAt} tanks={store.tanks} />
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

function CheckRow({ t, c, retest }: { t: Strings; c: Check; retest: boolean }) {
  const why = [c.g !== 'ok' ? t[`gcG_${c.g}`] : '', c.r !== 'ok' ? t[`gcR_${c.r}`].split(' — ')[0] : ''].filter(Boolean).join(' · ');
  return (
    <div className="pdf-crow" data-ok={c.ok ? true : undefined} style={{ height: ROW_H }}>
      <span dir="ltr">{clock(c.at)}</span>
      <span>
        {c.sh === 'm' ? t.shiftM : t.shiftE} · {t[c.b]}
        {retest ? ` · ${t.gcRetestTag}` : ''}
      </span>
      <span dir="ltr">
        {fmtTenths(c.top)} · {fmtTenths(c.mid)} · {fmtTenths(c.base)} g
      </span>
      <span dir="ltr">{fmtTds(c.tds)}%</span>
      <span>{c.n}</span>
      <span className="c-status">{c.ok ? t.gcPassed : why}</span>
    </div>
  );
}

function HeaderRow({ t }: { t: Strings }) {
  return (
    <div className="pdf-row pdf-row-head" style={{ height: ROW_H }}>
      <span className="c-time">{t.time}</span>
      <span className="c-item">{t.item}</span>
      <span className="c-bn">{t.batch}</span>
      <span className="c-dose">{t.doses}</span>
      <span className="c-by">{t.by}</span>
      <span className="c-end">{t.ends}</span>
      <span className="c-disc">{t.discarded}</span>
      <span className="c-status">{t.status}</span>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'bad' }) {
  return (
    <div className="pdf-stat" data-tone={tone}>
      <div className="pdf-stat-value">{value}</div>
      <div className="pdf-stat-label">{label}</div>
    </div>
  );
}

function Row({ t, b, all, now, tanks }: { t: Strings; b: Batch; all: Batch[]; now: number; tanks: StoreInfo['tanks'] }) {
  const outcome = batchOutcome(b, all, now);
  const label = slotLabel(t, b.s);
  const statusText = { voided: t.voided, replaced: t.replaced, expired: t.expired, active: t.active }[outcome];
  return (
    <div className="pdf-row" data-outcome={outcome} style={{ height: ROW_H }}>
      <span className="c-time" dir="ltr">{clock(b.t)}</span>
      <span className="c-item">
        {label.item}
        {tanksFor(tanks, b.s) > 1 || (b.k ?? 1) > 1 ? ` · ${t.tank} ${b.k ?? 1}` : ''}
      </span>
      <span className="c-bn" dir="ltr">{b.bn ?? ''}</span>
      <span className="c-dose" dir="ltr">{b.d1 != null ? `${formatDose(b.d1)} · ${formatDose(b.d2)}` : ''}</span>
      <span className="c-by">{b.n}</span>
      <span className="c-end" dir="ltr">{clock(b.x)}</span>
      <span className="c-disc" dir="ltr">
        {b.dl
          ? `${b.dl / 1000} L · ${formatGrams(dripTenths(b.dl))}`
          : [
              b.w1 || b.w2 ? `D1×${b.w1 ?? 0} D2×${b.w2 ?? 0} · ${formatGrams(b.wg ?? thrownTenths(b.w1, b.w2))}` : '',
              b.s1 || b.s2 ? `+${(b.s1 ?? 0) + (b.s2 ?? 0)} svc · ${formatGrams(serviceTenths(b))}` : '',
            ]
              .filter(Boolean)
              .join(' · ')}
      </span>
      <span className="c-status">{statusText}</span>
    </div>
  );
}
