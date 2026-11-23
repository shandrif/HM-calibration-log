import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { StoreInfo } from '../../shared/config';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { testSound } from '../lib/sound';
import { IconBell, IconGlobe, IconPin, IconX, IconPlus } from './Icons';

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
  const [pushState, setPushState] = useState<'unsupported' | 'blocked' | 'off' | 'on' | 'busy'>('off');
  const [name, setName] = useState('');

  const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && !!vapid;

  useEffect(() => {
    if (!pushSupported) return setPushState('unsupported');
    if (Notification.permission === 'denied') return setPushState('blocked');
    navigator.serviceWorker.ready.then(async (reg) => setPushState((await reg.pushManager.getSubscription()) ? 'on' : 'off'));
  }, [pushSupported]);

  const togglePush = async () => {
    if (!pushSupported) return;
    setPushState('busy');
    try {
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        await api.unsubscribe(existing.endpoint).catch(() => {});
        await existing.unsubscribe();
        return setPushState('off');
      }
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return setPushState(perm === 'denied' ? 'blocked' : 'off');
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(vapid) });
      await api.subscribe(sub.toJSON());
      setPushState('on');
    } catch (e) {
      console.error(e);
      toast.error(t.failed);
      setPushState('off');
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
        <div className="setting">
          <span>{t.notifications}</span>
          {pushState === 'unsupported' ? (
            <span className="muted small">{t.notifUnsupported}</span>
          ) : pushState === 'blocked' ? (
            <span className="muted small">{t.notifBlocked}</span>
          ) : (
            <button className="switch" role="switch" aria-checked={pushState === 'on'} onClick={togglePush} disabled={pushState === 'busy'}>
              <span className="switch-thumb" />
            </button>
          )}
        </div>
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
