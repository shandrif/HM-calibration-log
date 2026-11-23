import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { StoreInfo } from '../../shared/config';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { testSound } from '../lib/sound';
import { IconBell, IconGlobe, IconPin, IconX, IconPlus } from './Icons';

/** Where web push can work: Chrome/Edge/Samsung/Firefox, and iPhone/iPad only when opened from the Home Screen (iOS 16.4+). */
function pushEnvironment() {
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  return { supported, iosNeedsInstall: ios && !standalone };
}

/** The service worker registration, registering it if needed; fails after 10 s instead of hanging. */
async function swRegistration(): Promise<ServiceWorkerRegistration> {
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'));
  if (reg.active) return reg;
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('service worker not ready')), 10000)),
  ]);
}

function b64ToBytes(b64: string) {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

export function MoreView({
  store,
  vapid,
  awake,
  geoStatus,
  onSaveStaff,
  onSignOut,
}: {
  store: StoreInfo;
  vapid: string;
  awake: boolean;
  geoStatus: string;
  onSaveStaff: (names: string[]) => Promise<string[] | null>;
  onSignOut: () => void;
}) {
  const { t, lang, setLang } = useI18n();
  const [pushState, setPushState] = useState<'unsupported' | 'ios-install' | 'blocked' | 'off' | 'on' | 'busy'>('off');
  const [name, setName] = useState('');

  const env = pushEnvironment();
  const pushSupported = env.supported && !!vapid;

  useEffect(() => {
    if (env.iosNeedsInstall) return setPushState('ios-install');
    if (!pushSupported) return setPushState('unsupported');
    if (Notification.permission === 'denied') return setPushState('blocked');
    let alive = true;
    swRegistration()
      .then(async (reg) => alive && setPushState((await reg.pushManager.getSubscription()) ? 'on' : 'off'))
      .catch(() => alive && setPushState('off'));
    return () => {
      alive = false;
    };
  }, [pushSupported, env.iosNeedsInstall]);

  const turnOn = async () => {
    setPushState('busy');
    try {
      // Ask first, directly inside the tap: iPhone ignores a permission request that comes after other awaits.
      const perm = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
      if (perm !== 'granted') {
        setPushState(perm === 'denied' ? 'blocked' : 'off');
        if (perm === 'denied') toast.error(t.notifBlocked);
        return;
      }
      const reg = await swRegistration();
      const existing = await reg.pushManager.getSubscription();
      const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(vapid) }));
      await api.subscribe(sub.toJSON());
      setPushState('on');
      toast.success(t.notifOnToast);
    } catch (e) {
      console.error(e);
      toast.error(`${t.notifFailed} (${e instanceof Error ? e.name || e.message : 'error'})`);
      setPushState('off');
    }
  };

  const turnOff = async () => {
    setPushState('busy');
    try {
      const reg = await swRegistration();
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        await api.unsubscribe(existing.endpoint).catch(() => {});
        await existing.unsubscribe();
      }
    } catch (e) {
      console.error(e);
    }
    setPushState('off');
  };

  const sendTest = async () => {
    try {
      await api.testPush();
      toast(t.notifTestSent);
    } catch {
      toast.error(t.notifFailed);
    }
  };

  return (
    <div className="more">
      <section className="card">
        <h2 className="card-title">
          <IconBell /> {t.alarmHelpTitle}
        </h2>
        <p className="card-text">{t.alarmHelp}</p>
        <div className="setting">
          <span>{t.sound}</span>
          <button className="btn btn-ghost" onClick={testSound}>
            {t.testSound}
          </button>
        </div>
        <div className="setting setting-notif">
          <span>{t.notifications}</span>
          {pushState === 'ios-install' || pushState === 'unsupported' || pushState === 'blocked' ? null : (
            <button
              className="switch"
              role="switch"
              aria-checked={pushState === 'on'}
              aria-busy={pushState === 'busy' || undefined}
              onClick={() => (pushState === 'on' ? turnOff() : turnOn())}
              disabled={pushState === 'busy'}
            >
              <span className="switch-thumb" />
            </button>
          )}
        </div>
        {pushState === 'ios-install' && (
          <ol className="howto">
            <li>{t.iosStep1}</li>
            <li>{t.iosStep2}</li>
            <li>{t.iosStep3}</li>
          </ol>
        )}
        {pushState === 'unsupported' && <p className="howto-note">{t.notifUnsupported}</p>}
        {pushState === 'blocked' && <p className="howto-note">{t.notifBlockedHelp}</p>}
        {pushState === 'on' && (
          <div className="setting">
            <span className="muted small">{t.notifOn}</span>
            <button className="btn btn-ghost" onClick={sendTest}>
              {t.notifTest}
            </button>
          </div>
        )}
        <div className="setting">
          <span>{t.screenAwake}</span>
          <span className="status-chip" data-on={awake || undefined}>{awake ? '●' : '○'}</span>
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">{t.staff}</h2>
        <ul className="staff-list">
          {store.staff.map((n) => (
            <li key={n}>
              <span>{n}</span>
              <button className="icon-btn" aria-label={`${t.removeName} ${n}`} onClick={() => onSaveStaff(store.staff.filter((x) => x !== n))}>
                <IconX />
              </button>
            </li>
          ))}
        </ul>
        <form
          className="add-row"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            if (await onSaveStaff([...store.staff, name.trim()])) setName('');
          }}
        >
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t.namePlaceholder} maxLength={40} />
          <button className="btn btn-primary" disabled={!name.trim()} aria-label={t.add}>
            <IconPlus />
          </button>
        </form>
      </section>

      <section className="card">
        <div className="setting">
          <span>
            <IconGlobe /> {t.language}
          </span>
          <div className="segmented">
            <button data-active={lang === 'en' || undefined} onClick={() => setLang('en')}>English</button>
            <button data-active={lang === 'ar' || undefined} onClick={() => setLang('ar')}>العربية</button>
          </div>
        </div>
        {store.geofence && (
          <div className="setting">
            <span>
              <IconPin /> GPS
            </span>
            <span className="status-chip" data-on={geoStatus === 'watching' || undefined}>
              {geoStatus === 'watching' ? '●' : geoStatus === 'denied' ? t.locationDenied : '○'}
            </span>
          </div>
        )}
        <div className="setting">
          <span>{t.install}</span>
          <span className="muted small">{t.installHint}</span>
        </div>
      </section>

      <button className="btn btn-ghost btn-lg signout" onClick={onSignOut}>
        {t.signOut}
      </button>
      <p className="footnote">
        {store.name} · {store.code}
      </p>
    </div>
  );
}
