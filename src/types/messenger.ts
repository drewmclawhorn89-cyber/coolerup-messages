import type { Timestamp } from 'firebase/firestore';

export type ChatThemeId = 'azure' | 'emerald' | 'coral' | 'violet' | 'slate';

export interface ChatThemeConfig {
  id: ChatThemeId;
  label: string;
  swatchHex: string;
  bubbleBg: string;
  bubbleText: string;
  accentText: string;
  accentBgSoft: string;
  ringClass: string;
}

export const CHAT_THEMES: Record<ChatThemeId, ChatThemeConfig> = {
  azure: {
    id: 'azure',
    label: 'Snap Blue',
    swatchHex: '#00A6FF',
    bubbleBg: 'bg-[#0095FF] dark:bg-[#0EA5E9]',
    bubbleText: 'text-white',
    accentText: 'text-[#0088E8] dark:text-[#38BDF8]',
    accentBgSoft: 'bg-[#00A6FF]/12 dark:bg-[#0EA5E9]/20',
    ringClass: 'ring-[#00A6FF]',
  },
  emerald: {
    id: 'emerald',
    label: 'Mint Emerald',
    swatchHex: '#059669',
    bubbleBg: 'bg-[#059669] dark:bg-[#10B981]',
    bubbleText: 'text-white',
    accentText: 'text-[#059669] dark:text-[#34D399]',
    accentBgSoft: 'bg-[#059669]/10 dark:bg-[#10B981]/20',
    ringClass: 'ring-[#059669]',
  },
  coral: {
    id: 'coral',
    label: 'Snap Crimson',
    swatchHex: '#F43F5E',
    bubbleBg: 'bg-[#F43F5E] dark:bg-[#FB7185]',
    bubbleText: 'text-white',
    accentText: 'text-[#E11D48] dark:text-[#FB7185]',
    accentBgSoft: 'bg-[#F43F5E]/10 dark:bg-[#FB7185]/20',
    ringClass: 'ring-[#F43F5E]',
  },
  violet: {
    id: 'violet',
    label: 'Story Violet',
    swatchHex: '#7C3AED',
    bubbleBg: 'bg-[#7C3AED] dark:bg-[#8B5CF6]',
    bubbleText: 'text-white',
    accentText: 'text-[#7C3AED] dark:text-[#A78BFA]',
    accentBgSoft: 'bg-[#7C3AED]/10 dark:bg-[#8B5CF6]/20',
    ringClass: 'ring-[#7C3AED]',
  },
  slate: {
    id: 'slate',
    label: 'Graphite Slate',
    swatchHex: '#334155',
    bubbleBg: 'bg-[#1E293B] dark:bg-[#334155]',
    bubbleText: 'text-white',
    accentText: 'text-[#334155] dark:text-[#CBD5E1]',
    accentBgSoft: 'bg-slate-500/10 dark:bg-slate-400/20',
    ringClass: 'ring-slate-600',
  },
};

export interface PublicProfile {
  uid: string;
  displayName: string;
  displayNameLower: string;
  handle: string;
  photoURL: string;
  avatarSeed?: string;
  statusText: string;
  snapScore?: number;
  isOnline: boolean;
  isDiscoverable: boolean;
  lastSeenAt: Timestamp | null;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface PrivateUserInfo {
  uid: string;
  email: string;
  themeMode: 'light' | 'dark';
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export type FriendshipStatus = 'pending' | 'accepted' | 'declined';

export interface Friendship {
  id: string;
  userIds: string[];
  requesterId: string;
  receiverId: string;
  status: FriendshipStatus;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export type MessageKind = 'text' | 'image' | 'sticker' | 'snap' | 'voice' | 'system';
export type MediaType = 'photo' | 'video' | 'audio' | 'text';
export type SnapStatus = 'sent' | 'delivered' | 'opened' | 'replayed' | 'screenshotted';

export interface UserChatIndex {
  conversationId: string;
  userId: string;
  type: 'direct' | 'group';
  title: string;
  photoURL: string;
  peerUid: string;
  themeId: ChatThemeId;
  quickEmoji: string;
  lastMessageKind?: MessageKind;
  lastMediaType?: MediaType;
  lastSnapStatus?: SnapStatus;
  lastSnapOpened?: boolean;
  streakCount?: number;
  lastSnapAt?: Timestamp | null;
  lastMessageText: string;
  lastMessageSenderId: string;
  lastMessageSenderName: string;
  lastMessageAt: Timestamp | null;
  lastReadAt: Timestamp | null;
  unreadCount: number;
  pinned: boolean;
  muted: boolean;
  archived: boolean;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface Conversation {
  id: string;
  type: 'direct' | 'group';
  title: string;
  createdBy: string;
  memberIds: string[];
  themeId: ChatThemeId;
  quickEmoji: string;
  lastMessageKind?: MessageKind;
  lastMediaType?: MediaType;
  lastSnapStatus?: SnapStatus;
  streakCount?: number;
  lastSnapAt?: Timestamp | null;
  lastMessageText: string;
  lastMessageSenderId: string;
  lastMessageSenderName: string;
  lastMessageAt: Timestamp | null;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface ConversationMember {
  uid: string;
  conversationId: string;
  displayName: string;
  photoURL: string;
  role: 'admin' | 'member';
  memberIds: string[];
  isTyping: boolean;
  typingAt: Timestamp | null;
  lastReadAt: Timestamp | null;
  joinedAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  senderPhotoURL: string;
  memberIds: string[];
  kind: MessageKind;
  mediaType?: MediaType;
  text: string;
  imageData: string;
  snapDurationSec?: number;
  snapStatus?: SnapStatus;
  snapViewedBy?: string[];
  snapReplayedBy?: string[];
  snapScreenshottedBy?: string[];
  savedBy?: string[];
  replyToId: string;
  replyToSenderName: string;
  replyToText: string;
  reactions: Record<string, string>;
  edited: boolean;
  deleted: boolean;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface Story {
  id: string;
  authorId: string;
  authorName: string;
  authorHandle: string;
  authorPhotoURL: string;
  mediaType?: 'photo' | 'video';
  imageData: string;
  caption: string;
  durationSec: number;
  viewerIds: string[];
  isPublicStory: boolean;
  expiresAt: Timestamp | null;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface SpotlightVideo {
  id: string;
  authorId: string;
  authorName: string;
  authorHandle: string;
  authorPhotoURL: string;
  authorAvatarSeed?: string;
  videoData: string;
  chunkCount?: number;
  resolution?: string;
  soundTrackId?: string;
  caption: string;
  soundTitle: string;
  likedBy: string[];
  viewCount: number;
  isPublic: boolean;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export type NavTab = 'chats' | 'camera' | 'stories' | 'spotlight' | 'people' | 'archived' | 'video';
export type ChatFilter = 'all' | 'snaps' | 'unread' | 'groups';
