import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  type Bean,
  type Check,
  type ShiftKey,
  CHECK_GRACE_MS,
  CHECKS_SINCE_MS,
  GRIND_BEANS,
  GRIND_TARGET,
  GRIND_TOTAL_OK,
  TDS_RANGE,
  fmtTds,
  fmtTenths,
  shiftOf,
} from '../../shared/config';
import { useI18n, type Strings } from '../lib/i18n';
import { TZ_OFFSET_MIN, clock } from '../lib/time';
import { Sheet } from './Sheet';
import { IconCheck, IconMinus, IconPlus, IconSieve, IconX } from './Icons';

type Status = 'due' | 'overdue' | 'passed' | 'failed';

export function beanStatus(checks: Check[], bean: Bean, now: number): { status: Status; last?: Check; tries: number } {
  const cur = shiftOf(now, TZ_OFFSET_MIN);
  const mine = checks.filter((c) => c.sd === cur.day && c.sh === cur.sh && c.b === bean).sort((a, b) => a.at - b.at);
  const last = mine[mine.length - 1];
  if (!last) return { status: now - cur.start >= CHECK_GRACE_MS && cur.start >= CHECKS_SINCE_MS ? 'overdue' : 'due', tries: 0 };
  return { status: last.ok ? 'passed' : 'failed', last, tries: mine.length };
}

// ---------------------------------------------------------------- board card

export function GrindCard({ checks, now, onStart }: { checks: Check[]; now: number; onStart: (bean: Bean) => void }) {
  const { t } = useI18n();
  const cur = shiftOf(now, TZ_OFFSET_MIN);
  const rows = GRIND_BEANS.map((b) => ({ bean: b, ...beanStatus(checks, b, now) }));
  const worst: Status = rows.some((r) => r.status === 'overdue')
    ? 'overdue'
    : rows.some((r) => r.status === 'failed')
      ? 'failed'
      : rows.some((r) => r.status === 'due')
        ? 'due'
        : 'passed';
  const label: Record<Status, string> = { due: t.gcDue, overdue: t.gcOverdue, passed: t.gcPassed, failed: t.gcFailed };
  return (
    <section className="grind-card" data-state={worst} aria-label={t.grindCheck}>
      <div className="grind-head">
        <span className="grind-icon" aria-hidden>
          <IconSieve />
        </span>
        <div className="grind-title">
          <b>{t.grindCheck}</b>
          <span className="muted">
            {cur.sh === 'm' ? t.shiftM : t.shiftE} · <span className="num">{cur.sh === 'm' ? t.shiftHoursM : t.shiftHoursE}</span>
          </span>
        </div>
      </div>
      <div className="grind-beans">
        {rows.map((r) => (
          <button key={r.bean} className="grind-bean" data-state={r.status} onClick={() => onStart(r.bean)}>
            <span className={`grind-dot bean-${r.bean}`} aria-hidden />
            <span className="grind-bean-name">{t[r.bean]}</span>
            <span className="grind-bean-state">
              {r.status === 'passed' && <IconCheck />}
              {r.status === 'failed' && <IconX />}
              {label[r.status]}
              {r.last && <span className="num muted"> · {clock(r.last.at)}</span>}
            </span>
            {r.status !== 'passed' && <span className="grind-go">{r.status === 'failed' ? t.gcRetest : t.gcStart}</span>}
          </button>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- guided check

const parseTenths = (s: string) => {
  const v = Number(s.replace(',', '.').replace(/[^\d.]/g, ''));
  return s.trim() === '' || !isFinite(v) ? null : Math.round(v * 10);
};
const parseHundredths = (s: string) => {
  const v = Number(s.replace(',', '.').replace(/[^\d.]/g, ''));
  return s.trim() === '' || !isFinite(v) ? null : Math.round(v * 100);
};

function band(v: number | null, [lo, hi]: readonly [number, number] | readonly number[]) {
  if (v == null) return undefined;
  return v < lo ? 'low' : v > hi ? 'high' : 'ok';
}

export interface CheckInput {
  sh: ShiftKey;
  bean: Bean;
  top: number;
  mid: number;
  base: number;
  tds: number;
  staff: string;
}

export function GrindSheet({
  open,
  bean: initialBean,
  now,
  people,
  defaultPerson,
  onClose,
  onSave,
}: {
  open: boolean;
  bean: Bean;
  now: number;
  people: string[];
  defaultPerson: string;
  onClose: () => void;
  onSave: (v: CheckInput) => Promise<Check | null>;
}) {
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  const [sh, setSh] = useState<ShiftKey>('m');
  const [bean, setBean] = useState<Bean>(initialBean);
  const [zeroed, setZeroed] = useState(false);
  const [w, setW] = useState({ top: '', mid: '', base: '' });
  const [tds, setTds] = useState('');
  const [who, setWho] = useState(defaultPerson);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<Check | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setSh(shiftOf(now, TZ_OFFSET_MIN).sh);
    setBean(initialBean);
    setZeroed(false);
    setW({ top: '', mid: '', base: '' });
    setTds('');
    setWho(defaultPerson);
    setResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const top = parseTenths(w.top);
  const mid = parseTenths(w.mid);
  const base = parseTenths(w.base);
  const total = (top ?? 0) + (mid ?? 0) + (base ?? 0);
  const weightsDone = top != null && mid != null && base != null;
  const totalOk = total >= GRIND_TOTAL_OK[0] && total <= GRIND_TOTAL_OK[1];
  const tdsV = parseHundredths(tds);
  const canSave = weightsDone && tdsV != null && tdsV > 0 && tdsV < 2500 && !!who.trim();

  const steps = [t.gcStepZero, t.gcStepSift, t.gcStepTds, t.gcStepResult];

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    const c = await onSave({ sh, bean, top: top!, mid: mid!, base: base!, tds: tdsV!, staff: who.trim() });
    setSaving(false);
    if (c) {
      setResult(c);
      setStep(3);
    }
  };

  const retest = () => {
    setW({ top: '', mid: '', base: '' });
    setTds('');
    setResult(null);
    setStep(1);
  };

  const chambers = useMemo(
    () =>
      [
        { k: 'top' as const, label: t.gcTop, hint: t.gcTopHint, v: top, target: GRIND_TARGET.top },
        { k: 'mid' as const, label: t.gcMid, hint: t.gcMidHint, v: mid, target: GRIND_TARGET.mid },
        { k: 'base' as const, label: t.gcBase, hint: t.gcBaseHint, v: base, target: GRIND_TARGET.base },
      ] as const,
    [t, top, mid, base],
  );

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title={`${t.grindCheck} · ${t[bean]}`}>
      <div className="sheet-body gc">
        <ol className="gc-steps" aria-label={t.grindCheck}>
          {steps.map((s, i) => (
            <li key={s} data-state={i < step ? 'done' : i === step ? 'now' : undefined}>
              <span className="gc-step-n num">{i < step ? '✓' : i + 1}</span>
              <span className="gc-step-l">{s}</span>
            </li>
          ))}
        </ol>

        {step < 3 && (
          <div className="gc-pickers">
            <div className="segmented" role="radiogroup" aria-label={t.shiftLabel}>
              {(['m', 'e'] as const).map((k) => (
                <button key={k} type="button" role="radio" aria-checked={sh === k} data-active={sh === k || undefined} onClick={() => setSh(k)}>
                  {k === 'm' ? t.shiftM : t.shiftE}
                </button>
              ))}
            </div>
            <div className="segmented" role="radiogroup">
              {GRIND_BEANS.map((b) => (
                <button key={b} type="button" role="radio" aria-checked={bean === b} data-active={bean === b || undefined} onClick={() => setBean(b)}>
                  {t[b]}
                </button>
              ))}
            </div>
          </div>
        )}

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
          >
            {step === 0 && (
              <>
                <ol className="gc-howto">
                  {t.gcZeroSteps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
                <button type="button" className="gc-confirm" aria-pressed={zeroed} data-active={zeroed || undefined} onClick={() => setZeroed(!zeroed)}>
                  <span className="gc-box">{zeroed && <IconCheck />}</span>
                  <span className="num">{t.gcZeroDone}</span>
                </button>
                <div className="gc-actions">
                  <button className="btn btn-primary btn-lg" disabled={!zeroed} onClick={() => setStep(1)}>
                    {t.gcNext}
                  </button>
                </div>
              </>
            )}

            {step === 1 && (
              <>
                <ol className="gc-howto gc-howto-compact">
                  {t.gcSiftSteps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
                <div className="gc-chambers">
                  {chambers.map((c) => {
                    const st = band(c.v, c.target);
                    return (
                      <div className="gc-chamber" key={c.k} data-state={st}>
                        <div className="gc-ch-label">
                          <b>{c.label}</b>
                          <small>{c.hint}</small>
                          <small className="num">
                            {t.gcTarget} {fmtTenths(c.target[0])}–{fmtTenths(c.target[1])} g
                          </small>
                        </div>
                        <div className="gc-ch-input">
                          <button
                            type="button"
                            className="counter-btn"
                            aria-label={`${c.label} −`}
                            onClick={() => setW((x) => ({ ...x, [c.k]: fmtTenths(Math.max(0, (c.v ?? c.target[0]) - 1)) }))}
                          >
                            <IconMinus />
                          </button>
                          <label className="gc-field">
                            <input
                              className="num"
                              inputMode="decimal"
                              placeholder="0.0"
                              value={w[c.k]}
                              onChange={(e) => setW((x) => ({ ...x, [c.k]: e.target.value.replace(/[^\d.,]/g, '').slice(0, 5) }))}
                              aria-label={c.label}
                            />
                            <span>g</span>
                          </label>
                          <button
                            type="button"
                            className="counter-btn"
                            aria-label={`${c.label} +`}
                            onClick={() => setW((x) => ({ ...x, [c.k]: fmtTenths(Math.min(300, (c.v ?? c.target[0] - 1) + 1)) }))}
                          >
                            <IconPlus />
                          </button>
                        </div>
                        <div className="gc-ch-state">
                          {c.v != null && total > 0 && <span className="num">{Math.round((c.v / total) * 100)}%</span>}
                          {st && <span className="gc-pill" data-state={st}>{st === 'ok' ? t.gcOk : st === 'low' ? t.gcLow : t.gcHigh}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="gc-total" data-state={weightsDone ? (totalOk ? 'ok' : 'high') : undefined}>
                  <span>{t.gcTotal}</span>
                  <b className="num">{fmtTenths(total)} g</b>
                  {weightsDone && !totalOk && <span className="gc-total-warn">{t.gcTotalOff}</span>}
                </div>
                <div className="gc-actions">
                  <button className="btn btn-ghost btn-lg" onClick={() => setStep(0)}>
                    {t.gcBack}
                  </button>
                  <button className="btn btn-primary btn-lg" disabled={!weightsDone} onClick={() => setStep(2)}>
                    {t.gcNext}
                  </button>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <ol className="gc-howto gc-howto-compact">
                  {t.gcTdsSteps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
                <div className="gc-tds" data-state={tdsV != null ? band(tdsV, TDS_RANGE) : undefined}>
                  <span className="gc-tds-label">{t.gcTdsLabel}</span>
                  <div className="gc-ch-input">
                    <button type="button" className="counter-btn" aria-label="TDS −" onClick={() => setTds(fmtTds(Math.max(0, (tdsV ?? 150) - 1)))}>
                      <IconMinus />
                    </button>
                    <label className="gc-field gc-field-lg">
                      <input
                        className="num"
                        inputMode="decimal"
                        placeholder="1.50"
                        value={tds}
                        onChange={(e) => setTds(e.target.value.replace(/[^\d.,]/g, '').slice(0, 5))}
                        aria-label={t.gcTdsLabel}
                      />
                      <span>%</span>
                    </label>
                    <button type="button" className="counter-btn" aria-label="TDS +" onClick={() => setTds(fmtTds(Math.min(2499, (tdsV ?? 149) + 1)))}>
                      <IconPlus />
                    </button>
                  </div>
                  <span className="gc-tds-target num">{t.gcTdsTarget}</span>
                </div>
                <div className="gc-who">
                  <span>{t.gcDoneBy}</span>
                  {people.length > 0 ? (
                    <div className="gc-who-chips">
                      {people.map((n) => (
                        <button key={n} type="button" className="chip" data-active={who === n || undefined} aria-pressed={who === n} onClick={() => setWho(n)}>
                          {n}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <input className="input" value={who} maxLength={40} onChange={(e) => setWho(e.target.value)} />
                  )}
                </div>
                <div className="gc-actions">
                  <button className="btn btn-ghost btn-lg" onClick={() => setStep(1)}>
                    {t.gcBack}
                  </button>
                  <button className="btn btn-primary btn-lg" disabled={!canSave || saving} data-busy={saving || undefined} onClick={() => void save()}>
                    {t.gcSave}
                  </button>
                </div>
              </>
            )}

            {step === 3 && result && <CheckResult t={t} c={result} onRetest={retest} onDone={onClose} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </Sheet>
  );
}

function CheckResult({ t, c, onRetest, onDone }: { t: Strings; c: Check; onRetest: () => void; onDone: () => void }) {
  const total = c.top + c.mid + c.base || 1;
  const g = c.g === 'ok' ? null : (['coarse', 'fine', 'uneven', 'weigh'] as const).find((k) => k === c.g)!;
  const r = c.r === 'ok' ? null : c.r;
  return (
    <div className="gc-result" data-ok={c.ok ? true : undefined}>
      <div className="gc-verdict">
        <span className="gc-verdict-icon">{c.ok ? <IconCheck /> : <IconX />}</span>
        <div>
          <b>{c.ok ? t.gcPassTitle : t.gcFailTitle}</b>
          <p>{c.ok ? t.gcPassText : t.gcFailText}</p>
        </div>
      </div>

      <div className="gc-summary num" dir="ltr">
        <span>
          {t.gcTop} <b>{fmtTenths(c.top)} g</b> · {Math.round((c.top / total) * 100)}%
        </span>
        <span>
          {t.gcMid} <b>{fmtTenths(c.mid)} g</b> · {Math.round((c.mid / total) * 100)}%
        </span>
        <span>
          {t.gcBase} <b>{fmtTenths(c.base)} g</b> · {Math.round((c.base / total) * 100)}%
        </span>
        <span>
          TDS <b>{fmtTds(c.tds)}%</b>
        </span>
      </div>

      {g && r && <p className="gc-hint">{t.gcFixGrindFirst}</p>}

      <div className="gc-cases">
        {g ? (
          <Case
            title={t[`gcG_${g}`]}
            why={t[`gcG_${g}_why`]}
            reasons={t[`gcG_${g}_reasons`]}
            actions={t[`gcG_${g}_actions`]}
            t={t}
          />
        ) : (
          <div className="gc-case" data-ok>
            <IconCheck /> {t.gcGrindOk}
          </div>
        )}
        {r ? (
          <Case title={t[`gcR_${r}`]} reasons={t[`gcR_${r}_reasons`]} actions={t[`gcR_${r}_actions`]} t={t} />
        ) : (
          <div className="gc-case" data-ok>
            <IconCheck /> {t.gcTdsOk}
          </div>
        )}
      </div>

      <div className="gc-actions">
        {!c.ok && (
          <button className="btn btn-ghost btn-lg" onClick={onRetest}>
            {t.gcRetest}
          </button>
        )}
        <button className="btn btn-primary btn-lg" onClick={onDone}>
          {t.gcDone}
        </button>
      </div>
    </div>
  );
}

function Case({ title, why, reasons, actions, t }: { title: string; why?: string; reasons: string[]; actions: string[]; t: Strings }) {
  return (
    <div className="gc-case">
      <b className="gc-case-title">{title}</b>
      {why && <p className="muted">{why}</p>}
      <div className="gc-case-cols">
        <div>
          <small>{t.gcReasons}</small>
          <ul>
            {reasons.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
        <div>
          <small>{t.gcActions}</small>
          <ul className="gc-do">
            {actions.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
