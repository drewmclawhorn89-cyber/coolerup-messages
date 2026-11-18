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
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { clampText, LIMITS, sanitizeHandle } from '../lib/validation';
import type {
  ChatThemeId,
  Conversation,
  MediaType,
  Message,
  MessageKind,
  PrivateUserInfo,
  PublicProfile,
  SnapStatus,
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

  let existingProfile: PublicProfile | null = null;
  try {
    const snap = await getDoc(doc(db, 'profiles', uid));
    if (snap.exists()) {
      existingProfile = snap.data() as PublicProfile;
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, profilePath);
  }

  if (!existingProfile) {
    const handleSeed = user.email ? user.email.split('@')[0] : displayName;
    const handle = sanitizeHandle(handleSeed, uid);
    try {
      await setDoc(doc(db, 'profiles', uid), {
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
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, profilePath);
    }
  } else {
    try {
      await updateDoc(doc(db, 'profiles', uid), {
        isOnline: true,
        snapScore: existingProfile.snapScore ?? 0,
        lastSeenAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        ...(photoURL && photoURL !== existingProfile.photoURL ? { photoURL } : {}),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, profilePath);
    }
  }

  let existingPrivate: PrivateUserInfo | null = null;
  try {
    const privSnap = await getDoc(doc(db, 'users', uid, 'private', 'info'));
    if (privSnap.exists()) {
      existingPrivate = privSnap.data() as PrivateUserInfo;
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, privatePath);
  }

  if (!existingPrivate) {
    try {
      await setDoc(doc(db, 'users', uid, 'private', 'info'), {
        uid,
        email,
        themeMode: 'light',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, privatePath);
    }
  } else if (email && email !== existingPrivate.email) {
    try {
      await updateDoc(doc(db, 'users', uid, 'private', 'info'), {
        email,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, privatePath);
    }
  }

  let finalProfileSnap;
  let finalPrivateSnap;
  try {
    finalProfileSnap = await getDoc(doc(db, 'profiles', uid));
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, profilePath);
  }
  try {
    finalPrivateSnap = await getDoc(doc(db, 'users', uid, 'private', 'info'));
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, privatePath);
  }

  const finalProfile = finalProfileSnap.data() as PublicProfile;
  const finalPrivate = finalPrivateSnap.data() as PrivateUserInfo;

  await ensureSavedMessagesThread(finalProfile);

  return { profile: finalProfile, privateInfo: finalPrivate };
}

async function ensureSavedMessagesThread(profile: PublicProfile): Promise<void> {
  const conversationId = `saved_${profile.uid}`;
  const chatPath = `users/${profile.uid}/chats/${conversationId}`;
  try {
    const chatSnap = await getDoc(doc(db, 'users', profile.uid, 'chats', conversationId));
    if (chatSnap.exists()) return;

    const convSnap = await getDoc(doc(db, 'conversations', conversationId));
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

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, chatPath);
  }
}

export async function setUserOnlineStatus(uid: string, isOnline: boolean): Promise<void> {
  const path = `profiles/${uid}`;
  try {
    await updateDoc(doc(db, 'profiles', uid), {
      isOnline,
      lastSeenAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    if (String(error).includes('Missing or insufficient permissions')) {
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
    await updateDoc(doc(db, 'profiles', uid), {
      displayName: cleanName,
      displayNameLower: cleanName.toLowerCase(),
      handle: cleanHandle,
      statusText: cleanStatus,
      isDiscoverable: updates.isDiscoverable,
      ...(updates.avatarSeed !== undefined
        ? { avatarSeed: updates.avatarSeed.slice(0, LIMITS.AVATAR_SEED_MAX) }
        : {}),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateThemePreference(
  uid: string,
  themeMode: 'light' | 'dark'
): Promise<void> {
  const path = `users/${uid}/private/info`;
  try {
    await updateDoc(doc(db, 'users', uid, 'private', 'info'), {
      themeMode,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
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
    const snap = await getDoc(doc(db, 'friendships', friendshipId));
    if (!snap.exists()) {
      await setDoc(doc(db, 'friendships', friendshipId), {
        id: friendshipId,
        userIds,
        requesterId: me.uid,
        receiverId: peer.uid,
        status: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const existing = snap.data();
      if (existing.status === 'accepted') return;
      await updateDoc(doc(db, 'friendships', friendshipId), {
        requesterId: me.uid,
        receiverId: peer.uid,
        status: 'pending',
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function respondToFriendRequest(
  friendshipId: string,
  accept: boolean
): Promise<void> {
  const path = `friendships/${friendshipId}`;
  try {
    await updateDoc(doc(db, 'friendships', friendshipId), {
      status: accept ? 'accepted' : 'declined',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function removeFriendship(friendshipId: string): Promise<void> {
  const path = `friendships/${friendshipId}`;
  try {
    await deleteDoc(doc(db, 'friendships', friendshipId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Conversations & Messaging ---

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
    const convSnap = await getDoc(doc(db, 'conversations', conversationId));
    if (convSnap.exists()) {
      const myChatSnap = await getDoc(doc(db, 'users', me.uid, 'chats', conversationId));
      const convData = convSnap.data() as Conversation;
      if (!myChatSnap.exists()) {
        await setDoc(doc(db, 'users', me.uid, 'chats', conversationId), {
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
        });
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

    await batch.commit();
    return conversationId;
  } catch (error) {
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

    await batch.commit();
    return conversationId;
  } catch (error) {
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
  const cleanImage = imageData.slice(0, LIMITS.IMAGE_DATA_MAX);

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

    await batch.commit();
  } catch (error) {
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

    await batch.commit();
  } catch (error) {
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
    await batch.commit();
  } catch (error) {
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
    await batch.commit();
  } catch (error) {
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
    await updateDoc(doc(db, 'conversations', conversation.id, 'messages', message.id), {
      imageData: '',
      snapViewedBy: arrayUnion(viewerUid),
      snapStatus: message.snapStatus && message.snapStatus !== 'delivered' && message.snapStatus !== 'sent'
        ? message.snapStatus
        : 'opened',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    if (String(error).includes('Missing or insufficient permissions')) return;
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
    await updateDoc(doc(db, 'conversations', conversationId, 'messages', messageId), {
      savedBy: isSaved ? arrayRemove(uid) : arrayUnion(uid),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, msgPath);
  }
}

export async function deleteUserChat(uid: string, conversationId: string): Promise<void> {
  if (conversationId === `saved_${uid}`) return;
  const path = `users/${uid}/chats/${conversationId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'chats', conversationId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function createStory(params: {
  author: PublicProfile;
  mediaType?: 'photo' | 'video';
  imageData: string;
  caption: string;
  durationSec?: number;
}): Promise<string> {
  const { author, mediaType = 'photo', imageData, caption, durationSec = 5 } = params;
  const storyRef = doc(collection(db, 'stories'));
  const storyId = storyRef.id;
  const storyPath = `stories/${storyId}`;
  const expiresAt = Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000);

  try {
    const batch = writeBatch(db);
    batch.set(storyRef, {
      id: storyId,
      authorId: author.uid,
      authorName: author.displayName,
      authorHandle: author.handle,
      authorPhotoURL: author.photoURL,
      mediaType,
      imageData: imageData.slice(0, LIMITS.IMAGE_DATA_MAX),
      caption: caption.trim().slice(0, LIMITS.STORY_CAPTION_MAX),
      durationSec: Math.min(30, Math.max(1, durationSec)),
      viewerIds: [],
      isPublicStory: true,
      expiresAt,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.update(doc(db, 'profiles', author.uid), {
      snapScore: increment(1),
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
    return storyId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, storyPath);
  }
}

export async function markStoryViewed(storyId: string, viewerUid: string): Promise<void> {
  const path = `stories/${storyId}`;
  try {
    await updateDoc(doc(db, 'stories', storyId), {
      viewerIds: arrayUnion(viewerUid),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    if (String(error).includes('Missing or insufficient permissions')) return;
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteStory(storyId: string): Promise<void> {
  const path = `stories/${storyId}`;
  try {
    await deleteDoc(doc(db, 'stories', storyId));
  } catch (error) {
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

    await batch.commit();
  } catch (error) {
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

    await batch.commit();
  } catch (error) {
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
    await updateDoc(doc(db, 'conversations', conversationId, 'messages', messageId), {
      [`reactions.${uid}`]: alreadySame ? deleteField() : emoji.slice(0, LIMITS.QUICK_EMOJI_MAX),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, msgPath);
  }
}

export async function setTypingStatus(
  conversationId: string,
  uid: string,
  isTyping: boolean
): Promise<void> {
  const path = `conversations/${conversationId}/members/${uid}`;
  try {
    await updateDoc(doc(db, 'conversations', conversationId, 'members', uid), {
      isTyping,
      typingAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    if (String(error).includes('Missing or insufficient permissions')) return;
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function markConversationRead(
  conversationId: string,
  uid: string
): Promise<void> {
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
    await batch.commit();
  } catch (error) {
    if (String(error).includes('Missing or insufficient permissions')) return;
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
    await batch.commit();
  } catch (error) {
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
    await updateDoc(doc(db, 'users', uid, 'chats', conversationId), {
      ...flags,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
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
    await batch.commit();
  } catch (error) {
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

    await batch.commit();
  } catch (error) {
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
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, convPath);
  }
}
