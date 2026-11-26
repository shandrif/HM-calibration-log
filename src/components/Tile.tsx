import { memo } from 'react';
import { formatDose, formatGrams, UNDO_MS, type Down, recentShots, serviceTenths, SERVICE_PROMPT } from '../../shared/config';
import type { SlotView, TankView } from '../lib/board';
import { useI18n, slotLabel, fmt } from '../lib/i18n';
import { clock, countdown } from '../lib/time';
import { Ring } from './Ring';
import { IconDots, IconPower, IconUndo } from './Icons';

interface Props {
  view: SlotView;
  now: number;
  alarming: boolean;
  multiTank?: boolean;
  onDemo?: () => void;
  off?: Down;
  onPower?: () => void;
  onShot?: () => void;
  busy: boolean;
  onPrimary: () => void;
  onUndo: () => void;
  onMenu: () => void;
}

export const Tile = memo(function Tile({ view, now, alarming, multiTank, onDemo, off, onPower, onShot, busy, onPrimary, onUndo, onMenu }: Props) {
  const { t } = useI18n();
  const { def, current, phase, latest } = view;
  const { item } = slotLabel(t, def.slot);
  const isEspresso = def.kind === 'espresso';

  // undo always targets the batch logged last (whichever tank it went into)
  const undoLeft = latest ? UNDO_MS - (now - latest.t) : 0;
  const canUndo = !!latest && undoLeft > 0 && now < latest.x;
  const live = (tk: TankView) => !!tk.current && tk.phase !== 'expired' && tk.phase !== 'none';
  const canReset = !canUndo && view.tanks.some(live);

  let big = '—';
  let caption = t.notStarted;
  if (phase === 'brewing') {
    big = countdown(view.remaining);
    caption = t.brewing;
  } else if (phase === 'fresh' || phase === 'soon') {
    big = countdown(view.remaining);
    caption = phase === 'soon' ? t.soon : t.fresh;
  } else if (phase === 'expired') {
    big = '+' + countdown(-view.remaining);
    caption = t.expired;
  }

  // espresso: bad shots thrown during service on the running calibration
  const service = isEspresso && current && phase !== 'none' ? (current.s1 ?? 0) + (current.s2 ?? 0) : 0;
  const recent = isEspresso && current ? recentShots(current, now) : 0;
  const prompt = recent >= SERVICE_PROMPT.shots && phase !== 'none';
  const cta = isEspresso ? (current ? t.recalibrate : t.calibrate) : view.tanks.some((tk) => tk.current) ? t.newBatch : t.start;

  if (off) {
    return (
      <article className="tile" data-phase="off" aria-live="off">
        <header className="tile-head">
          <h3 className="tile-name">{item}</h3>
          <span className="tile-off-chip">
            <IconPower /> {t.offAt}
          </span>
        </header>
        <div className="tile-body">
          <div className="tile-ring tile-ring-off" aria-hidden>
            <IconPower />
          </div>
          <div className="tile-time">
            <div className="tile-big num">{countdown(now - off.off)}</div>
            <div className="tile-caption">{t.machineOffCaption}</div>
          </div>
        </div>
        <div className="tile-meta">
          <span className="num">
            {t.offSince} {clock(off.off)}
          </span>
          <span className="tile-by">{off.n}</span>
        </div>
        <div className="tile-actions">
          <button className="btn btn-primary tile-cta tile-cta-on" onClick={onPower} disabled={busy} data-busy={busy || undefined}>
            <IconPower /> {t.powerOn}
          </button>
        </div>
      </article>
    );
  }

  return (
    <article className="tile" data-phase={phase} data-alarm={alarming || undefined} data-prompt={prompt || undefined} aria-live="off">
      {/* re-mounts on every state change so the light sweeps across the glass once */}
      {phase !== 'none' && <span className="tile-shine" key={phase + (current?.id ?? '')} aria-hidden />}
      <header className="tile-head">
        <h3 className="tile-name">{item}</h3>
        {onPower && (
          <button className="icon-btn tile-power" onClick={onPower} aria-label={t.powerOff} title={t.powerOff}>
            <IconPower />
          </button>
        )}
        {onDemo && phase !== 'expired' && (
          <button className="tile-demo" onClick={onDemo}>
            ⚡ {t.demoTest}
          </button>
        )}
        {canUndo ? (
          <button className="tile-undo" onClick={onUndo} disabled={busy}>
            <IconUndo />
            <span>{t.undo}</span>
            <span className="num undo-left">{countdown(undoLeft)}</span>
          </button>
        ) : (
          canReset && (
            <button className="icon-btn tile-menu" onClick={onMenu} aria-label={t.reset}>
              <IconDots />
            </button>
          )
        )}
      </header>

      <div className="tile-body">
        <div className="tile-ring">
          <Ring progress={phase === 'none' ? 0 : phase === 'expired' ? 1 : phase === 'brewing' ? view.progress : 1 - view.progress} />
        </div>
        <div className="tile-time">
          <div className="tile-big num">{big}</div>
          <div className="tile-caption">{caption}</div>
        </div>
      </div>

      {multiTank && (
        <ul className="tile-tanks">
          {view.tanks.map((tk) => (
            <li key={tk.tank} data-phase={tk.phase} data-alarm={(tk.phase === 'expired' && alarming) || undefined}>
              <span className="tank-name">
                {t.tank} {tk.tank}
              </span>
              <span className="tank-state num">
                {tk.phase === 'none'
                  ? t.tankEmpty
                  : tk.phase === 'expired'
                    ? '+' + countdown(-tk.remaining)
                    : countdown(tk.remaining)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="tile-meta">
        {current && phase !== 'none' ? (
          <>
            {isEspresso && current.d1 != null ? (
              <span className="num" dir="ltr">
                {formatDose(current.d1)} · {formatDose(current.d2)}
              </span>
            ) : (
              <span className="num">
                {t.started} {clock(current.t)}
              </span>
            )}
            <span className="tile-by">{current.n}</span>
          </>
        ) : (
          <span>&nbsp;</span>
        )}
      </div>

      {service > 0 && !prompt && (
        <div className="tile-service num">{fmt(t.serviceLine, { n: service, g: formatGrams(serviceTenths(current!)) })}</div>
      )}
      {prompt && <div className="tile-prompt">{fmt(t.recalPrompt, { n: recent })}</div>}

      <div className="tile-actions">
        {onShot && isEspresso && current && phase !== 'none' && (
          <button className="btn btn-ghost tile-shot" onClick={onShot} disabled={busy}>
            {t.shotThrown}
          </button>
        )}
        <button className="btn btn-primary tile-cta" onClick={onPrimary} disabled={busy} data-busy={busy || undefined}>
          {cta}
        </button>
      </div>
    </article>
  );
});
