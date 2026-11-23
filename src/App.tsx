import { useEffect, useMemo, useState } from 'react';
import { MotionConfig } from 'motion/react';
import { Toaster } from 'sonner';
import { I18nContext, STRINGS, getInitialLang, type Lang } from './lib/i18n';
import { StoreApp } from './StoreApp';
import { Admin } from './admin/Admin';
import { LiquidBackground } from './components/LiquidBackground';

export function App() {
  const [lang, setLangState] = useState<Lang>(getInitialLang);
  const isAdmin = location.pathname.startsWith('/admin');
  const effective: Lang = isAdmin ? 'en' : lang;

  useEffect(() => {
    document.documentElement.lang = effective;
    document.documentElement.dir = effective === 'ar' ? 'rtl' : 'ltr';
  }, [effective]);

  const ctx = useMemo(
    () => ({
      lang: effective,
      t: STRINGS[effective],
      setLang: (l: Lang) => {
        setLangState(l);
        try {
          localStorage.setItem('hm_lang', l);
        } catch {
          /* ignore */
        }
      },
    }),
    [effective],
  );

  return (
    <I18nContext.Provider value={ctx}>
      <MotionConfig reducedMotion="user">
        <LiquidBackground />
        {isAdmin ? <Admin /> : <StoreApp />}
        <Toaster position="top-center" dir={effective === 'ar' ? 'rtl' : 'ltr'} toastOptions={{ className: 'toast' }} />
      </MotionConfig>
    </I18nContext.Provider>
  );
}
