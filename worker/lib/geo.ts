export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

export interface Fix {
  lat?: number;
  lng?: number;
  acc?: number;
}

export type GeoResult = { ok: true; distance?: number } | { ok: false; reason: 'no_location' | 'outside'; distance?: number };

/** Allowed when within radius, with up to 100 m of grace for the reported GPS accuracy. */
export function checkGeofence(store: { lat: number | null; lng: number | null; radius_m: number }, fix: Fix | undefined): GeoResult {
  if (store.lat == null || store.lng == null) return { ok: true };
  if (!fix || typeof fix.lat !== 'number' || typeof fix.lng !== 'number' || !isFinite(fix.lat) || !isFinite(fix.lng)) {
    return { ok: false, reason: 'no_location' };
  }
  const distance = distanceM(store.lat, store.lng, fix.lat, fix.lng);
  const grace = Math.min(Math.max(Number(fix.acc) || 0, 0), 100);
  return distance <= store.radius_m + grace ? { ok: true, distance } : { ok: false, reason: 'outside', distance };
}
