import { useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import { ArrowRight, Check, Moon, Sun } from 'lucide-react';
import { auth, googleProvider } from '../lib/firebase';
import { PWAInstallButton } from './PWAInstallButton';

interface SignInViewProps {
  darkMode: boolean;
  onToggleTheme: () => void;
}

export function SignInView({ darkMode, onToggleTheme }: SignInViewProps) {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [emblemFailed, setEmblemFailed] = useState(false);
  const [heroFailed, setHeroFailed] = useState(false);

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to sign in with Google.';
      if (!msg.includes('popup-closed-by-user')) {
        setErrorMsg(msg);
      }
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F4F6F9] dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 flex flex-col">
      {/* Top Bar */}
      <header className="w-full max-w-6xl mx-auto px-6 py-5 flex items-center justify-between gap-8">
        <div className="flex items-center gap-3 shrink-0">
          {!emblemFailed ? (
            <img
              src="/src/assets/images/coolerup_emblem_1794968388923.jpg"
              alt="CoolerUp Messages emblem"
              referrerPolicy="no-referrer"
              onError={() => setEmblemFailed(true)}
              className="w-9 h-9 rounded-xl object-cover border border-slate-200 dark:border-slate-800"
            />
          ) : (
            <div className="w-9 h-9 rounded-xl bg-[#0066FF] text-white font-display font-bold flex items-center justify-center text-sm">
              CU
            </div>
          )}
          <span className="font-display text-lg font-bold tracking-tight whitespace-nowrap">
            CoolerUp Messages
          </span>
        </div>

        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          className="h-10 px-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#121824] text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors flex items-center gap-2 text-sm font-medium cursor-pointer shrink-0"
        >
          {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          <span>{darkMode ? 'Light' : 'Dark'}</span>
        </button>
      </header>

      {/* Main Split Hero */}
      <main className="flex-1 w-full max-w-6xl mx-auto px-6 py-8 lg:py-12 flex items-center">
        <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-stretch">
          {/* Left Sign-In Column */}
          <div className="lg:col-span-6 flex flex-col justify-center">
            <p className="text-sm font-medium text-[#0088E8] dark:text-[#38BDF8] mb-3">
              Snaps · 24h Stories · Real-time Chats
            </p>
            <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-slate-900 dark:text-white leading-[1.1] text-balance mb-5">
              Share the moment with Snaps, Stories, and fast Chats.
            </h1>
            <p className="text-base text-slate-600 dark:text-slate-400 leading-relaxed max-w-lg mb-8">
              Capture photos with live camera lenses, doodles, and caption bars, send disappearing Snaps with countdown timers, build Streaks, and post 24-hour Stories.
            </p>

            <div className="space-y-3 mb-8 text-sm text-slate-700 dark:text-slate-300">
              <div className="flex items-center gap-2.5">
                <Check className="w-4 h-4 text-[#00A6FF] shrink-0" />
                <span>Live Snap Camera with color lenses, doodle pen, and timer</span>
              </div>
              <div className="flex items-center gap-2.5">
                <Check className="w-4 h-4 text-[#00A6FF] shrink-0" />
                <span>Disappearing Snaps, Snap Streaks, and 24-hour Stories</span>
              </div>
              <div className="flex items-center gap-2.5">
                <Check className="w-4 h-4 text-[#00A6FF] shrink-0" />
                <span>Save messages in chat, react, and message friends directly</span>
              </div>
            </div>

            {errorMsg && (
              <div className="mb-4 p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-sm text-rose-700 dark:text-rose-300">
                {errorMsg}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={loading}
                className="h-12 px-6 rounded-xl bg-[#FFFC00] hover:bg-[#F5E600] disabled:opacity-60 text-slate-950 font-bold text-sm flex items-center gap-3 transition-colors shadow-sm cursor-pointer whitespace-nowrap"
              >
                <span>{loading ? 'Signing in...' : 'Continue with Google'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
              <PWAInstallButton variant="cta" />
            </div>
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              Secured with Google Sign-In · Installable on Chrome, Android, and iOS
            </p>
          </div>

          {/* Right Studio Visual Column */}
          <div className="lg:col-span-6 flex">
            <div className="w-full rounded-3xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#121824] flex flex-col">
              <div className="relative flex-1 min-h-[280px] lg:min-h-[380px] bg-slate-100 dark:bg-slate-900">
                {!heroFailed ? (
                  <img
                    src="/src/assets/images/coolerup_signin_hero_1794968389986.jpg"
                    alt="CoolerUp Messages layered conversation glass composition"
                    referrerPolicy="no-referrer"
                    onError={() => setHeroFailed(true)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-[#0066FF]/15 via-slate-100 to-slate-200 dark:from-[#0066FF]/25 dark:via-slate-900 dark:to-slate-950 flex items-center justify-center p-8">
                    <span className="font-display text-xl font-semibold text-slate-700 dark:text-slate-300">
                      CoolerUp Messages
                    </span>
                  </div>
                )}
              </div>
              <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>Direct &amp; Group Messaging</span>
                <span>·</span>
                <span>Instant Sync Across Devices</span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
