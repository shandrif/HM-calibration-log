import { useEffect, useRef } from 'react';
import { stepDose } from '../../shared/config';
import { IconChevron } from './Icons';

/** Grinder setting "6:30": left number steps by 1, right number by 5 (00–95). Hold to repeat. */
export function DoseStepper({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const major = Math.floor(value / 100);
  const minor = value % 100;
  return (
    <div className="dose">
      <div className="dose-label">{label}</div>
      <div className="dose-body" dir="ltr">
        <Part value={String(major)} label="major" onStep={(d) => onChange(stepDose(value, 'major', d))} />
        <span className="dose-colon">:</span>
        <Part value={String(minor).padStart(2, '0')} label="minor" onStep={(d) => onChange(stepDose(value, 'minor', d))} />
      </div>
    </div>
  );
}

function Part({ value, label, onStep }: { value: string; label: string; onStep: (d: 1 | -1) => void }) {
  return (
    <div className="dose-part">
      <HoldButton onStep={() => onStep(1)} aria={`${label} up`}>
        <IconChevron dir="up" />
      </HoldButton>
      <span className="dose-value">{value}</span>
      <HoldButton onStep={() => onStep(-1)} aria={`${label} down`}>
        <IconChevron dir="down" />
      </HoldButton>
    </div>
  );
}

function HoldButton({ onStep, children, aria }: { onStep: () => void; children: React.ReactNode; aria: string }) {
  const timer = useRef<number | undefined>(undefined);
  const cb = useRef(onStep);
  cb.current = onStep;
  const stop = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
  };
  useEffect(() => stop, []);
  const start = (e: React.PointerEvent) => {
    e.preventDefault();
    cb.current();
    let delay = 380;
    const loop = () => {
      cb.current();
      delay = Math.max(60, delay * 0.8);
      timer.current = window.setTimeout(loop, delay);
    };
    timer.current = window.setTimeout(loop, delay);
  };
  return (
    <button
      type="button"
      className="dose-btn"
      aria-label={aria}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          cb.current();
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </button>
  );
}
