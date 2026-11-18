import { useMemo } from 'react';
import { Ghost } from 'lucide-react';
import { buildSnapcodeString, generateSnapcodeMatrix } from '../lib/snapUtils';
import type { PublicProfile } from '../types/messenger';
import { Avatar } from './Avatar';

interface SnapcodeCardProps {
  profile: PublicProfile;
  compact?: boolean;
}

export function SnapcodeCard({ profile, compact = false }: SnapcodeCardProps) {
  const codeValue = buildSnapcodeString(profile.handle);
  const matrix = useMemo(() => generateSnapcodeMatrix(codeValue), [codeValue]);

  return (
    <div
      className={`rounded-3xl bg-[#FFFC00] text-slate-950 flex flex-col items-center justify-center border border-slate-900/10 select-none ${
        compact ? 'p-3' : 'p-5'
      }`}
    >
      <div className="relative bg-[#FFFC00] p-2.5 rounded-2xl border-2 border-slate-950/15">
        <div
          className="grid gap-1"
          style={{
            gridTemplateColumns: `repeat(${matrix.length}, minmax(0, 1fr))`,
          }}
        >
          {matrix.flatMap((row, rIdx) =>
            row.map((filled, cIdx) => (
              <span
                key={`${rIdx}-${cIdx}`}
                className={`${compact ? 'w-2 h-2' : 'w-3 h-3'} rounded-full ${
                  filled ? 'bg-slate-950' : 'bg-transparent'
                }`}
              />
            ))
          )}
        </div>

        {/* Center Ghost + Bitmoji/Photo Badge */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-14 h-14 rounded-2xl bg-white border-2 border-slate-950 shadow-sm flex items-center justify-center overflow-hidden">
            {profile.avatarSeed || profile.photoURL ? (
              <Avatar
                name={profile.displayName}
                photoURL={profile.photoURL}
                avatarSeed={profile.avatarSeed}
                size="md"
              />
            ) : (
              <Ghost className="w-7 h-7 text-slate-950" />
            )}
          </div>
        </div>
      </div>

      <p className="mt-2.5 text-sm font-bold text-slate-950 tracking-tight">
        {profile.displayName}
      </p>
      <p className="text-xs font-mono-tabular text-slate-800/80">
        @{profile.handle} · {profile.snapScore ?? 0} score
      </p>
    </div>
  );
}
