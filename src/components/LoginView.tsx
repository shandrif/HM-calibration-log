import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { api, ApiError } from '../lib/api';
import { getFix, formatDistance } from '../lib/geo';
import { LocationHelp, locationBlocked } from './LocationHelp';
import { useI18n, fmt } from '../lib/i18n';
import { Logo } from './Logo';

export function LoginView({ onDone }: { onDone: () => void }) {
  const { t, lang, setLang } = useI18n();
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [locBlocked, setLocBlocked] = useState(false);

  // If the browser already blocks location for this site, show the fix straight away.
  useEffect(() => {
    void locationBlocked().then((b) => b && setLocBlocked(true));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(t.locating);
    try {
      let fix;
      try {
        fix = await getFix();
      } catch {
        setMsg('');
        setLocBlocked(true);
        setBusy(false);
        return;
      }
      setLocBlocked(false);
      setMsg('');
      await api.login(code, pin, fix);
      onDone();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'bad_login') setMsg(t.badLogin);
        else if (err.code === 'locked') setMsg(t.locked);
        else if (err.code === 'no_pin') setMsg(t.noPin);
        else if (err.code === 'outside') setMsg(fmt(t.outside, { d: formatDistance(Number(err.data.distance)), r: formatDistance(500) }));
        else if (err.code === 'no_location') setMsg(t.noLocation);
        else if (err.code === 'offline') setMsg(t.offline);
        else setMsg(t.failed);
      } else setMsg(t.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <button className="pill login-lang" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>
        {lang === 'ar' ? 'EN' : 'ع'}
      </button>
      <div className="liquid-blob" aria-hidden />
      <motion.form
        className="login-card"
        onSubmit={submit}
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45, ease: [0.23, 1, 0.32, 1] }}
      >
        <Logo size={56} />
        <h1 className="login-title">{t.appName}</h1>
        <p className="login-hint">{t.signInHint}</p>
        <label className="field">
          <span>{t.storeCode}</span>
          <input
            className="input input-lg"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            autoCapitalize="characters"
            autoComplete="username"
            inputMode="text"
            dir="ltr"
            required
          />
        </label>
        <label className="field">
          <span>{t.pin}</span>
          <input
            className="input input-lg num"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
            type="password"
            autoComplete="current-password"
            maxLength={8}
            dir="ltr"
            required
          />
        </label>
        {locBlocked && (
          <LocationHelp
            busy={busy}
            onRetry={async () => {
              setBusy(true);
              try {
                await getFix();
                setLocBlocked(false);
              } catch {
                // Safari only picks up a changed setting after the page reloads
                window.location.reload();
              } finally {
                setBusy(false);
              }
            }}
          />
        )}
        {msg && (
          <motion.p className="login-msg" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} role="status">
            {msg}
          </motion.p>
        )}
        <button className="btn btn-primary btn-lg" disabled={busy || !code || pin.length < 4}>
          {busy ? t.locating : t.signIn}
        </button>
      </motion.form>
    </div>
  );
}
