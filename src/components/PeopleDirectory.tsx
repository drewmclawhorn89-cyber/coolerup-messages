import { useMemo, useState } from 'react';
import {
  BellOff,
  Check,
  Contact,
  Copy,
  Flame,
  MessageSquare,
  QrCode,
  Search,
  ShieldAlert,
  ShieldBan,
  UserCheck,
  UserMinus,
  UserPlus,
  X,
} from 'lucide-react';
import { formatLastSeen } from '../lib/dateFormat';
import { extractHandleFromSnapcodeInput } from '../lib/snapUtils';
import type { Friendship, PublicProfile, UserChatIndex } from '../types/messenger';
import { Avatar } from './Avatar';
import { SnapcodeCard } from './SnapcodeCard';

interface PeopleDirectoryProps {
  currentUser: PublicProfile;
  profiles: PublicProfile[];
  friendships: Friendship[];
  chats?: UserChatIndex[];
  blockedUids?: string[];
  onSendFriendRequest: (peer: PublicProfile) => Promise<void>;
  onRespondFriendRequest: (friendshipId: string, accept: boolean) => Promise<void>;
  onRemoveFriendship?: (friendshipId: string) => Promise<void>;
  onBlockUser?: (uid: string) => Promise<void>;
  onUnblockUser?: (uid: string) => Promise<void>;
  onReportUser?: (uid: string, reason: string) => Promise<void>;
  onToggleMuteChat?: (conversationId: string, muted: boolean) => Promise<void>;
  onStartDirectChat: (peer: PublicProfile) => void;
  onOpenNewGroup: () => void;
}

export function PeopleDirectory({
  currentUser,
  profiles,
  friendships,
  chats = [],
  blockedUids = [],
  onSendFriendRequest,
  onRespondFriendRequest,
  onRemoveFriendship,
  onBlockUser,
  onUnblockUser,
  onReportUser,
  onToggleMuteChat,
  onStartDirectChat,
  onOpenNewGroup,
}: PeopleDirectoryProps) {
  const [query, setQuery] = useState('');
  const [snapcodeInput, setSnapcodeInput] = useState('');
  const [showMySnapcode, setShowMySnapcode] = useState(false);
  const [contactFeedback, setContactFeedback] = useState('');
  const [copied, setCopied] = useState(false);

  const friendshipByPeer = useMemo(() => {
    const map = new Map<string, Friendship>();
    for (const f of friendships) {
      const peerId = f.userIds.find((id) => id !== currentUser.uid);
      if (peerId) map.set(peerId, f);
    }
    return map;
  }, [friendships, currentUser.uid]);

  const incomingRequests = useMemo(() => {
    return friendships
      .filter((f) => f.status === 'pending' && f.receiverId === currentUser.uid)
      .map((f) => ({
        friendship: f,
        requester: profiles.find((p) => p.uid === f.requesterId),
      }))
      .filter((item): item is { friendship: Friendship; requester: PublicProfile } => Boolean(item.requester));
  }, [friendships, currentUser.uid, profiles]);

  const acceptedFriends = useMemo(() => {
    return profiles
      .filter((p) => p.uid !== currentUser.uid)
      .filter((p) => friendshipByPeer.get(p.uid)?.status === 'accepted')
      .filter((p) => {
        const q = query.trim().toLowerCase();
        if (!q) return true;
        return (
          p.displayNameLower.includes(q) ||
          p.handle.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [profiles, currentUser.uid, friendshipByPeer, query]);

  const quickAddPeople = useMemo(() => {
    const q = query.trim().toLowerCase();
    return profiles
      .filter((p) => p.uid !== currentUser.uid)
      .filter((p) => friendshipByPeer.get(p.uid)?.status !== 'accepted')
      .filter((p) => {
        if (!q) return true;
        return (
          p.displayNameLower.includes(q) ||
          p.handle.toLowerCase().includes(q) ||
          p.statusText.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
        return a.displayName.localeCompare(b.displayName);
      });
  }, [profiles, currentUser.uid, friendshipByPeer, query]);

  const handleCopyInvite = async () => {
    const inviteUrl = `${window.location.origin}/?chat=${encodeURIComponent(currentUser.handle)}`;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const handleAddFromSnapcode = async () => {
    const targetHandle = extractHandleFromSnapcodeInput(snapcodeInput);
    if (!targetHandle) return;
    const matched = profiles.find((p) => p.handle.toLowerCase() === targetHandle && p.uid !== currentUser.uid);
    if (!matched) {
      setContactFeedback(`No user found for @${targetHandle}`);
      return;
    }
    await onSendFriendRequest(matched);
    setSnapcodeInput('');
    setContactFeedback(`Friend request sent to @${matched.handle}!`);
    setTimeout(() => setContactFeedback(''), 2500);
  };

  const handleFindFromContacts = async () => {
    const nav = navigator as Navigator & {
      contacts?: {
        select: (props: string[], opts?: { multiple?: boolean }) => Promise<Array<{ name?: string[]; email?: string[] }>>;
      };
    };

    if (nav.contacts?.select) {
      try {
        const picked = await nav.contacts.select(['name', 'email'], { multiple: true });
        if (picked.length > 0) {
          const term = (picked[0].name?.[0] || '').toLowerCase();
          if (term) setQuery(term);
          setContactFeedback(`Matched contacts filter for "${picked[0].name?.[0] || 'contact'}"`);
          setTimeout(() => setContactFeedback(''), 2500);
          return;
        }
      } catch {
        // Fallback to invite share
      }
    }

    await handleCopyInvite();
    setContactFeedback('Copied your invite link to share with phone contacts!');
    setTimeout(() => setContactFeedback(''), 2500);
  };

  return (
    <section className="flex flex-col h-full w-full md:w-[360px] lg:w-[380px] shrink-0 bg-white dark:bg-[#0F0F0F] border-r border-slate-100 dark:border-white/10">
      <div className="px-4 pt-4 pb-3 flex items-center justify-between gap-2 shrink-0">
        <div>
          <h1 className="font-display text-[28px] leading-none font-extrabold tracking-[-0.05em] text-slate-900 dark:text-white">
            Add Friends
          </h1>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-tabular">
            Snap Score · {currentUser.snapScore ?? 0}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowMySnapcode((v) => !v)}
            title="My QR Snapcode"
            className={`w-9 h-9 rounded-2xl flex items-center justify-center transition-colors cursor-pointer ${
              showMySnapcode
                ? 'bg-[#FFFC00] text-slate-950'
                : 'bg-[#F2F2F2] dark:bg-white/10 text-slate-700 dark:text-slate-200'
            }`}
          >
            <QrCode className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onOpenNewGroup}
            className="h-9 px-3 rounded-2xl bg-[#F2F2F2] dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/10 text-xs font-medium text-slate-700 dark:text-slate-200 flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Group</span>
          </button>
        </div>
      </div>

      {/* My QR Snapcode Expandable Card */}
      {showMySnapcode && (
        <div className="px-4 pb-3 shrink-0 space-y-2">
          <SnapcodeCard profile={currentUser} compact />
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={snapcodeInput}
              onChange={(e) => setSnapcodeInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleAddFromSnapcode();
              }}
              placeholder="Paste Snapcode link or @username..."
              className="flex-1 h-9 px-3 rounded-2xl bg-[#F2F2F2] dark:bg-[#0A0A0A] text-xs text-slate-900 dark:text-slate-100 outline-none border border-slate-200/80 dark:border-white/10 focus:border-[#0E8CFF]"
            />
            <button
              type="button"
              onClick={handleAddFromSnapcode}
              className="h-9 px-3 rounded-full bg-[#FFFC00] hover:bg-[#F5E600] text-black text-xs font-bold cursor-pointer shrink-0"
            >
              Add
            </button>
          </div>
        </div>
      )}

      {/* Invite & Contacts Quick Actions */}
      <div className="px-4 pb-3 shrink-0 flex items-center gap-2">
        <button
          type="button"
          onClick={handleFindFromContacts}
          className="flex-1 h-9 px-3 rounded-2xl bg-[#F2F2F2] dark:bg-[#0A0A0A] hover:bg-slate-200/70 dark:hover:bg-white/5 text-xs font-medium text-slate-700 dark:text-slate-200 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
        >
          <Contact className="w-3.5 h-3.5 text-[#0E8CFF]" />
          <span>From Contacts</span>
        </button>
        <button
          type="button"
          onClick={handleCopyInvite}
          className="flex-1 h-9 px-3 rounded-full bg-[#FFFC00] hover:bg-[#F5E600] text-black text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copied ? 'Link Copied' : 'Share Link'}</span>
        </button>
      </div>

      {contactFeedback && (
        <p className="px-4 pb-2 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
          {contactFeedback}
        </p>
      )}

      {/* Search Bar */}
      <div className="px-4 pb-3 shrink-0">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find friends by name or @username..."
            className="w-full h-10 pl-9 pr-8 rounded-2xl bg-[#F2F2F2] dark:bg-[#0A0A0A] border border-transparent focus:border-[#0E8CFF]/40 focus:bg-white dark:focus:bg-[#101010] text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 outline-none transition-colors"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Directory List */}
      <div className="flex-1 overflow-y-auto chat-scroll px-2 pb-4 space-y-1">
        {/* Saved Snaps Shortcut */}
        <button
          type="button"
          onClick={() => onStartDirectChat(currentUser)}
          className="w-full min-h-[60px] px-3 py-2 rounded-2xl flex items-center justify-between gap-3 hover:bg-[#F2F2F2] dark:hover:bg-white/5/50 transition-colors text-left cursor-pointer"
        >
          <div className="flex items-center gap-3 min-w-0">
            <Avatar name="Saved Snaps" size="md" isSaved />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                Saved Snaps (You)
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                Private notes, photos &amp; reminders
              </p>
            </div>
          </div>
          <MessageSquare className="w-4 h-4 text-[#0E8CFF] shrink-0" />
        </button>

        {/* Pending Friend Requests (Accept / Decline) */}
        {incomingRequests.length > 0 && (
          <div className="pt-2">
            <p className="px-3 pb-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
              Added Me · {incomingRequests.length}
            </p>
            <div className="space-y-1.5 px-1">
              {incomingRequests.map(({ friendship, requester }) => (
                <div
                  key={friendship.id}
                  className="p-2.5 rounded-full bg-[#FFFC00]/20 dark:bg-[#FFFC00]/10 border border-[#FFFC00]/60 flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar
                      name={requester.displayName}
                      photoURL={requester.photoURL}
                      avatarSeed={requester.avatarSeed}
                      size="sm"
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                        {requester.displayName}
                      </p>
                      <p className="text-[11px] text-slate-600 dark:text-slate-300 truncate">
                        @{requester.handle}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => void onRespondFriendRequest(friendship.id, true)}
                      className="h-8 px-3 rounded-full bg-[#FFFC00] hover:bg-[#F5E600] text-black text-xs font-bold cursor-pointer"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => void onRespondFriendRequest(friendship.id, false)}
                      aria-label="Decline request"
                      className="w-8 h-8 rounded-2xl bg-white dark:bg-[#141414] text-slate-500 hover:text-rose-600 flex items-center justify-center cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* My Friends */}
        {acceptedFriends.length > 0 && (
          <div className="pt-2">
            <p className="px-3 pb-1 text-xs font-medium text-slate-400 dark:text-slate-500">
              My Friends · {acceptedFriends.length}
            </p>
            {acceptedFriends.map((friend, friendIdx) => {
              const rel = friendshipByPeer.get(friend.uid);
              const friendChat = chats.find((c) => c.type === 'direct' && c.peerUid === friend.uid);
              const streak = friendChat?.streakCount || 0;
              const bestEmoji = friendIdx === 0 ? '❤️' : friendIdx === 1 ? '💛' : friendIdx === 2 ? '😊' : '';
              const isBlocked = blockedUids.includes(friend.uid);

              return (
                <div
                  key={friend.uid}
                  className="w-full min-h-[60px] px-3 py-2 rounded-2xl flex items-center justify-between gap-2 hover:bg-[#F2F2F2] dark:hover:bg-white/5/50 transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => onStartDirectChat(friend)}
                    className="flex-1 flex items-center gap-3 min-w-0 text-left cursor-pointer"
                  >
                    <Avatar
                      name={friend.displayName}
                      photoURL={friend.photoURL}
                      avatarSeed={friend.avatarSeed}
                      size="md"
                      isOnline={friend.isOnline}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate flex items-center gap-1">
                        <span className="truncate">{friend.displayName}</span>
                        {bestEmoji && <span className="text-xs shrink-0">{bestEmoji}</span>}
                        {streak >= 2 && (
                          <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-amber-500 shrink-0 font-mono-tabular">
                            <Flame className="w-3 h-3 fill-amber-500" />
                            {streak}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        @{friend.handle} · {friend.snapScore ?? 0} score{isBlocked ? ' · Blocked' : ''}
                      </p>
                    </div>
                  </button>

                  <div className="flex items-center gap-1 shrink-0">
                    {friendChat && onToggleMuteChat && (
                      <button
                        type="button"
                        onClick={() => void onToggleMuteChat(friendChat.conversationId, !friendChat.muted)}
                        title={friendChat.muted ? 'Unmute notifications' : 'Mute notifications'}
                        className={`w-7 h-7 rounded-xl flex items-center justify-center cursor-pointer ${
                          friendChat.muted
                            ? 'bg-amber-500/15 text-amber-500'
                            : 'text-slate-400 hover:bg-slate-200 dark:hover:bg-white/10'
                        }`}
                      >
                        <BellOff className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {onBlockUser && onUnblockUser && (
                      <button
                        type="button"
                        onClick={() =>
                          void (isBlocked ? onUnblockUser(friend.uid) : onBlockUser(friend.uid))
                        }
                        title={isBlocked ? 'Unblock user' : 'Block user'}
                        className={`w-7 h-7 rounded-xl flex items-center justify-center cursor-pointer ${
                          isBlocked
                            ? 'bg-rose-500 text-white'
                            : 'text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30'
                        }`}
                      >
                        <ShieldBan className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {onReportUser && (
                      <button
                        type="button"
                        onClick={() => {
                          void onReportUser(friend.uid, 'User safety report');
                          setContactFeedback(`Reported @${friend.handle}`);
                          setTimeout(() => setContactFeedback(''), 2500);
                        }}
                        title="Report user"
                        className="w-7 h-7 rounded-xl text-slate-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/30 flex items-center justify-center cursor-pointer"
                      >
                        <ShieldAlert className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {rel && onRemoveFriendship && (
                      <button
                        type="button"
                        onClick={() => void onRemoveFriendship(rel.id)}
                        title="Remove friend"
                        className="w-7 h-7 rounded-xl text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 flex items-center justify-center cursor-pointer"
                      >
                        <UserMinus className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onStartDirectChat(friend)}
                      className="h-8 px-2.5 rounded-full bg-[#0E8CFF]/12 text-[#0E8CFF] text-xs font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      <span>Chat</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Quick Add People */}
        <div className="px-3 pt-3 pb-1 text-xs font-medium text-slate-400 dark:text-slate-500">
          Quick Add · {quickAddPeople.length} {quickAddPeople.length === 1 ? 'person' : 'people'}
        </div>

        {quickAddPeople.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              {query ? 'No people matched your search' : 'Everyone is already in your friends!'}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Share your Snapcode or invite link above to add more friends.
            </p>
          </div>
        ) : (
          quickAddPeople.map((person) => {
            const rel = friendshipByPeer.get(person.uid);
            const isPendingSent = rel?.status === 'pending' && rel.requesterId === currentUser.uid;
            return (
              <div
                key={person.uid}
                className="w-full min-h-[64px] px-3 py-2 rounded-2xl flex items-center justify-between gap-2 hover:bg-[#F2F2F2] dark:hover:bg-white/5/50 transition-colors"
              >
                <button
                  type="button"
                  onClick={() => onStartDirectChat(person)}
                  className="flex-1 min-w-0 flex items-center gap-3 text-left cursor-pointer"
                >
                  <Avatar
                    name={person.displayName}
                    photoURL={person.photoURL}
                    avatarSeed={person.avatarSeed}
                    size="md"
                    isOnline={person.isOnline}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {person.displayName}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      @{person.handle} · {formatLastSeen(person.isOnline, person.lastSeenAt)}
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  disabled={isPendingSent}
                  onClick={() => void onSendFriendRequest(person)}
                  className={`h-8 px-3 rounded-2xl text-xs font-bold flex items-center gap-1 shrink-0 transition-colors cursor-pointer ${
                    isPendingSent
                      ? 'bg-[#F2F2F2] dark:bg-white/10 text-slate-400 cursor-default'
                      : 'bg-[#FFFC00] hover:bg-[#F5E600] text-black'
                  }`}
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>{isPendingSent ? 'Added' : 'Add'}</span>
                </button>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
