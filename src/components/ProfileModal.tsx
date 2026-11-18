import { useState } from 'react';
import { Award, Check, Copy, Flame, LogOut, Moon, QrCode, Settings, Smile, Sun, X } from 'lucide-react';
import {
  BITMOJI_BG_PALETTE,
  BITMOJI_HAIR_COLORS,
  BITMOJI_SKIN_TONES,
  buildSnapcodeString,
  getDefaultBitmojiConfig,
  parseAvatarSeed,
  serializeAvatarSeed,
  type BitmojiAvatarConfig,
} from '../lib/snapUtils';
import { isValidHandle, LIMITS } from '../lib/validation';
import type { PrivateUserInfo, PublicProfile } from '../types/messenger';
import { Avatar } from './Avatar';
import { PWAInstallButton } from './PWAInstallButton';
import { SnapcodeCard } from './SnapcodeCard';

const TROPHY_CATALOG = [
  { id: 'first_snap', icon: '🥚', label: 'First Snap', unlockedWhen: (score: number) => score >= 1 },
  { id: 'streak_fire', icon: '🔥', label: 'Streak Master', unlockedWhen: (_s: number, streak: number) => streak >= 2 },
  { id: 'snap_hundred', icon: '💯', label: 'Snap 100', unlockedWhen: (score: number) => score >= 100 },
  { id: 'storyteller', icon: '📖', label: 'Storyteller', unlockedWhen: (_s: number, _st: number, list: string[]) => list.includes('storyteller') },
  { id: 'spotlight_star', icon: '🎬', label: 'Spotlight Star', unlockedWhen: (_s: number, _st: number, list: string[]) => list.includes('spotlight_star') },
  { id: 'bitmoji_creator', icon: '👻', label: 'Bitmoji Pro', unlockedWhen: (_s: number, _st: number, _l: string[], seed: string) => Boolean(seed) },
];

interface ProfileModalProps {
  profile: PublicProfile;
  privateInfo: PrivateUserInfo | null;
  topStreakCount?: number;
  darkMode: boolean;
  onToggleTheme: () => void;
  onOpenSettings?: () => void;
  onSaveProfile: (updates: {
    displayName: string;
    handle: string;
    statusText: string;
    isDiscoverable: boolean;
    avatarSeed: string;
  }) => Promise<void>;
  onSignOut: () => Promise<void>;
  onClose: () => void;
}

export function ProfileModal({
  profile,
  privateInfo,
  topStreakCount = 0,
  darkMode,
  onToggleTheme,
  onOpenSettings,
  onSaveProfile,
  onSignOut,
  onClose,
}: ProfileModalProps) {
  const [section, setSection] = useState<'profile' | 'bitmoji' | 'snapcode'>('profile');
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [handle, setHandle] = useState(profile.handle);
  const [statusText, setStatusText] = useState(profile.statusText);
  const [isDiscoverable, setIsDiscoverable] = useState(profile.isDiscoverable);
  const [useBitmoji, setUseBitmoji] = useState(Boolean(parseAvatarSeed(profile.avatarSeed)));
  const [bitmojiCfg, setBitmojiCfg] = useState<BitmojiAvatarConfig>(
    () => parseAvatarSeed(profile.avatarSeed) || getDefaultBitmojiConfig()
  );

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [copied, setCopied] = useState(false);

  const effectiveAvatarSeed = useBitmoji ? serializeAvatarSeed(bitmojiCfg) : '';

  const handleSave = async () => {
    const cleanHandle = handle.trim().toLowerCase();
    if (!displayName.trim()) {
      setErrorMsg('Display name cannot be empty.');
      return;
    }
    if (!isValidHandle(cleanHandle)) {
      setErrorMsg('Handle must be 2–40 chars using lowercase letters, numbers, ., _, or -.');
      return;
    }

    setErrorMsg('');
    setSaving(true);
    try {
      await onSaveProfile({
        displayName: displayName.trim(),
        handle: cleanHandle,
        statusText: statusText.trim(),
        isDiscoverable,
        avatarSeed: effectiveAvatarSeed,
      });
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to save profile.');
    } finally {
      setSaving(false);
    }
  };

  const handleCopyInvite = async () => {
    const url = `${window.location.origin}/?chat=${encodeURIComponent(profile.handle)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard failure
    }
  };

  const handleCopySnapcode = async () => {
    try {
      await navigator.clipboard.writeText(buildSnapcodeString(profile.handle));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard failure
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[90vh] flex flex-col bg-white dark:bg-[#121824] border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
          <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
            Profile, Trophies &amp; Snapcode
          </h2>
          <div className="flex items-center gap-1.5">
            {onOpenSettings && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenSettings();
                }}
                aria-label="Open Settings"
                className="w-9 h-9 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center cursor-pointer"
              >
                <Settings className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close modal"
              className="w-9 h-9 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 flex items-center justify-center cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Section Tabs */}
        <div className="px-5 pt-3 shrink-0">
          <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-[#F4F6F9] dark:bg-[#0B0F17]">
            <button
              type="button"
              onClick={() => setSection('profile')}
              className={`h-8 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                section === 'profile'
                  ? 'bg-white dark:bg-[#1A2232] text-slate-900 dark:text-white shadow-2xs'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              Profile
            </button>
            <button
              type="button"
              onClick={() => setSection('bitmoji')}
              className={`h-8 rounded-lg text-xs font-medium cursor-pointer transition-colors flex items-center justify-center gap-1 ${
                section === 'bitmoji'
                  ? 'bg-white dark:bg-[#1A2232] text-slate-900 dark:text-white shadow-2xs'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <Smile className="w-3.5 h-3.5" />
              <span>Bitmoji</span>
            </button>
            <button
              type="button"
              onClick={() => setSection('snapcode')}
              className={`h-8 rounded-lg text-xs font-medium cursor-pointer transition-colors flex items-center justify-center gap-1 ${
                section === 'snapcode'
                  ? 'bg-[#FFFC00] text-slate-950 font-semibold shadow-2xs'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <QrCode className="w-3.5 h-3.5" />
              <span>Snapcode</span>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto chat-scroll p-5 space-y-4">
          {section === 'snapcode' ? (
            <div className="space-y-4">
              <SnapcodeCard
                profile={{
                  ...profile,
                  displayName: displayName || profile.displayName,
                  handle: handle || profile.handle,
                  avatarSeed: effectiveAvatarSeed,
                }}
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopySnapcode}
                  className="flex-1 h-10 rounded-xl bg-[#FFFC00] hover:bg-[#F5E600] text-slate-950 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  <span>{copied ? 'Snapcode Copied!' : 'Copy Snapcode'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleCopyInvite}
                  className="flex-1 h-10 rounded-xl bg-[#F4F6F9] dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Copy className="w-4 h-4" />
                  <span>Copy Invite Link</span>
                </button>
              </div>
            </div>
          ) : section === 'bitmoji' ? (
            <div className="space-y-4">
              <div className="flex items-center gap-4 p-3 rounded-2xl bg-[#F4F6F9] dark:bg-[#0B0F17]">
                <Avatar
                  name={displayName}
                  photoURL={profile.photoURL}
                  avatarSeed={effectiveAvatarSeed}
                  size="xl"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">
                    Bitmoji Avatar
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                    Show your custom Bitmoji-style avatar across chats and Snapcode
                  </p>
                  <button
                    type="button"
                    onClick={() => setUseBitmoji((v) => !v)}
                    className={`h-8 px-3 rounded-lg text-xs font-semibold cursor-pointer ${
                      useBitmoji
                        ? 'bg-[#FFFC00] text-slate-950'
                        : 'bg-white dark:bg-[#1A2232] border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    {useBitmoji ? 'Using Bitmoji Avatar' : 'Switch to Bitmoji'}
                  </button>
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">
                  Background
                </p>
                <div className="flex items-center gap-2">
                  {BITMOJI_BG_PALETTE.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => {
                        setUseBitmoji(true);
                        setBitmojiCfg((prev) => ({ ...prev, bg: hex }));
                      }}
                      style={{ backgroundColor: hex }}
                      className={`w-8 h-8 rounded-full cursor-pointer ${
                        bitmojiCfg.bg === hex ? 'ring-2 ring-offset-2 ring-slate-900 dark:ring-white' : ''
                      }`}
                    />
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">
                  Skin Tone
                </p>
                <div className="flex items-center gap-2">
                  {BITMOJI_SKIN_TONES.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => {
                        setUseBitmoji(true);
                        setBitmojiCfg((prev) => ({ ...prev, skin: hex }));
                      }}
                      style={{ backgroundColor: hex }}
                      className={`w-8 h-8 rounded-full cursor-pointer ${
                        bitmojiCfg.skin === hex ? 'ring-2 ring-offset-2 ring-slate-900 dark:ring-white' : ''
                      }`}
                    />
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">
                  Hair / Cap &amp; Color
                </p>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {(['short', 'wavy', 'curls', 'cap'] as const).map((style) => (
                    <button
                      key={style}
                      type="button"
                      onClick={() => {
                        setUseBitmoji(true);
                        setBitmojiCfg((prev) => ({ ...prev, hairStyle: style }));
                      }}
                      className={`h-8 px-3 rounded-lg text-xs font-medium capitalize cursor-pointer ${
                        bitmojiCfg.hairStyle === style
                          ? 'bg-[#00A6FF] text-white'
                          : 'bg-[#F4F6F9] dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {style}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  {BITMOJI_HAIR_COLORS.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => {
                        setUseBitmoji(true);
                        setBitmojiCfg((prev) => ({ ...prev, hair: hex }));
                      }}
                      style={{ backgroundColor: hex }}
                      className={`w-7 h-7 rounded-full cursor-pointer ${
                        bitmojiCfg.hair === hex ? 'ring-2 ring-offset-2 ring-slate-900 dark:ring-white' : ''
                      }`}
                    />
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                    Glasses
                  </p>
                  <div className="flex gap-1.5">
                    {(['none', 'shades', 'round'] as const).map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => {
                          setUseBitmoji(true);
                          setBitmojiCfg((prev) => ({ ...prev, glasses: g }));
                        }}
                        className={`flex-1 h-8 rounded-lg text-xs font-medium capitalize cursor-pointer ${
                          bitmojiCfg.glasses === g
                            ? 'bg-[#00A6FF] text-white'
                            : 'bg-[#F4F6F9] dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                    Vibe
                  </p>
                  <div className="flex gap-1.5">
                    {(['smile', 'wink', 'cool'] as const).map((ex) => (
                      <button
                        key={ex}
                        type="button"
                        onClick={() => {
                          setUseBitmoji(true);
                          setBitmojiCfg((prev) => ({ ...prev, expression: ex }));
                        }}
                        className={`flex-1 h-8 rounded-lg text-xs font-medium capitalize cursor-pointer ${
                          bitmojiCfg.expression === ex
                            ? 'bg-[#00A6FF] text-white'
                            : 'bg-[#F4F6F9] dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {ex}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-4">
                <Avatar
                  name={profile.displayName}
                  photoURL={profile.photoURL}
                  avatarSeed={effectiveAvatarSeed}
                  size="xl"
                  isOnline={profile.isOnline}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold text-slate-900 dark:text-white truncate">
                    {profile.displayName}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                    @{profile.handle} · Snap Score {profile.snapScore ?? 0}
                  </p>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">
                    {privateInfo?.email || 'Private email'}
                  </p>
                  <button
                    type="button"
                    onClick={handleCopyInvite}
                    className="mt-2 h-8 px-3 rounded-lg bg-[#F4F6F9] dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? 'Link copied' : 'Copy invite link'}</span>
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Display Name
                  </label>
                  <input
                    type="text"
                    value={displayName}
                    maxLength={LIMITS.DISPLAY_NAME_MAX}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full h-10 px-3.5 rounded-xl bg-[#F4F6F9] dark:bg-[#0B0F17] border border-slate-200/80 dark:border-slate-800 text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-[#00A6FF]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Username Handle
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                      @
                    </span>
                    <input
                      type="text"
                      value={handle}
                      maxLength={LIMITS.HANDLE_MAX}
                      onChange={(e) => setHandle(e.target.value.toLowerCase())}
                      className="w-full h-10 pl-8 pr-3.5 rounded-xl bg-[#F4F6F9] dark:bg-[#0B0F17] border border-slate-200/80 dark:border-slate-800 text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-[#00A6FF]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Status Note
                  </label>
                  <input
                    type="text"
                    value={statusText}
                    maxLength={LIMITS.STATUS_TEXT_MAX}
                    onChange={(e) => setStatusText(e.target.value)}
                    placeholder="What are you up to?"
                    className="w-full h-10 px-3.5 rounded-xl bg-[#F4F6F9] dark:bg-[#0B0F17] border border-slate-200/80 dark:border-slate-800 text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-[#00A6FF]"
                  />
                </div>
              </div>

              <div className="pt-1 space-y-2.5">
                <div className="flex items-center justify-between py-2 px-3 rounded-xl bg-[#F4F6F9] dark:bg-[#0B0F17]">
                  <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      Discoverable in Add Friends
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Let friends find your @username and Snapcode
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isDiscoverable}
                    onClick={() => setIsDiscoverable((v) => !v)}
                    className={`w-11 h-6 rounded-full transition-colors p-0.5 cursor-pointer ${
                      isDiscoverable ? 'bg-[#00A6FF]' : 'bg-slate-300 dark:bg-slate-700'
                    }`}
                  >
                    <span
                      className={`block w-5 h-5 rounded-full bg-white transition-transform ${
                        isDiscoverable ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                <div className="flex items-center justify-between py-2 px-3 rounded-xl bg-[#F4F6F9] dark:bg-[#0B0F17]">
                  <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      Appearance
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {darkMode ? 'Dark mode active' : 'Light mode active'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onToggleTheme}
                    className="h-9 px-3 rounded-lg bg-white dark:bg-[#1A2232] border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer"
                  >
                    {darkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                    <span>{darkMode ? 'Light' : 'Dark'}</span>
                  </button>
                </div>

                <PWAInstallButton variant="row" />
              </div>

              {/* Streaks & Trophies Showcase */}
              <div className="p-3.5 rounded-2xl bg-[#F4F6F9] dark:bg-[#0B0F17] space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <Award className="w-4 h-4 text-[#FFFC00] fill-[#FFFC00] stroke-slate-950" />
                    Trophies &amp; Streaks
                  </span>
                  <span className="text-[11px] font-bold text-amber-500 flex items-center gap-1 font-mono-tabular">
                    <Flame className="w-3.5 h-3.5 fill-amber-500" />
                    Best Streak {topStreakCount}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {TROPHY_CATALOG.map((tr) => {
                    const unlocked = tr.unlockedWhen(
                      profile.snapScore ?? 0,
                      topStreakCount,
                      profile.trophies || [],
                      effectiveAvatarSeed
                    );
                    return (
                      <div
                        key={tr.id}
                        className={`p-2 rounded-xl text-center border ${
                          unlocked
                            ? 'bg-white dark:bg-[#1A2232] border-[#FFFC00] shadow-2xs'
                            : 'bg-slate-200/50 dark:bg-slate-900/50 border-transparent opacity-45'
                        }`}
                      >
                        <div className="text-xl leading-none mb-1">{tr.icon}</div>
                        <p className="text-[10px] font-semibold text-slate-700 dark:text-slate-200 truncate">
                          {tr.label}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {errorMsg && (
            <p className="text-xs text-rose-600 dark:text-rose-400">{errorMsg}</p>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={onSignOut}
            className="h-10 px-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 text-sm font-medium flex items-center gap-2 transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>

          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="h-10 px-5 rounded-xl bg-[#FFFC00] hover:bg-[#F5E600] disabled:opacity-50 text-slate-950 text-sm font-bold transition-colors cursor-pointer"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
