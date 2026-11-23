import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Sheet } from './Sheet';
import { IconChevron } from './Icons';
import { useI18n } from '../lib/i18n';
import { addDays } from '../lib/time';

/** Month calendar in a bottom sheet. Days are "YYYY-MM-DD" in store time. Week starts on Sunday. */
export function CalendarSheet({
  open,
  onOpenChange,
  value,
  min,
  max,
  counts,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  value: string;
  min: string;
  max: string;
  counts?: Record<string, number> | null;
  onSelect: (day: string) => void;
}) {
  const { t, lang } = useI18n();
  const [month, setMonth] = useState(value.slice(0, 7)); // "YYYY-MM"
  const [dir, setDir] = useState<1 | -1>(1);

  useEffect(() => {
    if (open) setMonth(value.slice(0, 7));
  }, [open, value]);

  const locale = lang === 'ar' ? 'ar-SA-u-nu-latn-ca-gregory' : 'en-GB';
  const title = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(month + '-15T12:00:00Z'));
  const weekdays = useMemo(() => {
    const f = new Intl.DateTimeFormat(locale, { weekday: lang === 'ar' ? 'short' : 'narrow', timeZone: 'UTC' });
    // 2026-11-01 is a Sunday
    return Array.from({ length: 7 }, (_, i) => f.format(new Date(Date.UTC(2026, 10, 1 + i, 12))));
  }, [locale, lang]);

  const cells = useMemo(() => {
    const first = new Date(month + '-01T00:00:00Z');
    const lead = first.getUTCDay(); // 0 = Sunday
    const daysIn = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    const out: (string | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= daysIn; d++) out.push(`${month}-${String(d).padStart(2, '0')}`);
    while (out.length % 7) out.push(null);
    return out;
  }, [month]);

  const shift = (n: 1 | -1) => {
    const d = new Date(month + '-01T00:00:00Z');
    d.setUTCMonth(d.getUTCMonth() + n);
    setDir(n);
    setMonth(d.toISOString().slice(0, 7));
  };
  const canPrev = month > min.slice(0, 7);
  const canNext = month < max.slice(0, 7);
  const pick = (day: string) => {
    onSelect(day);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t.pickDay}>
      <div className="cal">
        <div className="cal-quick">
          <button className="chip" data-active={value === max || undefined} onClick={() => pick(max)}>
            {t.today}
          </button>
          <button className="chip" data-active={value === addDays(max, -1) || undefined} onClick={() => pick(addDays(max, -1))} disabled={addDays(max, -1) < min}>
            {t.yesterday}
          </button>
        </div>

        <div className="cal-head">
          <button className="icon-btn" onClick={() => shift(-1)} disabled={!canPrev} aria-label={t.prevMonth}>
            <IconChevron dir={lang === 'ar' ? 'right' : 'left'} />
          </button>
          <AnimatePresence mode="popLayout" initial={false} custom={dir}>
            <motion.div
              key={month}
              className="cal-title"
              custom={dir}
              initial={{ opacity: 0, y: dir * 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: dir * -8 }}
              transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            >
              {title}
            </motion.div>
          </AnimatePresence>
          <button className="icon-btn" onClick={() => shift(1)} disabled={!canNext} aria-label={t.nextMonth}>
            <IconChevron dir={lang === 'ar' ? 'left' : 'right'} />
          </button>
        </div>

        <div className="cal-week" aria-hidden>
          {weekdays.map((w, i) => (
            <span key={i}>{w}</span>
          ))}
        </div>

        <div className="cal-viewport">
          <AnimatePresence mode="popLayout" initial={false} custom={dir}>
            <motion.div
              key={month}
              className="cal-grid"
              role="grid"
              custom={dir}
              initial={{ opacity: 0, x: (lang === 'ar' ? -1 : 1) * dir * 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: (lang === 'ar' ? 1 : -1) * dir * 40 }}
              transition={{ duration: 0.26, ease: [0.23, 1, 0.32, 1] }}
            >
              {cells.map((d, i) => {
                if (!d) return <span key={i} className="cal-empty" />;
                const disabled = d < min || d > max;
                const n = counts?.[d] ?? 0;
                return (
                  <button
                    key={d}
                    className="cal-day num"
                    data-selected={d === value || undefined}
                    data-today={d === max || undefined}
                    disabled={disabled}
                    onClick={() => pick(d)}
                    aria-label={`${d}${n ? ` · ${n}` : ''}`}
                    aria-pressed={d === value}
                  >
                    <span>{Number(d.slice(8))}</span>
                    {n > 0 && <i className="cal-dot" data-level={n >= 60 ? 3 : n >= 20 ? 2 : 1} />}
                  </button>
                );
              })}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="cal-foot">
          <span>
            <i className="cal-dot" data-level={2} /> {t.hasLogs}
          </span>
          <span className="muted">{t.keptDays}</span>
        </div>
      </div>
    </Sheet>
  );
}
