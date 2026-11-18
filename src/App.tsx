import { useCallback, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { Camera, CircleDot, Film, MessageCircle, Users, X } from 'lucide-react';
import { ChatDetailsDrawer } from './components/ChatDetailsDrawer';
import { ChatWindow } from './components/ChatWindow';
import { ConversationList } from './components/ConversationList';
import { NavRail } from './components/NavRail';
import { NewChatModal } from './components/NewChatModal';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PeopleDirectory } from './components/PeopleDirectory';
import { ProfileModal } from './components/ProfileModal';
import { SignInView } from './components/SignInView';
import { SnapCameraModal } from './components/SnapCameraModal';
import { SnapViewerModal } from './components/SnapViewerModal';
import { SpotlightFeedPanel } from './components/SpotlightFeedPanel';
import { StoriesPanel } from './components/StoriesPanel';
import { StoryViewerModal } from './components/StoryViewerModal';
import { auth, db, handleFirestoreError, isQuotaExceededError, OperationType } from './lib/firebase';
import {
  bootstrapLocalSavedChat,
  cacheGet,
  cacheSet,
  subscribeLocalCacheKey,
} from './lib/localFallbackStore';
import { LIMITS, transcodeVideoFileToBoundedDataUrl } from './lib/validation';
import {
  addMemberToGroupChat,
  consumeAndDeleteSnapMedia,
  createGroupChat,
  createOrOpenDirectChat,
  createSpotlightVideo,
  createStory,
  deleteSpotlightVideo,
  deleteStory,
  deleteUserChat,
  getConversationById,
  incrementSpotlightView,
  leaveGroupChat,
  markSnapReplayed,
  markSnapScreenshotted,
  markStoryViewed,
  renameGroupChat,
  resolveSpotlightVideoSrc,
  respondToFriendRequest,
  sendFriendRequest,
  sendMessage,
  setUserOnlineStatus,
  syncUserOnSignIn,
  toggleLikeSpotlightVideo,
  updateConversationAppearance,
  updateSpotlightVideoSound,
  updateThemePreference,
  updateUserChatFlags,
  updateUserProfile,
} from './services/messengerService';
import type {
  Conversation,
  ConversationMember,
  Friendship,
  Message,
  NavTab,
  PrivateUserInfo,
  PublicProfile,
  SpotlightVideo,
  Story,
  UserChatIndex,
} from './types/messenger';

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

  const [activeTab, setActiveTab] = useState<NavTab>('chats');
  const [chats, setChats] = useState<UserChatIndex[]>([]);
  const [profiles, setProfiles] = useState<PublicProfile[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [spotlightVideos, setSpotlightVideos] = useState<SpotlightVideo[]>([]);
  const [friendships, setFriendships] = useState<Friendship[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  const [activeConvData, setActiveConvData] = useState<{
    conversation: Conversation;
    members: ConversationMember[];
    messages: Message[];
  } | null>(null);

  const [showDetails, setShowDetails] = useState(false);
  const [newChatModalMode, setNewChatModalMode] = useState<'direct' | 'group' | null>(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);

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
    let fallbackUnsub: (() => void) | null = null;
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
          fallbackUnsub = subscribeLocalCacheKey<PublicProfile>(`profile_${uid}`, (cached) => {
            if (cached) setCurrentUserProfile(cached);
          });
          return;
        }
        handleFirestoreError(error, OperationType.LIST, `profiles/${uid}`);
      }
    );
    return () => {
      unsub();
      fallbackUnsub?.();
    };
  }, [currentUserProfile?.uid]);

  useEffect(() => {
    if (!currentUserProfile?.uid) return;
    let fallbackUnsub: (() => void) | null = null;
    const unsub = onSnapshot(
      query(collection(db, 'profiles'), where('isDiscoverable', '==', true), limit(40)),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as PublicProfile);
        setProfiles(list);
        void cacheSet('profiles', list);
      },
      (error) => {
        if (isQuotaExceededError(error)) {
          fallbackUnsub = subscribeLocalCacheKey<PublicProfile[]>('profiles', (cached) => {
            if (cached) setProfiles(cached);
          });
          return;
        }
        handleFirestoreError(error, OperationType.LIST, 'profiles');
      }
    );
    return () => {
      unsub();
      fallbackUnsub?.();
    };
  }, [currentUserProfile?.uid]);

  useEffect(() => {
    if (!currentUserProfile?.uid) return;
    const uid = currentUserProfile.uid;
    const path = `users/${uid}/chats`;
    let fallbackUnsub: (() => void) | null = null;

    const unsub = onSnapshot(
      query(collection(db, 'users', uid, 'chats'), orderBy('lastMessageAt', 'desc')),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as UserChatIndex);
        setChats(list);
        void cacheSet(`chats_${uid}`, list);
      },
      (error) => {
        if (isQuotaExceededError(error)) {
          void cacheGet<UserChatIndex[]>(`chats_${uid}`).then(async (cached) => {
            if ((!cached || cached.length === 0) && currentUserProfile) {
              await bootstrapLocalSavedChat(currentUserProfile);
            }
            const ready = await cacheGet<UserChatIndex[]>(`chats_${uid}`);
            if (ready) setChats(ready);
          });
          fallbackUnsub = subscribeLocalCacheKey<UserChatIndex[]>(`chats_${uid}`, (cached) => {
            if (cached) setChats(cached);
          });
          return;
        }
        handleFirestoreError(error, OperationType.LIST, path);
      }
    );
    return () => {
      unsub();
      fallbackUnsub?.();
    };
  }, [currentUserProfile?.uid]);

  // Live 24-hour Stories subscription
  useEffect(() => {
    if (!currentUserProfile?.uid) return;
    let fallbackUnsub: (() => void) | null = null;
    const unsub = onSnapshot(
      query(collection(db, 'stories'), where('isPublicStory', '==', true), limit(30)),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as Story);
        setStories(list);
        void cacheSet('stories', list);
      },
      (error) => {
        if (isQuotaExceededError(error)) {
          fallbackUnsub = subscribeLocalCacheKey<Story[]>('stories', (cached) => {
            if (cached) setStories(cached);
          });
          return;
        }
        handleFirestoreError(error, OperationType.LIST, 'stories');
      }
    );
    return () => {
      unsub();
      fallbackUnsub?.();
    };
  }, [currentUserProfile?.uid]);

  // Live Spotlight Video Feed subscription
  useEffect(() => {
    if (!currentUserProfile?.uid) return;
    let fallbackUnsub: (() => void) | null = null;
    const unsub = onSnapshot(
      query(collection(db, 'spotlightVideos'), where('isPublic', '==', true), limit(20)),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as SpotlightVideo);
        list.sort(
          (a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0)
        );
        setSpotlightVideos(list);
        void cacheSet('spotlightVideos', list);
      },
      (error) => {
        if (isQuotaExceededError(error)) {
          fallbackUnsub = subscribeLocalCacheKey<SpotlightVideo[]>('spotlightVideos', (cached) => {
            if (cached) setSpotlightVideos(cached);
          });
          return;
        }
        handleFirestoreError(error, OperationType.LIST, 'spotlightVideos');
      }
    );
    return () => {
      unsub();
      fallbackUnsub?.();
    };
  }, [currentUserProfile?.uid]);

  // Live Friendships & Friend Requests subscription
  useEffect(() => {
    if (!currentUserProfile?.uid) return;
    const uid = currentUserProfile.uid;
    let fallbackUnsub: (() => void) | null = null;
    const unsub = onSnapshot(
      query(collection(db, 'friendships'), where('userIds', 'array-contains', uid)),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as Friendship);
        setFriendships(list);
        void cacheSet(`friendships_${uid}`, list);
      },
      (error) => {
        if (isQuotaExceededError(error)) {
          fallbackUnsub = subscribeLocalCacheKey<Friendship[]>(`friendships_${uid}`, (cached) => {
            if (cached) setFriendships(cached);
          });
          return;
        }
        handleFirestoreError(error, OperationType.LIST, 'friendships');
      }
    );
    return () => {
      unsub();
      fallbackUnsub?.();
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

  useEffect(() => {
    if (!currentUserProfile?.uid) return;
    const uid = currentUserProfile.uid;

    const handleVisibility = () => {
      void setUserOnlineStatus(uid, document.visibilityState === 'visible');
    };
    const handleUnload = () => {
      void setUserOnlineStatus(uid, false);
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('beforeunload', handleUnload);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, [currentUserProfile?.uid]);

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
    }

    const targetConvIds = new Set(params.conversationIds);
    for (const peer of params.directPeerProfiles) {
      const convId = await createOrOpenDirectChat(currentUserProfile, peer);
      targetConvIds.add(convId);
    }

    // Ensure single-document Story / DM Snap payloads stay under Firestore's 1MB doc cap while keeping Spotlight 720p full-size
    let singleDocMedia = params.imageData;
    if (
      (params.postToStory || targetConvIds.size > 0) &&
      params.mediaType === 'video' &&
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
      });
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
        params.video.videoData && params.video.videoData.length <= LIMITS.IMAGE_DATA_MAX
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
    await signOut(auth);
  };

  if (!authReady) {
    return (
      <div className="h-screen bg-[#F4F6F9] dark:bg-[#0B0F17] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#FFFC00] text-slate-950 font-display font-bold flex items-center justify-center text-sm animate-pulse">
            CU
          </div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Loading CoolerUp Messages...
          </p>
        </div>
      </div>
    );
  }

  if (!currentUserProfile) {
    return <SignInView darkMode={darkMode} onToggleTheme={handleToggleTheme} />;
  }

  const allKnownProfiles = Object.values(profilesByUid);

  return (
    <div className="h-screen w-screen overflow-hidden bg-white dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 flex flex-col md:flex-row">
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
      />

      {activeTab === 'spotlight' ? (
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
            }}
            onUpdateVideoSound={(vid, soundTrackId, soundTitle) =>
              updateSpotlightVideoSound(vid.id, soundTrackId, soundTitle)
            }
            onToggleLike={(vid) =>
              toggleLikeSpotlightVideo(vid.id, currentUserProfile.uid, vid.likedBy)
            }
            onIncrementView={handleIncrementSpotlightView}
            onDeleteVideo={(vid) => deleteSpotlightVideo(vid.id, vid.chunkCount || 0)}
            onStartDirectChat={handleStartDirectChat}
            onForwardVideoToChat={handleForwardSpotlightToChat}
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
                onSendFriendRequest={(peer) => sendFriendRequest(currentUserProfile, peer)}
                onRespondFriendRequest={respondToFriendRequest}
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
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#F9FAFC] dark:bg-[#0B0F17]">
                <div className="w-16 h-16 rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 mb-5 bg-[#FFFC00] flex items-center justify-center">
                  <img
                    src="/src/assets/images/coolerup_emblem_1794968388923.jpg"
                    alt="CoolerUp Messages"
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                    className="w-full h-full object-cover"
                  />
                </div>
                <h2 className="font-display text-2xl font-bold text-slate-900 dark:text-white mb-2">
                  CoolerUp Messages
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm mb-6 leading-relaxed">
                  Send disappearing Snaps, post 24-hour Stories, watch Spotlight videos, or jump into a chat.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => setCameraModalConfig({ conversationId: null, mode: 'snap' })}
                    className="h-10 px-5 rounded-xl bg-[#FFFC00] hover:bg-[#F5E600] text-slate-950 text-sm font-bold flex items-center gap-2 transition-colors cursor-pointer"
                  >
                    <Camera className="w-4 h-4" />
                    <span>Open Camera</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('spotlight')}
                    className="h-10 px-5 rounded-xl bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 text-white text-sm font-semibold flex items-center gap-2 transition-colors cursor-pointer"
                  >
                    <Film className="w-4 h-4 text-[#FFFC00]" />
                    <span>Watch Spotlight</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewChatModalMode('direct')}
                    className="h-10 px-5 rounded-xl bg-[#00A6FF] hover:bg-[#0090E0] text-white text-sm font-medium transition-colors cursor-pointer"
                  >
                    New Chat
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Mobile Snapchat-Style Bottom Navigation Bar (Chat · Camera · Stories · Spotlight · Friends) */}
      {(!activeConversationId || activeTab === 'spotlight') && (
        <nav
          className="md:hidden fixed bottom-0 left-0 right-0 z-30 h-14 bg-white/95 dark:bg-[#121824]/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 grid grid-cols-5 items-center"
          aria-label="Mobile navigation"
        >
          <button
            type="button"
            onClick={() => {
              if (activeTab === 'spotlight') setActiveConversationId(null);
              setActiveTab('chats');
            }}
            className={`relative h-full flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
              activeTab === 'chats' || activeTab === 'archived'
                ? 'text-[#00A6FF]'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <div className="relative">
              <MessageCircle className="w-5 h-5" />
              {totalUnread > 0 && (
                <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 px-1 rounded-full bg-[#F43F5E] text-white text-[10px] font-semibold font-mono-tabular flex items-center justify-center">
                  {totalUnread > 99 ? '99+' : totalUnread}
                </span>
              )}
            </div>
            <span className="text-[10px] font-medium">Chat</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (activeTab === 'spotlight') setActiveConversationId(null);
              setActiveTab('stories');
            }}
            className={`relative h-full flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
              activeTab === 'stories'
                ? 'text-[#8B5CF6]'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <div className="relative">
              <CircleDot className="w-5 h-5" />
              {unviewedStoriesCount > 0 && (
                <span className="absolute -top-1 -right-2 min-w-[14px] h-3.5 px-1 rounded-full bg-[#8B5CF6] text-white text-[9px] font-semibold font-mono-tabular flex items-center justify-center">
                  {unviewedStoriesCount}
                </span>
              )}
            </div>
            <span className="text-[10px] font-medium">Stories</span>
          </button>

          <button
            type="button"
            onClick={() =>
              setCameraModalConfig({
                conversationId: activeTab === 'spotlight' ? null : activeConversationId,
                mode: activeTab === 'spotlight' ? 'spotlight' : 'snap',
              })
            }
            aria-label="Open Snap Camera"
            className="h-full flex flex-col items-center justify-center gap-0.5 text-slate-900 dark:text-white cursor-pointer"
          >
            <span className="w-10 h-10 rounded-full bg-[#FFFC00] text-slate-950 flex items-center justify-center shadow-xs">
              <Camera className="w-4 h-4" />
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('spotlight')}
            className={`relative h-full flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
              activeTab === 'spotlight'
                ? 'text-slate-950 dark:text-[#FFFC00]'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <Film className="w-5 h-5" />
            <span className="text-[10px] font-medium">Spotlight</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (activeTab === 'spotlight') setActiveConversationId(null);
              setActiveTab('people');
            }}
            className={`relative h-full flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
              activeTab === 'people'
                ? 'text-[#00A6FF]'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <div className="relative">
              <Users className="w-5 h-5" />
              {pendingFriendRequestsCount > 0 && (
                <span className="absolute -top-1 -right-2 min-w-[14px] h-3.5 px-1 rounded-full bg-[#F43F5E] text-white text-[9px] font-semibold font-mono-tabular flex items-center justify-center">
                  {pendingFriendRequestsCount}
                </span>
              )}
            </div>
            <span className="text-[10px] font-medium">Friends</span>
          </button>
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
          darkMode={darkMode}
          onToggleTheme={handleToggleTheme}
          onSaveProfile={(updates) => updateUserProfile(currentUserProfile.uid, updates)}
          onSignOut={handleSignOut}
          onClose={() => setShowProfileModal(false)}
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
