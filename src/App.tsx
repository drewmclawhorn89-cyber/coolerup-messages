import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { AlertTriangle, Camera, CircleDot, Film, MapPin, MessageCircle, X } from 'lucide-react';
import { CallModal } from './components/CallModal';
import { GhostLogo } from './components/GhostLogo';
import { ChatDetailsDrawer } from './components/ChatDetailsDrawer';
import { ChatWindow } from './components/ChatWindow';
import { ConversationList } from './components/ConversationList';
import { MemoriesModal } from './components/MemoriesModal';
import { NavRail } from './components/NavRail';
import { NewChatModal } from './components/NewChatModal';
import { NotificationsModal } from './components/NotificationsModal';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PeopleDirectory } from './components/PeopleDirectory';
import { ProfileModal } from './components/ProfileModal';
import { SettingsModal } from './components/SettingsModal';
import { SignInView } from './components/SignInView';
import { SnapCameraModal } from './components/SnapCameraModal';
import { SnapMapScreen } from './components/SnapMapScreen';
import { SnapViewerModal } from './components/SnapViewerModal';
import { SpotlightFeedPanel } from './components/SpotlightFeedPanel';
import { StoriesPanel } from './components/StoriesPanel';
import { StoryViewerModal } from './components/StoryViewerModal';
import {
  auth,
  db,
  handleFirestoreError,
  isQuotaExceededError,
  isReadQuotaPaused,
  markReadQuotaExceeded,
  OperationType,
} from './lib/firebase';
import {
  bootstrapLocalSavedChat,
  cacheGet,
  cacheSet,
  mergeServerCacheList,
  subscribeLocalCacheKey,
} from './lib/localFallbackStore';
import { LIMITS, transcodeVideoFileToBoundedDataUrl } from './lib/validation';
import {
  addMemberToGroupChat,
  awardTrophyIfMissing,
  blockUser,
  clearUnsavedChat,
  consumeAndDeleteSnapMedia,
  createGroupChat,
  createOrOpenDirectChat,
  createSpotlightVideo,
  createStory,
  deleteMemoryItem,
  deleteNotification,
  deleteSpotlightVideo,
  deleteStory,
  deleteUserChat,
  getConversationById,
  incrementSpotlightView,
  leaveGroupChat,
  markAllNotificationsRead,
  markNotificationRead,
  markSnapReplayed,
  markSnapScreenshotted,
  markStoryViewed,
  renameGroupChat,
  reportUser,
  resolveSpotlightVideoSrc,
  respondToFriendRequest,
  saveMemoryItem,
  sendFriendRequest,
  sendMessage,
  setUserOnlineStatus,
  syncUserOnSignIn,
  toggleFollowCreator,
  toggleGhostMode,
  toggleLikeSpotlightVideo,
  toggleLikeStory,
  toggleMemoryLock,
  unblockUser,
  updateConversationAppearance,
  updatePrivateSettings,
  updateSpotlightVideoSound,
  updateThemePreference,
  updateUserChatFlags,
  updateUserLocation,
  updateUserProfile,
} from './services/messengerService';
import type {
  AppNotification,
  Conversation,
  ConversationMember,
  Friendship,
  MemoryItem,
  Message,
  NavTab,
  PrivateUserInfo,
  PublicProfile,
  SpotlightVideo,
  Story,
  UserChatIndex,
} from './types/messenger';

const SWIPE_TABS: NavTab[] = ['map', 'chats', 'camera', 'stories', 'spotlight'];

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [currentUserProfile, setCurrentUserProfile] = useState<PublicProfile | null>(null);
  const [privateInfo, setPrivateInfo] = useState<PrivateUserInfo | null>(null);

  const [darkMode, setDarkMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('coolerup-theme') === 'dark';
    }
    return false;
  });

  const [activeTab, setActiveTab] = useState<NavTab>('camera');
  const [chats, setChats] = useState<UserChatIndex[]>([]);
  const [profiles, setProfiles] = useState<PublicProfile[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [spotlightVideos, setSpotlightVideos] = useState<SpotlightVideo[]>([]);
  const [friendships, setFriendships] = useState<Friendship[]>([]);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  const [activeConvData, setActiveConvData] = useState<{
    conversation: Conversation;
    members: ConversationMember[];
    messages: Message[];
  } | null>(null);

  const [showDetails, setShowDetails] = useState(false);
  const [newChatModalMode, setNewChatModalMode] = useState<'direct' | 'group' | null>(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showMemoriesModal, setShowMemoriesModal] = useState(false);
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [activeCall, setActiveCall] = useState<{
    mode: 'voice' | 'video';
    peerName: string;
    peerPhotoURL?: string;
    peerAvatarSeed?: string;
  } | null>(null);

  const [gmpQuotaBanner, setGmpQuotaBanner] = useState(false);
  const [gmpBannerDismissed, setGmpBannerDismissed] = useState(false);

  // Snapchat modals
  const [cameraModalConfig, setCameraModalConfig] = useState<{
    conversationId?: string | null;
    mode: 'snap' | 'story' | 'spotlight';
    captureKind?: 'photo' | 'video';
    returnToTab?: NavTab;
  } | null>(null);
  const [viewingSnap, setViewingSnap] = useState<{
    message: Message;
    conversation: Conversation;
  } | null>(null);
  const [viewingStoryAuthorId, setViewingStoryAuthorId] = useState<string | null>(null);

  const [pendingHandleInvite, setPendingHandleInvite] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('chat');
  });

  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const onQuota = () => setGmpQuotaBanner(true);
    window.addEventListener('gmp-quota-exceeded', onQuota);
    return () => window.removeEventListener('gmp-quota-exceeded', onQuota);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
      localStorage.setItem('coolerup-theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('coolerup-theme', 'light');
    }
  }, [darkMode]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setCurrentUserProfile(null);
        setPrivateInfo(null);
        setChats([]);
        setProfiles([]);
        setStories([]);
        setSpotlightVideos([]);
        setFriendships([]);
        setMemories([]);
        setNotifications([]);
        setActiveConversationId(null);
        setActiveConvData(null);
        setAuthReady(true);
        return;
      }

      try {
        const { profile, privateInfo: priv } = await syncUserOnSignIn(user);
        setCurrentUserProfile(profile);
        setPrivateInfo(priv);
        if (priv.themeMode === 'dark') {
          setDarkMode(true);
        } else if (priv.themeMode === 'light') {
          setDarkMode(false);
        }
      } catch (err) {
        if (!isQuotaExceededError(err)) {
          console.error('Sign-in sync error:', err);
        }
      } finally {
        setAuthReady(true);
      }
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    if (!currentUserProfile?.uid) return;
    const uid = currentUserProfile.uid;
    const unsubLocal = subscribeLocalCacheKey<PublicProfile>(`profile_${uid}`, (cached) => {
      if (cached) setCurrentUserProfile(cached);
    });
    if (isReadQuotaPaused()) {
      return () => unsubLocal();
    }

    const unsub = onSnapshot(
      query(collection(db, 'profiles'), where('uid', '==', uid)),
      (snap) => {
        if (!snap.empty) {
          const data = snap.docs[0].data() as PublicProfile;
          setCurrentUserProfile(data);
          void cacheSet(`profile_${uid}`, data);
        }
      },
      (error) => {
        if (isQuotaExceededError(error)) {
          markReadQuotaExceeded();
          return;
        }
        handleFirestoreError(error, OperationType.LIST, `profiles/${uid}`);
      }
    );
    return () => {
      unsub();
      unsubLocal();
    };
  }, [currentUserProfile?.uid]);

  useEffect(() => {
    if (!currentUserProfile?.uid) return;
    const unsubLocal = subscribeLocalCacheKey<PublicProfile[]>('profiles', (cached) => {
      if (cached) setProfiles(cached);
    });
    if (isReadQuotaPaused()) {
      return () => unsubLocal();
    }

    const unsub = onSnapshot(
      query(collection(db, 'profiles'), where('isDiscoverable', '==', true), limit(40)),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as PublicProfile);
        setProfiles(list);
        void cacheSet('profiles', list);
      },
      (error) => {
        if (isQuotaExceededError(error)) {
          markReadQuotaExceeded();
          return;
        }
        handleFirestoreError(error, OperationType.LIST, 'profiles');
      }
    );
    return () => {
      unsub();
      unsubLocal();
    };
  }, [currentUserProfile?.uid]);

  useEffect(() => {
    if (!currentUserProfile?.uid) return;
    const uid = currentUserProfile.uid;
    const path = `users/${uid}/chats`;

    const unsubLocal = subscribeLocalCacheKey<UserChatIndex[]>(`chats_${uid}`, (cached) => {
      if (cached) setChats(cached);
    });

    if (isReadQuotaPaused()) {
      void cacheGet<UserChatIndex[]>(`chats_${uid}`).then(async (cached) => {
        if ((!cached || cached.length === 0) && currentUserProfile) {
          await bootstrapLocalSavedChat(currentUserProfile);
        }
        const ready = await cacheGet<UserChatIndex[]>(`chats_${uid}`);
        if (ready) setChats(ready);
      });
      return () => unsubLocal();
    }

    const unsub = onSnapshot(
      query(collection(db, 'users', uid, 'chats'), orderBy('lastMessageAt', 'desc')),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as UserChatIndex);
        void mergeServerCacheList<UserChatIndex>(`chats_${uid}`, list).then((merged) => {
          merged.sort(
            (a, b) => (b.lastMessageAt?.toMillis?.() ?? 0) - (a.lastMessageAt?.toMillis?.() ?? 0)
          );
          setChats(merged);
        });
      },
      (error) => {
        if (isQuotaExceededError(error)) {
          markReadQuotaExceeded();
          void cacheGet<UserChatIndex[]>(`chats_${uid}`).then(async (cached) => {
            if ((!cached || cached.length === 0) && currentUserProfile) {
              await bootstrapLocalSavedChat(currentUserProfile);
            }
            const ready = await cacheGet<UserChatIndex[]>(`chats_${uid}`);
            if (ready) setChats(ready);
          });
          return;
        }
        handleFirestoreError(error, OperationType.LIST, path);
      }
    );
    return () => {
      unsub();
      unsubLocal();
    };
  }, [currentUserProfile?.uid]);

  // Live 24-hour Stories subscription
  useEffect(() => {
    if (!currentUserProfile?.uid) return;
    const unsubLocal = subscribeLocalCacheKey<Story[]>('stories', (cached) => {
      if (cached) setStories(cached);
    });
    if (isReadQuotaPaused()) {
      return () => unsubLocal();
    }

    const unsub = onSnapshot(
      query(collection(db, 'stories'), where('isPublicStory', '==', true), limit(30)),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as Story);
        void mergeServerCacheList<Story>('stories', list).then((merged) => {
          setStories(merged);
        });
      },
      (error) => {
        if (isQuotaExceededError(error)) {
          markReadQuotaExceeded();
          return;
        }
        handleFirestoreError(error, OperationType.LIST, 'stories');
      }
    );
    return () => {
      unsub();
      unsubLocal();
    };
  }, [currentUserProfile?.uid]);

  // Live Spotlight Video Feed subscription
  useEffect(() => {
    if (!currentUserProfile?.uid) return;
    const unsubLocal = subscribeLocalCacheKey<SpotlightVideo[]>('spotlightVideos', (cached) => {
      if (cached) setSpotlightVideos(cached);
    });
    if (isReadQuotaPaused()) {
      return () => unsubLocal();
    }

    const unsub = onSnapshot(
      query(collection(db, 'spotlightVideos'), where('isPublic', '==', true), limit(25)),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as SpotlightVideo);
        void mergeServerCacheList<SpotlightVideo>('spotlightVideos', list).then((merged) => {
          merged.sort(
            (a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0)
          );
          setSpotlightVideos(merged);
        });
      },
      (error) => {
        if (isQuotaExceededError(error)) {
          markReadQuotaExceeded();
          return;
        }
        handleFirestoreError(error, OperationType.LIST, 'spotlightVideos');
      }
    );
    return () => {
      unsub();
      unsubLocal();
    };
  }, [currentUserProfile?.uid]);

  // Live Friendships & Friend Requests subscription
  useEffect(() => {
    if (!currentUserProfile?.uid) return;
    const uid = currentUserProfile.uid;
    const unsubLocal = subscribeLocalCacheKey<Friendship[]>(`friendships_${uid}`, (cached) => {
      if (cached) setFriendships(cached);
    });
    if (isReadQuotaPaused()) {
      return () => unsubLocal();
    }

    const unsub = onSnapshot(
      query(collection(db, 'friendships'), where('userIds', 'array-contains', uid)),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as Friendship);
        void mergeServerCacheList<Friendship>(`friendships_${uid}`, list).then((merged) => {
          setFriendships(merged);
        });
      },
      (error) => {
        if (isQuotaExceededError(error)) {
          markReadQuotaExceeded();
          return;
        }
        handleFirestoreError(error, OperationType.LIST, 'friendships');
      }
    );
    return () => {
      unsub();
      unsubLocal();
    };
  }, [currentUserProfile?.uid]);

  // Live Memories subscription
  useEffect(() => {
    if (!currentUserProfile?.uid) return;
    const uid = currentUserProfile.uid;
    const unsubLocal = subscribeLocalCacheKey<MemoryItem[]>(`memories_${uid}`, (cached) => {
      if (cached) setMemories(cached);
    });
    if (isReadQuotaPaused()) {
      return () => unsubLocal();
    }

    const unsub = onSnapshot(
      query(collection(db, 'users', uid, 'memories'), orderBy('savedAt', 'desc'), limit(40)),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as MemoryItem);
        void mergeServerCacheList<MemoryItem>(`memories_${uid}`, list).then((merged) => {
          merged.sort(
            (a, b) => (b.savedAt?.toMillis?.() ?? 0) - (a.savedAt?.toMillis?.() ?? 0)
          );
          setMemories(merged);
        });
      },
      (error) => {
        if (isQuotaExceededError(error)) {
          markReadQuotaExceeded();
          return;
        }
        handleFirestoreError(error, OperationType.LIST, `users/${uid}/memories`);
      }
    );
    return () => {
      unsub();
      unsubLocal();
    };
  }, [currentUserProfile?.uid]);

  // Live Notifications subscription
  useEffect(() => {
    if (!currentUserProfile?.uid) return;
    const uid = currentUserProfile.uid;
    const unsubLocal = subscribeLocalCacheKey<AppNotification[]>(
      `notifications_${uid}`,
      (cached) => {
        if (cached) setNotifications(cached);
      }
    );
    if (isReadQuotaPaused()) {
      return () => unsubLocal();
    }

    const unsub = onSnapshot(
      query(collection(db, 'users', uid, 'notifications'), orderBy('createdAt', 'desc'), limit(40)),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as AppNotification);
        void mergeServerCacheList<AppNotification>(`notifications_${uid}`, list).then((merged) => {
          merged.sort(
            (a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0)
          );
          setNotifications(merged);
        });
      },
      (error) => {
        if (isQuotaExceededError(error)) {
          markReadQuotaExceeded();
          return;
        }
        handleFirestoreError(error, OperationType.LIST, `users/${uid}/notifications`);
      }
    );
    return () => {
      unsub();
      unsubLocal();
    };
  }, [currentUserProfile?.uid]);

  useEffect(() => {
    if (!activeConversationId && chats.length > 0 && window.innerWidth >= 768) {
      const firstActive = chats.find((c) => !c.archived) || chats[0];
      if (firstActive) {
        setActiveConversationId(firstActive.conversationId);
      }
    }
  }, [chats, activeConversationId]);

  useEffect(() => {
    if (!pendingHandleInvite || !currentUserProfile || profiles.length === 0) return;
    const normalized = pendingHandleInvite.replace(/^@/, '').toLowerCase();
    const match = profiles.find((p) => p.handle.toLowerCase() === normalized);
    if (match) {
      setPendingHandleInvite(null);
      window.history.replaceState({}, '', window.location.pathname);
      void createOrOpenDirectChat(currentUserProfile, match).then((convId) => {
        setActiveTab('chats');
        setActiveConversationId(convId);
      });
    }
  }, [pendingHandleInvite, currentUserProfile, profiles]);

  const profilesByUid = useMemo(() => {
    const map: Record<string, PublicProfile> = {};
    for (const p of profiles) {
      map[p.uid] = p;
    }
    if (currentUserProfile) {
      map[currentUserProfile.uid] = currentUserProfile;
    }
    return map;
  }, [profiles, currentUserProfile]);

  const friendUids = useMemo(() => {
    const set = new Set<string>();
    if (!currentUserProfile) return set;
    for (const f of friendships) {
      if (f.status !== 'accepted') continue;
      for (const uid of f.userIds) {
        if (uid !== currentUserProfile.uid) set.add(uid);
      }
    }
    return set;
  }, [friendships, currentUserProfile]);

  const totalUnread = useMemo(
    () =>
      chats
        .filter((c) => !c.archived && c.conversationId !== activeConversationId)
        .reduce((sum, c) => sum + (c.unreadCount || 0), 0),
    [chats, activeConversationId]
  );

  const archivedCount = useMemo(
    () => chats.filter((c) => c.archived).length,
    [chats]
  );

  const unviewedStoriesCount = useMemo(() => {
    if (!currentUserProfile) return 0;
    const now = Date.now();
    const unviewedAuthors = new Set<string>();
    for (const st of stories) {
      if (st.authorId === currentUserProfile.uid) continue;
      if ((st.expiresAt?.toMillis?.() ?? now + 1000) <= now) continue;
      if (!st.viewerIds.includes(currentUserProfile.uid)) {
        unviewedAuthors.add(st.authorId);
      }
    }
    return unviewedAuthors.size;
  }, [stories, currentUserProfile]);

  const pendingFriendRequestsCount = useMemo(() => {
    if (!currentUserProfile) return 0;
    return friendships.filter(
      (f) => f.status === 'pending' && f.receiverId === currentUserProfile.uid
    ).length;
  }, [friendships, currentUserProfile]);

  const unreadNotificationsCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications]
  );

  const topStreakCount = useMemo(
    () => chats.reduce((max, c) => Math.max(max, c.streakCount || 0), 0),
    [chats]
  );

  const activeAuthorStories = useMemo(() => {
    if (!viewingStoryAuthorId) return [];
    const now = Date.now();
    return stories
      .filter(
        (s) =>
          s.authorId === viewingStoryAuthorId &&
          (s.expiresAt?.toMillis?.() ?? now + 1000) > now
      )
      .sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));
  }, [stories, viewingStoryAuthorId]);

  const activeChatIndex = useMemo(
    () => chats.find((c) => c.conversationId === activeConversationId),
    [chats, activeConversationId]
  );

  const handleToggleTheme = async () => {
    const next = !darkMode;
    setDarkMode(next);
    if (currentUserProfile) {
      await updateThemePreference(currentUserProfile.uid, next ? 'dark' : 'light');
    }
  };

  const handleStartDirectChat = async (peer: PublicProfile) => {
    if (!currentUserProfile) return;
    const convId = await createOrOpenDirectChat(currentUserProfile, peer);
    setActiveTab('chats');
    setActiveConversationId(convId);
  };

  const handleCreateGroup = async (title: string, selectedMembers: PublicProfile[]) => {
    if (!currentUserProfile) return;
    const convId = await createGroupChat(currentUserProfile, title, selectedMembers);
    setActiveTab('chats');
    setActiveConversationId(convId);
  };

  const handleUpdatePrivateSettings = async (updates: Partial<PrivateUserInfo>) => {
    if (!currentUserProfile) return;
    setPrivateInfo((prev) => (prev ? { ...prev, ...updates } : prev));
    await updatePrivateSettings(currentUserProfile.uid, updates);
  };

  const handleSendSnapBatch = async (params: {
    conversationIds: string[];
    directPeerProfiles: PublicProfile[];
    imageData: string;
    mediaType: 'photo' | 'video';
    caption: string;
    durationSec: number;
    postToStory: boolean;
    postToSpotlight?: boolean;
    soundTrackId?: string;
    soundTitle?: string;
  }) => {
    if (!currentUserProfile) return;

    if (params.postToSpotlight && params.mediaType === 'video') {
      await createSpotlightVideo({
        author: currentUserProfile,
        videoData: params.imageData,
        caption: params.caption,
        soundTitle: params.soundTitle,
        soundTrackId: params.soundTrackId,
        resolution: '720p',
      });
      void awardTrophyIfMissing(currentUserProfile, 'spotlight_star');
    }

    const targetConvIds = new Set(params.conversationIds);
    for (const peer of params.directPeerProfiles) {
      const convId = await createOrOpenDirectChat(currentUserProfile, peer);
      targetConvIds.add(convId);
    }

    // Ensure single-document Story / DM Snap payloads stay compact when Storage fallback triggers
    let singleDocMedia = params.imageData;
    if (
      (params.postToStory || targetConvIds.size > 0) &&
      params.mediaType === 'video' &&
      singleDocMedia.startsWith('data:') &&
      singleDocMedia.length > LIMITS.IMAGE_DATA_MAX
    ) {
      singleDocMedia = await transcodeVideoFileToBoundedDataUrl(singleDocMedia);
    }

    if (params.postToStory) {
      await createStory({
        author: currentUserProfile,
        mediaType: params.mediaType,
        imageData: singleDocMedia,
        caption: params.caption,
        durationSec: params.durationSec >= 90 ? 5 : params.durationSec,
        locationLabel: currentUserProfile.locationLabel,
        lat: currentUserProfile.lat,
        lng: currentUserProfile.lng,
      });
      void awardTrophyIfMissing(currentUserProfile, 'storyteller');
    }

    let lastSentConvId: string | null = null;
    for (const convId of targetConvIds) {
      const conv = await getConversationById(convId);
      if (!conv) continue;
      await sendMessage({
        conversation: conv,
        sender: currentUserProfile,
        kind: 'snap',
        mediaType: params.mediaType,
        text: params.caption,
        imageData: singleDocMedia,
        snapDurationSec: params.durationSec,
      });
      lastSentConvId = convId;
    }

    if (lastSentConvId) {
      setActiveTab('chats');
      setActiveConversationId(lastSentConvId);
    } else if (cameraModalConfig?.returnToTab === 'video') {
      setActiveTab('video');
    } else if (params.postToSpotlight && params.mediaType === 'video') {
      setActiveTab('spotlight');
    } else if (params.postToStory) {
      setActiveTab('stories');
    }
  };

  const handleForwardSpotlightToChat = useCallback(
    async (params: {
      conversationId?: string;
      peerProfile?: PublicProfile;
      video: SpotlightVideo;
    }) => {
      if (!currentUserProfile) return;
      let targetConvId = params.conversationId;
      if (!targetConvId && params.peerProfile) {
        targetConvId = await createOrOpenDirectChat(currentUserProfile, params.peerProfile);
      }
      if (!targetConvId) return;

      const conv = await getConversationById(targetConvId);
      if (!conv) return;

      const resolvedSrc = await resolveSpotlightVideoSrc(params.video);
      const boundedSnapMedia =
        params.video.videoData &&
        (params.video.videoData.startsWith('http') ||
          params.video.videoData.length <= LIMITS.IMAGE_DATA_MAX)
          ? params.video.videoData
          : await transcodeVideoFileToBoundedDataUrl(resolvedSrc);

      await sendMessage({
        conversation: conv,
        sender: currentUserProfile,
        kind: 'snap',
        mediaType: 'video',
        text: params.video.caption || `Spotlight by @${params.video.authorHandle}`,
        imageData: boundedSnapMedia,
        snapDurationSec: 10,
      });
      setActiveTab('chats');
      setActiveConversationId(targetConvId);
    },
    [currentUserProfile]
  );

  const handleIncrementSpotlightView = useCallback(async (videoId: string) => {
    await incrementSpotlightView(videoId);
  }, []);

  const handleDeleteChat = async (conversationId: string) => {
    if (!currentUserProfile) return;
    await deleteUserChat(currentUserProfile.uid, conversationId);
    if (activeConversationId === conversationId) {
      setActiveConversationId(null);
      setShowDetails(false);
    }
  };

  const handleStoryReply = async (authorId: string, replyText: string) => {
    if (!currentUserProfile) return;
    const authorProfile = profilesByUid[authorId];
    if (!authorProfile) return;
    const convId = await createOrOpenDirectChat(currentUserProfile, authorProfile);
    const conv = await getConversationById(convId);
    if (conv) {
      await sendMessage({
        conversation: conv,
        sender: currentUserProfile,
        kind: 'text',
        text: replyText,
      });
    }
    setActiveTab('chats');
    setActiveConversationId(convId);
  };

  const handleConversationLoaded = useCallback(
    (conversation: Conversation, members: ConversationMember[], messages: Message[]) => {
      setActiveConvData({ conversation, members, messages });
    },
    []
  );

  const handleSignOut = async () => {
    if (currentUserProfile) {
      await setUserOnlineStatus(currentUserProfile.uid, false);
    }
    setShowProfileModal(false);
    setShowSettingsModal(false);
    await signOut(auth);
  };

  if (!authReady) {
    return (
      <div className="h-screen bg-[#FFFC00] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <GhostLogo className="w-16 h-16 text-black animate-pulse" />
          <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-black/70">
            Loading CoolerUp
          </p>
        </div>
      </div>
    );
  }

  if (!currentUserProfile) {
    return <SignInView darkMode={darkMode} onToggleTheme={handleToggleTheme} />;
  }

  const allKnownProfiles = Object.values(profilesByUid);
  const showMobileBottomNav =
    activeTab === 'camera' ||
    activeTab === 'map' ||
    activeTab === 'stories' ||
    activeTab === 'spotlight' ||
    activeTab === 'people' ||
    !activeConversationId;

  const canSwipeMobileTabs =
    !activeConversationId &&
    activeTab !== 'map' &&
    !cameraModalConfig &&
    !viewingSnap &&
    !viewingStoryAuthorId &&
    !showProfileModal &&
    !showMemoriesModal &&
    !showNotificationsModal &&
    !showSettingsModal;

  return (
    <div
      onPointerDown={(e) => {
        if (!canSwipeMobileTabs || window.innerWidth >= 768) return;
        swipeStartRef.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        const start = swipeStartRef.current;
        swipeStartRef.current = null;
        if (!start || !canSwipeMobileTabs || window.innerWidth >= 768) return;
        const dx = e.clientX - start.x;
        const dy = Math.abs(e.clientY - start.y);
        if (Math.abs(dx) < 85 || dy > 55) return;
        const idx = SWIPE_TABS.indexOf(activeTab);
        if (idx === -1) return;
        if (dx > 0 && idx > 0) {
          setActiveTab(SWIPE_TABS[idx - 1]);
        } else if (dx < 0 && idx < SWIPE_TABS.length - 1) {
          setActiveTab(SWIPE_TABS[idx + 1]);
        }
      }}
      className="h-screen w-screen overflow-hidden bg-white dark:bg-[#0A0A0A] text-slate-900 dark:text-slate-100 flex flex-col md:flex-row relative"
    >
      {/* Google Maps Demo Key Quota Banner */}
      {gmpQuotaBanner && !gmpBannerDismissed && (
        <div className="fixed top-0 inset-x-0 z-50 bg-amber-400 text-slate-950 px-4 py-2 shadow-md flex items-center justify-center gap-3 text-xs font-semibold">
          <div className="max-w-3xl flex items-center gap-2 flex-1 min-w-0">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <p className="truncate sm:whitespace-normal">
              Map demo quota exceeded. Try again later or{' '}
              <a
                href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-bold"
              >
                configure your own Google Maps API key
              </a>
              .
            </p>
          </div>
          <button
            type="button"
            onClick={() => setGmpBannerDismissed(true)}
            aria-label="Dismiss map quota notice"
            className="p-1 rounded-xl hover:bg-black/10 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Desktop Left Navigation Rail */}
      <NavRail
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onOpenCamera={() => setCameraModalConfig({ conversationId: activeConversationId, mode: 'snap' })}
        onPostVideo={() =>
          setCameraModalConfig({
            conversationId: null,
            mode: 'spotlight',
            captureKind: 'video',
            returnToTab: 'video',
          })
        }
        totalUnread={totalUnread}
        unviewedStoriesCount={unviewedStoriesCount}
        pendingFriendRequestsCount={pendingFriendRequestsCount}
        unreadNotificationsCount={unreadNotificationsCount}
        archivedCount={archivedCount}
        stories={stories}
        spotlightVideos={spotlightVideos}
        onToggleLikeSpotlight={(vid) =>
          toggleLikeSpotlightVideo(vid.id, currentUserProfile.uid, vid.likedBy)
        }
        profile={currentUserProfile}
        darkMode={darkMode}
        onToggleTheme={handleToggleTheme}
        onOpenProfile={() => setShowProfileModal(true)}
        onOpenMemories={() => setShowMemoriesModal(true)}
        onOpenNotifications={() => setShowNotificationsModal(true)}
        onOpenSettings={() => setShowSettingsModal(true)}
      />

      {activeTab === 'camera' ? (
        <div className="flex-1 h-full min-w-0 min-h-0 flex flex-col pb-14 md:pb-0">
          <SnapCameraModal
            embedded
            currentUser={currentUserProfile}
            chats={chats}
            profiles={allKnownProfiles}
            preselectedConversationId={activeConversationId}
            initialMode="snap"
            unreadNotificationsCount={unreadNotificationsCount}
            onOpenProfile={() => setShowProfileModal(true)}
            onOpenSearch={() => setActiveTab('people')}
            onOpenAddFriend={() => setActiveTab('people')}
            onOpenNotifications={() => setShowNotificationsModal(true)}
            onOpenSettings={() => setShowSettingsModal(true)}
            onOpenMemories={() => setShowMemoriesModal(true)}
            onSaveToMemory={async ({ mediaUrl, mediaType, caption }) => {
              await saveMemoryItem({
                userId: currentUserProfile.uid,
                mediaUrl,
                mediaType,
                caption,
                source: 'snap',
              });
            }}
            onClose={() => setActiveTab('chats')}
            onSendSnapToConversations={handleSendSnapBatch}
          />
        </div>
      ) : activeTab === 'map' ? (
        <div className="flex-1 h-full min-w-0 min-h-0 flex flex-col pb-14 md:pb-0">
          <SnapMapScreen
            currentUser={currentUserProfile}
            profiles={allKnownProfiles}
            stories={stories}
            friendUids={friendUids}
            onToggleGhostMode={(next) => toggleGhostMode(currentUserProfile.uid, next)}
            onUpdateMyLocation={(lat, lng, label) =>
              updateUserLocation(currentUserProfile.uid, lat, lng, label)
            }
            onSendSnapToPeer={async (peer) => {
              const convId = await createOrOpenDirectChat(currentUserProfile, peer);
              setCameraModalConfig({ conversationId: convId, mode: 'snap' });
            }}
            onChatWithPeer={handleStartDirectChat}
            onViewStoryAuthor={(uid) => setViewingStoryAuthorId(uid)}
          />
        </div>
      ) : activeTab === 'spotlight' ? (
        <div className="flex-1 h-full min-w-0 min-h-0 flex flex-col">
          <SpotlightFeedPanel
            currentUser={currentUserProfile}
            videos={spotlightVideos}
            friendships={friendships}
            chats={chats}
            profiles={allKnownProfiles}
            profilesByUid={profilesByUid}
            onOpenCameraForSpotlight={() =>
              setCameraModalConfig({
                conversationId: null,
                mode: 'spotlight',
                captureKind: 'video',
              })
            }
            onUploadSpotlightVideo={async ({ videoData, caption, soundTitle, soundTrackId }) => {
              await createSpotlightVideo({
                author: currentUserProfile,
                videoData,
                caption,
                soundTitle,
                soundTrackId,
                resolution: '720p',
              });
              void awardTrophyIfMissing(currentUserProfile, 'spotlight_star');
            }}
            onUpdateVideoSound={(vid, soundTrackId, soundTitle) =>
              updateSpotlightVideoSound(vid.id, soundTrackId, soundTitle)
            }
            onToggleLike={(vid) =>
              toggleLikeSpotlightVideo(vid.id, currentUserProfile.uid, vid.likedBy)
            }
            onIncrementView={handleIncrementSpotlightView}
            onDeleteVideo={(vid) => deleteSpotlightVideo(vid.id, vid.chunkCount || 0)}
            onToggleFollow={(targetUid, currentlyFollowing) =>
              toggleFollowCreator(currentUserProfile.uid, targetUid, currentlyFollowing)
            }
            onSaveToMemory={async (vid, resolvedUrl) => {
              await saveMemoryItem({
                userId: currentUserProfile.uid,
                mediaUrl: resolvedUrl,
                mediaType: 'video',
                caption: vid.caption || `Spotlight by @${vid.authorHandle}`,
                source: 'spotlight',
              });
            }}
            onStartDirectChat={handleStartDirectChat}
            onForwardVideoToChat={handleForwardSpotlightToChat}
            onBack={() => setActiveTab('camera')}
          />
        </div>
      ) : (
        <>
          {/* Sidebar: Chats / Stories / Friends / Archived */}
          <div
            className={`${
              activeConversationId ? 'hidden md:flex' : 'flex'
            } flex-1 md:flex-none h-full min-h-0 pb-14 md:pb-0`}
          >
            {activeTab === 'people' ? (
              <PeopleDirectory
                currentUser={currentUserProfile}
                profiles={allKnownProfiles}
                friendships={friendships}
                chats={chats}
                blockedUids={privateInfo?.blockedUids || []}
                onSendFriendRequest={(peer) => sendFriendRequest(currentUserProfile, peer)}
                onRespondFriendRequest={respondToFriendRequest}
                onRemoveFriendship={(fid) => respondToFriendRequest(fid, false)}
                onBlockUser={async (targetUid) => {
                  const next = Array.from(
                    new Set([...(privateInfo?.blockedUids || []), targetUid])
                  );
                  setPrivateInfo((prev) => (prev ? { ...prev, blockedUids: next } : prev));
                  await blockUser(
                    currentUserProfile.uid,
                    targetUid,
                    privateInfo?.blockedUids || []
                  );
                }}
                onUnblockUser={async (targetUid) => {
                  const next = (privateInfo?.blockedUids || []).filter((id) => id !== targetUid);
                  setPrivateInfo((prev) => (prev ? { ...prev, blockedUids: next } : prev));
                  await unblockUser(
                    currentUserProfile.uid,
                    targetUid,
                    privateInfo?.blockedUids || []
                  );
                }}
                onReportUser={(targetUid, reason) =>
                  reportUser({
                    reporterId: currentUserProfile.uid,
                    targetUserId: targetUid,
                    reason,
                  })
                }
                onToggleMuteChat={(convId, muted) =>
                  updateUserChatFlags(currentUserProfile.uid, convId, { muted })
                }
                onStartDirectChat={handleStartDirectChat}
                onOpenNewGroup={() => setNewChatModalMode('group')}
              />
            ) : activeTab === 'stories' ? (
              <StoriesPanel
                currentUser={currentUserProfile}
                stories={stories}
                profilesByUid={profilesByUid}
                onOpenCameraForStory={() =>
                  setCameraModalConfig({ conversationId: null, mode: 'story' })
                }
                onOpenCameraForVideo={() =>
                  setCameraModalConfig({
                    conversationId: null,
                    mode: 'story',
                    captureKind: 'video',
                  })
                }
                onViewAuthorStories={(authorId) => setViewingStoryAuthorId(authorId)}
                onDeleteStory={(storyId) => deleteStory(storyId)}
              />
            ) : (
              <ConversationList
                activeTab={activeTab}
                chats={chats}
                stories={stories}
                friendships={friendships}
                activeConversationId={activeConversationId}
                currentUser={currentUserProfile}
                profilesByUid={profilesByUid}
                onSelectChat={(convId) => setActiveConversationId(convId)}
                onOpenNewChat={(mode) => setNewChatModalMode(mode)}
                onOpenCameraForChat={(convId) =>
                  setCameraModalConfig({
                    conversationId: convId || null,
                    mode: convId ? 'snap' : 'story',
                  })
                }
                onViewAuthorStories={(authorId) => setViewingStoryAuthorId(authorId)}
                onDeleteChat={handleDeleteChat}
                onOpenProfile={() => setShowProfileModal(true)}
              />
            )}
          </div>

          {/* Active Chat Viewport */}
          <div
            className={`${
              activeConversationId ? 'flex' : 'hidden md:flex'
            } flex-1 h-full min-w-0 min-h-0`}
          >
            {activeConversationId ? (
              <>
                <ChatWindow
                  conversationId={activeConversationId}
                  chatIndex={activeChatIndex}
                  currentUser={currentUserProfile}
                  profilesByUid={profilesByUid}
                  showDetails={showDetails}
                  onToggleDetails={() => setShowDetails((v) => !v)}
                  onBackMobile={() => {
                    setActiveConversationId(null);
                    setShowDetails(false);
                  }}
                  onOpenCameraForChat={(convId) =>
                    setCameraModalConfig({ conversationId: convId, mode: 'snap' })
                  }
                  onOpenSnapViewer={(msg, conv) => setViewingSnap({ message: msg, conversation: conv })}
                  onConversationLoaded={handleConversationLoaded}
                  onOpenImageLightbox={(img) => setLightboxImage(img)}
                  onStartCall={(mode, peerName, peerPhotoURL, peerAvatarSeed) =>
                    setActiveCall({ mode, peerName, peerPhotoURL, peerAvatarSeed })
                  }
                  onClearChat={(convId) => clearUnsavedChat(currentUserProfile.uid, convId)}
                />

                {showDetails &&
                  activeConvData &&
                  activeConvData.conversation.id === activeConversationId && (
                    <ChatDetailsDrawer
                      conversation={activeConvData.conversation}
                      chatIndex={activeChatIndex}
                      members={activeConvData.members}
                      messages={activeConvData.messages}
                      currentUser={currentUserProfile}
                      profilesByUid={profilesByUid}
                      allProfiles={allKnownProfiles}
                      onClose={() => setShowDetails(false)}
                      onUpdateAppearance={(updates) =>
                        updateConversationAppearance(activeConvData.conversation, updates)
                      }
                      onUpdateFlags={(flags) =>
                        updateUserChatFlags(
                          currentUserProfile.uid,
                          activeConvData.conversation.id,
                          flags
                        )
                      }
                      onRenameGroup={(title) =>
                        renameGroupChat(activeConvData.conversation, title)
                      }
                      onAddMember={(member) =>
                        addMemberToGroupChat(activeConvData.conversation, member)
                      }
                      onLeaveGroup={async () => {
                        await leaveGroupChat(
                          activeConvData.conversation,
                          currentUserProfile.uid
                        );
                        setShowDetails(false);
                        setActiveConversationId(null);
                      }}
                      onDeleteChat={() => handleDeleteChat(activeConvData.conversation.id)}
                      onOpenImageLightbox={(img) => setLightboxImage(img)}
                    />
                  )}
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#FAFAFA] dark:bg-[#0A0A0A]">
                <div className="w-[88px] h-[88px] rounded-full bg-[#FFFC00] flex items-center justify-center mb-6 snap-glow">
                  <GhostLogo className="w-12 h-12 text-black" />
                </div>
                <h2 className="font-display text-[30px] leading-none font-extrabold tracking-[-0.05em] text-slate-900 dark:text-white mb-2">
                  Start snapping
                </h2>
                <p className="text-sm font-medium text-slate-500 dark:text-slate-400 max-w-sm mb-7 leading-relaxed">
                  Pick a friend to send a disappearing Snap, post a Story, or jump into a chat.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => setNewChatModalMode('direct')}
                    className="h-11 px-6 rounded-full bg-black dark:bg-[#FFFC00] text-white dark:text-black text-sm font-extrabold flex items-center gap-2 snap-press cursor-pointer"
                  >
                    <MessageCircle className="w-4 h-4" />
                    <span>New Chat</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('camera')}
                    className="h-11 px-6 rounded-full bg-[#FFFC00] hover:bg-[#F2EF00] text-black text-sm font-extrabold flex items-center gap-2 snap-press cursor-pointer"
                  >
                    <Camera className="w-4 h-4" />
                    <span>Open Camera</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('spotlight')}
                    className="h-11 px-6 rounded-full bg-[#F2F2F2] dark:bg-white/10 hover:bg-[#E5E5E5] dark:hover:bg-white/20 text-slate-900 dark:text-white text-sm font-extrabold flex items-center gap-2 snap-press cursor-pointer"
                  >
                    <Film className="w-4 h-4" />
                    <span>Spotlight</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Snapchat-style mobile tab bar: Map · Chat · Camera · Stories · Spotlight */}
      {showMobileBottomNav && (
        <nav
          className={`md:hidden fixed bottom-0 left-0 right-0 z-30 ${
            activeTab === 'spotlight'
              ? 'bg-black/60 backdrop-blur-xl border-t border-white/10 text-white'
              : 'bg-white/95 dark:bg-[#0A0A0A]/95 backdrop-blur-xl border-t border-slate-100 dark:border-white/10'
          }`}
          aria-label="Mobile navigation"
        >
          <div className="h-[62px] grid grid-cols-5 items-center pb-[env(safe-area-inset-bottom)]">
            {(
              [
                { id: 'map' as NavTab, label: 'Map', icon: MapPin, badge: 0 },
                { id: 'chats' as NavTab, label: 'Chat', icon: MessageCircle, badge: totalUnread },
                { id: 'stories' as NavTab, label: 'Stories', icon: CircleDot, badge: unviewedStoriesCount },
                { id: 'spotlight' as NavTab, label: 'Spotlight', icon: Film, badge: 0 },
              ] as const
            ).slice(0, 2).map((tab) => {
              const Icon = tab.icon;
              const isActive =
                tab.id === 'chats'
                  ? activeTab === 'chats' || activeTab === 'archived' || activeTab === 'people'
                  : activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setActiveConversationId(null);
                    setActiveTab(tab.id);
                  }}
                  className={`relative h-full flex flex-col items-center justify-center gap-1 cursor-pointer snap-press ${
                    isActive
                      ? activeTab === 'spotlight'
                        ? 'text-[#FFFC00]'
                        : 'text-slate-900 dark:text-white'
                      : activeTab === 'spotlight'
                      ? 'text-white/60'
                      : 'text-slate-400 dark:text-slate-500'
                  }`}
                >
                  <div className="relative">
                    <Icon className="w-[23px] h-[23px]" strokeWidth={isActive ? 2.8 : 2.2} />
                    {tab.badge > 0 && (
                      <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 px-1 rounded-full bg-[#FF3B5C] text-white text-[10px] font-bold font-mono-tabular flex items-center justify-center">
                        {tab.badge > 99 ? '99+' : tab.badge}
                      </span>
                    )}
                  </div>
                  <span className={`text-[10px] tracking-[-0.01em] ${isActive ? 'font-extrabold' : 'font-semibold'}`}>
                    {tab.label}
                  </span>
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => {
                setActiveConversationId(null);
                setActiveTab('camera');
              }}
              aria-label="Camera"
              className="h-full flex flex-col items-center justify-center cursor-pointer"
            >
              <span
                className={`w-[46px] h-[46px] rounded-full bg-[#FFFC00] text-black flex items-center justify-center snap-press ${
                  activeTab === 'camera' ? 'snap-glow' : 'shadow-md'
                }`}
              >
                <Camera className="w-[22px] h-[22px]" strokeWidth={2.6} />
              </span>
            </button>

            {(
              [
                { id: 'stories' as NavTab, label: 'Stories', icon: CircleDot, badge: unviewedStoriesCount },
                { id: 'spotlight' as NavTab, label: 'Spotlight', icon: Film, badge: 0 },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setActiveConversationId(null);
                    setActiveTab(tab.id);
                  }}
                  className={`relative h-full flex flex-col items-center justify-center gap-1 cursor-pointer snap-press ${
                    isActive
                      ? activeTab === 'spotlight'
                        ? 'text-[#FFFC00]'
                        : 'text-slate-900 dark:text-white'
                      : activeTab === 'spotlight'
                      ? 'text-white/60'
                      : 'text-slate-400 dark:text-slate-500'
                  }`}
                >
                  <div className="relative">
                    <Icon className="w-[23px] h-[23px]" strokeWidth={isActive ? 2.8 : 2.2} />
                    {tab.badge > 0 && (
                      <span className="absolute -top-1 -right-2 min-w-[15px] h-3.5 px-1 rounded-full bg-[#FF3B5C] text-white text-[9px] font-bold font-mono-tabular flex items-center justify-center">
                        {tab.badge > 9 ? '9+' : tab.badge}
                      </span>
                    )}
                  </div>
                  <span className={`text-[10px] tracking-[-0.01em] ${isActive ? 'font-extrabold' : 'font-semibold'}`}>
                    {tab.label}
                  </span>
                </button>
              );
            })}
          </div>
        </nav>
      )}

      {/* Modals */}
      {newChatModalMode && (
        <NewChatModal
          initialMode={newChatModalMode}
          currentUser={currentUserProfile}
          profiles={allKnownProfiles}
          onClose={() => setNewChatModalMode(null)}
          onCreateDirect={handleStartDirectChat}
          onCreateGroup={handleCreateGroup}
        />
      )}

      {showProfileModal && (
        <ProfileModal
          profile={currentUserProfile}
          privateInfo={privateInfo}
          topStreakCount={topStreakCount}
          darkMode={darkMode}
          onToggleTheme={handleToggleTheme}
          onOpenSettings={() => {
            setShowProfileModal(false);
            setShowSettingsModal(true);
          }}
          onSaveProfile={(updates) => updateUserProfile(currentUserProfile.uid, updates)}
          onSignOut={handleSignOut}
          onClose={() => setShowProfileModal(false)}
        />
      )}

      {showMemoriesModal && (
        <MemoriesModal
          userId={currentUserProfile.uid}
          memories={memories}
          privateInfo={privateInfo}
          onSaveCameraRollItem={async ({ mediaUrl, mediaType, caption }) => {
            await saveMemoryItem({
              userId: currentUserProfile.uid,
              mediaUrl,
              mediaType,
              caption,
              source: 'camera_roll',
            });
          }}
          onToggleLock={(memoryId, locked) =>
            toggleMemoryLock(currentUserProfile.uid, memoryId, locked)
          }
          onDelete={(memoryId) => deleteMemoryItem(currentUserProfile.uid, memoryId)}
          onSetPinHash={(pinHash) =>
            handleUpdatePrivateSettings({ myEyesOnlyPinHash: pinHash })
          }
          onPostMemoryToStory={async (item) => {
            await createStory({
              author: currentUserProfile,
              mediaType: item.mediaType,
              imageData: item.mediaUrl,
              caption: item.caption || 'From Memories',
              durationSec: 5,
            });
            setShowMemoriesModal(false);
            setActiveTab('stories');
          }}
          onOpenCamera={() => {
            setShowMemoriesModal(false);
            setActiveTab('camera');
          }}
          onClose={() => setShowMemoriesModal(false)}
        />
      )}

      {showNotificationsModal && (
        <NotificationsModal
          notifications={notifications}
          onMarkRead={(id) => markNotificationRead(currentUserProfile.uid, id)}
          onMarkAllRead={() =>
            markAllNotificationsRead(
              currentUserProfile.uid,
              notifications.filter((n) => !n.read).map((n) => n.id)
            )
          }
          onDelete={(id) => deleteNotification(currentUserProfile.uid, id)}
          onClose={() => setShowNotificationsModal(false)}
        />
      )}

      {showSettingsModal && (
        <SettingsModal
          profile={currentUserProfile}
          privateInfo={privateInfo}
          darkMode={darkMode}
          onToggleTheme={handleToggleTheme}
          onToggleGhostMode={(next) => toggleGhostMode(currentUserProfile.uid, next)}
          onUpdateSettings={handleUpdatePrivateSettings}
          onSignOut={handleSignOut}
          onClose={() => setShowSettingsModal(false)}
        />
      )}

      {activeCall && (
        <CallModal
          mode={activeCall.mode}
          peerName={activeCall.peerName}
          peerPhotoURL={activeCall.peerPhotoURL}
          peerAvatarSeed={activeCall.peerAvatarSeed}
          onEndCall={() => setActiveCall(null)}
        />
      )}

      {cameraModalConfig && (
        <SnapCameraModal
          currentUser={currentUserProfile}
          chats={chats}
          profiles={allKnownProfiles}
          preselectedConversationId={cameraModalConfig.conversationId}
          initialMode={cameraModalConfig.mode}
          initialCaptureKind={cameraModalConfig.captureKind}
          onSaveToMemory={async ({ mediaUrl, mediaType, caption }) => {
            await saveMemoryItem({
              userId: currentUserProfile.uid,
              mediaUrl,
              mediaType,
              caption,
              source: 'snap',
            });
          }}
          onClose={() => setCameraModalConfig(null)}
          onSendSnapToConversations={handleSendSnapBatch}
        />
      )}

      {viewingSnap && (
        <SnapViewerModal
          message={viewingSnap.message}
          canReplay={
            viewingSnap.message.senderId !== currentUserProfile.uid &&
            !(viewingSnap.message.snapReplayedBy || []).includes(currentUserProfile.uid)
          }
          onReplay={() =>
            markSnapReplayed(
              viewingSnap.conversation,
              viewingSnap.message,
              currentUserProfile.uid
            )
          }
          onScreenshot={() =>
            markSnapScreenshotted(
              viewingSnap.conversation,
              viewingSnap.message,
              currentUserProfile.uid
            )
          }
          onClose={() => {
            const snapToConsume = viewingSnap;
            setViewingSnap(null);
            void consumeAndDeleteSnapMedia(
              snapToConsume.conversation,
              snapToConsume.message,
              currentUserProfile.uid
            );
          }}
        />
      )}

      {viewingStoryAuthorId && activeAuthorStories.length > 0 && (
        <StoryViewerModal
          stories={activeAuthorStories}
          currentUser={currentUserProfile}
          profilesByUid={profilesByUid}
          onMarkViewed={(storyId) => void markStoryViewed(storyId, currentUserProfile.uid)}
          onToggleLike={(st) =>
            toggleLikeStory(st.id, currentUserProfile.uid, st.likedBy || [])
          }
          onDeleteStory={(storyId) => deleteStory(storyId)}
          onReplyToAuthor={handleStoryReply}
          onClose={() => setViewingStoryAuthorId(null)}
        />
      )}

      {lightboxImage && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setLightboxImage(null)}
        >
          <button
            type="button"
            onClick={() => setLightboxImage(null)}
            aria-label="Close image preview"
            className="absolute top-4 right-4 w-11 h-11 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
          <img
            src={lightboxImage}
            alt="Full resolution preview"
            className="max-w-full max-h-[90vh] rounded-2xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      <OfflineIndicator />
    </div>
  );
}
