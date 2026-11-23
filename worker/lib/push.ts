import { b64url } from './crypto';

// Web Push without a payload ("tickle"). The service worker then fetches the latest state and
// shows the notification. No payload encryption is needed, which keeps CPU time tiny on the free plan.

const jwtCache = new Map<string, { jwt: string; exp: number }>();
let keyCache: CryptoKey | null = null;

async function privateKey(jwk: string): Promise<CryptoKey> {
  if (!keyCache) {
    keyCache = await crypto.subtle.importKey('jwk', JSON.parse(jwk), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  }
  return keyCache;
}

async function vapidJwt(audience: string, subject: string, jwk: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const hit = jwtCache.get(audience);
  if (hit && hit.exp - now > 600) return hit.jwt;
  const exp = now + 12 * 3600;
  const enc = new TextEncoder();
  const head = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64url(enc.encode(JSON.stringify({ aud: audience, exp, sub: subject })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await privateKey(jwk), enc.encode(`${head}.${body}`));
  const jwt = `${head}.${body}.${b64url(sig)}`;
  jwtCache.set(audience, { jwt, exp });
  return jwt;
}

/** Returns false if the subscription is gone and should be deleted. */
export async function sendTickle(endpoint: string, opts: { publicKey: string; privateJwk: string; subject: string }): Promise<boolean> {
  const aud = new URL(endpoint).origin;
  const jwt = await vapidJwt(aud, opts.subject, opts.privateJwk);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { TTL: '900', Urgency: 'high', Authorization: `vapid t=${jwt}, k=${opts.publicKey}`, 'Content-Length': '0' },
  });
  return !(res.status === 404 || res.status === 410);
}
