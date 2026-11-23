// Reads today's account-wide usage from Cloudflare's analytics API (needs an Analytics:Read token)
// so head office sees a warning before any free-tier limit is reached.

export const FREE_LIMITS = {
  requests: 100_000, // Workers requests / day (whole account)
  rowsRead: 5_000_000, // D1 rows read / day (whole account)
  rowsWritten: 100_000, // D1 rows written / day (whole account)
  storageBytes: 5 * 1024 ** 3, // D1 storage (whole account)
};
export const WARN_AT = 0.7;

export interface UsageSnapshot {
  at: number;
  day: string; // UTC day (free limits reset at 00:00 UTC)
  requests: number;
  rowsRead: number;
  rowsWritten: number;
  storageBytes: number;
  byScript: Record<string, number>;
  error?: string;
}

export async function fetchUsage(accountId: string, token: string): Promise<UsageSnapshot> {
  const day = new Date().toISOString().slice(0, 10);
  const query = `query($a:String!,$d:Date!){viewer{accounts(filter:{accountTag:$a}){
    workersInvocationsAdaptive(limit:100,filter:{date_geq:$d}){sum{requests} dimensions{scriptName}}
    d1AnalyticsAdaptiveGroups(limit:100,filter:{date_geq:$d}){sum{rowsRead rowsWritten}}
    d1StorageAdaptiveGroups(limit:100,filter:{date_geq:$d}){max{databaseSizeBytes} dimensions{databaseId}}
  }}}`;
  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { a: accountId, d: day } }),
  });
  const snap: UsageSnapshot = { at: Date.now(), day, requests: 0, rowsRead: 0, rowsWritten: 0, storageBytes: 0, byScript: {} };
  if (!res.ok) return { ...snap, error: `HTTP ${res.status}` };
  const json = (await res.json()) as any;
  const acc = json?.data?.viewer?.accounts?.[0];
  if (!acc) return { ...snap, error: json?.errors?.[0]?.message ?? 'no data' };
  for (const r of acc.workersInvocationsAdaptive ?? []) {
    snap.requests += r.sum.requests;
    snap.byScript[r.dimensions.scriptName] = (snap.byScript[r.dimensions.scriptName] ?? 0) + r.sum.requests;
  }
  for (const r of acc.d1AnalyticsAdaptiveGroups ?? []) {
    snap.rowsRead += r.sum.rowsRead;
    snap.rowsWritten += r.sum.rowsWritten;
  }
  const perDb = new Map<string, number>();
  for (const r of acc.d1StorageAdaptiveGroups ?? []) perDb.set(r.dimensions.databaseId, Math.max(perDb.get(r.dimensions.databaseId) ?? 0, r.max.databaseSizeBytes));
  snap.storageBytes = [...perDb.values()].reduce((a, b) => a + b, 0);
  return snap;
}
