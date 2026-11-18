import type { User } from 'firebase/auth';
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  increment,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import {
  auth,
  db,
  handleFirestoreError,
  isQuotaExceededError,
  isWriteQuotaPaused,
  OperationType,
  runFirestoreRead,
  runFirestoreWrite,
} from '../lib/firebase';
import {
  addLocalMemoryItem,
  addLocalNotification,
  addLocalSpotlightComment,
  appendLocalMessage,
  bootstrapLocalSavedChat,
  cacheGet,
  cacheSet,
  clearLocalChatMessages,
  createLocalGroupChat,
  createLocalSpotlightVideo,
  createLocalStory,
  deleteLocalMemoryItem,
  deleteLocalNotification,
  deleteLocalSpotlightComment,
  deleteLocalSpotlightVideo,
  deleteLocalStory,
  deleteLocalUserChat,
  markAllLocalNotificationsRead,
  markLocalNotificationRead,
  removeLocalFriendship,
  respondLocalFriendRequest,
  saveLocalPrivateInfo,
  saveLocalProfile,
  toggleLocalFollowCreator,
  toggleLocalMemoryLock,
  toggleLocalStoryLike,
  updateLocalAppearance,
  updateLocalConversation,
  updateLocalMessageById,
  updateLocalPrivateInfo,
  updateLocalProfile,
  updateLocalSpotlightVideo,
  updateLocalThemePreference,
  updateLocalUserChatIndex,
  upsertLocalDirectChat,
  upsertLocalFriendRequest,
} from '../lib/localFallbackStore';
import { uploadMediaWithFallback } from '../lib/storageService';
import { clampText, LIMITS, sanitizeHandle } from '../lib/validation';
import type {
  AppNotificationType,
  ChatThemeId,
  Conversation,
  ConversationMember,
  MediaType,
  Message,
  MessageKind,
  PrivateUserInfo,
  PublicProfile,
  SnapStatus,
  SpotlightVideo,
} from '../types/messenger';

export function buildDirectConversationId(uidA: string, uidB: string): string {
  if (uidA === uidB) {
    return `saved_${uidA}`;
  }
  const sorted = [uidA, uidB].sort();
  return `dm_${sorted[0]}_${sorted[1]}`;
}

export function buildFriendshipId(uidA: string, uidB: string): string {
  const sorted = [uidA, uidB].sort();
  return `fr_${sorted[0]}_${sorted[1]}`;
}

export async function syncUserOnSignIn(user: User): Promise<{
  profile: PublicProfile;
  privateInfo: PrivateUserInfo;
}> {
  const uid = user.uid;
  const profilePath = `profiles/${uid}`;
  const privatePath = `users/${uid}/private/info`;

  const displayName = clampText(
    user.displayName || user.email?.split('@')[0] || 'CoolerUp User',
    LIMITS.DISPLAY_NAME_MAX
  );
  const photoURL = (user.photoURL || '').slice(0, LIMITS.PHOTO_URL_MAX);
  const email = (user.email || '').slice(0, 254);

  let existingProfile: PublicProfile | null = await cacheGet<PublicProfile>(`profile_${uid}`);
  let quotaHit = false;
  try {
    const snap = await runFirestoreRead(() => getDoc(doc(db, 'profiles', uid)));
    if (snap.exists()) {
      existingProfile = snap.data() as PublicProfile;
    }
  } catch (error) {
    if (isQuotaExceededError(error)) {
      quotaHit = true;
    } else {
      handleFirestoreError(error, OperationType.GET, profilePath);
    }
  }

  if (!existingProfile && !quotaHit) {
    const handleSeed = user.email ? user.email.split('@')[0] : displayName;
    const handle = sanitizeHandle(handleSeed, uid);
    try {
      await runFirestoreWrite(() =>
        setDoc(doc(db, 'profiles', uid), {
          uid,
          displayName,
          displayNameLower: displayName.toLowerCase(),
          handle,
          photoURL,
          avatarSeed: '',
          statusText: 'Snapping on CoolerUp',
          snapScore: 0,
          isOnline: true,
          isDiscoverable: true,
          lastSeenAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    } catch (error) {
      if (isQuotaExceededError(error)) {
        quotaHit = true;
      } else {
        handleFirestoreError(error, OperationType.CREATE, profilePath);
      }
    }
  } else if (existingProfile && !quotaHit && photoURL && photoURL !== existingProfile.photoURL) {
    // Only write on sign-in if the Google avatar URL actually changed (saves write quota on every reload)
    try {
      await runFirestoreWrite(() =>
        updateDoc(doc(db, 'profiles', uid), {
          photoURL,
          updatedAt: serverTimestamp(),
        })
      );
    } catch (error) {
      if (isQuotaExceededError(error)) {
        quotaHit = true;
      } else {
        handleFirestoreError(error, OperationType.UPDATE, profilePath);
      }
    }
  }

  let existingPrivate: PrivateUserInfo | null = await cacheGet<PrivateUserInfo>(`private_${uid}`);
  if (!quotaHit) {
    try {
      const privSnap = await runFirestoreRead(() =>
        getDoc(doc(db, 'users', uid, 'private', 'info'))
      );
      if (privSnap.exists()) {
        existingPrivate = privSnap.data() as PrivateUserInfo;
      }
    } catch (error) {
      if (isQuotaExceededError(error)) {
        quotaHit = true;
      } else {
        handleFirestoreError(error, OperationType.GET, privatePath);
      }
    }
  }

  if (!existingPrivate && !quotaHit && !isWriteQuotaPaused()) {
    try {
      await runFirestoreWrite(() =>
        setDoc(doc(db, 'users', uid, 'private', 'info'), {
          uid,
          email,
          themeMode: 'light',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    } catch (error) {
      if (isQuotaExceededError(error)) {
        quotaHit = true;
      } else {
        handleFirestoreError(error, OperationType.CREATE, privatePath);
      }
    }
  } else if (
    existingPrivate &&
    email &&
    email !== existingPrivate.email &&
    !quotaHit &&
    !isWriteQuotaPaused()
  ) {
    try {
      await runFirestoreWrite(() =>
        updateDoc(doc(db, 'users', uid, 'private', 'info'), {
          email,
          updatedAt: serverTimestamp(),
        })
      );
    } catch (error) {
      if (isQuotaExceededError(error)) {
        quotaHit = true;
      } else {
        handleFirestoreError(error, OperationType.UPDATE, privatePath);
      }
    }
  }

  let finalProfile = existingProfile;
  if (!finalProfile && !quotaHit) {
    try {
      const snap = await runFirestoreRead(() => getDoc(doc(db, 'profiles', uid)));
      if (snap.exists()) finalProfile = snap.data() as PublicProfile;
    } catch (error) {
      if (!isQuotaExceededError(error)) {
        handleFirestoreError(error, OperationType.GET, profilePath);
      }
    }
  }

  let finalPrivate = existingPrivate;
  if (!finalPrivate && !quotaHit) {
    try {
      const snap = await runFirestoreRead(() =>
        getDoc(doc(db, 'users', uid, 'private', 'info'))
      );
      if (snap.exists()) finalPrivate = snap.data() as PrivateUserInfo;
    } catch (error) {
      if (!isQuotaExceededError(error)) {
        handleFirestoreError(error, OperationType.GET, privatePath);
      }
    }
  }

  const resolvedProfile: PublicProfile = finalProfile || {
    uid,
    displayName,
    displayNameLower: displayName.toLowerCase(),
    handle: sanitizeHandle(user.email ? user.email.split('@')[0] : displayName, uid),
    photoURL,
    avatarSeed: '',
    statusText: 'Snapping on CoolerUp',
    snapScore: 0,
    isOnline: true,
    isDiscoverable: true,
    lastSeenAt: null,
    createdAt: null,
    updatedAt: null,
  };

  const resolvedPrivate: PrivateUserInfo = finalPrivate || {
    uid,
    email,
    themeMode: 'light',
    createdAt: null,
    updatedAt: null,
  };

  await saveLocalProfile(resolvedProfile);
  await saveLocalPrivateInfo(resolvedPrivate);
  await bootstrapLocalSavedChat(resolvedProfile);
  if (!quotaHit && !isWriteQuotaPaused()) {
    await ensureSavedMessagesThread(resolvedProfile);
  }

  return { profile: resolvedProfile, privateInfo: resolvedPrivate };
}

async function ensureSavedMessagesThread(profile: PublicProfile): Promise<void> {
  const conversationId = `saved_${profile.uid}`;
  const chatPath = `users/${profile.uid}/chats/${conversationId}`;
  try {
    const chatSnap = await runFirestoreRead(() =>
      getDoc(doc(db, 'users', profile.uid, 'chats', conversationId))
    );
    if (chatSnap.exists()) return;

    const convSnap = await runFirestoreRead(() =>
      getDoc(doc(db, 'conversations', conversationId))
    );
    const batch = writeBatch(db);
    if (!convSnap.exists()) {
      batch.set(doc(db, 'conversations', conversationId), {
        id: conversationId,
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
        lastMessageAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      batch.set(doc(db, 'conversations', conversationId, 'members', profile.uid), {
        uid: profile.uid,
        conversationId,
        displayName: profile.displayName,
        photoURL: profile.photoURL,
        role: 'admin',
        memberIds: [profile.uid],
        isTyping: false,
        typingAt: serverTimestamp(),
        lastReadAt: serverTimestamp(),
        joinedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    batch.set(doc(db, 'users', profile.uid, 'chats', conversationId), {
      conversationId,
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
      lastMessageAt: serverTimestamp(),
      lastReadAt: serverTimestamp(),
      unreadCount: 0,
      pinned: true,
      muted: false,
      archived: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await runFirestoreWrite(() => batch.commit());
  } catch (error) {
    if (isQuotaExceededError(error)) return;
    handleFirestoreError(error, OperationType.WRITE, chatPath);
  }
}

let lastOnlineWriteAt = 0;
let lastOnlineState: boolean | null = null;

export async function setUserOnlineStatus(uid: string, isOnline: boolean): Promise<void> {
  if (isWriteQuotaPaused()) return;
  const now = Date.now();
  if (lastOnlineState === isOnline && now - lastOnlineWriteAt < 60_000) {
    return;
  }
  lastOnlineWriteAt = now;
  lastOnlineState = isOnline;

  const path = `profiles/${uid}`;
  try {
    await runFirestoreWrite(() =>
      updateDoc(doc(db, 'profiles', uid), {
        isOnline,
        lastSeenAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  } catch (error) {
    const str = String(error);
    if (str.includes('Missing or insufficient permissions') || isQuotaExceededError(error)) {
      return;
    }
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateUserProfile(
  uid: string,
  updates: {
    displayName: string;
    handle: string;
    statusText: string;
    isDiscoverable: boolean;
    avatarSeed?: string;
  }
): Promise<void> {
  const path = `profiles/${uid}`;
  const cleanName = clampText(updates.displayName, LIMITS.DISPLAY_NAME_MAX) || 'CoolerUp User';
  const cleanHandle = sanitizeHandle(updates.handle, uid);
  const cleanStatus = clampText(updates.statusText, LIMITS.STATUS_TEXT_MAX);

  try {
    await runFirestoreWrite(() =>
      updateDoc(doc(db, 'profiles', uid), {
        displayName: cleanName,
        displayNameLower: cleanName.toLowerCase(),
        handle: cleanHandle,
        statusText: cleanStatus,
        isDiscoverable: updates.isDiscoverable,
        ...(updates.avatarSeed !== undefined
          ? { avatarSeed: updates.avatarSeed.slice(0, LIMITS.AVATAR_SEED_MAX) }
          : {}),
        updatedAt: serverTimestamp(),
      })
    );
  } catch (error) {
    if (isQuotaExceededError(error)) {
      await updateLocalProfile(uid, {
        displayName: cleanName,
        displayNameLower: cleanName.toLowerCase(),
        handle: cleanHandle,
        statusText: cleanStatus,
        isDiscoverable: updates.isDiscoverable,
        ...(updates.avatarSeed !== undefined
          ? { avatarSeed: updates.avatarSeed.slice(0, LIMITS.AVATAR_SEED_MAX) }
          : {}),
      });
      return;
    }
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateThemePreference(
  uid: string,
  themeMode: 'light' | 'dark'
): Promise<void> {
  const path = `users/${uid}/private/info`;
  try {
    await runFirestoreWrite(() =>
      updateDoc(doc(db, 'users', uid, 'private', 'info'), {
        themeMode,
        updatedAt: serverTimestamp(),
      })
    );
  } catch (error) {
    if (isQuotaExceededError(error)) {
      await updateLocalThemePreference(uid, themeMode);
      return;
    }
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// --- Friendships & Friend Requests ---

export async function sendFriendRequest(
  me: PublicProfile,
  peer: PublicProfile
): Promise<void> {
  if (me.uid === peer.uid) return;
  const friendshipId = buildFriendshipId(me.uid, peer.uid);
  const path = `friendships/${friendshipId}`;
  const userIds = [me.uid, peer.uid].sort();

  try {
    const snap = await runFirestoreRead(() => getDoc(doc(db, 'friendships', friendshipId)));
    if (!snap.exists()) {
      await runFirestoreWrite(() =>
        setDoc(doc(db, 'friendships', friendshipId), {
          id: friendshipId,
          userIds,
          requesterId: me.uid,
          receiverId: peer.uid,
          status: 'pending',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    } else {
      const existing = snap.data();
      if (existing.status === 'accepted') return;
      await runFirestoreWrite(() =>
        updateDoc(doc(db, 'friendships', friendshipId), {
          requesterId: me.uid,
          receiverId: peer.uid,
          status: 'pending',
          updatedAt: serverTimestamp(),
        })
      );
    }
  } catch (error) {
    if (isQuotaExceededError(error)) {
      await upsertLocalFriendRequest(me.uid, friendshipId, me.uid, peer.uid);
      return;
    }
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function respondToFriendRequest(
  friendshipId: string,
  accept: boolean
): Promise<void> {
  const path = `friendships/${friendshipId}`;
  try {
    await runFirestoreWrite(() =>
      updateDoc(doc(db, 'friendships', friendshipId), {
        status: accept ? 'accepted' : 'declined',
        updatedAt: serverTimestamp(),
      })
    );
  } catch (error) {
    if (isQuotaExceededError(error)) {
      const uid = auth.currentUser?.uid;
      if (uid) await respondLocalFriendRequest(uid, friendshipId, accept);
      return;
    }
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function removeFriendship(friendshipId: string): Promise<void> {
  const path = `friendships/${friendshipId}`;
  try {
    await runFirestoreWrite(() => deleteDoc(doc(db, 'friendships', friendshipId)));
  } catch (error) {
    if (isQuotaExceededError(error)) {
      const uid = auth.currentUser?.uid;
      if (uid) await removeLocalFriendship(uid, friendshipId);
      return;
    }
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Conversations & Messaging ---

export async function getConversationById(conversationId: string): Promise<Conversation | null> {
  if (conversationId.startsWith('local_')) {
    return await cacheGet<Conversation>(`conv_${conversationId}`);
  }
  try {
    const snap = await runFirestoreRead(() => getDoc(doc(db, 'conversations', conversationId)));
    if (snap.exists()) {
      const conv = snap.data() as Conversation;
      void cacheSet(`conv_${conversationId}`, conv);
      return conv;
    }
    return await cacheGet<Conversation>(`conv_${conversationId}`);
  } catch (error) {
    if (isQuotaExceededError(error)) {
      return await cacheGet<Conversation>(`conv_${conversationId}`);
    }
    handleFirestoreError(error, OperationType.GET, `conversations/${conversationId}`);
  }
}

export async function createOrOpenDirectChat(
  me: PublicProfile,
  peer: PublicProfile
): Promise<string> {
  if (me.uid === peer.uid) {
    await ensureSavedMessagesThread(me);
    return `saved_${me.uid}`;
  }

  const conversationId = buildDirectConversationId(me.uid, peer.uid);
  const convPath = `conversations/${conversationId}`;

  try {
    const convSnap = await runFirestoreRead(() =>
      getDoc(doc(db, 'conversations', conversationId))
    );
    if (convSnap.exists()) {
      const myChatSnap = await runFirestoreRead(() =>
        getDoc(doc(db, 'users', me.uid, 'chats', conversationId))
      );
      const convData = convSnap.data() as Conversation;
      if (!myChatSnap.exists()) {
        await runFirestoreWrite(() =>
          setDoc(doc(db, 'users', me.uid, 'chats', conversationId), {
            conversationId,
            userId: me.uid,
            type: 'direct',
            title: peer.displayName.slice(0, LIMITS.TITLE_MAX),
            photoURL: peer.photoURL,
            peerUid: peer.uid,
            themeId: convData.themeId,
            quickEmoji: convData.quickEmoji,
            lastMessageKind: convData.lastMessageKind || 'text',
            lastMediaType: convData.lastMediaType || 'text',
            lastSnapStatus: convData.lastSnapStatus || 'sent',
            lastSnapOpened: true,
            streakCount: convData.streakCount || 0,
            ...(convData.lastSnapAt ? { lastSnapAt: convData.lastSnapAt } : {}),
            lastMessageText: convData.lastMessageText,
            lastMessageSenderId: convData.lastMessageSenderId,
            lastMessageSenderName: convData.lastMessageSenderName,
            lastMessageAt: convData.lastMessageAt || serverTimestamp(),
            lastReadAt: serverTimestamp(),
            unreadCount: 0,
            pinned: false,
            muted: false,
            archived: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        );
      }
      return conversationId;
    }

    const memberIds = [me.uid, peer.uid].sort();
    const batch = writeBatch(db);

    batch.set(doc(db, 'conversations', conversationId), {
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
      lastMessageAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'conversations', conversationId, 'members', me.uid), {
      uid: me.uid,
      conversationId,
      displayName: me.displayName,
      photoURL: me.photoURL,
      role: 'member',
      memberIds,
      isTyping: false,
      typingAt: serverTimestamp(),
      lastReadAt: serverTimestamp(),
      joinedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'conversations', conversationId, 'members', peer.uid), {
      uid: peer.uid,
      conversationId,
      displayName: peer.displayName,
      photoURL: peer.photoURL,
      role: 'member',
      memberIds,
      isTyping: false,
      typingAt: serverTimestamp(),
      lastReadAt: serverTimestamp(),
      joinedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'users', me.uid, 'chats', conversationId), {
      conversationId,
      userId: me.uid,
      type: 'direct',
      title: peer.displayName.slice(0, LIMITS.TITLE_MAX),
      photoURL: peer.photoURL,
      peerUid: peer.uid,
      themeId: 'azure',
      quickEmoji: '👻',
      lastMessageKind: 'system',
      lastMediaType: 'text',
      lastSnapStatus: 'sent',
      lastSnapOpened: true,
      streakCount: 0,
      lastMessageText: 'Say hi or send a Snap',
      lastMessageSenderId: me.uid,
      lastMessageSenderName: me.displayName,
      lastMessageAt: serverTimestamp(),
      lastReadAt: serverTimestamp(),
      unreadCount: 0,
      pinned: false,
      muted: false,
      archived: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'users', peer.uid, 'chats', conversationId), {
      conversationId,
      userId: peer.uid,
      type: 'direct',
      title: me.displayName.slice(0, LIMITS.TITLE_MAX),
      photoURL: me.photoURL,
      peerUid: me.uid,
      themeId: 'azure',
      quickEmoji: '👻',
      lastMessageKind: 'system',
      lastMediaType: 'text',
      lastSnapStatus: 'sent',
      lastSnapOpened: true,
      streakCount: 0,
      lastMessageText: 'Say hi or send a Snap',
      lastMessageSenderId: me.uid,
      lastMessageSenderName: me.displayName,
      lastMessageAt: serverTimestamp(),
      lastReadAt: serverTimestamp(),
      unreadCount: 0,
      pinned: false,
      muted: false,
      archived: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await runFirestoreWrite(() => batch.commit());
    return conversationId;
  } catch (error) {
    if (isQuotaExceededError(error)) {
      return await upsertLocalDirectChat(me, peer, conversationId);
    }
    handleFirestoreError(error, OperationType.WRITE, convPath);
  }
}

export async function createGroupChat(
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

  const convRef = doc(collection(db, 'conversations'));
  const conversationId = `grp_${convRef.id}`;
  const convPath = `conversations/${conversationId}`;

  try {
    const batch = writeBatch(db);

    batch.set(doc(db, 'conversations', conversationId), {
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
      lastMessageAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    for (const member of allMembers) {
      batch.set(doc(db, 'conversations', conversationId, 'members', member.uid), {
        uid: member.uid,
        conversationId,
        displayName: member.displayName,
        photoURL: member.photoURL,
        role: member.uid === me.uid ? 'admin' : 'member',
        memberIds,
        isTyping: false,
        typingAt: serverTimestamp(),
        lastReadAt: serverTimestamp(),
        joinedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      batch.set(doc(db, 'users', member.uid, 'chats', conversationId), {
        conversationId,
        userId: member.uid,
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
        lastMessageAt: serverTimestamp(),
        lastReadAt: serverTimestamp(),
        unreadCount: member.uid === me.uid ? 0 : 1,
        pinned: false,
        muted: false,
        archived: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    await runFirestoreWrite(() => batch.commit());
    return conversationId;
  } catch (error) {
    if (isQuotaExceededError(error)) {
      return await createLocalGroupChat(me, title, peers);
    }
    handleFirestoreError(error, OperationType.WRITE, convPath);
  }
}

export async function sendMessage(params: {
  conversation: Conversation;
  sender: PublicProfile;
  kind: MessageKind;
  mediaType?: MediaType;
  text: string;
  imageData?: string;
  snapDurationSec?: number;
  replyTo?: {
    id: string;
    senderName: string;
    text: string;
  } | null;
}): Promise<void> {
  const {
    conversation,
    sender,
    kind,
    mediaType = kind === 'snap' ? 'photo' : kind === 'voice' ? 'audio' : kind === 'image' ? 'photo' : 'text',
    text,
    imageData = '',
    snapDurationSec = 5,
    replyTo,
  } = params;
  const cleanText = text.slice(0, LIMITS.MESSAGE_TEXT_MAX);
  let rawMedia = imageData;
  if (rawMedia && rawMedia.startsWith('data:') && !conversation.id.startsWith('local_') && !isWriteQuotaPaused()) {
    const ext = mediaType === 'video' ? 'webm' : mediaType === 'audio' ? 'webm' : 'jpg';
    const folder = kind === 'voice' ? 'voice' : kind === 'snap' ? 'snaps' : 'chat';
    const uploaded = await uploadMediaWithFallback({
      uid: sender.uid,
      folder,
      media: rawMedia,
      ext,
    });
    rawMedia = uploaded.url;
  }
  const cleanImage = rawMedia.slice(0, LIMITS.IMAGE_DATA_MAX);

  if (!cleanText.trim() && !cleanImage) return;

  const msgRef = doc(collection(db, 'conversations', conversation.id, 'messages'));
  const messageId = msgRef.id;
  const msgPath = `conversations/${conversation.id}/messages/${messageId}`;
  const isSelfChat = conversation.id === `saved_${sender.uid}`;

  const previewText =
    kind === 'snap'
      ? mediaType === 'video'
        ? 'New Video Snap'
        : 'New Snap'
      : kind === 'voice'
      ? 'Voice Note'
      : kind === 'image'
      ? cleanText.trim()
        ? `📷 ${cleanText.trim()}`
        : 'Sent a photo'
      : cleanText.trim();
  const clampedPreview = previewText.slice(0, LIMITS.LAST_MESSAGE_TEXT_MAX);

  const isSnap = kind === 'snap';
  const prevSnapMs = conversation.lastSnapAt?.toMillis?.() ?? 0;
  const hoursSincePrevSnap = prevSnapMs ? (Date.now() - prevSnapMs) / (1000 * 60 * 60) : 0;

  let nextStreak = conversation.streakCount || 0;
  if (isSnap && !isSelfChat) {
    if (prevSnapMs && hoursSincePrevSnap >= 28) {
      nextStreak = 1;
    } else if (conversation.lastMessageSenderId !== sender.uid || nextStreak === 0) {
      nextStreak = nextStreak + 1;
    }
  }

  const nextStatus: SnapStatus = 'delivered';

  try {
    const batch = writeBatch(db);

    batch.set(msgRef, {
      id: messageId,
      conversationId: conversation.id,
      senderId: sender.uid,
      senderName: sender.displayName,
      senderPhotoURL: sender.photoURL,
      memberIds: conversation.memberIds,
      kind,
      mediaType,
      text: cleanText,
      imageData: cleanImage,
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
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.update(doc(db, 'conversations', conversation.id), {
      lastMessageKind: kind,
      lastMediaType: mediaType,
      lastSnapStatus: nextStatus,
      streakCount: nextStreak,
      ...(isSnap ? { lastSnapAt: serverTimestamp() } : {}),
      lastMessageText: clampedPreview,
      lastMessageSenderId: sender.uid,
      lastMessageSenderName: sender.displayName,
      lastMessageAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    for (const memberId of conversation.memberIds) {
      const isSender = memberId === sender.uid;
      batch.update(doc(db, 'users', memberId, 'chats', conversation.id), {
        lastMessageKind: kind,
        lastMediaType: mediaType,
        lastSnapStatus: nextStatus,
        lastSnapOpened: isSnap ? isSelfChat : true,
        streakCount: nextStreak,
        ...(isSnap ? { lastSnapAt: serverTimestamp() } : {}),
        lastMessageText: clampedPreview,
        lastMessageSenderId: sender.uid,
        lastMessageSenderName: sender.displayName,
        lastMessageAt: serverTimestamp(),
        archived: false,
        updatedAt: serverTimestamp(),
        ...(isSender
          ? { lastReadAt: serverTimestamp(), unreadCount: 0 }
          : { unreadCount: increment(1) }),
      });
    }

    batch.update(doc(db, 'conversations', conversation.id, 'members', sender.uid), {
      isTyping: false,
      lastReadAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    if (isSnap) {
      batch.update(doc(db, 'profiles', sender.uid), {
        snapScore: increment(1),
        updatedAt: serverTimestamp(),
      });
    }

    if (conversation.id.startsWith('local_') || isWriteQuotaPaused()) {
      await appendLocalMessage({
        conversation,
        sender,
        kind,
        mediaType,
        text: cleanText,
        imageData: cleanImage,
        snapDurationSec,
        previewText: clampedPreview,
        nextStreak,
        replyTo,
      });
      return;
    }

    await runFirestoreWrite(() => batch.commit());
  } catch (error) {
    if (isQuotaExceededError(error)) {
      await appendLocalMessage({
        conversation,
        sender,
        kind,
        mediaType,
        text: cleanText,
        imageData: cleanImage,
        snapDurationSec,
        previewText: clampedPreview,
        nextStreak,
        replyTo,
      });
      return;
    }
    handleFirestoreError(error, OperationType.WRITE, msgPath);
  }
}

export async function markSnapViewed(
  conversation: Conversation,
  message: Message,
  viewerUid: string
): Promise<void> {
  const msgPath = `conversations/${conversation.id}/messages/${message.id}`;
  const alreadyViewed = message.snapViewedBy?.includes(viewerUid);

  try {
    const batch = writeBatch(db);
    if (!alreadyViewed) {
      batch.update(doc(db, 'conversations', conversation.id, 'messages', message.id), {
        snapStatus: 'opened',
        snapViewedBy: arrayUnion(viewerUid),
        updatedAt: serverTimestamp(),
      });
      batch.update(doc(db, 'profiles', viewerUid), {
        snapScore: increment(1),
        updatedAt: serverTimestamp(),
      });
    }

    batch.update(doc(db, 'conversations', conversation.id), {
      lastSnapStatus: 'opened',
      updatedAt: serverTimestamp(),
    });

    for (const memberId of conversation.memberIds) {
      batch.update(doc(db, 'users', memberId, 'chats', conversation.id), {
        lastSnapStatus: 'opened',
        lastSnapOpened: true,
        updatedAt: serverTimestamp(),
        ...(memberId === viewerUid ? { unreadCount: 0 } : {}),
      });
    }

    await runFirestoreWrite(() => batch.commit());
  } catch (error) {
    if (isQuotaExceededError(error)) {
      await updateLocalMessageById(conversation.id, message.id, (m) => ({
        ...m,
        snapStatus: 'opened',
        snapViewedBy: m.snapViewedBy?.includes(viewerUid)
          ? m.snapViewedBy
          : [...(m.snapViewedBy || []), viewerUid],
      }));
      return;
    }
    handleFirestoreError(error, OperationType.UPDATE, msgPath);
  }
}

export async function markSnapReplayed(
  conversation: Conversation,
  message: Message,
  viewerUid: string
): Promise<void> {
  const msgPath = `conversations/${conversation.id}/messages/${message.id}`;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'conversations', conversation.id, 'messages', message.id), {
      snapStatus: 'replayed',
      snapReplayedBy: arrayUnion(viewerUid),
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'conversations', conversation.id), {
      lastSnapStatus: 'replayed',
      updatedAt: serverTimestamp(),
    });
    for (const memberId of conversation.memberIds) {
      batch.update(doc(db, 'users', memberId, 'chats', conversation.id), {
        lastSnapStatus: 'replayed',
        updatedAt: serverTimestamp(),
      });
    }
    await runFirestoreWrite(() => batch.commit());
  } catch (error) {
    if (isQuotaExceededError(error)) {
      await updateLocalMessageById(conversation.id, message.id, (m) => ({
        ...m,
        snapStatus: 'replayed',
        snapReplayedBy: [...(m.snapReplayedBy || []), viewerUid],
      }));
      return;
    }
    handleFirestoreError(error, OperationType.UPDATE, msgPath);
  }
}

export async function markSnapScreenshotted(
  conversation: Conversation,
  message: Message,
  viewerUid: string
): Promise<void> {
  const msgPath = `conversations/${conversation.id}/messages/${message.id}`;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'conversations', conversation.id, 'messages', message.id), {
      snapStatus: 'screenshotted',
      snapScreenshottedBy: arrayUnion(viewerUid),
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'conversations', conversation.id), {
      lastSnapStatus: 'screenshotted',
      updatedAt: serverTimestamp(),
    });
    for (const memberId of conversation.memberIds) {
      batch.update(doc(db, 'users', memberId, 'chats', conversation.id), {
        lastSnapStatus: 'screenshotted',
        updatedAt: serverTimestamp(),
      });
    }
    await runFirestoreWrite(() => batch.commit());
  } catch (error) {
    if (isQuotaExceededError(error)) {
      await updateLocalMessageById(conversation.id, message.id, (m) => ({
        ...m,
        snapStatus: 'screenshotted',
        snapScreenshottedBy: [...(m.snapScreenshottedBy || []), viewerUid],
      }));
      return;
    }
    handleFirestoreError(error, OperationType.UPDATE, msgPath);
  }
}

/**
 * Deletes the disappearing Snap media from Firestore once the recipient closes it
 * (unless it is inside the user's private Saved Snaps chat or saved in chat).
 */
export async function consumeAndDeleteSnapMedia(
  conversation: Conversation,
  message: Message,
  viewerUid: string
): Promise<void> {
  if (conversation.id === `saved_${viewerUid}`) return;
  if (message.senderId === viewerUid) return;
  if ((message.savedBy || []).length > 0) return;
  if (!message.imageData) return;

  const msgPath = `conversations/${conversation.id}/messages/${message.id}`;
  try {
    await runFirestoreWrite(() =>
      updateDoc(doc(db, 'conversations', conversation.id, 'messages', message.id), {
        imageData: '',
        snapViewedBy: arrayUnion(viewerUid),
        snapStatus: message.snapStatus && message.snapStatus !== 'delivered' && message.snapStatus !== 'sent'
          ? message.snapStatus
          : 'opened',
        updatedAt: serverTimestamp(),
      })
    );
  } catch (error) {
    if (String(error).includes('Missing or insufficient permissions') || isQuotaExceededError(error)) {
      await updateLocalMessageById(conversation.id, message.id, (m) => ({
        ...m,
        imageData: '',
        snapStatus: 'opened',
      }));
      return;
    }
    handleFirestoreError(error, OperationType.UPDATE, msgPath);
  }
}

export async function toggleSaveMessage(
  conversationId: string,
  messageId: string,
  uid: string,
  currentSavedBy: string[] = []
): Promise<void> {
  const msgPath = `conversations/${conversationId}/messages/${messageId}`;
  const isSaved = currentSavedBy.includes(uid);
  try {
    await runFirestoreWrite(() =>
      updateDoc(doc(db, 'conversations', conversationId, 'messages', messageId), {
        savedBy: isSaved ? arrayRemove(uid) : arrayUnion(uid),
        updatedAt: serverTimestamp(),
      })
    );
  } catch (error) {
    if (isQuotaExceededError(error)) {
      await updateLocalMessageById(conversationId, messageId, (m) => ({
        ...m,
        savedBy: isSaved ? (m.savedBy || []).filter((id) => id !== uid) : [...(m.savedBy || []), uid],
      }));
      return;
    }
    handleFirestoreError(error, OperationType.UPDATE, msgPath);
  }
}

export async function deleteUserChat(uid: string, conversationId: string): Promise<void> {
  if (conversationId === `saved_${uid}`) return;
  const path = `users/${uid}/chats/${conversationId}`;
  try {
    if (conversationId.startsWith('local_') || isWriteQuotaPaused()) {
      await deleteLocalUserChat(uid, conversationId);
      return;
    }
    await runFirestoreWrite(() => deleteDoc(doc(db, 'users', uid, 'chats', conversationId)));
  } catch (error) {
    if (isQuotaExceededError(error)) {
      await deleteLocalUserChat(uid, conversationId);
      return;
    }
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function createStory(params: {
  author: PublicProfile;
  mediaType?: 'photo' | 'video';
  imageData: string;
  caption: string;
  durationSec?: number;
  locationLabel?: string;
  lat?: number;
  lng?: number;
}): Promise<string> {
  const { author, mediaType = 'photo', imageData, caption, durationSec = 5, locationLabel, lat, lng } = params;
  const storyRef = doc(collection(db, 'stories'));
  const storyId = storyRef.id;
  const storyPath = `stories/${storyId}`;
  const expiresAt = Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000);

  let mediaUrl = imageData;
  if (mediaUrl.startsWith('data:') && !isWriteQuotaPaused()) {
    const uploaded = await uploadMediaWithFallback({
      uid: author.uid,
      folder: 'stories',
      media: mediaUrl,
      ext: mediaType === 'video' ? 'webm' : 'jpg',
    });
    mediaUrl = uploaded.url;
  }

  try {
    const batch = writeBatch(db);
    batch.set(storyRef, {
      id: storyId,
      authorId: author.uid,
      authorName: author.displayName,
      authorHandle: author.handle,
      authorPhotoURL: author.photoURL,
      mediaType,
      imageData: mediaUrl.slice(0, LIMITS.IMAGE_DATA_MAX),
      caption: caption.trim().slice(0, LIMITS.STORY_CAPTION_MAX),
      durationSec: Math.min(60, Math.max(1, durationSec)),
      viewerIds: [],
      likedBy: [],
      ...(locationLabel ? { locationLabel: locationLabel.slice(0, 120) } : {}),
      ...(typeof lat === 'number' && typeof lng === 'number' ? { lat, lng } : {}),
      isPublicStory: true,
      expiresAt,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.update(doc(db, 'profiles', author.uid), {
      snapScore: increment(1),
      updatedAt: serverTimestamp(),
    });

    await runFirestoreWrite(() => batch.commit());
    return storyId;
  } catch (error) {
    if (isQuotaExceededError(error)) {
      return await createLocalStory({ author, mediaType, imageData: mediaUrl, caption, durationSec });
    }
    handleFirestoreError(error, OperationType.CREATE, storyPath);
  }
}

export async function markStoryViewed(storyId: string, viewerUid: string): Promise<void> {
  if (storyId.startsWith('local_') || isWriteQuotaPaused()) return;
  const path = `stories/${storyId}`;
  try {
    await runFirestoreWrite(() =>
      updateDoc(doc(db, 'stories', storyId), {
        viewerIds: arrayUnion(viewerUid),
        updatedAt: serverTimestamp(),
      })
    );
  } catch (error) {
    if (String(error).includes('Missing or insufficient permissions') || isQuotaExceededError(error)) return;
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteStory(storyId: string): Promise<void> {
  const path = `stories/${storyId}`;
  try {
    if (storyId.startsWith('local_') || isWriteQuotaPaused()) {
      await deleteLocalStory(storyId);
      return;
    }
    await runFirestoreWrite(() => deleteDoc(doc(db, 'stories', storyId)));
  } catch (error) {
    if (isQuotaExceededError(error)) {
      await deleteLocalStory(storyId);
      return;
    }
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Spotlight Video Feed ---

const resolvedVideoUrlCache = new Map<string, string>();

function dataUrlToBlob(dataUrl: string): Blob {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) {
    throw new Error('Malformed video data.');
  }
  const header = dataUrl.slice(0, commaIdx);
  const b64 = dataUrl.slice(commaIdx + 1);
  const mimeMatch = header.match(/data:([^;]+)/);
  const mimeType = mimeMatch?.[1] || 'video/webm';
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

export async function resolveSpotlightVideoSrc(video: SpotlightVideo): Promise<string> {
  if (video.videoData) {
    return video.videoData;
  }

  const cached = resolvedVideoUrlCache.get(video.id);
  if (cached) {
    return cached;
  }

  const idbCachedDataUrl = await cacheGet<string>(`spotlight_media_${video.id}`);
  if (idbCachedDataUrl) {
    const blob = dataUrlToBlob(idbCachedDataUrl);
    const objectUrl = URL.createObjectURL(blob);
    resolvedVideoUrlCache.set(video.id, objectUrl);
    return objectUrl;
  }

  const count = video.chunkCount || 0;
  if (count <= 0) {
    throw new Error('Spotlight video media missing.');
  }

  const path = `spotlightVideos/${video.id}/chunks`;
  try {
    const chunkSnaps = await runFirestoreRead(() =>
      Promise.all(
        Array.from({ length: count }, (_, idx) =>
          getDoc(doc(db, 'spotlightVideos', video.id, 'chunks', String(idx)))
        )
      )
    );
    const fullDataUrl = chunkSnaps
      .map((snap) => (snap.exists() ? String(snap.data().data || '') : ''))
      .join('');
    if (!fullDataUrl) {
      throw new Error('Could not assemble 720p video chunks.');
    }
    void cacheSet(`spotlight_media_${video.id}`, fullDataUrl);
    const blob = dataUrlToBlob(fullDataUrl);
    const objectUrl = URL.createObjectURL(blob);
    resolvedVideoUrlCache.set(video.id, objectUrl);
    return objectUrl;
  } catch (error) {
    if (isQuotaExceededError(error)) {
      throw new Error('Video media is temporarily unavailable while daily cloud quota is full.');
    }
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function createSpotlightVideo(params: {
  author: PublicProfile;
  videoData: string;
  caption: string;
  soundTitle?: string;
  soundTrackId?: string;
  resolution?: string;
}): Promise<string> {
  const { author, videoData, caption, soundTitle, soundTrackId = 'original', resolution = '720p' } = params;
  const videoRef = doc(collection(db, 'spotlightVideos'));
  const videoId = videoRef.id;
  const path = `spotlightVideos/${videoId}`;

  const cleanSound =
    (soundTitle || '').trim().slice(0, LIMITS.SOUND_TITLE_MAX) ||
    `Original Sound · ${author.displayName.split(' ')[0]}`;
  const cleanSoundId = soundTrackId.slice(0, LIMITS.SOUND_TRACK_ID_MAX);
  const cleanResolution = resolution.slice(0, LIMITS.RESOLUTION_MAX);

  // Prefer Firebase Storage for Spotlight video clips so playback is instant & unlimited
  let resolvedMedia = videoData;
  if (resolvedMedia.startsWith('data:') && !isWriteQuotaPaused()) {
    const uploaded = await uploadMediaWithFallback({
      uid: author.uid,
      folder: 'spotlight',
      media: resolvedMedia,
      ext: 'webm',
    });
    if (uploaded.fromStorage) {
      resolvedMedia = uploaded.url;
    }
  }

  const isUrlMedia = resolvedMedia.startsWith('https://') || resolvedMedia.startsWith('http://');

  const chunks: string[] = [];
  if (!isUrlMedia && resolvedMedia.length > LIMITS.SPOTLIGHT_INLINE_MAX) {
    for (let offset = 0; offset < resolvedMedia.length; offset += LIMITS.SPOTLIGHT_CHUNK_MAX) {
      chunks.push(resolvedMedia.slice(offset, offset + LIMITS.SPOTLIGHT_CHUNK_MAX));
    }
    if (chunks.length > LIMITS.SPOTLIGHT_MAX_CHUNKS) {
      throw new Error('720p video is too large. Keep clips concise when Storage is unavailable.');
    }
  }

  try {
    if (isUrlMedia || resolvedMedia.length <= LIMITS.SPOTLIGHT_INLINE_MAX) {
      const batch = writeBatch(db);
      batch.set(videoRef, {
        id: videoId,
        authorId: author.uid,
        authorName: author.displayName.slice(0, LIMITS.DISPLAY_NAME_MAX),
        authorHandle: author.handle.slice(0, LIMITS.HANDLE_MAX),
        authorPhotoURL: author.photoURL.slice(0, LIMITS.PHOTO_URL_MAX),
        authorAvatarSeed: (author.avatarSeed || '').slice(0, LIMITS.AVATAR_SEED_MAX),
        videoData: resolvedMedia,
        chunkCount: 0,
        resolution: cleanResolution,
        soundTrackId: cleanSoundId,
        caption: caption.trim().slice(0, LIMITS.STORY_CAPTION_MAX),
        soundTitle: cleanSound,
        likedBy: [],
        viewCount: 0,
        commentCount: 0,
        isPublic: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      batch.update(doc(db, 'profiles', author.uid), {
        snapScore: increment(1),
        updatedAt: serverTimestamp(),
      });

      await runFirestoreWrite(() => batch.commit());
      return videoId;
    }

    await runFirestoreWrite(() =>
      setDoc(videoRef, {
        id: videoId,
        authorId: author.uid,
        authorName: author.displayName.slice(0, LIMITS.DISPLAY_NAME_MAX),
        authorHandle: author.handle.slice(0, LIMITS.HANDLE_MAX),
        authorPhotoURL: author.photoURL.slice(0, LIMITS.PHOTO_URL_MAX),
        authorAvatarSeed: (author.avatarSeed || '').slice(0, LIMITS.AVATAR_SEED_MAX),
        videoData: '',
        chunkCount: chunks.length,
        resolution: cleanResolution,
        soundTrackId: cleanSoundId,
        caption: caption.trim().slice(0, LIMITS.STORY_CAPTION_MAX),
        soundTitle: cleanSound,
        likedBy: [],
        viewCount: 0,
        commentCount: 0,
        isPublic: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // Write chunks cleanly in small groups to stay well below Firestore batch payload caps
    for (let i = 0; i < chunks.length; i += 3) {
      const slice = chunks.slice(i, i + 3);
      await runFirestoreWrite(
        () =>
          Promise.all(
            slice.map((chunkData, subIdx) => {
              const chunkIdx = i + subIdx;
              return setDoc(doc(db, 'spotlightVideos', videoId, 'chunks', String(chunkIdx)), {
                id: String(chunkIdx),
                videoId,
                authorId: author.uid,
                index: chunkIdx,
                data: chunkData,
                createdAt: serverTimestamp(),
              });
            })
          ),
        10000
      );
    }

    const publishBatch = writeBatch(db);
    publishBatch.update(videoRef, {
      isPublic: true,
      updatedAt: serverTimestamp(),
    });
    publishBatch.update(doc(db, 'profiles', author.uid), {
      snapScore: increment(1),
      updatedAt: serverTimestamp(),
    });
    await runFirestoreWrite(() => publishBatch.commit());
    void cacheSet(`spotlight_media_${videoId}`, resolvedMedia);

    return videoId;
  } catch (error) {
    if (isQuotaExceededError(error)) {
      return await createLocalSpotlightVideo({
        author,
        videoData: resolvedMedia,
        caption,
        soundTitle: cleanSound,
        soundTrackId: cleanSoundId,
        resolution: cleanResolution,
      });
    }
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function toggleLikeSpotlightVideo(
  videoId: string,
  uid: string,
  currentLikedBy: string[] = []
): Promise<void> {
  const path = `spotlightVideos/${videoId}`;
  const isLiked = currentLikedBy.includes(uid);
  try {
    if (videoId.startsWith('local_') || isWriteQuotaPaused()) {
      await updateLocalSpotlightVideo(videoId, (v) => ({
        ...v,
        likedBy: isLiked ? v.likedBy.filter((id) => id !== uid) : [...v.likedBy, uid],
      }));
      return;
    }
    await runFirestoreWrite(() =>
      updateDoc(doc(db, 'spotlightVideos', videoId), {
        likedBy: isLiked ? arrayRemove(uid) : arrayUnion(uid),
        updatedAt: serverTimestamp(),
      })
    );
  } catch (error) {
    if (isQuotaExceededError(error)) {
      await updateLocalSpotlightVideo(videoId, (v) => ({
        ...v,
        likedBy: isLiked ? v.likedBy.filter((id) => id !== uid) : [...v.likedBy, uid],
      }));
      return;
    }
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

const viewedSpotlightInSession = new Set<string>();

export async function incrementSpotlightView(videoId: string): Promise<void> {
  if (videoId.startsWith('local_') || isWriteQuotaPaused() || viewedSpotlightInSession.has(videoId)) {
    return;
  }
  viewedSpotlightInSession.add(videoId);
  const path = `spotlightVideos/${videoId}`;
  try {
    await runFirestoreWrite(() =>
      updateDoc(doc(db, 'spotlightVideos', videoId), {
        viewCount: increment(1),
        updatedAt: serverTimestamp(),
      })
    );
  } catch (error) {
    if (String(error).includes('Missing or insufficient permissions') || isQuotaExceededError(error)) return;
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateSpotlightVideoSound(
  videoId: string,
  soundTrackId: string,
  soundTitle: string
): Promise<void> {
  const path = `spotlightVideos/${videoId}`;
  try {
    if (videoId.startsWith('local_') || isWriteQuotaPaused()) {
      await updateLocalSpotlightVideo(videoId, (v) => ({
        ...v,
        soundTrackId: soundTrackId.slice(0, LIMITS.SOUND_TRACK_ID_MAX),
        soundTitle: soundTitle.trim().slice(0, LIMITS.SOUND_TITLE_MAX),
      }));
      return;
    }
    await runFirestoreWrite(() =>
      updateDoc(doc(db, 'spotlightVideos', videoId), {
        soundTrackId: soundTrackId.slice(0, LIMITS.SOUND_TRACK_ID_MAX),
        soundTitle: soundTitle.trim().slice(0, LIMITS.SOUND_TITLE_MAX),
        updatedAt: serverTimestamp(),
      })
    );
  } catch (error) {
    if (isQuotaExceededError(error)) {
      await updateLocalSpotlightVideo(videoId, (v) => ({
        ...v,
        soundTrackId: soundTrackId.slice(0, LIMITS.SOUND_TRACK_ID_MAX),
        soundTitle: soundTitle.trim().slice(0, LIMITS.SOUND_TITLE_MAX),
      }));
      return;
    }
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteSpotlightVideo(videoId: string, chunkCount = 0): Promise<void> {
  const path = `spotlightVideos/${videoId}`;
  try {
    if (videoId.startsWith('local_') || isWriteQuotaPaused()) {
      await deleteLocalSpotlightVideo(videoId);
      return;
    }
    if (chunkCount > 0) {
      await runFirestoreWrite(() =>
        Promise.all(
          Array.from({ length: chunkCount }, (_, idx) =>
            deleteDoc(doc(db, 'spotlightVideos', videoId, 'chunks', String(idx)))
          )
        )
      );
    }
    await runFirestoreWrite(() => deleteDoc(doc(db, 'spotlightVideos', videoId)));
    const cachedUrl = resolvedVideoUrlCache.get(videoId);
    if (cachedUrl) {
      URL.revokeObjectURL(cachedUrl);
      resolvedVideoUrlCache.delete(videoId);
    }
  } catch (error) {
    if (isQuotaExceededError(error)) {
      await deleteLocalSpotlightVideo(videoId);
      return;
    }
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function editMessage(
  conversation: Conversation,
  messageId: string,
  newText: string,
  isLatest: boolean
): Promise<void> {
  const cleanText = newText.trim().slice(0, LIMITS.MESSAGE_TEXT_MAX);
  if (!cleanText) return;

  const msgPath = `conversations/${conversation.id}/messages/${messageId}`;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'conversations', conversation.id, 'messages', messageId), {
      text: cleanText,
      edited: true,
      updatedAt: serverTimestamp(),
    });

    if (isLatest) {
      const clampedPreview = cleanText.slice(0, LIMITS.LAST_MESSAGE_TEXT_MAX);
      batch.update(doc(db, 'conversations', conversation.id), {
        lastMessageText: clampedPreview,
        updatedAt: serverTimestamp(),
      });
      for (const memberId of conversation.memberIds) {
        batch.update(doc(db, 'users', memberId, 'chats', conversation.id), {
          lastMessageText: clampedPreview,
          updatedAt: serverTimestamp(),
        });
      }
    }

    await runFirestoreWrite(() => batch.commit());
  } catch (error) {
    if (isQuotaExceededError(error)) {
      await updateLocalMessageById(conversation.id, messageId, (m) => ({
        ...m,
        text: cleanText,
        edited: true,
      }));
      return;
    }
    handleFirestoreError(error, OperationType.UPDATE, msgPath);
  }
}

export async function unsendMessage(
  conversation: Conversation,
  messageId: string,
  isLatest: boolean
): Promise<void> {
  const msgPath = `conversations/${conversation.id}/messages/${messageId}`;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'conversations', conversation.id, 'messages', messageId), {
      text: '',
      imageData: '',
      deleted: true,
      updatedAt: serverTimestamp(),
    });

    if (isLatest) {
      batch.update(doc(db, 'conversations', conversation.id), {
        lastMessageText: 'Unsent a message',
        updatedAt: serverTimestamp(),
      });
      for (const memberId of conversation.memberIds) {
        batch.update(doc(db, 'users', memberId, 'chats', conversation.id), {
          lastMessageText: 'Unsent a message',
          updatedAt: serverTimestamp(),
        });
      }
    }

    await runFirestoreWrite(() => batch.commit());
  } catch (error) {
    if (isQuotaExceededError(error)) {
      await updateLocalMessageById(conversation.id, messageId, (m) => ({
        ...m,
        text: '',
        imageData: '',
        deleted: true,
      }));
      return;
    }
    handleFirestoreError(error, OperationType.UPDATE, msgPath);
  }
}

export async function toggleMessageReaction(
  conversationId: string,
  messageId: string,
  uid: string,
  emoji: string,
  currentReactions: Record<string, string>
): Promise<void> {
  const msgPath = `conversations/${conversationId}/messages/${messageId}`;
  const alreadySame = currentReactions[uid] === emoji;
  try {
    await runFirestoreWrite(() =>
      updateDoc(doc(db, 'conversations', conversationId, 'messages', messageId), {
        [`reactions.${uid}`]: alreadySame ? deleteField() : emoji.slice(0, LIMITS.QUICK_EMOJI_MAX),
        updatedAt: serverTimestamp(),
      })
    );
  } catch (error) {
    if (isQuotaExceededError(error)) {
      await updateLocalMessageById(conversationId, messageId, (m) => {
        const nextReactions = { ...(m.reactions || {}) };
        if (alreadySame) delete nextReactions[uid];
        else nextReactions[uid] = emoji.slice(0, LIMITS.QUICK_EMOJI_MAX);
        return { ...m, reactions: nextReactions };
      });
      return;
    }
    handleFirestoreError(error, OperationType.UPDATE, msgPath);
  }
}

export async function setTypingStatus(
  conversationId: string,
  uid: string,
  isTyping: boolean
): Promise<void> {
  if (conversationId.startsWith('local_') || isWriteQuotaPaused()) return;
  const path = `conversations/${conversationId}/members/${uid}`;
  try {
    await runFirestoreWrite(() =>
      updateDoc(doc(db, 'conversations', conversationId, 'members', uid), {
        isTyping,
        typingAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  } catch (error) {
    if (String(error).includes('Missing or insufficient permissions') || isQuotaExceededError(error)) return;
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function markConversationRead(
  conversationId: string,
  uid: string
): Promise<void> {
  if (conversationId.startsWith('local_') || isWriteQuotaPaused()) return;
  const path = `users/${uid}/chats/${conversationId}`;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'users', uid, 'chats', conversationId), {
      unreadCount: 0,
      lastReadAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'conversations', conversationId, 'members', uid), {
      lastReadAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await runFirestoreWrite(() => batch.commit());
  } catch (error) {
    if (String(error).includes('Missing or insufficient permissions') || isQuotaExceededError(error)) return;
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateConversationAppearance(
  conversation: Conversation,
  updates: { themeId?: ChatThemeId; quickEmoji?: string }
): Promise<void> {
  const convPath = `conversations/${conversation.id}`;
  const payload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };
  if (updates.themeId) payload.themeId = updates.themeId;
  if (updates.quickEmoji) payload.quickEmoji = updates.quickEmoji.slice(0, LIMITS.QUICK_EMOJI_MAX);

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'conversations', conversation.id), payload);
    for (const memberId of conversation.memberIds) {
      batch.update(doc(db, 'users', memberId, 'chats', conversation.id), payload);
    }
    await runFirestoreWrite(() => batch.commit());
  } catch (error) {
    if (isQuotaExceededError(error)) {
      const uid = auth.currentUser?.uid;
      if (uid) await updateLocalAppearance(uid, conversation.id, updates);
      return;
    }
    handleFirestoreError(error, OperationType.UPDATE, convPath);
  }
}

export async function updateUserChatFlags(
  uid: string,
  conversationId: string,
  flags: { pinned?: boolean; muted?: boolean; archived?: boolean }
): Promise<void> {
  const path = `users/${uid}/chats/${conversationId}`;
  try {
    await runFirestoreWrite(() =>
      updateDoc(doc(db, 'users', uid, 'chats', conversationId), {
        ...flags,
        updatedAt: serverTimestamp(),
      })
    );
  } catch (error) {
    if (isQuotaExceededError(error)) {
      await updateLocalUserChatIndex(uid, conversationId, flags);
      return;
    }
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function renameGroupChat(
  conversation: Conversation,
  newTitle: string
): Promise<void> {
  const cleanTitle = clampText(newTitle, LIMITS.TITLE_MAX);
  if (!cleanTitle || conversation.type !== 'group') return;

  const convPath = `conversations/${conversation.id}`;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'conversations', conversation.id), {
      title: cleanTitle,
      updatedAt: serverTimestamp(),
    });
    for (const memberId of conversation.memberIds) {
      batch.update(doc(db, 'users', memberId, 'chats', conversation.id), {
        title: cleanTitle,
        updatedAt: serverTimestamp(),
      });
    }
    await runFirestoreWrite(() => batch.commit());
  } catch (error) {
    if (isQuotaExceededError(error)) {
      const uid = auth.currentUser?.uid;
      await updateLocalConversation(conversation.id, { title: cleanTitle });
      if (uid) await updateLocalUserChatIndex(uid, conversation.id, { title: cleanTitle });
      return;
    }
    handleFirestoreError(error, OperationType.UPDATE, convPath);
  }
}

export async function addMemberToGroupChat(
  conversation: Conversation,
  newMember: PublicProfile
): Promise<void> {
  if (conversation.type !== 'group') return;
  if (conversation.memberIds.includes(newMember.uid)) return;
  if (conversation.memberIds.length >= LIMITS.MEMBERS_MAX) {
    throw new Error(`Groups are limited to ${LIMITS.MEMBERS_MAX} members.`);
  }

  const nextMemberIds = [...conversation.memberIds, newMember.uid];
  const convPath = `conversations/${conversation.id}`;

  try {
    const batch = writeBatch(db);

    batch.update(doc(db, 'conversations', conversation.id), {
      memberIds: nextMemberIds,
      updatedAt: serverTimestamp(),
    });

    for (const existingUid of conversation.memberIds) {
      batch.update(doc(db, 'conversations', conversation.id, 'members', existingUid), {
        memberIds: nextMemberIds,
        updatedAt: serverTimestamp(),
      });
    }

    batch.set(doc(db, 'conversations', conversation.id, 'members', newMember.uid), {
      uid: newMember.uid,
      conversationId: conversation.id,
      displayName: newMember.displayName,
      photoURL: newMember.photoURL,
      role: 'member',
      memberIds: nextMemberIds,
      isTyping: false,
      typingAt: serverTimestamp(),
      lastReadAt: serverTimestamp(),
      joinedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'users', newMember.uid, 'chats', conversation.id), {
      conversationId: conversation.id,
      userId: newMember.uid,
      type: 'group',
      title: conversation.title,
      photoURL: '',
      peerUid: '',
      themeId: conversation.themeId,
      quickEmoji: conversation.quickEmoji,
      lastMessageKind: conversation.lastMessageKind || 'text',
      lastMediaType: conversation.lastMediaType || 'text',
      lastSnapStatus: conversation.lastSnapStatus || 'sent',
      lastSnapOpened: true,
      streakCount: conversation.streakCount || 0,
      lastMessageText: conversation.lastMessageText,
      lastMessageSenderId: conversation.lastMessageSenderId,
      lastMessageSenderName: conversation.lastMessageSenderName,
      lastMessageAt: conversation.lastMessageAt || serverTimestamp(),
      lastReadAt: serverTimestamp(),
      unreadCount: 1,
      pinned: false,
      muted: false,
      archived: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await runFirestoreWrite(() => batch.commit());
  } catch (error) {
    if (isQuotaExceededError(error)) {
      await updateLocalConversation(conversation.id, { memberIds: nextMemberIds });
      const existingMembers = (await cacheGet<ConversationMember[]>(`members_${conversation.id}`)) || [];
      const now = Timestamp.now();
      await cacheSet(
        `members_${conversation.id}`,
        [
          ...existingMembers,
          {
            uid: newMember.uid,
            conversationId: conversation.id,
            displayName: newMember.displayName,
            photoURL: newMember.photoURL,
            role: 'member',
            memberIds: nextMemberIds,
            isTyping: false,
            typingAt: now,
            lastReadAt: now,
            joinedAt: now,
            updatedAt: now,
          } satisfies ConversationMember,
        ],
        true
      );
      return;
    }
    handleFirestoreError(error, OperationType.WRITE, convPath);
  }
}

export async function leaveGroupChat(
  conversation: Conversation,
  uid: string
): Promise<void> {
  if (conversation.type !== 'group') return;
  const remainingIds = conversation.memberIds.filter((id) => id !== uid);
  const convPath = `conversations/${conversation.id}`;

  try {
    const batch = writeBatch(db);
    if (remainingIds.length >= 1) {
      batch.update(doc(db, 'conversations', conversation.id), {
        memberIds: remainingIds,
        updatedAt: serverTimestamp(),
      });
      for (const memberId of remainingIds) {
        batch.update(doc(db, 'conversations', conversation.id, 'members', memberId), {
          memberIds: remainingIds,
          updatedAt: serverTimestamp(),
        });
      }
    }
    batch.delete(doc(db, 'conversations', conversation.id, 'members', uid));
    batch.delete(doc(db, 'users', uid, 'chats', conversation.id));
    await runFirestoreWrite(() => batch.commit());
  } catch (error) {
    if (isQuotaExceededError(error)) {
      await deleteLocalUserChat(uid, conversation.id);
      return;
    }
    handleFirestoreError(error, OperationType.WRITE, convPath);
  }
}

// --- Memories & My Eyes Only ---

export async function hashMyEyesOnlyPin(pin: string): Promise<string> {
  const clean = pin.trim();
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoded = new TextEncoder().encode(`coolerup_meo_${clean}`);
    const digest = await crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return `pin_${clean}`;
}

export async function saveMemoryItem(params: {
  userId: string;
  mediaUrl: string;
  mediaType: 'photo' | 'video';
  caption?: string;
  source?: 'snap' | 'camera_roll' | 'spotlight';
  locked?: boolean;
}): Promise<string> {
  const { userId, mediaUrl, mediaType, caption = '', source = 'snap', locked = false } = params;
  let finalUrl = mediaUrl;
  if (finalUrl.startsWith('data:') && !isWriteQuotaPaused()) {
    const uploaded = await uploadMediaWithFallback({
      uid: userId,
      folder: 'memories',
      media: finalUrl,
      ext: mediaType === 'video' ? 'webm' : 'jpg',
    });
    finalUrl = uploaded.url;
  }
  if (finalUrl.length > LIMITS.IMAGE_DATA_MAX) {
    return await addLocalMemoryItem({ userId, mediaUrl: finalUrl, mediaType, caption, source, locked });
  }

  const memRef = doc(collection(db, 'users', userId, 'memories'));
  const memoryId = memRef.id;
  const path = `users/${userId}/memories/${memoryId}`;
  try {
    await runFirestoreWrite(() =>
      setDoc(memRef, {
        id: memoryId,
        userId,
        mediaUrl: finalUrl,
        mediaType,
        caption: caption.trim().slice(0, LIMITS.STORY_CAPTION_MAX),
        source,
        locked,
        savedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    return memoryId;
  } catch (error) {
    if (isQuotaExceededError(error)) {
      return await addLocalMemoryItem({ userId, mediaUrl: finalUrl, mediaType, caption, source, locked });
    }
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function toggleMemoryLock(
  userId: string,
  memoryId: string,
  locked: boolean
): Promise<void> {
  if (memoryId.startsWith('local_') || isWriteQuotaPaused()) {
    await toggleLocalMemoryLock(userId, memoryId, locked);
    return;
  }
  const path = `users/${userId}/memories/${memoryId}`;
  try {
    await runFirestoreWrite(() =>
      updateDoc(doc(db, 'users', userId, 'memories', memoryId), {
        locked,
        updatedAt: serverTimestamp(),
      })
    );
  } catch (error) {
    if (isQuotaExceededError(error)) {
      await toggleLocalMemoryLock(userId, memoryId, locked);
      return;
    }
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteMemoryItem(userId: string, memoryId: string): Promise<void> {
  if (memoryId.startsWith('local_') || isWriteQuotaPaused()) {
    await deleteLocalMemoryItem(userId, memoryId);
    return;
  }
  const path = `users/${userId}/memories/${memoryId}`;
  try {
    await runFirestoreWrite(() => deleteDoc(doc(db, 'users', userId, 'memories', memoryId)));
  } catch (error) {
    if (isQuotaExceededError(error)) {
      await deleteLocalMemoryItem(userId, memoryId);
      return;
    }
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Notifications ---

export async function createNotification(params: {
  userId: string;
  type: AppNotificationType;
  fromUser: PublicProfile;
  message: string;
}): Promise<void> {
  const { userId, type, fromUser, message } = params;
  if (!userId || userId === fromUser.uid) return;
  if (isWriteQuotaPaused()) {
    await addLocalNotification({
      userId,
      type,
      fromUserId: fromUser.uid,
      fromUserName: fromUser.displayName,
      fromPhotoURL: fromUser.photoURL,
      message,
    });
    return;
  }
  const notifRef = doc(collection(db, 'users', userId, 'notifications'));
  try {
    await runFirestoreWrite(() =>
      setDoc(notifRef, {
        id: notifRef.id,
        userId,
        type,
        fromUserId: fromUser.uid,
        fromUserName: fromUser.displayName.slice(0, LIMITS.DISPLAY_NAME_MAX),
        fromPhotoURL: fromUser.photoURL.slice(0, LIMITS.PHOTO_URL_MAX),
        message: message.slice(0, 240),
        read: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  } catch {
    // Non-fatal side-effect notification
  }
}

export async function markNotificationRead(userId: string, notificationId: string): Promise<void> {
  if (notificationId.startsWith('local_') || isWriteQuotaPaused()) {
    await markLocalNotificationRead(userId, notificationId);
    return;
  }
  try {
    await runFirestoreWrite(() =>
      updateDoc(doc(db, 'users', userId, 'notifications', notificationId), {
        read: true,
        updatedAt: serverTimestamp(),
      })
    );
  } catch (error) {
    if (isQuotaExceededError(error)) {
      await markLocalNotificationRead(userId, notificationId);
    }
  }
}

export async function markAllNotificationsRead(
  userId: string,
  unreadIds: string[]
): Promise<void> {
  await markAllLocalNotificationsRead(userId);
  if (isWriteQuotaPaused() || unreadIds.length === 0) return;
  try {
    const batch = writeBatch(db);
    unreadIds
      .filter((id) => !id.startsWith('local_'))
      .slice(0, 30)
      .forEach((id) => {
        batch.update(doc(db, 'users', userId, 'notifications', id), {
          read: true,
          updatedAt: serverTimestamp(),
        });
      });
    await runFirestoreWrite(() => batch.commit());
  } catch {
    // Best-effort mark read
  }
}

export async function deleteNotification(userId: string, notificationId: string): Promise<void> {
  if (notificationId.startsWith('local_') || isWriteQuotaPaused()) {
    await deleteLocalNotification(userId, notificationId);
    return;
  }
  try {
    await runFirestoreWrite(() =>
      deleteDoc(doc(db, 'users', userId, 'notifications', notificationId))
    );
  } catch (error) {
    if (isQuotaExceededError(error)) {
      await deleteLocalNotification(userId, notificationId);
    }
  }
}

// --- Spotlight Comments & Creator Follow ---

export async function addSpotlightComment(params: {
  videoId: string;
  videoAuthorId: string;
  author: PublicProfile;
  text: string;
}): Promise<string> {
  const { videoId, videoAuthorId, author, text } = params;
  const cleanText = text.trim().slice(0, 500);
  if (!cleanText) return '';

  if (videoId.startsWith('local_') || isWriteQuotaPaused()) {
    return await addLocalSpotlightComment({ videoId, author, text: cleanText });
  }

  const cmtRef = doc(collection(db, 'spotlightVideos', videoId, 'comments'));
  const path = `spotlightVideos/${videoId}/comments/${cmtRef.id}`;
  try {
    const batch = writeBatch(db);
    batch.set(cmtRef, {
      id: cmtRef.id,
      videoId,
      authorId: author.uid,
      authorName: author.displayName.slice(0, LIMITS.DISPLAY_NAME_MAX),
      authorHandle: author.handle.slice(0, LIMITS.HANDLE_MAX),
      authorPhotoURL: author.photoURL.slice(0, LIMITS.PHOTO_URL_MAX),
      text: cleanText,
      createdAt: serverTimestamp(),
    });
    batch.update(doc(db, 'spotlightVideos', videoId), {
      commentCount: increment(1),
      updatedAt: serverTimestamp(),
    });
    await runFirestoreWrite(() => batch.commit());
    if (videoAuthorId !== author.uid) {
      void createNotification({
        userId: videoAuthorId,
        type: 'spotlight_comment',
        fromUser: author,
        message: `commented on your Spotlight: "${cleanText.slice(0, 80)}"`,
      });
    }
    return cmtRef.id;
  } catch (error) {
    if (isQuotaExceededError(error)) {
      return await addLocalSpotlightComment({ videoId, author, text: cleanText });
    }
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteSpotlightComment(
  videoId: string,
  commentId: string
): Promise<void> {
  if (videoId.startsWith('local_') || commentId.startsWith('local_') || isWriteQuotaPaused()) {
    await deleteLocalSpotlightComment(videoId, commentId);
    return;
  }
  const path = `spotlightVideos/${videoId}/comments/${commentId}`;
  try {
    await runFirestoreWrite(() =>
      deleteDoc(doc(db, 'spotlightVideos', videoId, 'comments', commentId))
    );
  } catch (error) {
    if (isQuotaExceededError(error)) {
      await deleteLocalSpotlightComment(videoId, commentId);
      return;
    }
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function toggleFollowCreator(
  meUid: string,
  targetUid: string,
  currentlyFollowing: boolean
): Promise<void> {
  if (!meUid || !targetUid || meUid === targetUid) return;
  if (isWriteQuotaPaused()) {
    await toggleLocalFollowCreator(meUid, targetUid);
    return;
  }
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'profiles', meUid), {
      following: currentlyFollowing ? arrayRemove(targetUid) : arrayUnion(targetUid),
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'profiles', targetUid), {
      followers: currentlyFollowing ? arrayRemove(meUid) : arrayUnion(meUid),
      updatedAt: serverTimestamp(),
    });
    await runFirestoreWrite(() => batch.commit());
  } catch (error) {
    if (isQuotaExceededError(error)) {
      await toggleLocalFollowCreator(meUid, targetUid);
      return;
    }
    handleFirestoreError(error, OperationType.UPDATE, `profiles/${targetUid}`);
  }
}

export async function toggleLikeStory(
  storyId: string,
  uid: string,
  currentLikedBy: string[] = []
): Promise<void> {
  if (storyId.startsWith('local_') || isWriteQuotaPaused()) {
    await toggleLocalStoryLike(storyId, uid);
    return;
  }
  const liked = currentLikedBy.includes(uid);
  try {
    await runFirestoreWrite(() =>
      updateDoc(doc(db, 'stories', storyId), {
        likedBy: liked ? arrayRemove(uid) : arrayUnion(uid),
        updatedAt: serverTimestamp(),
      })
    );
  } catch (error) {
    if (isQuotaExceededError(error)) {
      await toggleLocalStoryLike(storyId, uid);
      return;
    }
    handleFirestoreError(error, OperationType.UPDATE, `stories/${storyId}`);
  }
}

// --- Snap Map Location & Ghost Mode ---

export async function updateUserLocation(
  uid: string,
  lat: number,
  lng: number,
  locationLabel: string
): Promise<void> {
  const cleanLabel = locationLabel.trim().slice(0, 120);
  if (isWriteQuotaPaused()) {
    await updateLocalProfile(uid, { lat, lng, locationLabel: cleanLabel });
    return;
  }
  try {
    await runFirestoreWrite(() =>
      updateDoc(doc(db, 'profiles', uid), {
        lat,
        lng,
        locationLabel: cleanLabel,
        locationUpdatedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  } catch (error) {
    if (isQuotaExceededError(error)) {
      await updateLocalProfile(uid, { lat, lng, locationLabel: cleanLabel });
      return;
    }
    handleFirestoreError(error, OperationType.UPDATE, `profiles/${uid}`);
  }
}

export async function toggleGhostMode(uid: string, ghostMode: boolean): Promise<void> {
  if (isWriteQuotaPaused()) {
    await updateLocalProfile(uid, { ghostMode });
    return;
  }
  try {
    await runFirestoreWrite(() =>
      updateDoc(doc(db, 'profiles', uid), {
        ghostMode,
        updatedAt: serverTimestamp(),
      })
    );
  } catch (error) {
    if (isQuotaExceededError(error)) {
      await updateLocalProfile(uid, { ghostMode });
      return;
    }
    handleFirestoreError(error, OperationType.UPDATE, `profiles/${uid}`);
  }
}

// --- Chat Clear, Privacy Settings, Safety & Trophies ---

export async function clearUnsavedChat(uid: string, conversationId: string): Promise<void> {
  if (conversationId.startsWith('local_') || isWriteQuotaPaused()) {
    await clearLocalChatMessages(uid, conversationId);
    return;
  }
  try {
    await runFirestoreWrite(() =>
      updateDoc(doc(db, 'users', uid, 'chats', conversationId), {
        clearedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  } catch (error) {
    if (isQuotaExceededError(error)) {
      await clearLocalChatMessages(uid, conversationId);
      return;
    }
    handleFirestoreError(error, OperationType.UPDATE, `users/${uid}/chats/${conversationId}`);
  }
}

export async function updatePrivateSettings(
  uid: string,
  updates: Partial<
    Pick<
      PrivateUserInfo,
      | 'birthday'
      | 'phoneNumber'
      | 'myEyesOnlyPinHash'
      | 'privacyContact'
      | 'privacyStory'
      | 'privacyQuickAdd'
      | 'blockedUids'
      | 'notificationsEnabled'
      | 'themeMode'
    >
  >
): Promise<void> {
  if (isWriteQuotaPaused()) {
    await updateLocalPrivateInfo(uid, updates);
    return;
  }
  try {
    await runFirestoreWrite(() =>
      updateDoc(doc(db, 'users', uid, 'private', 'info'), {
        ...updates,
        updatedAt: serverTimestamp(),
      })
    );
    await updateLocalPrivateInfo(uid, updates);
  } catch (error) {
    if (isQuotaExceededError(error)) {
      await updateLocalPrivateInfo(uid, updates);
      return;
    }
    handleFirestoreError(error, OperationType.UPDATE, `users/${uid}/private/info`);
  }
}

export async function blockUser(
  uid: string,
  targetUid: string,
  currentBlocked: string[] = []
): Promise<void> {
  if (!uid || !targetUid || uid === targetUid) return;
  const next = Array.from(new Set([...currentBlocked, targetUid]));
  await updatePrivateSettings(uid, { blockedUids: next });
}

export async function unblockUser(
  uid: string,
  targetUid: string,
  currentBlocked: string[] = []
): Promise<void> {
  const next = currentBlocked.filter((id) => id !== targetUid);
  await updatePrivateSettings(uid, { blockedUids: next });
}

export async function reportUser(params: {
  reporterId: string;
  targetUserId: string;
  reason: string;
  details?: string;
}): Promise<void> {
  const { reporterId, targetUserId, reason, details = '' } = params;
  if (!reporterId || !targetUserId || reporterId === targetUserId) return;
  if (isWriteQuotaPaused()) return;
  const repRef = doc(collection(db, 'reports'));
  try {
    await runFirestoreWrite(() =>
      setDoc(repRef, {
        id: repRef.id,
        reporterId,
        targetUserId,
        reason: reason.trim().slice(0, 100) || 'Inappropriate behavior',
        details: details.trim().slice(0, 500),
        createdAt: serverTimestamp(),
      })
    );
  } catch (error) {
    if (!isQuotaExceededError(error)) {
      handleFirestoreError(error, OperationType.CREATE, `reports/${repRef.id}`);
    }
  }
}

export async function awardTrophyIfMissing(
  profile: PublicProfile,
  trophyId: string
): Promise<void> {
  const existing = profile.trophies || [];
  if (existing.includes(trophyId)) return;
  const next = Array.from(new Set([...existing, trophyId])).slice(0, 30);
  if (isWriteQuotaPaused()) {
    await updateLocalProfile(profile.uid, { trophies: next });
    return;
  }
  try {
    await runFirestoreWrite(() =>
      updateDoc(doc(db, 'profiles', profile.uid), {
        trophies: next,
        updatedAt: serverTimestamp(),
      })
    );
  } catch {
    // Non-fatal trophy sync
  }
}

