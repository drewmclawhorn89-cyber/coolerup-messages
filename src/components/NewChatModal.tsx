import { useMemo, useState } from 'react';
import { Check, Search, Users, X } from 'lucide-react';
import { LIMITS } from '../lib/validation';
import type { PublicProfile } from '../types/messenger';
import { Avatar } from './Avatar';

interface NewChatModalProps {
  initialMode: 'direct' | 'group';
  currentUser: PublicProfile;
  profiles: PublicProfile[];
  onClose: () => void;
  onCreateDirect: (peer: PublicProfile) => Promise<void>;
  onCreateGroup: (title: string, members: PublicProfile[]) => Promise<void>;
}

export function NewChatModal({
  initialMode,
  currentUser,
  profiles,
  onClose,
  onCreateDirect,
  onCreateGroup,
}: NewChatModalProps) {
  const [mode, setMode] = useState<'direct' | 'group'>(initialMode);
  const [query, setQuery] = useState('');
  const [groupTitle, setGroupTitle] = useState('');
  const [selectedUids, setSelectedUids] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return profiles
      .filter((p) => (mode === 'group' ? p.uid !== currentUser.uid : true))
      .filter((p) => {
        if (!q) return true;
        return (
          p.displayNameLower.includes(q) ||
          p.handle.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        if (a.uid === currentUser.uid) return -1;
        if (b.uid === currentUser.uid) return 1;
        return a.displayName.localeCompare(b.displayName);
      });
  }, [profiles, currentUser.uid, mode, query]);

  const toggleMember = (uid: string) => {
    setSelectedUids((prev) => {
      if (prev.includes(uid)) return prev.filter((id) => id !== uid);
      if (prev.length >= LIMITS.MEMBERS_MAX - 1) return prev;
      return [...prev, uid];
    });
  };

  const handleStartGroup = async () => {
    if (selectedUids.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      const selectedProfiles = profiles.filter((p) => selectedUids.includes(p.uid));
      await onCreateGroup(groupTitle, selectedProfiles);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white dark:bg-[#121824] border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
            {mode === 'group' ? 'New Group Chat' : 'New Message'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="w-9 h-9 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 pt-3 pb-2">
          <div className="grid grid-cols-2 gap-1 p-1 bg-[#F4F6F9] dark:bg-[#0B0F17] rounded-xl">
            <button
              type="button"
              onClick={() => setMode('direct')}
              className={`h-9 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                mode === 'direct'
                  ? 'bg-white dark:bg-[#1A2232] text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Direct Message
            </button>
            <button
              type="button"
              onClick={() => setMode('group')}
              className={`h-9 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                mode === 'group'
                  ? 'bg-white dark:bg-[#1A2232] text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Group Chat
            </button>
          </div>
        </div>

        {mode === 'group' && (
          <div className="px-5 py-2">
            <input
              type="text"
              value={groupTitle}
              maxLength={LIMITS.TITLE_MAX}
              onChange={(e) => setGroupTitle(e.target.value)}
              placeholder="Group name (optional)"
              className="w-full h-10 px-3.5 rounded-xl bg-[#F4F6F9] dark:bg-[#0B0F17] border border-slate-200/80 dark:border-slate-800 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 outline-none focus:border-[#0066FF]"
            />
          </div>
        )}

        <div className="px-5 py-2">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search people..."
              className="w-full h-10 pl-9 pr-3 rounded-xl bg-[#F4F6F9] dark:bg-[#0B0F17] text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 outline-none"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto chat-scroll px-3 py-2 space-y-1">
          {candidates.length === 0 ? (
            <p className="text-center text-xs text-slate-500 dark:text-slate-400 py-8">
              No people found. Share your CoolerUp link to invite others!
            </p>
          ) : (
            candidates.map((person) => {
              const isSelf = person.uid === currentUser.uid;
              const isChecked = selectedUids.includes(person.uid);
              return (
                <button
                  key={person.uid}
                  type="button"
                  disabled={submitting}
                  onClick={async () => {
                    if (mode === 'direct') {
                      setSubmitting(true);
                      try {
                        await onCreateDirect(person);
                        onClose();
                      } finally {
                        setSubmitting(false);
                      }
                    } else {
                      toggleMember(person.uid);
                    }
                  }}
                  className="w-full px-3 py-2.5 rounded-xl hover:bg-[#F4F6F9] dark:hover:bg-slate-800/60 flex items-center justify-between gap-3 text-left transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar
                      name={isSelf ? 'Saved Snaps' : person.displayName}
                      photoURL={person.photoURL}
                      avatarSeed={person.avatarSeed}
                      size="md"
                      isOnline={person.isOnline}
                      isSaved={isSelf}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {isSelf ? 'Saved Snaps (You)' : person.displayName}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        @{person.handle}
                      </p>
                    </div>
                  </div>

                  {mode === 'group' && (
                    <span
                      className={`w-5 h-5 rounded-md flex items-center justify-center border transition-colors ${
                        isChecked
                          ? 'bg-[#0066FF] border-[#0066FF] text-white'
                          : 'border-slate-300 dark:border-slate-600'
                      }`}
                    >
                      {isChecked && <Check className="w-3.5 h-3.5" />}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>

        {mode === 'group' && (
          <div className="px-5 py-3.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
            <span className="text-xs text-slate-500 dark:text-slate-400 font-mono-tabular">
              {selectedUids.length} selected
            </span>
            <button
              type="button"
              disabled={selectedUids.length === 0 || submitting}
              onClick={handleStartGroup}
              className="h-10 px-5 rounded-xl bg-[#0066FF] hover:bg-[#0052CC] disabled:opacity-40 text-white text-sm font-medium flex items-center gap-2 transition-colors cursor-pointer"
            >
              <Users className="w-4 h-4" />
              <span>{submitting ? 'Creating...' : 'Create Group'}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
