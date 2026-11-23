import { useEffect, useRef, useState } from 'react';
import type { Fix } from './api';

type GeoStatus = 'idle' | 'watching' | 'denied' | 'unavailable';

/** Keeps a fresh GPS fix in the background so logging never waits for location. */
export function useGeo(enabled: boolean) {
  const fix = useRef<Fix>(undefined);
  const [status, setStatus] = useState<GeoStatus>('idle');
  useEffect(() => {
    if (!enabled || !('geolocation' in navigator)) {
      if (enabled) setStatus('unavailable');
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        fix.current = { lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) };
        setStatus('watching');
      },
      (e) => setStatus(e.code === e.PERMISSION_DENIED ? 'denied' : 'unavailable'),
      { enableHighAccuracy: true, maximumAge: 60000, timeout: 30000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);
  return { fix, status };
}

/** One-off fix (used on sign-in). */
export function getFix(timeout = 12000): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return resolve(undefined);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) }),
      (e) => (e.code === e.PERMISSION_DENIED ? reject(new Error('denied')) : resolve(undefined)),
      { enableHighAccuracy: true, maximumAge: 60000, timeout },
    );
  });
}

export function formatDistance(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
}
