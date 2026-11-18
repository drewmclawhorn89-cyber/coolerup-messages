import { useState } from 'react';
import { sendEmailVerification, sendPasswordResetEmail, updatePassword } from 'firebase/auth';
import {
  Bell,
  Calendar,
  EyeOff,
  KeyRound,
  LogOut,
  Moon,
  Phone,
  Settings,
  Shield,
  Sun,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import { auth } from '../lib/firebase';
import { clearAllLocalCache } from '../lib/localFallbackStore';
import type { PrivateUserInfo, PublicProfile } from '../types/messenger';

interface SettingsModalProps {
  profile: PublicProfile;
  privateInfo: PrivateUserInfo | null;
  darkMode: boolean;
  onToggleTheme: () => void;
  onToggleGhostMode: (next: boolean) => Promise<void>;
  onUpdateSettings: (updates: Partial<PrivateUserInfo>) => Promise<void>;
  onSignOut: () => Promise<void>;
  onClose: () => void;
}

export function SettingsModal({
  profile,
  privateInfo,
  darkMode,
  onToggleTheme,
  onToggleGhostMode,
  onUpdateSettings,
  onSignOut,
  onClose,
}: SettingsModalProps) {
  const [birthday, setBirthday] = useState(privateInfo?.birthday || '');
  const [phoneNumber, setPhoneNumber] = useState(privateInfo?.phoneNumber || '');
  const [privacyContact, setPrivacyContact] = useState<'everyone' | 'friends'>(
    privateInfo?.privacyContact || 'everyone'
  );
  const [privacyStory, setPrivacyStory] = useState<'everyone' | 'friends' | 'custom'>(
    privateInfo?.privacyStory || 'everyone'
  );
  const [privacyQuickAdd, setPrivacyQuickAdd] = useState<boolean>(
    privateInfo?.privacyQuickAdd ?? true
  );
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(
    privateInfo?.notificationsEnabled ?? true
  );
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');

  const emailVerified = auth.currentUser?.emailVerified ?? true;
  const ghostMode = Boolean(profile.ghostMode);

  const handleSave = async () => {
    setSaving(true);
    setFeedback('');
    try {
      await onUpdateSettings({
        birthday: birthday.trim().slice(0, 24),
        phoneNumber: phoneNumber.trim().slice(0, 32),
        privacyContact,
        privacyStory,
        privacyQuickAdd,
        notificationsEnabled,
      });
      setFeedback('Settings saved to your account.');
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Unable to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordChange = async () => {
    const user = auth.currentUser;
    if (!user) return;
    setFeedback('');
    if (newPassword.trim().length >= 6) {
      try {
        await updatePassword(user, newPassword.trim());
        setNewPassword('');
        setFeedback('Password updated successfully.');
      } catch (err) {
        if (user.email) {
          await sendPasswordResetEmail(auth, user.email).catch(() => {});
          setFeedback(`Sent password reset link to ${user.email}.`);
        } else {
          setFeedback(err instanceof Error ? err.message : 'Re-sign in required to change password.');
        }
      }
    } else if (user.email) {
      await sendPasswordResetEmail(auth, user.email);
      setFeedback(`Password reset link emailed to ${user.email}.`);
    }
  };

  const handleClearCache = async () => {
    await clearAllLocalCache();
    setFeedback('Local media cache cleared. Cloud data remains safe.');
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/65 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[88vh] rounded-3xl bg-white dark:bg-[#121824] border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#FFFC00] text-slate-950 flex items-center justify-center">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                Settings
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                @{profile.handle} · Account &amp; Privacy
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="w-9 h-9 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 flex items-center justify-center cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Settings Body */}
        <div className="flex-1 overflow-y-auto chat-scroll p-5 space-y-5">
          {feedback && (
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-xs font-medium text-emerald-700 dark:text-emerald-300">
              {feedback}
            </div>
          )}

          {!emailVerified && auth.currentUser && (
            <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 space-y-2">
              <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">
                Verify your email to enable full cloud sync
              </p>
              <button
                type="button"
                onClick={async () => {
                  if (!auth.currentUser) return;
                  await sendEmailVerification(auth.currentUser);
                  setFeedback('Verification link sent to your email.');
                }}
                className="h-8 px-3 rounded-lg bg-[#FFFC00] text-slate-950 text-xs font-bold cursor-pointer"
              >
                Resend Verification Email
              </button>
            </div>
          )}

          {/* Account Info */}
          <div className="space-y-3">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">My Account</p>
            <div className="p-3 rounded-2xl bg-[#F4F6F9] dark:bg-[#0B0F17] space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Name</span>
                <span className="font-semibold text-slate-900 dark:text-white">{profile.displayName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Username</span>
                <span className="font-mono-tabular font-semibold text-slate-900 dark:text-white">
                  @{profile.handle}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Email</span>
                <span className="text-slate-700 dark:text-slate-300 truncate max-w-[200px]">
                  {privateInfo?.email || 'Not set'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="flex items-center gap-1 text-[11px] font-medium text-slate-500 mb-1">
                  <Calendar className="w-3 h-3" /> Birthday
                </label>
                <input
                  type="date"
                  value={birthday}
                  onChange={(e) => setBirthday(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl bg-[#F4F6F9] dark:bg-[#0B0F17] text-xs text-slate-900 dark:text-white outline-none"
                />
              </div>
              <div>
                <label className="flex items-center gap-1 text-[11px] font-medium text-slate-500 mb-1">
                  <Phone className="w-3 h-3" /> Phone Number
                </label>
                <input
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="+1 (555) 000-0000"
                  className="w-full h-10 px-3 rounded-xl bg-[#F4F6F9] dark:bg-[#0B0F17] text-xs text-slate-900 dark:text-white outline-none"
                />
              </div>
            </div>

            <div>
              <label className="flex items-center gap-1 text-[11px] font-medium text-slate-500 mb-1">
                <KeyRound className="w-3 h-3" /> Password
              </label>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="New password (6+ chars)"
                  className="flex-1 h-10 px-3 rounded-xl bg-[#F4F6F9] dark:bg-[#0B0F17] text-xs text-slate-900 dark:text-white outline-none"
                />
                <button
                  type="button"
                  onClick={() => void handlePasswordChange()}
                  className="h-10 px-3 rounded-xl bg-slate-200 dark:bg-slate-800 text-xs font-semibold text-slate-900 dark:text-white cursor-pointer"
                >
                  {newPassword.trim().length >= 6 ? 'Update' : 'Reset'}
                </button>
              </div>
            </div>
          </div>

          {/* Privacy Controls */}
          <div className="space-y-2.5">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5" /> Privacy Controls
            </p>

            <div className="flex items-center justify-between p-3 rounded-2xl bg-[#F4F6F9] dark:bg-[#0B0F17]">
              <span className="text-xs font-medium text-slate-800 dark:text-slate-200">
                Who Can Contact Me
              </span>
              <select
                value={privacyContact}
                onChange={(e) => setPrivacyContact(e.target.value as 'everyone' | 'friends')}
                className="h-8 px-2 rounded-lg bg-white dark:bg-slate-800 text-xs font-semibold text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700"
              >
                <option value="everyone">Everyone</option>
                <option value="friends">My Friends</option>
              </select>
            </div>

            <div className="flex items-center justify-between p-3 rounded-2xl bg-[#F4F6F9] dark:bg-[#0B0F17]">
              <span className="text-xs font-medium text-slate-800 dark:text-slate-200">
                Who Can View My Story
              </span>
              <select
                value={privacyStory}
                onChange={(e) => setPrivacyStory(e.target.value as 'everyone' | 'friends' | 'custom')}
                className="h-8 px-2 rounded-lg bg-white dark:bg-slate-800 text-xs font-semibold text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700"
              >
                <option value="everyone">Everyone</option>
                <option value="friends">My Friends</option>
                <option value="custom">Custom</option>
              </select>
            </div>

            <button
              type="button"
              onClick={() => setPrivacyQuickAdd((v) => !v)}
              className="w-full p-3 rounded-2xl bg-[#F4F6F9] dark:bg-[#0B0F17] flex items-center justify-between cursor-pointer"
            >
              <span className="text-xs font-medium text-slate-800 dark:text-slate-200 flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-[#00A6FF]" />
                See Me in Quick Add
              </span>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                  privacyQuickAdd ? 'bg-emerald-500 text-white' : 'bg-slate-300 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                }`}
              >
                {privacyQuickAdd ? 'ON' : 'OFF'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => void onToggleGhostMode(!ghostMode)}
              className="w-full p-3 rounded-2xl bg-[#F4F6F9] dark:bg-[#0B0F17] flex items-center justify-between cursor-pointer"
            >
              <span className="text-xs font-medium text-slate-800 dark:text-slate-200 flex items-center gap-2">
                <EyeOff className="w-4 h-4 text-violet-500" />
                Snap Map Ghost Mode
              </span>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                  ghostMode ? 'bg-slate-900 text-[#FFFC00]' : 'bg-slate-300 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                }`}
              >
                {ghostMode ? 'ON' : 'OFF'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setNotificationsEnabled((v) => !v)}
              className="w-full p-3 rounded-2xl bg-[#F4F6F9] dark:bg-[#0B0F17] flex items-center justify-between cursor-pointer"
            >
              <span className="text-xs font-medium text-slate-800 dark:text-slate-200 flex items-center gap-2">
                <Bell className="w-4 h-4 text-amber-500" />
                Notifications
              </span>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                  notificationsEnabled ? 'bg-emerald-500 text-white' : 'bg-slate-300 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                }`}
              >
                {notificationsEnabled ? 'ON' : 'OFF'}
              </span>
            </button>

            <button
              type="button"
              onClick={onToggleTheme}
              className="w-full p-3 rounded-2xl bg-[#F4F6F9] dark:bg-[#0B0F17] flex items-center justify-between cursor-pointer"
            >
              <span className="text-xs font-medium text-slate-800 dark:text-slate-200 flex items-center gap-2">
                {darkMode ? <Moon className="w-4 h-4 text-[#FFFC00]" /> : <Sun className="w-4 h-4 text-amber-500" />}
                Dark Mode
              </span>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                  darkMode ? 'bg-[#FFFC00] text-slate-950' : 'bg-slate-300 text-slate-700'
                }`}
              >
                {darkMode ? 'ON' : 'OFF'}
              </span>
            </button>
          </div>

          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="w-full h-11 rounded-xl bg-[#FFFC00] hover:bg-[#F5E600] text-slate-950 text-sm font-bold cursor-pointer"
          >
            {saving ? 'Saving Settings...' : 'Save Settings'}
          </button>

          <div className="pt-2 border-t border-slate-200 dark:border-slate-800 grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => void handleClearCache()}
              className="h-10 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
              <span>Clear Cache</span>
            </button>

            <button
              type="button"
              onClick={() => void onSignOut()}
              className="h-10 rounded-xl bg-rose-50 dark:bg-rose-950/30 hover:bg-rose-100 dark:hover:bg-rose-950/60 text-rose-600 dark:text-rose-400 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>Log Out</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
