import { Timestamp } from 'firebase/firestore';
import type {
  ChatThemeId,
  Conversation,
  ConversationMember,
  Friendship,
  MediaType,
  Message,
  MessageKind,
  PrivateUserInfo,
  PublicProfile,
  SnapStatus,
  SpotlightVideo,
  Story,
  UserChatIndex,
} from '../types/messenger';
import { clampText, LIMITS } from './validation';

const DB_NAME = 'coolerup_local_cache_v1';
const STORE_NAME = 'kv';

const memoryCache = new Map<string, unknown>();
const localEvents = new EventTarget();
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openLocalDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function serializeForIdb(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Timestamp) {
    return { __ts: true, seconds: value.seconds, nanoseconds: value.nanoseconds };
  }
  if (Array.isArray(value)) {
    return value.map(serializeForIdb);
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (
      typeof record.seconds === 'number' &&
      typeof record.nanoseconds === 'number' &&
      typeof record.toMillis === 'function'
    ) {
      return { __ts: true, seconds: record.seconds, nanoseconds: record.nanoseconds };
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(record)) {
      out[k] = serializeForIdb(v);
    }
    return out;
  }
  return value;
}

function reviveTimestamps<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (value instanceof Timestamp) return value;
  if (Array.isArray(value)) {
    return value.map((item) => reviveTimestamps(item)) as unknown as T;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (
      (record.__ts === true ||
        (typeof record.seconds === 'number' &&
          typeof record.nanoseconds === 'number' &&
          Object.keys(record).length <= 3)) &&
      typeof record.seconds === 'number' &&
      typeof record.nanoseconds === 'number'
    ) {
      return new Timestamp(record.seconds, record.nanoseconds) as unknown as T;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(record)) {
      out[k] = reviveTimestamps(v);
    }
    return out as T;
  }
  return value;
}

function emitKeyChange(key: string): void {
  localEvents.dispatchEvent(new CustomEvent('change', { detail: { key } }));
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  if (memoryCache.has(key)) {
    return reviveTimestamps(memoryCache.get(key) as T);
  }
  const db = await openLocalDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => {
        if (req.result === undefined) {
          resolve(null);
        } else {
          const revived = reviveTimestamps(req.result as T);
          memoryCache.set(key, revived);
          resolve(revived);
        }
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function cacheSet(key: string, value: unknown, notify = false): Promise<void> {
  const revived = reviveTimestamps(value);
  memoryCache.set(key, revived);
  if (notify) {
    emitKeyChange(key);
  }
  const db = await openLocalDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(serializeForIdb(revived), key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export function subscribeLocalCacheKey<T>(
  key: string,
  onData: (val: T | null) => void
): () => void {
  let active = true;
  void cacheGet<T>(key).then((val) => {
    if (active && val !== null) onData(val);
  });

  const handler = (ev: Event) => {
    const detail = (ev as CustomEvent<{ key?: string }>).detail;
    if (detail?.key === key) {
      void cacheGet<T>(key).then((val) => {
        if (active) onData(val);
      });
    }
  };
  localEvents.addEventListener('change', handler);
  return () => {
    active = false;
    localEvents.removeEventListener('change', handler);
  };
}

function makeLocalId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function bootstrapLocalSavedChat(profile: PublicProfile): Promise<void> {
  const convId = `saved_${profile.uid}`;
  const now = Timestamp.now();

  const existingChats = (await cacheGet<UserChatIndex[]>(`chats_${profile.uid}`)) || [];
  if (!existingChats.some((c) => c.conversationId === convId)) {
    const savedIndex: UserChatIndex = {
      conversationId: convId,
      userId: profile.uid,
      type: 'direct',
      title: 'Saved Snaps',
      photoURL: profile.photoURL,
      peerUid: profile.uid,
      themeId: 'azure',
      quickEmoji: '👻',
      lastMessageKind: 'system',
      lastMediaType: 'text',
      lastSnapStatus: 'sent',
      lastSnapOpened: true,
      streakCount: 0,
      lastMessageText: 'Private space for notes, photos, and reminders.',
      lastMessageSenderId: profile.uid,
      lastMessageSenderName: profile.displayName,
      lastMessageAt: now,
      lastReadAt: now,
      unreadCount: 0,
      pinned: true,
      muted: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
    await cacheSet(`chats_${profile.uid}`, [savedIndex, ...existingChats], true);
  }

  const existingConv = await cacheGet<Conversation>(`conv_${convId}`);
  if (!existingConv) {
    const conv: Conversation = {
      id: convId,
      type: 'direct',
      title: 'Saved Snaps',
      createdBy: profile.uid,
      memberIds: [profile.uid],
      themeId: 'azure',
      quickEmoji: '👻',
      lastMessageKind: 'system',
      lastMediaType: 'text',
      lastSnapStatus: 'sent',
      streakCount: 0,
      lastMessageText: 'Private space for notes, photos, and reminders.',
      lastMessageSenderId: profile.uid,
      lastMessageSenderName: profile.displayName,
      lastMessageAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await cacheSet(`conv_${convId}`, conv, true);
  }

  const existingMembers = await cacheGet<ConversationMember[]>(`members_${convId}`);
  if (!existingMembers || existingMembers.length === 0) {
    const member: ConversationMember = {
      uid: profile.uid,
      conversationId: convId,
      displayName: profile.displayName,
      photoURL: profile.photoURL,
      role: 'admin',
      memberIds: [profile.uid],
      isTyping: false,
      typingAt: now,
      lastReadAt: now,
      joinedAt: now,
      updatedAt: now,
    };
    await cacheSet(`members_${convId}`, [member], true);
  }

  const existingMsgs = await cacheGet<Message[]>(`messages_${convId}`);
  if (!existingMsgs) {
    await cacheSet(`messages_${convId}`, [], true);
  }
}

export async function saveLocalProfile(profile: PublicProfile): Promise<void> {
  await cacheSet(`profile_${profile.uid}`, profile, true);
  const profiles = (await cacheGet<PublicProfile[]>('profiles')) || [];
  const next = profiles.some((p) => p.uid === profile.uid)
    ? profiles.map((p) => (p.uid === profile.uid ? profile : p))
    : [profile, ...profiles];
  await cacheSet('profiles', next, true);
}

export async function saveLocalPrivateInfo(priv: PrivateUserInfo): Promise<void> {
  await cacheSet(`private_${priv.uid}`, priv, true);
}

export async function updateLocalProfile(
  uid: string,
  updates: Partial<PublicProfile>
): Promise<void> {
  const current = await cacheGet<PublicProfile>(`profile_${uid}`);
  if (current) {
    await saveLocalProfile({ ...current, ...updates, updatedAt: Timestamp.now() });
  }
}

export async function updateLocalThemePreference(
  uid: string,
  themeMode: 'light' | 'dark'
): Promise<void> {
  const current = await cacheGet<PrivateUserInfo>(`private_${uid}`);
  if (current) {
    await saveLocalPrivateInfo({ ...current, themeMode, updatedAt: Timestamp.now() });
  }
}

export async function upsertLocalDirectChat(
  me: PublicProfile,
  peer: PublicProfile,
  conversationId: string
): Promise<string> {
  if (me.uid === peer.uid) {
    await bootstrapLocalSavedChat(me);
    return `saved_${me.uid}`;
  }
  const now = Timestamp.now();
  const memberIds = [me.uid, peer.uid].sort();

  let conv = await cacheGet<Conversation>(`conv_${conversationId}`);
  if (!conv) {
    conv = {
      id: conversationId,
      type: 'direct',
      title: `${me.displayName} & ${peer.displayName}`.slice(0, LIMITS.TITLE_MAX),
      createdBy: me.uid,
      memberIds,
      themeId: 'azure',
      quickEmoji: '👻',
      lastMessageKind: 'system',
      lastMediaType: 'text',
      lastSnapStatus: 'sent',
      streakCount: 0,
      lastMessageText: 'Say hi or send a Snap',
      lastMessageSenderId: me.uid,
      lastMessageSenderName: me.displayName,
      lastMessageAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await cacheSet(`conv_${conversationId}`, conv, true);
    await cacheSet(
      `members_${conversationId}`,
      [
        {
          uid: me.uid,
          conversationId,
          displayName: me.displayName,
          photoURL: me.photoURL,
          role: 'member',
          memberIds,
          isTyping: false,
          typingAt: now,
          lastReadAt: now,
          joinedAt: now,
          updatedAt: now,
        },
        {
          uid: peer.uid,
          conversationId,
          displayName: peer.displayName,
          photoURL: peer.photoURL,
          role: 'member',
          memberIds,
          isTyping: false,
          typingAt: now,
          lastReadAt: now,
          joinedAt: now,
          updatedAt: now,
        },
      ] satisfies ConversationMember[],
      true
    );
    await cacheSet(`messages_${conversationId}`, [], true);
  }

  const myChats = (await cacheGet<UserChatIndex[]>(`chats_${me.uid}`)) || [];
  if (!myChats.some((c) => c.conversationId === conversationId)) {
    const newIndex: UserChatIndex = {
      conversationId,
      userId: me.uid,
      type: 'direct',
      title: peer.displayName.slice(0, LIMITS.TITLE_MAX),
      photoURL: peer.photoURL,
      peerUid: peer.uid,
      themeId: conv.themeId,
      quickEmoji: conv.quickEmoji,
      lastMessageKind: conv.lastMessageKind || 'system',
      lastMediaType: conv.lastMediaType || 'text',
      lastSnapStatus: conv.lastSnapStatus || 'sent',
      lastSnapOpened: true,
      streakCount: conv.streakCount || 0,
      lastMessageText: conv.lastMessageText,
      lastMessageSenderId: conv.lastMessageSenderId,
      lastMessageSenderName: conv.lastMessageSenderName,
      lastMessageAt: conv.lastMessageAt || now,
      lastReadAt: now,
      unreadCount: 0,
      pinned: false,
      muted: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
    await cacheSet(`chats_${me.uid}`, [newIndex, ...myChats], true);
  }
  return conversationId;
}

export async function createLocalGroupChat(
  me: PublicProfile,
  title: string,
  peers: PublicProfile[]
): Promise<string> {
  const uniquePeers = peers.filter((p) => p.uid !== me.uid).slice(0, LIMITS.MEMBERS_MAX - 1);
  const allMembers = [me, ...uniquePeers];
  const memberIds = allMembers.map((m) => m.uid);
  const cleanTitle =
    clampText(title, LIMITS.TITLE_MAX) ||
    allMembers
      .map((m) => m.displayName.split(' ')[0])
      .join(', ')
      .slice(0, LIMITS.TITLE_MAX);
  const conversationId = makeLocalId('grp_local');
  const now = Timestamp.now();

  const conv: Conversation = {
    id: conversationId,
    type: 'group',
    title: cleanTitle,
    createdBy: me.uid,
    memberIds,
    themeId: 'azure',
    quickEmoji: '👻',
    lastMessageKind: 'system',
    lastMediaType: 'text',
    lastSnapStatus: 'sent',
    streakCount: 0,
    lastMessageText: `${me.displayName} created the group`,
    lastMessageSenderId: me.uid,
    lastMessageSenderName: me.displayName,
    lastMessageAt: now,
    createdAt: now,
    updatedAt: now,
  };

  await cacheSet(`conv_${conversationId}`, conv, true);
  await cacheSet(
    `members_${conversationId}`,
    allMembers.map((member) => ({
      uid: member.uid,
      conversationId,
      displayName: member.displayName,
      photoURL: member.photoURL,
      role: member.uid === me.uid ? 'admin' : 'member',
      memberIds,
      isTyping: false,
      typingAt: now,
      lastReadAt: now,
      joinedAt: now,
      updatedAt: now,
    })) satisfies ConversationMember[],
    true
  );
  await cacheSet(`messages_${conversationId}`, [], true);

  const myChats = (await cacheGet<UserChatIndex[]>(`chats_${me.uid}`)) || [];
  const indexItem: UserChatIndex = {
    conversationId,
    userId: me.uid,
    type: 'group',
    title: cleanTitle,
    photoURL: '',
    peerUid: '',
    themeId: 'azure',
    quickEmoji: '👻',
    lastMessageKind: 'system',
    lastMediaType: 'text',
    lastSnapStatus: 'sent',
    lastSnapOpened: true,
    streakCount: 0,
    lastMessageText: `${me.displayName} created the group`,
    lastMessageSenderId: me.uid,
    lastMessageSenderName: me.displayName,
    lastMessageAt: now,
    lastReadAt: now,
    unreadCount: 0,
    pinned: false,
    muted: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  await cacheSet(`chats_${me.uid}`, [indexItem, ...myChats], true);
  return conversationId;
}

export async function appendLocalMessage(params: {
  conversation: Conversation;
  sender: PublicProfile;
  kind: MessageKind;
  mediaType: MediaType;
  text: string;
  imageData: string;
  snapDurationSec: number;
  previewText: string;
  nextStreak: number;
  replyTo?: { id: string; senderName: string; text: string } | null;
}): Promise<void> {
  const {
    conversation,
    sender,
    kind,
    mediaType,
    text,
    imageData,
    snapDurationSec,
    previewText,
    nextStreak,
    replyTo,
  } = params;
  const now = Timestamp.now();
  const isSnap = kind === 'snap';
  const isSelfChat = conversation.id === `saved_${sender.uid}`;
  const nextStatus: SnapStatus = 'delivered';

  const msg: Message = {
    id: makeLocalId('msg'),
    conversationId: conversation.id,
    senderId: sender.uid,
    senderName: sender.displayName,
    senderPhotoURL: sender.photoURL,
    memberIds: conversation.memberIds,
    kind,
    mediaType,
    text,
    imageData,
    snapDurationSec: isSnap ? snapDurationSec : 0,
    snapStatus: nextStatus,
    snapViewedBy: isSnap ? [sender.uid] : [],
    snapReplayedBy: [],
    snapScreenshottedBy: [],
    savedBy: isSelfChat ? [sender.uid] : [],
    replyToId: replyTo ? replyTo.id.slice(0, LIMITS.ID_MAX) : '',
    replyToSenderName: replyTo ? replyTo.senderName.slice(0, LIMITS.DISPLAY_NAME_MAX) : '',
    replyToText: replyTo ? replyTo.text.slice(0, LIMITS.REPLY_TEXT_MAX) : '',
    reactions: {},
    edited: false,
    deleted: false,
    createdAt: now,
    updatedAt: now,
  };

  const existingMsgs = (await cacheGet<Message[]>(`messages_${conversation.id}`)) || [];
  await cacheSet(`messages_${conversation.id}`, [...existingMsgs, msg], true);

  const updatedConv: Conversation = {
    ...conversation,
    lastMessageKind: kind,
    lastMediaType: mediaType,
    lastSnapStatus: nextStatus,
    streakCount: nextStreak,
    ...(isSnap ? { lastSnapAt: now } : {}),
    lastMessageText: previewText,
    lastMessageSenderId: sender.uid,
    lastMessageSenderName: sender.displayName,
    lastMessageAt: now,
    updatedAt: now,
  };
  await cacheSet(`conv_${conversation.id}`, updatedConv, true);

  const myChats = (await cacheGet<UserChatIndex[]>(`chats_${sender.uid}`)) || [];
  const nextChats = myChats
    .map((c) =>
      c.conversationId === conversation.id
        ? {
            ...c,
            lastMessageKind: kind,
            lastMediaType: mediaType,
            lastSnapStatus: nextStatus,
            lastSnapOpened: isSnap ? isSelfChat : true,
            streakCount: nextStreak,
            ...(isSnap ? { lastSnapAt: now } : {}),
            lastMessageText: previewText,
            lastMessageSenderId: sender.uid,
            lastMessageSenderName: sender.displayName,
            lastMessageAt: now,
            lastReadAt: now,
            unreadCount: 0,
            archived: false,
            updatedAt: now,
          }
        : c
    )
    .sort((a, b) => (b.lastMessageAt?.toMillis?.() ?? 0) - (a.lastMessageAt?.toMillis?.() ?? 0));
  await cacheSet(`chats_${sender.uid}`, nextChats, true);
}

export async function updateLocalMessageById(
  conversationId: string,
  messageId: string,
  updater: (msg: Message) => Message
): Promise<void> {
  const existing = (await cacheGet<Message[]>(`messages_${conversationId}`)) || [];
  const next = existing.map((m) => (m.id === messageId ? updater(m) : m));
  await cacheSet(`messages_${conversationId}`, next, true);
}

export async function createLocalStory(params: {
  author: PublicProfile;
  mediaType: 'photo' | 'video';
  imageData: string;
  caption: string;
  durationSec: number;
}): Promise<string> {
  const now = Timestamp.now();
  const storyId = makeLocalId('story');
  const story: Story = {
    id: storyId,
    authorId: params.author.uid,
    authorName: params.author.displayName,
    authorHandle: params.author.handle,
    authorPhotoURL: params.author.photoURL,
    mediaType: params.mediaType,
    imageData: params.imageData.slice(0, LIMITS.IMAGE_DATA_MAX),
    caption: params.caption.trim().slice(0, LIMITS.STORY_CAPTION_MAX),
    durationSec: Math.min(30, Math.max(1, params.durationSec)),
    viewerIds: [],
    isPublicStory: true,
    expiresAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000),
    createdAt: now,
    updatedAt: now,
  };
  const stories = (await cacheGet<Story[]>('stories')) || [];
  await cacheSet('stories', [story, ...stories], true);
  return storyId;
}

export async function deleteLocalStory(storyId: string): Promise<void> {
  const stories = (await cacheGet<Story[]>('stories')) || [];
  await cacheSet(
    'stories',
    stories.filter((s) => s.id !== storyId),
    true
  );
}

export async function createLocalSpotlightVideo(params: {
  author: PublicProfile;
  videoData: string;
  caption: string;
  soundTitle: string;
  soundTrackId: string;
  resolution: string;
}): Promise<string> {
  const now = Timestamp.now();
  const id = makeLocalId('spot');
  const video: SpotlightVideo = {
    id,
    authorId: params.author.uid,
    authorName: params.author.displayName.slice(0, LIMITS.DISPLAY_NAME_MAX),
    authorHandle: params.author.handle.slice(0, LIMITS.HANDLE_MAX),
    authorPhotoURL: params.author.photoURL.slice(0, LIMITS.PHOTO_URL_MAX),
    authorAvatarSeed: (params.author.avatarSeed || '').slice(0, LIMITS.AVATAR_SEED_MAX),
    videoData: params.videoData,
    chunkCount: 0,
    resolution: params.resolution.slice(0, LIMITS.RESOLUTION_MAX),
    soundTrackId: params.soundTrackId.slice(0, LIMITS.SOUND_TRACK_ID_MAX),
    caption: params.caption.trim().slice(0, LIMITS.STORY_CAPTION_MAX),
    soundTitle: params.soundTitle.trim().slice(0, LIMITS.SOUND_TITLE_MAX),
    likedBy: [],
    viewCount: 0,
    isPublic: true,
    createdAt: now,
    updatedAt: now,
  };
  const videos = (await cacheGet<SpotlightVideo[]>('spotlightVideos')) || [];
  await cacheSet('spotlightVideos', [video, ...videos], true);
  return id;
}

export async function updateLocalSpotlightVideo(
  videoId: string,
  updater: (v: SpotlightVideo) => SpotlightVideo
): Promise<void> {
  const videos = (await cacheGet<SpotlightVideo[]>('spotlightVideos')) || [];
  await cacheSet(
    'spotlightVideos',
    videos.map((v) => (v.id === videoId ? updater(v) : v)),
    true
  );
}

export async function deleteLocalSpotlightVideo(videoId: string): Promise<void> {
  const videos = (await cacheGet<SpotlightVideo[]>('spotlightVideos')) || [];
  await cacheSet(
    'spotlightVideos',
    videos.filter((v) => v.id !== videoId),
    true
  );
}

export async function upsertLocalFriendRequest(
  uid: string,
  friendshipId: string,
  meUid: string,
  peerUid: string
): Promise<void> {
  const now = Timestamp.now();
  const list = (await cacheGet<Friendship[]>(`friendships_${uid}`)) || [];
  const exists = list.some((f) => f.id === friendshipId);
  const next: Friendship[] = exists
    ? list.map((f) =>
        f.id === friendshipId
          ? { ...f, requesterId: meUid, receiverId: peerUid, status: 'pending', updatedAt: now }
          : f
      )
    : [
        {
          id: friendshipId,
          userIds: [meUid, peerUid].sort(),
          requesterId: meUid,
          receiverId: peerUid,
          status: 'pending',
          createdAt: now,
          updatedAt: now,
        },
        ...list,
      ];
  await cacheSet(`friendships_${uid}`, next, true);
}

export async function respondLocalFriendRequest(
  uid: string,
  friendshipId: string,
  accept: boolean
): Promise<void> {
  const list = (await cacheGet<Friendship[]>(`friendships_${uid}`)) || [];
  const next: Friendship[] = list.map((f) =>
    f.id === friendshipId
      ? { ...f, status: accept ? 'accepted' : 'declined', updatedAt: Timestamp.now() }
      : f
  );
  await cacheSet(`friendships_${uid}`, next, true);
}

export async function removeLocalFriendship(uid: string, friendshipId: string): Promise<void> {
  const list = (await cacheGet<Friendship[]>(`friendships_${uid}`)) || [];
  await cacheSet(
    `friendships_${uid}`,
    list.filter((f) => f.id !== friendshipId),
    true
  );
}

export async function updateLocalUserChatIndex(
  uid: string,
  conversationId: string,
  updates: Partial<UserChatIndex>
): Promise<void> {
  const list = (await cacheGet<UserChatIndex[]>(`chats_${uid}`)) || [];
  const next = list.map((c) =>
    c.conversationId === conversationId ? { ...c, ...updates, updatedAt: Timestamp.now() } : c
  );
  await cacheSet(`chats_${uid}`, next, true);
}

export async function deleteLocalUserChat(uid: string, conversationId: string): Promise<void> {
  const list = (await cacheGet<UserChatIndex[]>(`chats_${uid}`)) || [];
  await cacheSet(
    `chats_${uid}`,
    list.filter((c) => c.conversationId !== conversationId),
    true
  );
}

export async function updateLocalConversation(
  conversationId: string,
  updates: Partial<Conversation>
): Promise<void> {
  const conv = await cacheGet<Conversation>(`conv_${conversationId}`);
  if (conv) {
    await cacheSet(`conv_${conversationId}`, { ...conv, ...updates, updatedAt: Timestamp.now() }, true);
  }
}

export async function updateLocalAppearance(
  uid: string,
  conversationId: string,
  updates: { themeId?: ChatThemeId; quickEmoji?: string }
): Promise<void> {
  await updateLocalConversation(conversationId, updates);
  await updateLocalUserChatIndex(uid, conversationId, updates);
}
