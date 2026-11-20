import { useMemo, useRef, useState } from 'react';
import {
  BellOff,
  Camera,
  Edit3,
  Flame,
  Hourglass,
  MessageSquare,
  Pin,
  Plus,
  Search,
  Send,
  Square,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { formatConversationTime } from '../lib/dateFormat';
import { getStreakStatus } from '../lib/snapUtils';
import type {
  ChatFilter,
  Friendship,
  NavTab,
  PublicProfile,
  Story,
  UserChatIndex,
} from '../types/messenger';
import { Avatar } from './Avatar';
import { PWAInstallButton } from './PWAInstallButton';

interface ConversationListProps {
  activeTab: NavTab;
  chats: UserChatIndex[];
  stories: Story[];
  friendships: Friendship[];
  activeConversationId: string | null;
  currentUser: PublicProfile;
  profilesByUid: Record<string, PublicProfile>;
  onSelectChat: (conversationId: string) => void;
  onOpenNewChat: (mode: 'direct' | 'group') => void;
  onOpenCameraForChat: (conversationId?: string) => void;
  onViewAuthorStories: (authorId: string) => void;
  onDeleteChat: (conversationId: string) => Promise<void>;
  onOpenProfile: () => void;
}

export function ConversationList({
  activeTab,
  chats,
  stories,
  friendships,
  activeConversationId,
  currentUser,
  profilesByUid,
  onSelectChat,
  onOpenNewChat,
  onOpenCameraForChat,
  onViewAuthorStories,
  onDeleteChat,
  onOpenProfile,
}: ConversationListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<ChatFilter>('all');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const swipeRowStartRef = useRef<{ id: string; x: number; y: number } | null>(null);

  const storyRings = useMemo(() => {
    const now = Date.now();
    const active = stories.filter((s) => (s.expiresAt?.toMillis?.() ?? now + 1000) > now);
    const byAuthor = new Map<string, Story[]>();
    for (const st of active) {
      const list = byAuthor.get(st.authorId) || [];
      list.push(st);
      byAuthor.set(st.authorId, list);
    }

    const myItems = byAuthor.get(currentUser.uid) || [];
    const myViewersCount = new Set(
      myItems.flatMap((s) => s.viewerIds.filter((id) => id !== currentUser.uid))
    ).size;

    const friends = Array.from(byAuthor.entries())
      .filter(([uid]) => uid !== currentUser.uid)
      .map(([uid, items]) => ({
        uid,
        name: profilesByUid[uid]?.displayName || items[0].authorName,
        photoURL: profilesByUid[uid]?.photoURL || items[0].authorPhotoURL,
        avatarSeed: profilesByUid[uid]?.avatarSeed,
        hasUnviewed: items.some((s) => !s.viewerIds.includes(currentUser.uid)),
      }))
      .sort((a, b) => (a.hasUnviewed === b.hasUnviewed ? 0 : a.hasUnviewed ? -1 : 1));

    return { myCount: myItems.length, myViewersCount, friends };
  }, [stories, currentUser.uid, profilesByUid]);

  // Best Friends: direct chats sorted by streakCount or accepted friendships
  const bestFriends = useMemo(() => {
    const acceptedPeerIds = new Set(
      friendships
        .filter((f) => f.status === 'accepted')
        .map((f) => f.userIds.find((id) => id !== currentUser.uid) || '')
        .filter(Boolean)
    );

    const directChats = chats.filter(
      (c) =>
        c.type === 'direct' &&
        c.conversationId !== `saved_${currentUser.uid}` &&
        c.peerUid &&
        !c.archived
    );

    return directChats
      .filter((c) => (c.streakCount || 0) >= 2 || acceptedPeerIds.has(c.peerUid))
      .sort((a, b) => (b.streakCount || 0) - (a.streakCount || 0))
      .slice(0, 6);
  }, [chats, friendships, currentUser.uid]);

  const filteredChats = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return chats
      .filter((chat) => {
        if (activeTab === 'archived') {
          if (!chat.archived) return false;
        } else {
          if (chat.archived) return false;
        }
        if (filter === 'unread' && chat.unreadCount === 0) return false;
        if (filter === 'snaps' && chat.lastMessageKind !== 'snap') return false;
        if (filter === 'groups' && chat.type !== 'group') return false;
        if (!q) return true;
        const peer = chat.peerUid ? profilesByUid[chat.peerUid] : undefined;
        const resolvedTitle = (peer?.displayName || chat.title).toLowerCase();
        return (
          resolvedTitle.includes(q) ||
          chat.lastMessageText.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        const aTime = a.lastMessageAt?.toMillis?.() ?? 0;
        const bTime = b.lastMessageAt?.toMillis?.() ?? 0;
        return bTime - aTime;
      });
  }, [chats, activeTab, filter, searchQuery, profilesByUid]);

  return (
    <section className="flex flex-col h-full w-full md:w-[360px] lg:w-[384px] shrink-0 bg-white dark:bg-[#0F0F0F] border-r border-slate-100 dark:border-white/10">
      {/* Header */}
      <div className="px-4 pt-5 pb-2 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={onOpenProfile}
            className="md:hidden shrink-0 cursor-pointer"
            aria-label="Open profile settings"
          >
            <Avatar
              name={currentUser.displayName}
              photoURL={currentUser.photoURL}
              avatarSeed={currentUser.avatarSeed}
              size="sm"
              isOnline={currentUser.isOnline}
            />
          </button>
          <h1 className="font-display text-[28px] leading-none font-extrabold tracking-[-0.05em] text-slate-900 dark:text-white truncate">
            {activeTab === 'archived' ? 'Archived' : 'Chat'}
          </h1>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <div className="md:hidden">
            <PWAInstallButton variant="compact" />
          </div>
          <button
            type="button"
            onClick={() => onOpenCameraForChat()}
            title="Open Snap Camera"
            aria-label="Open Snap Camera"
            className="h-10 px-4 rounded-full bg-[#FFFC00] hover:bg-[#F2EF00] text-black font-extrabold text-xs flex items-center gap-1.5 snap-press cursor-pointer"
          >
            <Camera className="w-4 h-4" />
            <span>Snap</span>
          </button>
          <button
            type="button"
            onClick={() => onOpenNewChat('group')}
            title="New group chat"
            aria-label="New group chat"
            className="min-w-[40px] min-h-[40px] rounded-full bg-[#F2F2F2] dark:bg-white/10 hover:bg-[#E5E5E5] dark:hover:bg-white/20 text-slate-900 dark:text-white flex items-center justify-center snap-press cursor-pointer"
          >
            <Users className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => onOpenNewChat('direct')}
            title="New chat"
            aria-label="New chat"
            className="min-w-[40px] min-h-[40px] rounded-full bg-black dark:bg-white text-white dark:text-black hover:opacity-80 flex items-center justify-center snap-press cursor-pointer"
          >
            <Edit3 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="px-4 pb-3 shrink-0">
        <div className="relative">
          <Search className="w-[18px] h-[18px] text-slate-500 dark:text-slate-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" strokeWidth={2.4} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search friends & chats"
            className="w-full h-11 pl-11 pr-9 rounded-full bg-[#F2F2F2] dark:bg-white/10 border-2 border-transparent focus:border-[#FFFC00] text-[14px] font-medium text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-400 outline-none transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Filter Tabs */}
      {activeTab !== 'archived' && (
        <div className="px-4 pb-3 shrink-0">
          <div className="flex items-center gap-2 overflow-x-auto snap-no-scrollbar">
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'snaps', label: 'Snaps' },
                { id: 'unread', label: 'Unread' },
                { id: 'groups', label: 'Groups' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`h-8 px-3.5 text-xs font-bold rounded-full transition-colors cursor-pointer whitespace-nowrap snap-press ${
                  filter === tab.id
                    ? 'bg-black dark:bg-[#FFFC00] text-white dark:text-black'
                    : 'bg-[#F2F2F2] dark:bg-white/10 text-slate-700 dark:text-slate-300 hover:bg-[#E5E5E5] dark:hover:bg-white/20'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Stories Section: My Story at top + Friends Stories below */}
      {activeTab === 'chats' && !searchQuery && (
        <div className="px-4 pb-3 border-b border-slate-100 dark:border-white/10/80 shrink-0 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() =>
                storyRings.myCount > 0
                  ? onViewAuthorStories(currentUser.uid)
                  : onOpenCameraForChat()
              }
              className="flex-1 min-w-0 flex items-center gap-2.5 p-1.5 -ml-1.5 rounded-2xl hover:bg-[#F2F2F2] dark:hover:bg-white/5/60 text-left cursor-pointer"
            >
              <div
                className={`relative p-[2.5px] rounded-full shrink-0 ${
                  storyRings.myCount > 0 ? 'snap-story-ring' : 'snap-story-ring-seen'
                }`}
              >
                <Avatar
                  name={currentUser.displayName}
                  photoURL={currentUser.photoURL}
                  avatarSeed={currentUser.avatarSeed}
                  size="sm"
                />
                {storyRings.myCount === 0 && (
                  <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-[#FFFC00] text-slate-950 flex items-center justify-center ring-2 ring-white dark:ring-[#141414]">
                    <Plus className="w-2.5 h-2.5" />
                  </span>
                )}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                  My Story
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {storyRings.myCount > 0
                    ? `${storyRings.myCount} active · ${storyRings.myViewersCount} views`
                    : 'Tap to add a 24h story'}
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => onOpenCameraForChat()}
              title="Add to My Story"
              className="h-8 px-3 rounded-full bg-[#FFFC00] hover:bg-[#F2EF00] text-black text-[11px] font-extrabold flex items-center gap-1 shrink-0 snap-press cursor-pointer"
            >
              <Plus className="w-3 h-3" />
              <span>Add</span>
            </button>
          </div>

          {storyRings.friends.length > 0 && (
            <div className="flex items-center gap-3 overflow-x-auto chat-scroll pb-0.5">
              {storyRings.friends.map((friend) => (
                <button
                  key={friend.uid}
                  type="button"
                  onClick={() => onViewAuthorStories(friend.uid)}
                  className="flex flex-col items-center gap-1 w-14 shrink-0 group cursor-pointer"
                >
                  <div
                    className={`p-[2.5px] rounded-full ${
                      friend.hasUnviewed ? 'snap-story-ring' : 'snap-story-ring-seen'
                    }`}
                  >
                    <Avatar
                      name={friend.name}
                      photoURL={friend.photoURL}
                      avatarSeed={friend.avatarSeed}
                      size="md"
                    />
                  </div>
                  <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 truncate w-full text-center">
                    {friend.name.split(' ')[0]}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Best Friends Strip */}
      {activeTab === 'chats' && !searchQuery && bestFriends.length > 0 && (
        <div className="px-4 py-2 border-b border-slate-100 dark:border-white/10/80 shrink-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1.5">
            Best Friends
          </p>
          <div className="flex items-center gap-2.5 overflow-x-auto chat-scroll">
            {bestFriends.map((bf) => {
              const peer = profilesByUid[bf.peerUid];
              const streak = getStreakStatus(bf.streakCount, bf.lastSnapAt);
              return (
                <button
                  key={bf.conversationId}
                  type="button"
                  onClick={() => onSelectChat(bf.conversationId)}
                  className="flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full bg-[#F2F2F2] dark:bg-white/10 hover:bg-[#E5E5E5] dark:hover:bg-white/20 shrink-0 cursor-pointer transition-colors snap-press"
                >
                  <Avatar
                    name={peer?.displayName || bf.title}
                    photoURL={peer?.photoURL || bf.photoURL}
                    avatarSeed={peer?.avatarSeed}
                    size="xs"
                    isOnline={Boolean(peer?.isOnline)}
                  />
                  <span className="text-xs font-medium text-slate-800 dark:text-slate-200 max-w-[72px] truncate">
                    {(peer?.displayName || bf.title).split(' ')[0]}
                  </span>
                  {streak.active && (
                    <span className="text-[10px] font-bold text-amber-500 font-mono-tabular">
                      🔥{streak.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto chat-scroll px-2 py-2 space-y-0.5">
        {filteredChats.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              {searchQuery
                ? 'No matching chats'
                : activeTab === 'archived'
                ? 'No archived chats'
                : filter === 'snaps'
                ? 'No recent Snaps'
                : filter === 'unread'
                ? 'All caught up'
                : 'No chats yet'}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
              Tap Camera to send a Snap or start a new chat with a friend.
            </p>
            {activeTab !== 'archived' && !searchQuery && (
              <button
                type="button"
                onClick={() => onOpenCameraForChat()}
                className="h-9 px-4 rounded-full bg-[#FFFC00] hover:bg-[#F5E600] text-black text-xs font-bold transition-colors cursor-pointer"
              >
                Send a Snap
              </button>
            )}
          </div>
        ) : (
          filteredChats.map((chat) => {
            const isSelected = chat.conversationId === activeConversationId;
            const peer =
              chat.type === 'direct' && chat.peerUid
                ? profilesByUid[chat.peerUid]
                : undefined;
            const isSaved = chat.conversationId === `saved_${currentUser.uid}`;
            const displayTitle = isSaved
              ? 'Saved Snaps'
              : peer?.displayName || chat.title;
            const displayPhoto = peer?.photoURL || chat.photoURL;
            const isPeerOnline = Boolean(peer?.isOnline);
            const hasUnread = chat.unreadCount > 0 && !isSelected;
            const isSelfLast = chat.lastMessageSenderId === currentUser.uid;
            const isSnapLast = chat.lastMessageKind === 'snap';
            const isVideoSnap = chat.lastMediaType === 'video';
            const snapOpened = Boolean(chat.lastSnapOpened);
            const snapStatus = chat.lastSnapStatus || (snapOpened ? 'opened' : 'delivered');
            const streak = getStreakStatus(chat.streakCount, chat.lastSnapAt);

            // Snapchat-style icon color: Red = photo snap, Purple = video snap, Blue = chat
            const snapArrowColor = isVideoSnap
              ? snapStatus === 'opened' || snapStatus === 'replayed' || snapStatus === 'screenshotted'
                ? 'text-violet-400'
                : 'text-violet-500 fill-violet-500'
              : snapStatus === 'opened' || snapStatus === 'replayed' || snapStatus === 'screenshotted'
              ? 'text-rose-400'
              : 'text-rose-500 fill-rose-500';

            const snapSquareColor = isVideoSnap
              ? !snapOpened
                ? 'text-violet-500 fill-violet-500'
                : 'text-violet-400'
              : !snapOpened
              ? 'text-rose-500 fill-rose-500'
              : 'text-rose-400';

            const snapLabel = (() => {
              if (snapStatus === 'screenshotted') return 'Screenshotted';
              if (snapStatus === 'replayed') return 'Replayed';
              if (snapStatus === 'opened') return 'Opened';
              if (snapStatus === 'sent') return 'Sent';
              return 'Delivered';
            })();

            const snapStatusNode = (() => {
              if (isSnapLast) {
                if (isSelfLast) {
                  return (
                    <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 truncate">
                      <Send className={`w-3 h-3 shrink-0 ${snapArrowColor}`} />
                      <span>{snapLabel}</span>
                    </span>
                  );
                }
                return (
                  <span
                    className={`inline-flex items-center gap-1.5 text-xs truncate ${
                      !snapOpened
                        ? isVideoSnap
                          ? 'font-bold text-violet-500'
                          : 'font-bold text-rose-500'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    <Square className={`w-3 h-3 shrink-0 ${snapSquareColor}`} />
                    <span>{!snapOpened ? (isVideoSnap ? 'New Video Snap' : 'New Snap') : snapLabel}</span>
                  </span>
                );
              }

              if (hasUnread) {
                return (
                  <span className="inline-flex items-center gap-1.5 text-[13px] font-bold text-slate-900 dark:text-white truncate">
                    <MessageSquare className="w-3 h-3 fill-[#0E8CFF] text-[#0E8CFF] shrink-0" />
                    <span className="truncate">
                      {chat.lastMessageText || 'New Chat'}
                    </span>
                  </span>
                );
              }

              return (
                <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 truncate">
                  {isSelfLast && !isSaved && chat.lastMessageKind !== 'system' && (
                    <Send className="w-3 h-3 shrink-0 text-[#0E8CFF]" />
                  )}
                  <span className="truncate">
                    {isSelfLast && chat.lastMessageText && !isSaved ? 'You: ' : ''}
                    {chat.lastMessageText || 'Tap to chat'}
                  </span>
                </span>
              );
            })();

            const isConfirmingDelete = confirmDeleteId === chat.conversationId;

            const showYellowSnapDot =
              isSnapLast && !isSelfLast && !snapOpened && !isSaved;
            const showBlueChatDot =
              !isSnapLast && hasUnread && !isSaved;

            return (
              <div
                key={chat.conversationId}
                onPointerDown={(e) => {
                  swipeRowStartRef.current = {
                    id: chat.conversationId,
                    x: e.clientX,
                    y: e.clientY,
                  };
                }}
                onPointerUp={(e) => {
                  const start = swipeRowStartRef.current;
                  swipeRowStartRef.current = null;
                  if (!start || start.id !== chat.conversationId) return;
                  const dx = e.clientX - start.x;
                  const dy = Math.abs(e.clientY - start.y);
                  if (dx > 56 && dy < 40) {
                    onOpenCameraForChat(chat.conversationId);
                  }
                }}
                className={`group w-full min-h-[76px] px-2.5 py-2 rounded-2xl flex items-center gap-2 transition-colors touch-pan-y ${
                  isSelected
                    ? 'bg-[#FFFDE7] dark:bg-white/10'
                    : 'hover:bg-[#F7F7F7] dark:hover:bg-white/5'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectChat(chat.conversationId)}
                  className="flex-1 min-w-0 flex items-center gap-3 text-left cursor-pointer"
                >
                  <div className="relative shrink-0">
                    <Avatar
                      name={displayTitle}
                      photoURL={displayPhoto}
                      avatarSeed={peer?.avatarSeed}
                      size="lg"
                      isOnline={isPeerOnline}
                      isGroup={chat.type === 'group'}
                      isSaved={isSaved}
                    />
                    {showYellowSnapDot && (
                      <span
                        title="New Snap"
                        className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-[#FFFC00] ring-2 ring-white dark:ring-[#141414] shadow-xs"
                      />
                    )}
                    {!showYellowSnapDot && showBlueChatDot && (
                      <span
                        title="New Chat"
                        className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-[#0E8CFF] ring-2 ring-white dark:ring-[#141414]"
                      />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className={`text-[15px] truncate tracking-[-0.02em] ${
                            hasUnread
                              ? 'font-extrabold text-slate-900 dark:text-white'
                              : 'font-bold text-slate-900 dark:text-slate-100'
                          }`}
                        >
                          {displayTitle}
                        </span>
                        {streak.active && (
                          <span
                            title={
                              streak.hourglass
                                ? 'Snap soon before your streak expires!'
                                : `${streak.count}-day Snapstreak`
                            }
                            className="inline-flex items-center gap-0.5 text-[11px] font-semibold font-mono-tabular text-amber-500 shrink-0"
                          >
                            <Flame className="w-3 h-3 fill-amber-500" />
                            <span>{streak.count}</span>
                            {streak.hourglass && (
                              <Hourglass className="w-3 h-3 text-orange-500 animate-pulse" />
                            )}
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] font-mono-tabular text-slate-400 dark:text-slate-500 shrink-0">
                        {formatConversationTime(chat.lastMessageAt)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      {snapStatusNode}

                      <div className="flex items-center gap-1 shrink-0">
                        {showYellowSnapDot && (
                          <span className="w-2 h-2 rounded-full bg-[#FFFC00] ring-1 ring-slate-900/20" />
                        )}
                        {!showYellowSnapDot && showBlueChatDot && (
                          <span className="w-2 h-2 rounded-full bg-[#0E8CFF]" />
                        )}
                        {chat.muted && <BellOff className="w-3 h-3 text-slate-400" />}
                        {chat.pinned && <Pin className="w-3 h-3 text-slate-400" />}
                      </div>
                    </div>
                  </div>
                </button>

                {/* Quick Snap Camera / Delete Chat */}
                <div className="flex items-center gap-0.5 shrink-0">
                  {!isSaved && (
                    isConfirmingDelete ? (
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmDeleteId(null);
                          void onDeleteChat(chat.conversationId);
                        }}
                        onBlur={() => setConfirmDeleteId(null)}
                        className="h-8 px-2 rounded-xl bg-rose-600 text-white text-[10px] font-bold cursor-pointer"
                      >
                        Delete
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(chat.conversationId)}
                        title={`Delete ${displayTitle}`}
                        aria-label={`Delete ${displayTitle}`}
                        className="w-8 h-8 rounded-2xl text-slate-300 dark:text-slate-600 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 flex items-center justify-center transition-all cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )
                  )}

                  <button
                    type="button"
                    onClick={() => onOpenCameraForChat(chat.conversationId)}
                    title={`Snap ${displayTitle}`}
                    aria-label={`Snap ${displayTitle}`}
                    className="w-9 h-9 rounded-full bg-[#FFFC00] text-black hover:bg-[#F2EF00] flex items-center justify-center snap-press cursor-pointer shrink-0"
                  >
                    <Camera className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

