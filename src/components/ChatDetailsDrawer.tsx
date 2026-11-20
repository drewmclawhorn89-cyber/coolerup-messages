import { useMemo, useState } from 'react';
import {
  Archive,
  Bell,
  BellOff,
  Check,
  Image as ImageIcon,
  LogOut,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { formatLastSeen } from '../lib/dateFormat';
import { LIMITS } from '../lib/validation';
import {
  CHAT_THEMES,
  type ChatThemeId,
  type Conversation,
  type ConversationMember,
  type Message,
  type PublicProfile,
  type UserChatIndex,
} from '../types/messenger';
import { Avatar } from './Avatar';

const QUICK_EMOJI_OPTIONS = ['👍', '❤️', '🔥', '⚡', '🎉', '😂'];

interface ChatDetailsDrawerProps {
  conversation: Conversation;
  chatIndex: UserChatIndex | undefined;
  members: ConversationMember[];
  messages: Message[];
  currentUser: PublicProfile;
  profilesByUid: Record<string, PublicProfile>;
  allProfiles: PublicProfile[];
  onClose: () => void;
  onUpdateAppearance: (updates: { themeId?: ChatThemeId; quickEmoji?: string }) => Promise<void>;
  onUpdateFlags: (flags: { pinned?: boolean; muted?: boolean; archived?: boolean }) => Promise<void>;
  onRenameGroup: (newTitle: string) => Promise<void>;
  onAddMember: (member: PublicProfile) => Promise<void>;
  onLeaveGroup: () => Promise<void>;
  onDeleteChat: () => Promise<void>;
  onOpenImageLightbox: (imageData: string) => void;
}

export function ChatDetailsDrawer({
  conversation,
  chatIndex,
  members,
  messages,
  currentUser,
  profilesByUid,
  allProfiles,
  onClose,
  onUpdateAppearance,
  onUpdateFlags,
  onRenameGroup,
  onAddMember,
  onLeaveGroup,
  onDeleteChat,
  onOpenImageLightbox,
}: ChatDetailsDrawerProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(conversation.title);
  const [showAddMember, setShowAddMember] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDeleteChat, setConfirmDeleteChat] = useState(false);

  const isSaved = conversation.id === `saved_${currentUser.uid}`;
  const peerUid = chatIndex?.peerUid || conversation.memberIds.find((id) => id !== currentUser.uid) || '';
  const peerProfile = peerUid ? profilesByUid[peerUid] : undefined;

  const displayTitle = isSaved
    ? 'Saved Snaps'
    : conversation.type === 'group'
    ? conversation.title
    : peerProfile?.displayName || chatIndex?.title || conversation.title;

  const sharedImages = useMemo(
    () => messages.filter((m) => !m.deleted && m.imageData),
    [messages]
  );

  const addableProfiles = useMemo(
    () =>
      allProfiles.filter(
        (p) => !conversation.memberIds.includes(p.uid)
      ),
    [allProfiles, conversation.memberIds]
  );

  const handleSaveTitle = async () => {
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== conversation.title) {
      await onRenameGroup(trimmed);
    }
    setEditingTitle(false);
  };

  return (
    <aside className="fixed inset-y-0 right-0 z-40 w-[310px] xl:static xl:w-[300px] shrink-0 bg-white dark:bg-[#141414] border-l border-slate-100 dark:border-white/10/80 flex flex-col h-full shadow-xl xl:shadow-none">
      <div className="h-16 px-4 border-b border-slate-100 dark:border-white/10 flex items-center justify-between shrink-0">
        <span className="font-display text-[15px] font-extrabold tracking-[-0.03em] text-slate-900 dark:text-white">
          Conversation Info
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="w-9 h-9 rounded-2xl hover:bg-[#F7F7F7] dark:hover:bg-white/5 text-slate-500 flex items-center justify-center cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto chat-scroll p-4 space-y-6">
        {/* Profile Header */}
        <div className="flex flex-col items-center text-center pt-2">
          <Avatar
            name={displayTitle}
            photoURL={peerProfile?.photoURL || chatIndex?.photoURL}
            avatarSeed={peerProfile?.avatarSeed}
            size="xl"
            isOnline={Boolean(peerProfile?.isOnline)}
            isGroup={conversation.type === 'group'}
            isSaved={isSaved}
          />

          {conversation.type === 'group' && editingTitle ? (
            <div className="mt-3 flex items-center gap-1.5 w-full">
              <input
                type="text"
                value={titleDraft}
                maxLength={LIMITS.TITLE_MAX}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSaveTitle();
                  if (e.key === 'Escape') setEditingTitle(false);
                }}
                autoFocus
                className="flex-1 h-9 px-3 rounded-xl bg-[#F2F2F2] dark:bg-[#0A0A0A] border border-[#0066FF] text-sm text-slate-900 dark:text-white outline-none"
              />
              <button
                type="button"
                onClick={handleSaveTitle}
                className="w-9 h-9 rounded-xl bg-[#0066FF] text-white flex items-center justify-center cursor-pointer"
              >
                <Check className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="mt-3 flex items-center gap-1.5 max-w-full">
              <h3 className="font-display text-lg font-extrabold tracking-[-0.03em] text-slate-900 dark:text-white truncate">
                {displayTitle}
              </h3>
              {conversation.type === 'group' && (
                <button
                  type="button"
                  onClick={() => {
                    setTitleDraft(conversation.title);
                    setEditingTitle(true);
                  }}
                  aria-label="Rename group"
                  className="w-7 h-7 rounded-xl hover:bg-[#F7F7F7] dark:hover:bg-white/5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 flex items-center justify-center cursor-pointer shrink-0"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {isSaved
              ? 'Private notes & files'
              : conversation.type === 'group'
              ? `${conversation.memberIds.length} members`
              : peerProfile
              ? `@${peerProfile.handle} · ${formatLastSeen(peerProfile.isOnline, peerProfile.lastSeenAt)}`
              : 'Direct chat'}
          </p>
        </div>

        {/* Quick Actions */}
        {chatIndex && (
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => onUpdateFlags({ pinned: !chatIndex.pinned })}
              className={`py-2.5 px-2 rounded-2xl border text-xs font-medium flex flex-col items-center gap-1.5 transition-colors cursor-pointer ${
                chatIndex.pinned
                  ? 'border-[#0066FF] bg-[#0066FF]/10 text-[#0066FF] dark:text-[#60A5FA]'
                  : 'border-slate-100 dark:border-white/10 hover:bg-[#F2F2F2] dark:hover:bg-white/5/60 text-slate-700 dark:text-slate-300'
              }`}
            >
              {chatIndex.pinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
              <span>{chatIndex.pinned ? 'Unpin' : 'Pin'}</span>
            </button>

            <button
              type="button"
              onClick={() => onUpdateFlags({ muted: !chatIndex.muted })}
              className={`py-2.5 px-2 rounded-2xl border text-xs font-medium flex flex-col items-center gap-1.5 transition-colors cursor-pointer ${
                chatIndex.muted
                  ? 'border-[#0066FF] bg-[#0066FF]/10 text-[#0066FF] dark:text-[#60A5FA]'
                  : 'border-slate-100 dark:border-white/10 hover:bg-[#F2F2F2] dark:hover:bg-white/5/60 text-slate-700 dark:text-slate-300'
              }`}
            >
              {chatIndex.muted ? <BellOff className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
              <span>{chatIndex.muted ? 'Muted' : 'Mute'}</span>
            </button>

            <button
              type="button"
              onClick={() => onUpdateFlags({ archived: !chatIndex.archived })}
              className="py-2.5 px-2 rounded-2xl border border-slate-100 dark:border-white/10 hover:bg-[#F2F2F2] dark:hover:bg-white/5/60 text-slate-700 dark:text-slate-300 text-xs font-medium flex flex-col items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Archive className="w-4 h-4" />
              <span>{chatIndex.archived ? 'Unarchive' : 'Archive'}</span>
            </button>
          </div>
        )}

        {/* Chat Theme Accent */}
        <div>
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2.5">
            Chat Theme
          </p>
          <div className="flex items-center gap-2.5">
            {(Object.keys(CHAT_THEMES) as ChatThemeId[]).map((id) => {
              const theme = CHAT_THEMES[id];
              const isSelected = conversation.themeId === id;
              return (
                <button
                  key={id}
                  type="button"
                  title={theme.label}
                  aria-label={`Select ${theme.label} theme`}
                  onClick={() => onUpdateAppearance({ themeId: id })}
                  style={{ backgroundColor: theme.swatchHex }}
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-white transition-transform cursor-pointer ${
                    isSelected ? 'ring-2 ring-offset-2 ring-offset-white dark:ring-offset-[#141414] ring-slate-900 dark:ring-white scale-105' : 'hover:scale-105'
                  }`}
                >
                  {isSelected && <Check className="w-4 h-4" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Quick Reaction Emoji */}
        <div>
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2.5">
            Quick Reaction
          </p>
          <div className="flex items-center gap-1.5">
            {QUICK_EMOJI_OPTIONS.map((emoji) => {
              const isSelected = conversation.quickEmoji === emoji;
              return (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => onUpdateAppearance({ quickEmoji: emoji })}
                  className={`w-9 h-9 rounded-2xl text-lg flex items-center justify-center transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-[#0066FF]/15 ring-1 ring-[#0066FF]'
                      : 'bg-[#F2F2F2] dark:bg-[#0A0A0A] hover:bg-slate-200 dark:hover:bg-white/5'
                  }`}
                >
                  {emoji}
                </button>
              );
            })}
          </div>
        </div>

        {/* Group Members */}
        {conversation.type === 'group' && (
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Members · {members.length}
              </p>
              {conversation.memberIds.length < LIMITS.MEMBERS_MAX && addableProfiles.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAddMember((v) => !v)}
                  className="text-xs font-medium text-[#0066FF] dark:text-[#60A5FA] hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add</span>
                </button>
              )}
            </div>

            {showAddMember && (
              <div className="mb-3 p-2 rounded-2xl bg-[#F2F2F2] dark:bg-[#0A0A0A] border border-slate-100 dark:border-white/10 max-h-40 overflow-y-auto chat-scroll space-y-1">
                {addableProfiles.map((p) => (
                  <button
                    key={p.uid}
                    type="button"
                    onClick={async () => {
                      await onAddMember(p);
                      setShowAddMember(false);
                    }}
                    className="w-full px-2 py-1.5 rounded-xl hover:bg-white dark:hover:bg-white/5 flex items-center gap-2 text-left text-xs cursor-pointer"
                  >
                    <Avatar name={p.displayName} photoURL={p.photoURL} avatarSeed={p.avatarSeed} size="xs" />
                    <span className="truncate font-medium text-slate-800 dark:text-slate-200">
                      {p.displayName}
                    </span>
                  </button>
                ))}
              </div>
            )}

            <div className="space-y-1.5">
              {members.map((member) => {
                const liveProfile = profilesByUid[member.uid];
                return (
                  <div
                    key={member.uid}
                    className="flex items-center justify-between gap-2.5 py-1.5"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar
                        name={liveProfile?.displayName || member.displayName}
                        photoURL={liveProfile?.photoURL || member.photoURL}
                        avatarSeed={liveProfile?.avatarSeed}
                        size="sm"
                        isOnline={Boolean(liveProfile?.isOnline)}
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {liveProfile?.displayName || member.displayName}
                          {member.uid === currentUser.uid ? ' (You)' : ''}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {member.role === 'admin' ? 'Admin' : 'Member'}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="pt-3">
              {!confirmLeave ? (
                <button
                  type="button"
                  onClick={() => setConfirmLeave(true)}
                  className="w-full h-9 rounded-2xl border border-slate-100 dark:border-white/10 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-rose-600 dark:text-rose-400 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Leave Group</span>
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmLeave(false)}
                    className="flex-1 h-9 rounded-2xl border border-slate-100 dark:border-white/10 text-xs font-medium text-slate-600 dark:text-slate-300 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={onLeaveGroup}
                    className="flex-1 h-9 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium cursor-pointer"
                  >
                    Confirm Leave
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Shared Media */}
        <div>
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2.5 flex items-center gap-1.5">
            <ImageIcon className="w-3.5 h-3.5" />
            <span>Shared Photos · {sharedImages.length}</span>
          </p>
          {sharedImages.length === 0 ? (
            <p className="text-xs text-slate-400 dark:text-slate-500">
              Photos shared in this conversation appear here.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-1.5">
              {sharedImages.slice(-9).reverse().map((msg) => (
                <button
                  key={msg.id}
                  type="button"
                  onClick={() => onOpenImageLightbox(msg.imageData)}
                  className="aspect-square rounded-xl overflow-hidden bg-[#F2F2F2] dark:bg-white/10 hover:opacity-90 transition-opacity cursor-pointer"
                >
                  <img
                    src={msg.imageData}
                    alt="Shared media"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Delete Chat */}
        {!isSaved && (
          <div className="pt-2 border-t border-slate-100 dark:border-white/10">
            {!confirmDeleteChat ? (
              <button
                type="button"
                onClick={() => setConfirmDeleteChat(true)}
                className="w-full h-9 rounded-2xl border border-slate-100 dark:border-white/10 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-rose-600 dark:text-rose-400 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Chat</span>
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteChat(false)}
                  className="flex-1 h-9 rounded-2xl border border-slate-100 dark:border-white/10 text-xs font-medium text-slate-600 dark:text-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={onDeleteChat}
                  className="flex-1 h-9 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium cursor-pointer"
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
