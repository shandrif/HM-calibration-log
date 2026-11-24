import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { toast } from 'sonner';
import { type Batch, type StoreInfo, type BeanKey, slotsFor, DISCARD_QUICK_ML, MAX_THROWN, DOSE_TENTHS_G, thrownTenths, beanOf, BEAN_KEYS, normalizeBatch, dripTenths } from '../shared/config';
import { api, ApiError } from './lib/api';
import { useI18n, fmt, slotLabel } from './lib/i18n';
import { useNow, setServerNow, nowMs, clock, dayKey } from './lib/time';
import { useGeo, formatDistance } from './lib/geo';
import { useWakeLock } from './lib/wakelock';
import { unlockAudio, startAlarm, stopAlarm, chime, onSoundBlocked, resumeAlarmIfNeeded } from './lib/sound';
import { haptic } from './lib/haptics';
import { slotView, loadAcks, saveAcks, ls, lsSet, type SlotView } from './lib/board';
import { Tile } from './components/Tile';
import { Grams } from './components/Grams';
import { Sheet } from './components/Sheet';
import { DoseStepper } from './components/DoseStepper';
import { Logo } from './components/Logo';
import { IconBoard, IconLog, IconMore, IconBell, IconPlus, IconUser, IconMinus, IconChevron } from './components/Icons';
import { LoginView } from './components/LoginView';
import { LogView } from './components/LogView';
import { MoreView } from './components/MoreView';

type Tab = 'board' | 'log' | 'more';
const TAB_ORDER: Tab[] = ['board', 'log', 'more'];
/** Sideways slide in the direction of travel; the old tab leaves fast so the new one feels instant. */
const TAB_VARIANTS = {
  enter: (d: number) => ({ opacity: 0, x: d * 40 }),
  center: { opacity: 1, x: 0, transition: { duration: 0.3, ease: [0.23, 1, 0.32, 1] as [number, number, number, number] } },
  exit: (d: number) => ({ opacity: 0, x: d * -24, transition: { duration: 0.12, ease: [0.4, 0, 1, 1] as [number, number, number, number] } }),
};

export function StoreApp() {
  const { t, lang } = useI18n();
  const [status, setStatus] = useState<'loading' | 'signedOut' | 'ready'>('loading');
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [vapid, setVapid] = useState('');
  const [gated, setGated] = useState(false);
  const [tab, setTab] = useState<Tab>('board');

  const load = useCallback(async () => {
    try {
      const s = await api.state();
      setServerNow(s.now);
      setStore(s.store);
      setBatches(s.batches);
      setVapid(s.vapid);
      setStatus('ready');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setStatus('signedOut');
      else if (status === 'loading') setStatus('signedOut');
    }
  }, [status]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync without polling hard: on returning to the page, and every 10 minutes while visible.
  useEffect(() => {
    if (status !== 'ready') return;
    const onVis = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVis);
    const iv = window.setInterval(() => document.visibilityState === 'visible' && void load(), 10 * 60 * 1000);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      clearInterval(iv);
    };
  }, [status, load]);

  const onAuthError = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) {
        toast.error(t.signedOut);
        setStatus('signedOut');
        return true;
      }
      return false;
    },
    [t],
  );

  if (status === 'loading') return <div className="splash"><Logo size={56} /></div>;
  if (status === 'signedOut' || !store)
    return (
      <LoginView
        onDone={() => {
          setGated(true);
          unlockAudio();
          void load();
        }}
      />
    );

  return (
    <>
      <AnimatePresence>
        {!gated && (
          <motion.button
            className="gate"
            key="gate"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, filter: 'blur(4px)' }}
            transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
            onClick={() => {
              unlockAudio();
              setGated(true);
            }}
          >
            <span className="liquid-blob" aria-hidden />
            <Logo size={72} />
            <div className="gate-store">{lang === 'ar' && store.name_ar ? store.name_ar : store.name}</div>
            <div className="gate-cta">{t.tapToBegin}</div>
            <div className="gate-hint">{t.gateHint}</div>
          </motion.button>
        )}
      </AnimatePresence>
      <Shell
        store={store}
        setStore={setStore}
        batches={batches}
        setBatches={setBatches}
        vapid={vapid}
        gated={gated}
        tab={tab}
        setTab={setTab}
        onAuthError={onAuthError}
        onSignOut={async () => {
          await api.logout().catch(() => {});
          setStatus('signedOut');
          setStore(null);
        }}
      />
    </>
  );
}

interface ShellProps {
  store: StoreInfo;
  setStore: (s: StoreInfo) => void;
  batches: Batch[];
  setBatches: React.Dispatch<React.SetStateAction<Batch[]>>;
  vapid: string;
  gated: boolean;
  tab: Tab;
  setTab: (t: Tab) => void;
  onAuthError: (e: unknown) => boolean;
  onSignOut: () => void;
}

function Shell({ store, setStore, batches, setBatches, vapid, gated, tab, setTab, onAuthError, onSignOut }: ShellProps) {
  const { t, lang, setLang } = useI18n();
  // tab order decides the slide direction (Board → Log → More)
  const [tabDir, setTabDir] = useState<1 | -1>(1);
  const goTab = (k: Tab) => {
    if (k === tab) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      document.querySelector('.main > div')?.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setTabDir(TAB_ORDER.indexOf(k) > TAB_ORDER.indexOf(tab) ? 1 : -1);
    haptic(8);
    setTab(k);
  };
  const now = useNow();
  const geo = useGeo(gated && store.geofence);
  const awake = useWakeLock(gated);
  // Several people can be on shift; each log records who actually did it.
  const [shift, setShiftState] = useState<string[]>(() => {
    try {
      const s = JSON.parse(ls('hm_shift', '[]'));
      if (Array.isArray(s) && s.length) return s.map(String);
    } catch {
      /* ignore */
    }
    const legacy = ls('hm_staff');
    return legacy ? [legacy] : [];
  });
  const [lastBy, setLastByState] = useState(() => ls('hm_last_by'));
  const [whoSheet, setWhoSheet] = useState<null | { label: string; then: (name: string) => void }>(null);
  const [acks, setAcks] = useState(loadAcks);
  const [busySlot, setBusySlot] = useState<string | null>(null);

  // sheets
  const [staffSheet, setStaffSheet] = useState<null | { then?: (name: string) => void }>(null);
  const [espressoSheet, setEspressoSheet] = useState<null | { slot: string; d1: number; d2: number; w1: number; w2: number; by: string }>(null);
  const [discardSheet, setDiscardSheet] = useState<null | { id: string; day: string; label: string }>(null);
  const [resetSheet, setResetSheet] = useState<null | { batch: Batch }>(null);

  const onShift = useMemo(() => shift.filter((n) => store.staff.includes(n)), [shift, store.staff]);
  const setShift = (names: string[]) => {
    setShiftState(names);
    lsSet('hm_shift', JSON.stringify(names));
  };
  const toggleShift = (n: string) => setShift(shift.includes(n) ? shift.filter((x) => x !== n) : [...shift, n]);
  const addToShift = (n: string) => !shift.includes(n) && setShift([...shift, n]);
  const setLastBy = (n: string) => {
    setLastByState(n);
    lsSet('hm_last_by', n);
  };
  // most recent person first in pickers
  const shiftOrdered = useMemo(() => (lastBy && onShift.includes(lastBy) ? [lastBy, ...onShift.filter((n) => n !== lastBy)] : onShift), [onShift, lastBy]);

  const slots = useMemo(() => slotsFor(store.espresso_mode), [store.espresso_mode]);
  const views = useMemo(() => slots.map((d) => slotView(d, batches, now)), [slots, batches, now]);

  // ---------------------------------------------------------------- alarm
  const alarming = useMemo(
    () => views.filter((v) => v.phase === 'expired' && v.current && !acks.has(v.current.id) && now - v.current.x < 6 * 3600 * 1000),
    [views, acks, now],
  );
  // Sound needs a tap before browsers allow it: unlock on every tap anywhere (sign-in, gate, tiles…).
  useEffect(() => {
    const onTap = () => unlockAudio();
    const onVis = () => document.visibilityState === 'visible' && resumeAlarmIfNeeded();
    window.addEventListener('pointerdown', onTap, true);
    window.addEventListener('keydown', onTap, true);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pointerdown', onTap, true);
      window.removeEventListener('keydown', onTap, true);
      document.removeEventListener('visibilitychange', onVis);
      stopAlarm();
    };
  }, []);
  const [soundBlocked, setSoundBlocked] = useState(false);
  useEffect(() => onSoundBlocked(setSoundBlocked), []);
  // Start even before the "Tap to begin" screen is dismissed: if the browser blocks it,
  // the next tap anywhere starts it.
  useEffect(() => {
    if (alarming.length) startAlarm();
    else stopAlarm();
  }, [alarming.length]);

  const ackAll = () => {
    haptic(20);
    const next = new Set(acks);
    alarming.forEach((v) => v.current && next.add(v.current.id));
    setAcks(next);
    saveAcks(next);
  };

  // soft chimes on phase changes (ready / expiring soon)
  const prevPhases = useRef<Record<string, string>>({});
  useEffect(() => {
    for (const v of views) {
      const prev = prevPhases.current[v.def.slot];
      if (prev && prev !== v.phase && gated) {
        if (prev === 'brewing' && v.phase === 'fresh' && v.def.kind === 'drip') {
          chime('ready');
          toast.success(`${slotLabel(t, v.def.slot).group} · ${slotLabel(t, v.def.slot).item} — ${t.readyAt}`);
        }
        if (prev === 'fresh' && v.phase === 'soon') chime('soon');
      }
      prevPhases.current[v.def.slot] = v.phase;
    }
  }, [views, gated, t]);

  // ---------------------------------------------------------------- actions
  const handleError = (e: unknown) => {
    if (onAuthError(e)) return;
    if (e instanceof ApiError) {
      if (e.code === 'outside') return toast.error(fmt(t.outside, { d: formatDistance(Number(e.data.distance)), r: formatDistance(500) }));
      if (e.code === 'no_location') return toast.error(geo.status === 'denied' ? t.locationDenied : t.noLocation);
      if (e.code === 'offline') return toast.error(t.offline);
    }
    toast.error(t.failed);
  };

  /** One person on shift → use them. Several → quick "who is doing this?" picker. Nobody → pick/add a name. */
  const withStaff = (label: string, fn: (name: string) => void) => {
    if (onShift.length === 1) fn(onShift[0]);
    else if (onShift.length > 1) setWhoSheet({ label, then: fn });
    else setStaffSheet({ then: fn });
  };

  const startBatch = async (view: SlotView, name: string, doses?: { d1: number; d2: number; w1?: number; w2?: number }) => {
    const previous = view.current && nowMs() - view.current.t < 12 * 3600 * 1000 ? view.current : undefined;
    setBusySlot(view.def.slot);
    try {
      setLastBy(name);
      const res = await api.start({ slot: view.def.slot, staff: name, ...doses, fix: geo.fix.current });
      setServerNow(res.now);
      setBatches((b) => [...b, res.batch]);
      haptic(15);
      if (doses) setStore({ ...store, last_doses: { ...store.last_doses, [view.def.slot]: [doses.d1, doses.d2] } });
      if (previous) {
        const acked = new Set(acks);
        acked.add(previous.id);
        setAcks(acked);
        saveAcks(acked);
      }
      if (view.def.kind === 'drip' && previous) {
        const l = slotLabel(t, view.def.slot);
        setDiscardSheet({ id: res.batch.id, day: res.day, label: `${l.group} · ${l.item}` });
      }
    } catch (e) {
      handleError(e);
    } finally {
      setBusySlot(null);
    }
  };

  // ---------------------------------------------------------------- bean batches
  const [beanSheet, setBeanSheet] = useState<null | { bean: BeanKey; then?: () => void }>(null);
  const [skippedBeans, setSkippedBeans] = useState<Set<BeanKey>>(new Set());
  /** First log of a bean with no batch number: ask once (can be skipped for this visit). */
  const ensureBatch = (bean: BeanKey, cont: () => void) => {
    if (store.beans?.[bean]?.cur || skippedBeans.has(bean)) cont();
    else setBeanSheet({ bean, then: cont });
  };
  const saveBean = async (bean: BeanKey, batch: string) => {
    try {
      const r = await api.setBean(bean, batch, lastBy || onShift[0] || '');
      setStore({ ...store, beans: r.beans });
      toast.success(`${t[bean === 'espresso' ? 'espresso' : bean]} · ${t.batch} ${batch}`);
      return true;
    } catch (e) {
      handleError(e);
      return false;
    }
  };

  const onPrimary = (view: SlotView) => ensureBatch(beanOf(view.def.slot), () => onPrimaryInner(view));
  const onPrimaryInner = (view: SlotView) => {
    if (view.def.kind === 'espresso') {
      const last = store.last_doses[view.def.slot] ?? store.last_doses.espresso_hot ?? store.last_doses.espresso ?? [630, 870];
      const open = (by: string) => setEspressoSheet({ slot: view.def.slot, d1: last[0], d2: last[1], w1: 0, w2: 0, by });
      if (onShift.length === 0) setStaffSheet({ then: open });
      else open(onShift.length === 1 ? onShift[0] : lastBy && onShift.includes(lastBy) ? lastBy : '');
    } else {
      const l = slotLabel(t, view.def.slot);
      withStaff(`${l.group} · ${l.item}`, (name) => void startBatch(view, name));
    }
  };

  const voidBatch = async (b: Batch) => {
    try {
      await api.void(b.id, dayKey(b.t));
      setBatches((all) => all.map((x) => (x.id === b.id ? { ...x, v: nowMs() } : x)));
      toast(t.resetDone);
    } catch (e) {
      handleError(e);
    }
  };

  const saveStaffList = async (names: string[]) => {
    try {
      const r = await api.staff(names);
      setStore({ ...store, staff: r.staff });
      return r.staff;
    } catch (e) {
      handleError(e);
      return null;
    }
  };

  // ---------------------------------------------------------------- render
  const groups: { key: 'espresso' | 'hot_drip' | 'iced_drip'; every: string }[] = [
    { key: 'espresso', every: t.every3h },
    { key: 'hot_drip', every: t.every30m },
    { key: 'iced_drip', every: t.every1h },
  ];
  const storeName = lang === 'ar' && store.name_ar ? store.name_ar : store.name;

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-row">
          <Logo size={34} />
          <div className="topbar-title">
            <div className="topbar-store">{storeName}</div>
            <div className="topbar-sub num">
              {store.code} · {clock(now)}
            </div>
          </div>
          <div className="topbar-clock num" aria-hidden>
            {clock(now)}
          </div>
          <button className="pill" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')} aria-label={t.language}>
            {lang === 'ar' ? 'EN' : 'ع'}
          </button>
        </div>
        <StaffBar staff={store.staff} onShift={onShift} onToggle={toggleShift} onAdd={() => setStaffSheet({})} />
      </header>

      <AnimatePresence>
        {alarming.length > 0 && (
          <motion.div
            className="alarm-bar"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            role="alert"
          >
            <IconBell />
            <span className="alarm-text">
              {fmt(t.alarmActive, { n: alarming.length })}:{' '}
              {alarming.map((v) => {
                const l = slotLabel(t, v.def.slot);
                return `${v.def.group === 'espresso' ? l.group + ' ' + l.item : l.group + ' · ' + l.item}`;
              }).join(', ')}
            </span>
            {soundBlocked ? (
              <button className="btn btn-light alarm-sound" onClick={() => unlockAudio()}>
                🔊 {t.tapForSound}
              </button>
            ) : (
              <button className="btn btn-light" onClick={ackAll}>
                {t.stopAlarm}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <main className="main">
        <AnimatePresence mode="wait" initial={false} custom={tabDir * (lang === 'ar' ? -1 : 1)} onExitComplete={() => window.scrollTo(0, 0)}>
          <motion.div
            key={tab}
            custom={tabDir * (lang === 'ar' ? -1 : 1)}
            variants={TAB_VARIANTS}
            initial="enter"
            animate="center"
            exit="exit"
          >
            {tab === 'board' && (
              <>
              <BeanStrip beans={store.beans ?? {}} onPick={(bean) => setBeanSheet({ bean })} />
              <div className="board">
                {groups.map((g, gi) => {
                  const vs = views.filter((v) => v.def.group === g.key);
                  return (
                    <motion.section
                      key={g.key}
                      className="station"
                      data-station={g.key}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4, delay: gi * 0.06, ease: [0.23, 1, 0.32, 1] }}
                    >
                      <div className="station-head">
                        <h2>{t[g.key]}</h2>
                        <span className="station-every">{g.every}</span>
                      </div>
                      <div className="tiles" data-count={vs.length}>
                        {vs.map((v) => (
                          <Tile
                            key={v.def.slot}
                            view={v}
                            now={now}
                            alarming={alarming.includes(v)}
                            busy={busySlot === v.def.slot}
                            onPrimary={() => onPrimary(v)}
                            onUndo={() => v.current && void voidBatch(v.current)}
                            onMenu={() => v.current && setResetSheet({ batch: v.current })}
                          />
                        ))}
                      </div>
                    </motion.section>
                  );
                })}
              </div>
              </>
            )}
            {tab === 'log' && <LogView store={store} fetchDay={(d) => api.log(d)} fetchDays={() => api.logDays()} liveBatches={batches} onAuthError={onAuthError} />}
            {tab === 'more' && (
              <MoreView
                store={store}
                vapid={vapid}
                awake={awake}
                onSaveStaff={saveStaffList}
                onSignOut={onSignOut}
                geoStatus={geo.status}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      <nav className="tabbar" aria-label="Main">
        {(
          [
            ['board', t.board, <IconBoard key="b" />],
            ['log', t.logShort, <IconLog key="l" />],
            ['more', t.more, <IconMore key="m" />],
          ] as const
        ).map(([k, label, icon]) => (
          <button key={k} className="tab" data-active={tab === k || undefined} onClick={() => goTab(k)} aria-current={tab === k ? 'page' : undefined}>
            {icon}
            <span>{label}</span>
            {tab === k && <motion.span layoutId="tab-dot" className="tab-dot" transition={{ type: 'spring', duration: 0.35, bounce: 0.15 }} />}
          </button>
        ))}
      </nav>

      {/* ------------------------------------------------ sheets */}
      <StaffSheet
        open={!!staffSheet}
        onOpenChange={(o) => !o && setStaffSheet(null)}
        staff={store.staff}
        onShift={onShift}
        onPick={(n) => {
          addToShift(n);
          const then = staffSheet?.then;
          setStaffSheet(null);
          then?.(n);
        }}
        onAdd={async (n) => {
          const list = await saveStaffList([...store.staff, n]);
          return !!list;
        }}
      />

      <Sheet open={!!espressoSheet} onOpenChange={(o) => !o && setEspressoSheet(null)} title={espressoSheet ? `${t.espresso} · ${slotLabel(t, espressoSheet.slot).item}` : ''}>
        {espressoSheet && (
          <div className="sheet-body esp-grid">
            <div className="dose-row">
              <DoseStepper label={t.dose1} value={espressoSheet.d1} onChange={(d1) => setEspressoSheet({ ...espressoSheet, d1 })} />
              <DoseStepper label={t.dose2} value={espressoSheet.d2} onChange={(d2) => setEspressoSheet({ ...espressoSheet, d2 })} />
            </div>
            <div className="esp-side">
            <div className="thrown">
              <div className="thrown-title">
                <span>{t.thrownTitle}</span>
                {espressoSheet.w1 + espressoSheet.w2 > 0 && (
                  <motion.span className="thrown-total num" key={espressoSheet.w1 * 100 + espressoSheet.w2} initial={{ opacity: 0.4, y: -2 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
                    = <Grams tenths={thrownTenths(espressoSheet.w1, espressoSheet.w2)} lang={lang} />
                  </motion.span>
                )}
              </div>
              <div className="thrown-row">
                <Counter label={t.dose1} hint={fmt(t.gPerShot, { g: DOSE_TENTHS_G.d1 / 10 })} value={espressoSheet.w1} onChange={(w1) => setEspressoSheet({ ...espressoSheet, w1 })} />
                <Counter label={t.dose2} hint={fmt(t.gPerShot, { g: DOSE_TENTHS_G.d2 / 10 })} value={espressoSheet.w2} onChange={(w2) => setEspressoSheet({ ...espressoSheet, w2 })} />
              </div>
            </div>
            <div className="by">
              <div className="by-label">
                <IconUser /> {t.calibratedBy}
              </div>
              <div className="by-chips" role="radiogroup" aria-label={t.calibratedBy}>
                {shiftOrdered.map((n) => (
                  <button key={n} role="radio" aria-checked={espressoSheet.by === n} className="chip" data-active={espressoSheet.by === n || undefined} onClick={() => setEspressoSheet({ ...espressoSheet, by: n })}>
                    {n}
                  </button>
                ))}
                <button
                  className="chip chip-add"
                  aria-label={t.someoneElse}
                  onClick={() => {
                    const keep = espressoSheet;
                    setEspressoSheet(null);
                    setStaffSheet({ then: (n) => setEspressoSheet({ ...keep, by: n }) });
                  }}
                >
                  <IconPlus />
                </button>
              </div>
            </div>
            <button
              className="btn btn-primary btn-lg"
              disabled={busySlot === espressoSheet.slot || !espressoSheet.by}
              onClick={() => {
                const v = views.find((x) => x.def.slot === espressoSheet.slot)!;
                const d = { d1: espressoSheet.d1, d2: espressoSheet.d2, w1: espressoSheet.w1, w2: espressoSheet.w2 };
                const by = espressoSheet.by;
                setEspressoSheet(null);
                void startBatch(v, by, d);
              }}
            >
              {espressoSheet.by ? t.saveStart : t.pickWho}
            </button>
            </div>
          </div>
        )}
      </Sheet>

      <Sheet open={!!whoSheet} onOpenChange={(o) => !o && setWhoSheet(null)} title={t.whoIsDoing}>
        {whoSheet && (
          <div className="sheet-body">
            <p className="sheet-text muted">{whoSheet.label}</p>
            <div className="chip-grid">
              {shiftOrdered.map((n) => (
                <button
                  key={n}
                  className="chip chip-lg"
                  onClick={() => {
                    const then = whoSheet.then;
                    setWhoSheet(null);
                    then(n);
                  }}
                >
                  {n}
                </button>
              ))}
              <button
                className="chip chip-lg chip-other"
                onClick={() => {
                  const then = whoSheet.then;
                  setWhoSheet(null);
                  setStaffSheet({ then });
                }}
              >
                {t.someoneElse}
              </button>
            </div>
          </div>
        )}
      </Sheet>

      <BeanSheet
        state={beanSheet}
        current={beanSheet ? store.beans?.[beanSheet.bean] : undefined}
        onClose={() => setBeanSheet(null)}
        onSkip={() => {
          if (!beanSheet) return;
          const { bean, then } = beanSheet;
          setSkippedBeans(new Set([...skippedBeans, bean]));
          setBeanSheet(null);
          then?.();
        }}
        onSave={async (batch) => {
          if (!beanSheet) return;
          const { bean, then } = beanSheet;
          if (await saveBean(bean, batch)) {
            setBeanSheet(null);
            then?.();
          }
        }}
      />

      <DiscardSheet
        state={discardSheet}
        onClose={() => setDiscardSheet(null)}
        onSave={async (ml) => {
          if (!discardSheet) return;
          const { id, day } = discardSheet;
          setDiscardSheet(null);
          if (ml <= 0) return;
          try {
            await api.discard(id, day, ml);
            setBatches((all) => all.map((x) => (x.id === id ? { ...x, dl: ml } : x)));
            toast.success(t.discardSaved);
          } catch (e) {
            handleError(e);
          }
        }}
      />

      <Sheet open={!!resetSheet} onOpenChange={(o) => !o && setResetSheet(null)} title={t.reset}>
        {resetSheet && (
          <div className="sheet-body">
            <p className="sheet-text">{t.resetConfirm}</p>
            <p className="sheet-text muted num">
              {slotLabel(t, resetSheet.batch.s).group} · {slotLabel(t, resetSheet.batch.s).item} · {clock(resetSheet.batch.t)} · {resetSheet.batch.n}
            </p>
            <div className="btn-row">
              <button className="btn btn-ghost btn-lg" onClick={() => setResetSheet(null)}>
                {t.cancel}
              </button>
              <button
                className="btn btn-danger btn-lg"
                onClick={() => {
                  const b = resetSheet.batch;
                  setResetSheet(null);
                  void voidBatch(b);
                }}
              >
                {t.confirm}
              </button>
            </div>
          </div>
        )}
      </Sheet>

    </div>
  );
}

// ---------------------------------------------------------------- bean batches

function BeanIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <ellipse cx="12" cy="12" rx="6.6" ry="9.2" transform="rotate(32 12 12)" fill="currentColor" />
      <path d="M8.9 18.4c2.6-2.2 1.2-5.6 3.3-7.6 1.7-1.6 2.6-3.1 2.9-4.9" fill="none" stroke="rgba(255,255,255,.85)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** Bag-label cards: bean, current batch code, and when / by whom the bag was opened. */
function BeanStrip({ beans, onPick }: { beans: StoreInfo['beans']; onPick: (b: BeanKey) => void }) {
  const { t } = useI18n();
  return (
    <div className="bag-row" role="group" aria-label={t.batches}>
      {BEAN_KEYS.map((b) => {
        const info = beans?.[b];
        const cur = info?.cur;
        return (
          <button key={b} className="bag" data-bean={b} data-missing={!cur || undefined} onClick={() => onPick(b)}>
            <span className="bag-top">
              <span className="bag-icon">
                <BeanIcon />
              </span>
              <span className="bag-name">{t[b === 'espresso' ? 'espresso' : b]}</span>
              <IconChevron dir="right" />
            </span>
            <span className="bag-perf" aria-hidden />
            <span className="bag-code num" dir="ltr">
              {cur ?? `${t.addBatch} +`}
            </span>
            <span className="bag-meta num">{cur ? [clock(info!.at), info!.by].filter(Boolean).join(' · ') : t.tapToAdd}</span>
          </button>
        );
      })}
    </div>
  );
}

function BeanSheet({
  state,
  current,
  onClose,
  onSave,
  onSkip,
}: {
  state: null | { bean: BeanKey; then?: () => void };
  current?: { cur: string; recent: string[]; at: number; by: string };
  onClose: () => void;
  onSave: (batch: string) => Promise<void>;
  onSkip: () => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (state) setValue('');
  }, [state]);
  if (!state) return <Sheet open={false} onOpenChange={() => {}} title="">{null}</Sheet>;
  const name = t[state.bean === 'espresso' ? 'espresso' : state.bean];
  const valid = normalizeBatch(value);
  const submit = async (v: string) => {
    setSaving(true);
    await onSave(v);
    setSaving(false);
  };
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={`${name} · ${t.batchNumber}`}>
      <form
        className="sheet-body"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) void submit(valid);
        }}
      >
        {state.then && !current?.cur && <p className="sheet-text muted">{t.batchFirstTime}</p>}
        {current?.cur && (
          <div className="batch-current">
            <span className="muted small">{t.batchInUse}</span>
            <span className="batch-current-value num" dir="ltr">
              #{current.cur}
            </span>
            {current.by && (
              <span className="muted small">
                {current.by} · {clock(current.at)}
              </span>
            )}
          </div>
        )}
        <label className="field">
          <span>{current?.cur ? t.newBagBatch : t.batchNumber}</span>
          <input
            className="input input-lg num"
            dir="ltr"
            value={value}
            onChange={(e) => setValue(e.target.value.toUpperCase())}
            placeholder="A1234"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
            maxLength={30}
          />
        </label>
        {!!current?.recent?.length && (
          <div className="batch-recent">
            <span className="muted small">{t.recentBatches}</span>
            <div className="by-chips">
              {current.recent.map((r) => (
                <button type="button" key={r} className="chip num" dir="ltr" onClick={() => void submit(r)}>
                  #{r}
                </button>
              ))}
            </div>
          </div>
        )}
        <button className="btn btn-primary btn-lg" disabled={!valid || saving}>
          {t.saveBatch}
        </button>
        {state.then && (
          <button type="button" className="btn btn-ghost" onClick={onSkip}>
            {t.skipForNow}
          </button>
        )}
      </form>
    </Sheet>
  );
}

// ---------------------------------------------------------------- thrown shots counter

function Counter({ label, hint, value, onChange }: { label: string; hint: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="counter" data-active={value > 0 || undefined}>
      <span className="counter-label">
        {label} <small className="counter-hint num">{hint}</small>
      </span>
      <button type="button" className="counter-btn" onClick={() => onChange(Math.max(0, value - 1))} disabled={value === 0} aria-label={`${label} −`}>
        <IconMinus />
      </button>
      <span className="counter-value num">{value}</span>
      <button type="button" className="counter-btn" onClick={() => onChange(Math.min(MAX_THROWN, value + 1))} aria-label={`${label} +`}>
        <IconPlus />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- staff

function StaffBar({ staff, onShift, onToggle, onAdd }: { staff: string[]; onShift: string[]; onToggle: (n: string) => void; onAdd: () => void }) {
  const { t } = useI18n();
  // people on shift first, then everyone else
  const ordered = [...onShift, ...staff.filter((n) => !onShift.includes(n))];
  return (
    <div className="staffbar" role="group" aria-label={t.onShift}>
      <span className="staffbar-label">
        {t.onShift}
        {onShift.length > 0 && <span className="staffbar-count num">{onShift.length}</span>}
      </span>
      <div className="staffbar-chips">
        {ordered.map((n) => (
          <button key={n} aria-pressed={onShift.includes(n)} className="chip" data-active={onShift.includes(n) || undefined} onClick={() => onToggle(n)}>
            {onShift.includes(n) && <span className="chip-check" aria-hidden>✓</span>}
            {n}
          </button>
        ))}
        <button className="chip chip-add" onClick={onAdd} aria-label={t.addName}>
          <IconPlus />
        </button>
      </div>
    </div>
  );
}

function StaffSheet({
  open,
  onOpenChange,
  staff,
  onShift,
  onPick,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  staff: string[];
  onShift: string[];
  onPick: (n: string) => void;
  onAdd: (n: string) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) setName('');
  }, [open]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t.whoIsCalibrating}>
      <div className="sheet-body">
        {staff.length > 0 && (
          <div className="chip-grid">
            {staff.map((n) => (
              <button key={n} className="chip chip-lg" data-active={onShift.includes(n) || undefined} onClick={() => onPick(n)}>
                {n}
              </button>
            ))}
          </div>
        )}
        <form
          className="add-row"
          onSubmit={async (e) => {
            e.preventDefault();
            const n = name.trim();
            if (!n) return;
            setSaving(true);
            const ok = await onAdd(n);
            setSaving(false);
            if (ok) onPick(n);
          }}
        >
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t.namePlaceholder} maxLength={40} autoComplete="off" enterKeyHint="done" />
          <button className="btn btn-primary" disabled={!name.trim() || saving}>
            {t.add}
          </button>
        </form>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- discard

function DiscardSheet({ state, onClose, onSave }: { state: null | { id: string; label: string }; onClose: () => void; onSave: (ml: number) => void }) {
  const { t, lang } = useI18n();
  const [custom, setCustom] = useState<number | null>(null);
  const [left, setLeft] = useState(10);
  useEffect(() => {
    if (!state) return;
    setCustom(null);
    setLeft(10);
  }, [state]);
  // Closes by itself (= nothing discarded) so a busy barista can just walk away.
  useEffect(() => {
    if (!state || custom !== null) return;
    if (left <= 0) {
      onSave(0);
      return;
    }
    const id = setTimeout(() => setLeft((l) => l - 1), 1000);
    return () => clearTimeout(id);
  }, [state, left, custom, onSave]);

  const litres = (ml: number) => {
    const map: Record<number, string> = { 250: '¼', 500: '½', 750: '¾' };
    return map[ml] ?? String(ml / 1000);
  };

  return (
    <Sheet open={!!state} onOpenChange={(o) => !o && onClose()} title={t.discardTitle}>
      {state && (
        <div className="sheet-body">
          <p className="sheet-text muted">{state.label}</p>
          {custom === null ? (
            <>
              <div className="chip-grid chip-grid-4">
                <button className="chip chip-lg" onClick={() => onSave(0)}>
                  {t.discardNone}
                </button>
                {DISCARD_QUICK_ML.map((ml) => (
                  <button key={ml} className="chip chip-lg chip-stack" onClick={() => onSave(ml)}>
                    <span>
                      <span className="num">{litres(ml)}</span>&nbsp;{t.litres}
                    </span>
                    <small>
                      <Grams tenths={dripTenths(ml)} lang={lang} />
                    </small>
                  </button>
                ))}
                <button className="chip chip-lg" onClick={() => setCustom(1000)}>
                  {t.other}
                </button>
              </div>
              <div className="autoclose" aria-hidden>
                <motion.div className="autoclose-bar" initial={{ scaleX: 1 }} animate={{ scaleX: 0 }} transition={{ duration: 10, ease: 'linear' }} />
              </div>
            </>
          ) : (
            <div className="litre-stepper">
              <button className="round-btn" onClick={() => setCustom(Math.max(250, custom - 250))} aria-label="−">
                <IconMinus />
              </button>
              <div className="litre-value num">
                {(custom / 1000).toFixed(2).replace(/\.?0+$/, '')} <small>{t.litres}</small>
                <div className="litre-grams">
                  = <Grams tenths={dripTenths(custom)} lang={lang} />
                </div>
              </div>
              <button className="round-btn" onClick={() => setCustom(Math.min(50000, custom + 250))} aria-label="+">
                <IconPlus />
              </button>
              <button className="btn btn-primary btn-lg litre-save" onClick={() => onSave(custom)}>
                {t.save}
              </button>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}
