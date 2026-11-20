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
import { GhostLogo } from './GhostLogo';
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
    <div className="min-h-screen bg-[#FFFC00] text-black flex flex-col relative overflow-hidden">
      {/* Oversized ghost watermark, Snapchat-marketing style */}
      <GhostLogo className="pointer-events-none absolute -right-24 -bottom-24 w-[520px] h-[520px] text-black/[0.055]" />
      <GhostLogo className="pointer-events-none absolute -left-32 top-24 w-[360px] h-[360px] text-black/[0.04]" />

      {/* Top Bar */}
      <header className="relative z-10 w-full max-w-6xl mx-auto px-6 py-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5 shrink-0">
          <GhostLogo className="w-9 h-9 text-black" />
          <span className="font-display text-[22px] font-extrabold tracking-[-0.05em] whitespace-nowrap">
            CoolerUp
          </span>
        </div>

        <div className="flex items-center gap-2">
          <PWAInstallButton variant="cta" />
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            className="h-9 px-3.5 rounded-full bg-black/10 hover:bg-black/15 text-black transition-colors flex items-center gap-1.5 text-xs font-bold cursor-pointer shrink-0"
          >
            {darkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            <span>{darkMode ? 'Light' : 'Dark'}</span>
          </button>
        </div>
      </header>

      {/* Main Split Hero */}
      <main className="relative z-10 flex-1 w-full max-w-6xl mx-auto px-6 pb-10 flex items-center">
        <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-center">
          {/* Left: big Snapchat-style statement */}
          <div className="lg:col-span-6 flex flex-col justify-center">
            <span className="inline-flex w-fit items-center gap-1.5 px-3 py-1 rounded-full bg-black text-[#FFFC00] text-[11px] font-extrabold uppercase tracking-[0.14em] mb-5">
              Snaps · Stories · Map · Spotlight
            </span>
            <h1 className="font-display text-[46px] sm:text-[62px] leading-[0.94] font-extrabold tracking-[-0.055em] text-black mb-5">
              Snap.
              <br />
              Chat.
              <br />
              Share the moment.
            </h1>
            <p className="text-[15px] font-medium text-black/70 leading-relaxed max-w-md mb-7">
              A full-screen camera with lenses, disappearing Snaps, 24-hour Stories, Spotlight,
              Snap Map and PIN-locked Memories — all synced to your account.
            </p>

            <div className="flex flex-wrap gap-2.5">
              {['Disappearing Snaps', 'Snapstreaks', 'Bitmoji avatars', 'My Eyes Only'].map((tag) => (
                <span
                  key={tag}
                  className="px-3.5 py-1.5 rounded-full bg-black/10 text-black text-xs font-bold"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>

          {/* Right: auth card */}
          <div className="lg:col-span-6 flex justify-center lg:justify-end">
            <div className="w-full max-w-[420px] rounded-[28px] bg-white p-6 sm:p-7 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.35)]">
              <div className="flex rounded-full bg-[#F2F2F2] p-1 mb-5">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('signin');
                    setErrorMsg('');
                  }}
                  className={`flex-1 h-9 rounded-full text-[13px] font-extrabold transition-colors cursor-pointer ${
                    authMode === 'signin' ? 'bg-black text-white' : 'text-slate-500'
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
                  className={`flex-1 h-9 rounded-full text-[13px] font-extrabold transition-colors cursor-pointer ${
                    authMode === 'signup' ? 'bg-black text-white' : 'text-slate-500'
                  }`}
                >
                  Sign Up
                </button>
              </div>

              <h2 className="font-display text-[26px] leading-none font-extrabold tracking-[-0.045em] text-slate-900 mb-1">
                {authMode === 'signup' ? 'Create your account' : 'Welcome back'}
              </h2>
              <p className="text-[13px] font-medium text-slate-500 mb-5">
                {authMode === 'signup'
                  ? 'Pick a name, then start snapping.'
                  : 'Log in to pick up where you left off.'}
              </p>

              {errorMsg && (
                <div className="mb-3 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-700">
                  {errorMsg}
                </div>
              )}

              {infoMsg && (
                <div className="mb-3 p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-700">
                  {infoMsg}
                </div>
              )}

              <form onSubmit={handleEmailSubmit} className="space-y-2.5">
                {authMode === 'signup' && (
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Display name"
                      maxLength={60}
                      className="w-full h-12 pl-11 pr-4 rounded-2xl bg-[#F2F2F2] text-[14px] font-medium text-slate-900 placeholder:text-slate-500 focus:ring-2 focus:ring-[#FFFC00] focus:bg-white transition-colors"
                    />
                  </div>
                )}

                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Email address"
                    required
                    className="w-full h-12 pl-11 pr-4 rounded-2xl bg-[#F2F2F2] text-[14px] font-medium text-slate-900 placeholder:text-slate-500 focus:ring-2 focus:ring-[#FFFC00] focus:bg-white transition-colors"
                  />
                </div>

                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password (6+ characters)"
                    required
                    className="w-full h-12 pl-11 pr-11 rounded-2xl bg-[#F2F2F2] text-[14px] font-medium text-slate-900 placeholder:text-slate-500 focus:ring-2 focus:ring-[#FFFC00] focus:bg-white transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                {authMode === 'signin' && (
                  <div className="flex justify-end pt-0.5">
                    <button
                      type="button"
                      onClick={handleResetPassword}
                      className="text-[12px] font-bold text-[#0E8CFF] hover:underline cursor-pointer"
                    >
                      Forgot password?
                    </button>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-12 rounded-full bg-[#0E8CFF] hover:bg-[#0B7DE6] disabled:opacity-60 text-white font-extrabold text-[14px] flex items-center justify-center gap-2 snap-press cursor-pointer"
                >
                  <span>
                    {loading
                      ? 'Please wait...'
                      : authMode === 'signup'
                      ? 'Create Account'
                      : 'Log In'}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>

              <div className="my-4 flex items-center gap-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <div className="h-px flex-1 bg-slate-200" />
                <span>or</span>
                <div className="h-px flex-1 bg-slate-200" />
              </div>

              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={loading}
                className="w-full h-12 px-4 rounded-full bg-[#FFFC00] hover:bg-[#F2EF00] disabled:opacity-60 text-black font-extrabold text-[14px] flex items-center justify-center gap-2 snap-press cursor-pointer whitespace-nowrap"
              >
                <span>Continue with Google</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] font-semibold text-slate-500">
                <span className="flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-[#0E8CFF]" /> Cloud sync
                </span>
                <span className="flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-[#0E8CFF]" /> Phone & desktop
                </span>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="relative z-10 w-full max-w-6xl mx-auto px-6 pb-6 text-[11px] font-bold text-black/50 flex flex-wrap items-center justify-between gap-2">
        <span>Camera · Map · Chat · Stories · Spotlight</span>
        <span>Made for moments that disappear</span>
      </footer>
    </div>
  );
}
