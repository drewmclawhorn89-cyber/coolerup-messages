import { useState, type FormEvent } from 'react';
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
} from 'firebase/auth';
import { ArrowRight, Check, Eye, EyeOff, Lock, Mail, Moon, Sun, User } from 'lucide-react';
import { auth, googleProvider } from '../lib/firebase';
import { PWAInstallButton } from './PWAInstallButton';

interface SignInViewProps {
  darkMode: boolean;
  onToggleTheme: () => void;
}

export function SignInView({ darkMode, onToggleTheme }: SignInViewProps) {
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');
  const [emblemFailed, setEmblemFailed] = useState(false);
  const [heroFailed, setHeroFailed] = useState(false);

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setErrorMsg('');
    setInfoMsg('');
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

  const handleEmailSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      setErrorMsg('Please enter your email and password.');
      return;
    }
    setLoading(true);
    setErrorMsg('');
    setInfoMsg('');
    try {
      if (authMode === 'signup') {
        if (password.length < 6) {
          setErrorMsg('Password must be at least 6 characters.');
          setLoading(false);
          return;
        }
        const cred = await createUserWithEmailAndPassword(auth, cleanEmail, password);
        if (displayName.trim()) {
          await updateProfile(cred.user, { displayName: displayName.trim().slice(0, 60) });
        }
        try {
          await sendEmailVerification(cred.user);
        } catch {
          // Verification link sent best-effort
        }
      } else {
        await signInWithEmailAndPassword(auth, cleanEmail, password);
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Authentication failed.';
      if (raw.includes('email-already-in-use')) {
        setErrorMsg('An account already exists for that email. Try signing in.');
      } else if (raw.includes('invalid-credential') || raw.includes('wrong-password')) {
        setErrorMsg('Incorrect email or password.');
      } else if (raw.includes('operation-not-allowed')) {
        setErrorMsg('Email/Password sign-in is disabled in Firebase Console. Use Google Sign-In or enable Email/Password.');
      } else {
        setErrorMsg(raw);
      }
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setErrorMsg('Enter your email address first to reset your password.');
      return;
    }
    setErrorMsg('');
    setInfoMsg('');
    try {
      await sendPasswordResetEmail(auth, cleanEmail);
      setInfoMsg(`Password reset link sent to ${cleanEmail}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not send reset email.');
    }
  };

  return (
    <div className="min-h-screen bg-[#FFFC00]/20 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 flex flex-col">
      {/* Top Bar */}
      <header className="w-full max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-8">
        <div className="flex items-center gap-3 shrink-0">
          {!emblemFailed ? (
            <img
              src="/src/assets/images/coolerup_emblem_1794968388923.jpg"
              alt="CoolerUp Messages emblem"
              referrerPolicy="no-referrer"
              onError={() => setEmblemFailed(true)}
              className="w-10 h-10 rounded-xl object-cover border border-slate-200 dark:border-slate-800 bg-[#FFFC00]"
            />
          ) : (
            <div className="w-10 h-10 rounded-xl bg-[#FFFC00] text-slate-950 font-display font-bold flex items-center justify-center text-sm shadow-xs">
              👻
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
      <main className="flex-1 w-full max-w-6xl mx-auto px-6 py-6 lg:py-10 flex items-center">
        <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-stretch">
          {/* Left Sign-In Column */}
          <div className="lg:col-span-6 flex flex-col justify-center">
            <span className="inline-flex w-fit items-center gap-1.5 px-3 py-1 rounded-full bg-[#FFFC00] text-slate-950 text-xs font-bold mb-3">
              👻 Snaps · Stories · Map · Spotlight
            </span>
            <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-slate-900 dark:text-white leading-[1.08] text-balance mb-4">
              Snap fast. Chat live. Explore the Map.
            </h1>
            <p className="text-base text-slate-600 dark:text-slate-400 leading-relaxed max-w-lg mb-6">
              Full-screen camera with live lenses &amp; 60s video, disappearing Snaps, 24-hour Stories, Spotlight vertical feed, Snap Map, and PIN-locked Memories synced to your account.
            </p>

            {/* Auth Card */}
            <div className="rounded-3xl bg-white dark:bg-[#121824] border border-slate-200 dark:border-slate-800 p-5 sm:p-6 shadow-sm max-w-md">
              <div className="flex rounded-xl bg-slate-100 dark:bg-slate-800/80 p-1 mb-4">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('signin');
                    setErrorMsg('');
                  }}
                  className={`flex-1 h-9 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                    authMode === 'signin'
                      ? 'bg-[#FFFC00] text-slate-950 shadow-xs'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  Log In
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('signup');
                    setErrorMsg('');
                  }}
                  className={`flex-1 h-9 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                    authMode === 'signup'
                      ? 'bg-[#FFFC00] text-slate-950 shadow-xs'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  Sign Up
                </button>
              </div>

              {errorMsg && (
                <div className="mb-3 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-xs text-rose-700 dark:text-rose-300">
                  {errorMsg}
                </div>
              )}

              {infoMsg && (
                <div className="mb-3 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-700 dark:text-emerald-300">
                  {infoMsg}
                </div>
              )}

              <form onSubmit={handleEmailSubmit} className="space-y-3">
                {authMode === 'signup' && (
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Display name"
                      maxLength={60}
                      className="w-full h-11 pl-10 pr-3 rounded-xl bg-slate-100 dark:bg-slate-800/70 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#FFFC00]"
                    />
                  </div>
                )}

                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Email address"
                    required
                    className="w-full h-11 pl-10 pr-3 rounded-xl bg-slate-100 dark:bg-slate-800/70 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#FFFC00]"
                  />
                </div>

                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password (6+ characters)"
                    required
                    className="w-full h-11 pl-10 pr-10 rounded-xl bg-slate-100 dark:bg-slate-800/70 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#FFFC00]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                {authMode === 'signin' && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleResetPassword}
                      className="text-xs font-medium text-[#00A6FF] hover:underline cursor-pointer"
                    >
                      Forgot password?
                    </button>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-11 rounded-xl bg-[#00A6FF] hover:bg-[#0090E0] disabled:opacity-60 text-white font-bold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <span>
                    {loading
                      ? 'Please wait...'
                      : authMode === 'signup'
                      ? 'Create Account'
                      : 'Sign In with Email'}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>

              <div className="my-4 flex items-center gap-3 text-xs text-slate-400">
                <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
                <span>or</span>
                <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={loading}
                  className="flex-1 h-11 px-4 rounded-xl bg-[#FFFC00] hover:bg-[#F5E600] disabled:opacity-60 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 transition-colors shadow-xs cursor-pointer whitespace-nowrap"
                >
                  <span>Continue with Google</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
                <PWAInstallButton variant="cta" />
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-600 dark:text-slate-400">
              <span className="flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5 text-[#00A6FF]" /> Cloud Firestore &amp; Storage Sync
              </span>
              <span className="flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5 text-[#00A6FF]" /> Works on Phone &amp; Desktop
              </span>
            </div>
          </div>

          {/* Right Studio Visual Column */}
          <div className="lg:col-span-6 flex">
            <div className="w-full rounded-3xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#121824] flex flex-col">
              <div className="relative flex-1 min-h-[280px] lg:min-h-[420px] bg-slate-100 dark:bg-slate-900">
                {!heroFailed ? (
                  <img
                    src="/src/assets/images/coolerup_signin_hero_1794968389986.jpg"
                    alt="CoolerUp Messages layered conversation glass composition"
                    referrerPolicy="no-referrer"
                    onError={() => setHeroFailed(true)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-[#FFFC00]/30 via-slate-100 to-slate-200 dark:from-[#FFFC00]/20 dark:via-slate-900 dark:to-slate-950 flex items-center justify-center p-8">
                    <span className="font-display text-2xl font-bold text-slate-800 dark:text-slate-200">
                      CoolerUp Messages
                    </span>
                  </div>
                )}
              </div>
              <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>Camera · Map · Chat · Stories · Spotlight</span>
                <span>·</span>
                <span>Cloud Account Sync</span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
