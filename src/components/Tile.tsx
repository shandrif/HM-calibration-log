import { memo } from 'react';
import { formatDose, UNDO_MS } from '../../shared/config';
import type { SlotView } from '../lib/board';
import { useI18n, slotLabel } from '../lib/i18n';
import { clock, countdown } from '../lib/time';
import { Ring } from './Ring';
import { IconDots, IconUndo } from './Icons';

interface Props {
  view: SlotView;
  now: number;
  alarming: boolean;
  busy: boolean;
  onPrimary: () => void;
  onUndo: () => void;
  onMenu: () => void;
}

export const Tile = memo(function Tile({ view, now, alarming, busy, onPrimary, onUndo, onMenu }: Props) {
  const { t } = useI18n();
  const { def, current, phase } = view;
  const { item } = slotLabel(t, def.slot);
  const isEspresso = def.kind === 'espresso';

  const undoLeft = current ? UNDO_MS - (now - current.t) : 0;
  const canUndo = !!current && undoLeft > 0 && phase !== 'expired';
  const canReset = !!current && !canUndo && phase !== 'expired' && phase !== 'none';

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

  const cta = isEspresso ? (current ? t.recalibrate : t.calibrate) : current ? t.newBatch : t.start;

  return (
    <article className="tile" data-phase={phase} data-alarm={alarming || undefined} aria-live="off">
      {/* re-mounts on every state change so the light sweeps across the glass once */}
      {phase !== 'none' && <span className="tile-shine" key={phase + (current?.id ?? '')} aria-hidden />}
      <header className="tile-head">
        <h3 className="tile-name">{item}</h3>
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

      <div className="tile-actions">
        <button className="btn btn-primary tile-cta" onClick={onPrimary} disabled={busy} data-busy={busy || undefined}>
          {cta}
        </button>
      </div>
    </article>
  );
});
