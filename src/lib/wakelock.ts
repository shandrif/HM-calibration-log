import { useEffect, useState } from 'react';

/** Keeps the screen on while the board is open (Chrome, Edge, Safari 16.4+, Samsung Internet). */
export function useWakeLock(active: boolean) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        lock = await navigator.wakeLock.request('screen');
        if (cancelled) return void lock.release();
        setOn(true);
        lock.addEventListener('release', () => setOn(false));
      } catch {
        setOn(false);
      }
    };
    void acquire();
    const onVis = () => void acquire();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      void lock?.release();
    };
  }, [active]);
  return on;
}
