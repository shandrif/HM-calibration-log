import { useI18n } from '../lib/i18n';

export type DeviceKind = 'ios' | 'android' | 'other';

export function deviceKind(): DeviceKind {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'other';
}

/** Step-by-step help when the phone blocks location. A website cannot change these settings itself. */
export function LocationHelp({ onRetry, busy }: { onRetry: () => void; busy?: boolean }) {
  const { t } = useI18n();
  const kind = deviceKind();
  const steps = kind === 'ios' ? [t.locIos1, t.locIos2, t.locIos3] : kind === 'android' ? [t.locAndroid1, t.locAndroid2, t.locAndroid3] : [t.locOther1, t.locOther2];
  return (
    <div className="loc-help" role="alert">
      <div className="loc-help-title">{t.locHelpTitle}</div>
      <ol className="howto">
        {steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <button type="button" className="btn btn-ghost loc-retry" onClick={onRetry} disabled={busy}>
        {t.tryAgain}
      </button>
    </div>
  );
}

/** True when the browser already knows location is blocked for this site (no prompt will appear). */
export async function locationBlocked(): Promise<boolean> {
  try {
    const s = await navigator.permissions?.query({ name: 'geolocation' as PermissionName });
    return s?.state === 'denied';
  } catch {
    return false;
  }
}
