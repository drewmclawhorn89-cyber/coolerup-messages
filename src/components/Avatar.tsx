import { useState } from 'react';
import { Bookmark, Users } from 'lucide-react';
import { parseAvatarSeed, type BitmojiAvatarConfig } from '../lib/snapUtils';

interface AvatarProps {
  name: string;
  photoURL?: string;
  avatarSeed?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  isOnline?: boolean;
  isGroup?: boolean;
  isSaved?: boolean;
}

const SIZE_MAP: Record<NonNullable<AvatarProps['size']>, string> = {
  xs: 'w-5 h-5 text-[10px]',
  sm: 'w-8 h-8 text-xs',
  md: 'w-11 h-11 text-sm',
  lg: 'w-12 h-12 text-base',
  xl: 'w-16 h-16 text-xl',
};

const DOT_MAP: Record<NonNullable<AvatarProps['size']>, string> = {
  xs: 'w-1.5 h-1.5',
  sm: 'w-2.5 h-2.5',
  md: 'w-3 h-3',
  lg: 'w-3 h-3',
  xl: 'w-3.5 h-3.5',
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'C';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function BitmojiSvg({ config }: { config: BitmojiAvatarConfig }) {
  return (
    <svg viewBox="0 0 64 64" className="w-full h-full rounded-full" aria-hidden="true">
      <circle cx="32" cy="32" r="32" fill={config.bg} />
      {/* Shoulders */}
      <path d="M12 64 C14 48, 50 48, 52 64 Z" fill="#0F172A" opacity="0.88" />
      {/* Neck & Head */}
      <rect x="27" y="42" width="10" height="8" rx="4" fill={config.skin} />
      <circle cx="32" cy="31" r="14" fill={config.skin} />

      {/* Hair styles */}
      {config.hairStyle === 'short' && (
        <path d="M18 29 C18 16, 46 16, 46 29 C44 22, 20 22, 18 29 Z" fill={config.hair} />
      )}
      {config.hairStyle === 'wavy' && (
        <path d="M16 34 C15 15, 49 15, 48 34 C46 24, 41 21, 32 22 C23 21, 18 24, 16 34 Z" fill={config.hair} />
      )}
      {config.hairStyle === 'curls' && (
        <g fill={config.hair}>
          <circle cx="22" cy="20" r="6" />
          <circle cx="32" cy="17" r="7" />
          <circle cx="42" cy="20" r="6" />
          <circle cx="18" cy="26" r="4" />
          <circle cx="46" cy="26" r="4" />
        </g>
      )}
      {config.hairStyle === 'cap' && (
        <g>
          <path d="M18 27 C18 15, 46 15, 46 27 Z" fill="#00A6FF" />
          <rect x="18" y="24" width="32" height="4" rx="2" fill="#0284C7" />
        </g>
      )}

      {/* Eyes */}
      <circle cx="26.5" cy="31" r="1.8" fill="#0F172A" />
      {config.expression === 'wink' ? (
        <path d="M35 31 Q37.5 29.2 40 31" stroke="#0F172A" strokeWidth="2" strokeLinecap="round" fill="none" />
      ) : (
        <circle cx="37.5" cy="31" r="1.8" fill="#0F172A" />
      )}

      {/* Glasses */}
      {config.glasses === 'shades' && (
        <g>
          <rect x="20.5" y="28" width="10" height="6" rx="2" fill="#0F172A" />
          <rect x="33.5" y="28" width="10" height="6" rx="2" fill="#0F172A" />
          <line x1="30.5" y1="30.5" x2="33.5" y2="30.5" stroke="#0F172A" strokeWidth="1.6" />
        </g>
      )}
      {config.glasses === 'round' && (
        <g fill="none" stroke="#0F172A" strokeWidth="1.6">
          <circle cx="26" cy="31" r="4.2" />
          <circle cx="38" cy="31" r="4.2" />
          <line x1="30.2" y1="31" x2="33.8" y2="31" />
        </g>
      )}

      {/* Mouth */}
      {config.expression === 'cool' ? (
        <path d="M27 38.5 Q33 40.5 38 37" stroke="#0F172A" strokeWidth="2" strokeLinecap="round" fill="none" />
      ) : (
        <path d="M26.5 37.5 Q32 42 37.5 37.5" stroke="#0F172A" strokeWidth="2" strokeLinecap="round" fill="none" />
      )}
    </svg>
  );
}

export function Avatar({
  name,
  photoURL,
  avatarSeed,
  size = 'md',
  isOnline = false,
  isGroup = false,
  isSaved = false,
}: AvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const bitmoji = parseAvatarSeed(avatarSeed);

  return (
    <div className={`relative shrink-0 inline-flex items-center justify-center select-none ${SIZE_MAP[size]}`}>
      {isSaved ? (
        <div className="w-full h-full rounded-full bg-[#00A6FF] text-white flex items-center justify-center">
          <Bookmark className={size === 'xs' ? 'w-3 h-3' : size === 'sm' ? 'w-4 h-4' : 'w-5 h-5'} />
        </div>
      ) : isGroup && !photoURL ? (
        <div className="w-full h-full rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center border border-slate-300/60 dark:border-slate-700">
          <Users className={size === 'xs' ? 'w-3 h-3' : size === 'sm' ? 'w-4 h-4' : 'w-5 h-5'} />
        </div>
      ) : bitmoji ? (
        <BitmojiSvg config={bitmoji} />
      ) : photoURL && !imgFailed ? (
        <img
          src={photoURL}
          alt={name}
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className="w-full h-full rounded-full object-cover bg-slate-200 dark:bg-slate-800"
        />
      ) : (
        <div className="w-full h-full rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold flex items-center justify-center">
          {getInitials(name)}
        </div>
      )}

      {isOnline && !isGroup && !isSaved && (
        <span
          aria-label="Active now"
          className={`absolute bottom-0 right-0 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-[#121824] ${DOT_MAP[size]}`}
        />
      )}
    </div>
  );
}
