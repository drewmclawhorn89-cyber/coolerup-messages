import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bookmark,
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  Film,
  Heart,
  Loader2,
  MessageCircle,
  MessageSquare,
  Music2,
  Play,
  Plus,
  Send,
  Trash2,
  Upload,
  UserCheck,
  UserPlus,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore';
import {
  db,
  isQuotaExceededError,
  isReadQuotaPaused,
  markReadQuotaExceeded,
} from '../lib/firebase';
import {
  mergeServerCacheList,
  subscribeLocalCacheKey,
} from '../lib/localFallbackStore';
import {
  resumeSpotlightAudioContext,
  SPOTLIGHT_SOUND_TRACKS,
  startSpotlightTrack,
  stopSpotlightTrack,
} from '../lib/spotlightMusic';
import { LIMITS, prepare720pVideoDataUrl, unlockVideoTranscodeAudio } from '../lib/validation';
import {
  addSpotlightComment,
  deleteSpotlightComment,
  resolveSpotlightVideoSrc,
} from '../services/messengerService';
import type {
  Friendship,
  PublicProfile,
  SpotlightComment,
  SpotlightVideo,
  UserChatIndex,
} from '../types/messenger';
import { Avatar } from './Avatar';

type FeedFilter = 'foryou' | 'following' | 'mine';

interface SpotlightFeedPanelProps {
  currentUser: PublicProfile;
  videos: SpotlightVideo[];
  friendships: Friendship[];
  chats: UserChatIndex[];
  profiles: PublicProfile[];
  profilesByUid: Record<string, PublicProfile>;
  onOpenCameraForSpotlight: () => void;
  onUploadSpotlightVideo: (params: {
    videoData: string;
    caption: string;
    soundTitle: string;
    soundTrackId: string;
  }) => Promise<void>;
  onUpdateVideoSound: (
    video: SpotlightVideo,
    soundTrackId: string,
    soundTitle: string
  ) => Promise<void>;
  onToggleLike: (video: SpotlightVideo) => Promise<void>;
  onIncrementView: (videoId: string) => Promise<void>;
  onDeleteVideo: (video: SpotlightVideo) => Promise<void>;
  onToggleFollow?: (targetUid: string, currentlyFollowing: boolean) => Promise<void>;
  onSaveToMemory?: (video: SpotlightVideo, resolvedUrl: string) => Promise<void>;
  onStartDirectChat: (peer: PublicProfile) => Promise<void>;
  onForwardVideoToChat: (params: {
    conversationId?: string;
    peerProfile?: PublicProfile;
    video: SpotlightVideo;
  }) => Promise<void>;
  onBack?: () => void;
}

function formatCompactCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatRelativeTime(ts: SpotlightVideo['createdAt']): string {
  if (!ts?.toMillis) return 'Just now';
  const diffSec = Math.max(0, Math.floor((Date.now() - ts.toMillis()) / 1000));
  if (diffSec < 60) return 'Just now';
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function SpotlightFeedPanel({
  currentUser,
  videos,
  friendships,
  chats,
  profiles,
  profilesByUid,
  onOpenCameraForSpotlight,
  onUploadSpotlightVideo,
  onUpdateVideoSound,
  onToggleLike,
  onIncrementView,
  onDeleteVideo,
  onToggleFollow,
  onSaveToMemory,
  onStartDirectChat,
  onForwardVideoToChat,
  onBack,
}: SpotlightFeedPanelProps) {
  const [filter, setFilter] = useState<FeedFilter>('foryou');
  const [shuffleSeed] = useState<number>(() => Math.floor(Math.random() * 100000));
  const [activeIndex, setActiveIndex] = useState(0);
  const [muted, setMuted] = useState(false);
  const [autoplayAudioBlocked, setAutoplayAudioBlocked] = useState(false);
  const [paused, setPaused] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [clipHasNoAudio, setClipHasNoAudio] = useState(false);
  const [savedToastId, setSavedToastId] = useState<string | null>(null);

  // Comments sheet state
  const [commentsVideo, setCommentsVideo] = useState<SpotlightVideo | null>(null);
  const [comments, setComments] = useState<SpotlightComment[]>([]);
  const [commentText, setCommentText] = useState('');
  const [postingComment, setPostingComment] = useState(false);

  // Resolved video src cache (supports inline & chunked 720p videos across snap slides)
  const [resolvedSrcById, setResolvedSrcById] = useState<Record<string, string>>({});
  const [resolvedSrc, setResolvedSrc] = useState<string>('');
  const [loadingVideo, setLoadingVideo] = useState(false);
  const [videoDimsLabel, setVideoDimsLabel] = useState<string>('720p HD');

  // Upload modal state
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadVideoData, setUploadVideoData] = useState('');
  const [uploadCaption, setUploadCaption] = useState('');
  const [uploadSoundTrackId, setUploadSoundTrackId] = useState('original');
  const [uploadSoundTitle, setUploadSoundTitle] = useState('');
  const [uploadPreviewMuted, setUploadPreviewMuted] = useState(false);
  const [uploadClipHasNoAudio, setUploadClipHasNoAudio] = useState(false);
  const [processingFile, setProcessingFile] = useState(false);
  const [postingVideo, setPostingVideo] = useState(false);
  const [uploadError, setUploadError] = useState('');

  // Edit music on existing video modal
  const [editMusicVideo, setEditMusicVideo] = useState<SpotlightVideo | null>(null);
  const [editingMusicTrackId, setEditingMusicTrackId] = useState('original');
  const [savingMusic, setSavingMusic] = useState(false);

  // Share / Forward modal state
  const [shareVideo, setShareVideo] = useState<SpotlightVideo | null>(null);
  const [forwardingId, setForwardingId] = useState<string | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const videoPlayerRef = useRef<HTMLVideoElement | null>(null);
  const uploadPreviewRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const viewedIdsRef = useRef<Set<string>>(new Set());
  const resolvingIdsRef = useRef<Set<string>>(new Set());

  const friendAndFollowingUids = useMemo(() => {
    const set = new Set<string>([currentUser.uid, ...(currentUser.following || [])]);
    for (const f of friendships) {
      if (f.status !== 'accepted') continue;
      for (const uid of f.userIds) {
        set.add(uid);
      }
    }
    return set;
  }, [friendships, currentUser.uid, currentUser.following]);

  const filteredVideos = useMemo(() => {
    if (filter === 'mine') {
      return videos.filter((v) => v.authorId === currentUser.uid);
    }
    if (filter === 'following') {
      return videos.filter((v) => friendAndFollowingUids.has(v.authorId));
    }
    // Shuffle For You feed per visit while keeping stable order across likes/views updates
    return [...videos].sort((a, b) => {
      const hash = (id: string) => {
        let h = shuffleSeed;
        for (let i = 0; i < id.length; i++) {
          h = Math.imul(h ^ id.charCodeAt(i), 2654435761);
        }
        return h >>> 0;
      };
      return hash(a.id) - hash(b.id);
    });
  }, [videos, filter, friendAndFollowingUids, currentUser.uid, shuffleSeed]);

  const safeIndex = filteredVideos.length > 0 ? Math.min(activeIndex, filteredVideos.length - 1) : 0;
  const activeVideo = filteredVideos[safeIndex] ?? null;

  const scrollToSlide = useCallback(
    (targetIdx: number) => {
      const container = scrollContainerRef.current;
      const clamped = Math.max(0, Math.min(filteredVideos.length - 1, targetIdx));
      setActiveIndex(clamped);
      if (container) {
        container.scrollTo({
          top: clamped * container.clientHeight,
          behavior: 'smooth',
        });
      }
    },
    [filteredVideos.length]
  );

  useEffect(() => {
    setActiveIndex(0);
    setPaused(false);
    setConfirmDeleteId(null);
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({ top: 0, behavior: 'auto' });
    }
  }, [filter]);

  // Track visible snap slide via IntersectionObserver
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || filteredVideos.length === 0) return;

    const slides = Array.from(container.querySelectorAll<HTMLElement>('[data-slide-index]'));
    if (slides.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        let bestIdx: number | null = null;
        let bestRatio = 0;
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio > bestRatio) {
            const idxAttr = entry.target.getAttribute('data-slide-index');
            const parsed = idxAttr ? Number(idxAttr) : NaN;
            if (!Number.isNaN(parsed)) {
              bestRatio = entry.intersectionRatio;
              bestIdx = parsed;
            }
          }
        }
        if (bestIdx !== null && bestRatio >= 0.55) {
          setActiveIndex((prev) => (prev === bestIdx ? prev : bestIdx));
        }
      },
      { root: container, threshold: [0.55, 0.8] }
    );

    slides.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [filteredVideos.length, filter]);

  // Live comments subscription when comments drawer is open
  useEffect(() => {
    if (!commentsVideo) {
      setComments([]);
      return;
    }
    const vid = commentsVideo.id;
    const unsubLocal = subscribeLocalCacheKey<SpotlightComment[]>(
      `spotlight_comments_${vid}`,
      (cached) => {
        if (cached) setComments(cached);
      }
    );
    if (vid.startsWith('local_') || isReadQuotaPaused()) {
      return () => unsubLocal();
    }
    const unsub = onSnapshot(
      query(
        collection(db, 'spotlightVideos', vid, 'comments'),
        orderBy('createdAt', 'desc'),
        limit(50)
      ),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as SpotlightComment);
        void mergeServerCacheList<SpotlightComment>(`spotlight_comments_${vid}`, list).then(
          (merged) => {
            merged.sort(
              (a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0)
            );
            setComments(merged);
          }
        );
      },
      (err) => {
        if (isQuotaExceededError(err)) {
          markReadQuotaExceeded();
        }
      }
    );
    return () => {
      unsub();
      unsubLocal();
    };
  }, [commentsVideo?.id]);

  // Resolve inline or chunked 720p video URL for active slide and adjacent slides
  useEffect(() => {
    if (!activeVideo) {
      setResolvedSrc('');
      setLoadingVideo(false);
      return;
    }

    let cancelled = false;
    setPaused(false);
    setConfirmDeleteId(null);
    setClipHasNoAudio(false);
    setVideoDimsLabel(activeVideo.resolution || '720p HD');

    const cachedActive = activeVideo.videoData || resolvedSrcById[activeVideo.id];
    if (cachedActive) {
      setResolvedSrc(cachedActive);
      setLoadingVideo(false);
    } else {
      setLoadingVideo(true);
      setResolvedSrc('');
      void resolveSpotlightVideoSrc(activeVideo)
        .then((url) => {
          if (!cancelled) {
            setResolvedSrc(url);
            setResolvedSrcById((prev) => ({ ...prev, [activeVideo.id]: url }));
            setLoadingVideo(false);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setLoadingVideo(false);
          }
        });
    }

    // Preload immediate neighbors for seamless snap scrolling
    const neighborIndices = [safeIndex - 1, safeIndex + 1];
    for (const ni of neighborIndices) {
      const neighbor = filteredVideos[ni];
      if (
        neighbor &&
        !neighbor.videoData &&
        !resolvedSrcById[neighbor.id] &&
        !resolvingIdsRef.current.has(neighbor.id)
      ) {
        resolvingIdsRef.current.add(neighbor.id);
        void resolveSpotlightVideoSrc(neighbor)
          .then((url) => {
            setResolvedSrcById((prev) => ({ ...prev, [neighbor.id]: url }));
          })
          .catch(() => {})
          .finally(() => {
            resolvingIdsRef.current.delete(neighbor.id);
          });
      }
    }

    if (!viewedIdsRef.current.has(activeVideo.id)) {
      viewedIdsRef.current.add(activeVideo.id);
      void onIncrementView(activeVideo.id);
    }

    return () => {
      cancelled = true;
    };
  }, [activeVideo, safeIndex, filteredVideos, resolvedSrcById, onIncrementView]);

  // Imperatively sync muted & volume on the active feed <video> AND upload preview <video>
  useEffect(() => {
    const el = videoPlayerRef.current;
    if (!el || !resolvedSrc) return;

    let cancelled = false;
    el.muted = muted || autoplayAudioBlocked;
    el.volume = 1;

    if (!muted && !autoplayAudioBlocked) {
      void el
        .play()
        .then(() => {
          if (!cancelled) {
            setAutoplayAudioBlocked(false);
          }
        })
        .catch(() => {
          if (cancelled) return;
          el.muted = true;
          setAutoplayAudioBlocked(true);
          void el.play().catch(() => {});
        });
    } else {
      void el.play().catch(() => {});
    }

    return () => {
      cancelled = true;
    };
  }, [resolvedSrc, muted, autoplayAudioBlocked, activeVideo?.id]);

  useEffect(() => {
    const el = uploadPreviewRef.current;
    if (!el || !uploadVideoData) return;
    el.muted = uploadPreviewMuted;
    el.volume = 1;
    void el.play().catch(() => {});
  }, [uploadPreviewMuted, uploadVideoData]);

  // Detect whether the decoded video file itself contains an audible audio track
  useEffect(() => {
    const el = videoPlayerRef.current;
    if (!el || !resolvedSrc || paused || muted || autoplayAudioBlocked) return;

    const timer = window.setTimeout(() => {
      if (!videoPlayerRef.current || videoPlayerRef.current.paused || videoPlayerRef.current.muted) {
        return;
      }
      const v = videoPlayerRef.current as HTMLVideoElement & {
        webkitAudioDecodedByteCount?: number;
        mozHasAudio?: boolean;
        audioTracks?: { length: number };
      };
      const hasMoz = v.mozHasAudio === true;
      const hasTracks = Boolean(v.audioTracks && v.audioTracks.length > 0);
      const decodedBytes =
        typeof v.webkitAudioDecodedByteCount === 'number' ? v.webkitAudioDecodedByteCount : null;
      if (!hasMoz && !hasTracks && decodedBytes === 0 && v.currentTime > 0.35) {
        setClipHasNoAudio(true);
      } else if (hasMoz || hasTracks || (decodedBytes !== null && decodedBytes > 0)) {
        setClipHasNoAudio(false);
      }
    }, 850);

    return () => window.clearTimeout(timer);
  }, [resolvedSrc, activeVideo?.id, paused, muted, autoplayAudioBlocked]);

  // Play/stop Web Audio Spotlight music synced with playback state & modal previews
  useEffect(() => {
    if (editMusicVideo) {
      if (editingMusicTrackId !== 'original') {
        startSpotlightTrack(editingMusicTrackId);
      } else {
        stopSpotlightTrack();
      }
      return;
    }

    if (showUploadModal) {
      if (!uploadPreviewMuted && uploadSoundTrackId !== 'original') {
        startSpotlightTrack(uploadSoundTrackId);
      } else {
        stopSpotlightTrack();
      }
      return;
    }

    if (
      activeVideo &&
      resolvedSrc &&
      !paused &&
      !muted &&
      !autoplayAudioBlocked &&
      activeVideo.soundTrackId &&
      activeVideo.soundTrackId !== 'original'
    ) {
      startSpotlightTrack(activeVideo.soundTrackId);
    } else {
      stopSpotlightTrack();
    }
  }, [
    editMusicVideo,
    editingMusicTrackId,
    showUploadModal,
    uploadPreviewMuted,
    uploadSoundTrackId,
    activeVideo,
    resolvedSrc,
    paused,
    muted,
    autoplayAudioBlocked,
  ]);

  useEffect(() => {
    return () => {
      stopSpotlightTrack();
    };
  }, []);

  // Keyboard Up/Down/Space navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (showUploadModal || shareVideo || editMusicVideo || commentsVideo) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        scrollToSlide(safeIndex + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        scrollToSlide(safeIndex - 1);
      } else if (e.key === ' ') {
        const el = videoPlayerRef.current;
        if (!el) return;
        e.preventDefault();
        void resumeSpotlightAudioContext();
        if (el.paused) {
          void el.play().catch(() => {});
          setPaused(false);
        } else {
          el.pause();
          setPaused(true);
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [safeIndex, scrollToSlide, showUploadModal, shareVideo, editMusicVideo, commentsVideo]);

  const handleEnableSound = () => {
    void resumeSpotlightAudioContext();
    setMuted(false);
    setAutoplayAudioBlocked(false);
    const el = videoPlayerRef.current;
    if (el) {
      el.muted = false;
      el.volume = 1;
      void el.play().catch(() => {});
    }
  };

  const togglePlayPause = () => {
    const el = videoPlayerRef.current;
    if (!el) return;
    void resumeSpotlightAudioContext();

    // If sound was muted or blocked by autoplay policy, tapping first enables audio without pausing!
    if (autoplayAudioBlocked || muted) {
      handleEnableSound();
      if (el.paused) {
        void el.play().catch(() => {});
        setPaused(false);
      }
      return;
    }

    if (el.paused) {
      void el.play().catch(() => {});
      setPaused(false);
    } else {
      el.pause();
      setPaused(true);
    }
  };

  const handleVideoFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setProcessingFile(true);
    setUploadError('');
    setUploadClipHasNoAudio(false);
    try {
      const dataUrl = await prepare720pVideoDataUrl(file);
      setUploadVideoData(dataUrl);
      setUploadPreviewMuted(false);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Unable to process 720p video clip.');
    } finally {
      setProcessingFile(false);
    }
  };

  const handlePostUploadedVideo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadVideoData || postingVideo) return;
    setPostingVideo(true);
    setUploadError('');
    const chosenTrack = SPOTLIGHT_SOUND_TRACKS.find((t) => t.id === uploadSoundTrackId);
    const resolvedSoundTitle =
      uploadSoundTitle.trim() ||
      (uploadSoundTrackId === 'original'
        ? `Original Sound · ${currentUser.displayName.split(' ')[0]}`
        : chosenTrack?.title || 'Spotlight Music');

    try {
      await onUploadSpotlightVideo({
        videoData: uploadVideoData,
        caption: uploadCaption.trim(),
        soundTitle: resolvedSoundTitle,
        soundTrackId: uploadSoundTrackId,
      });
      setShowUploadModal(false);
      setUploadVideoData('');
      setUploadCaption('');
      setUploadSoundTitle('');
      setUploadSoundTrackId('original');
      setFilter('foryou');
      setActiveIndex(0);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to post Spotlight video.');
    } finally {
      setPostingVideo(false);
    }
  };

  const activeChatsForShare = useMemo(
    () => chats.filter((c) => !c.archived),
    [chats]
  );

  const otherPeersForShare = useMemo(() => {
    const existingPeers = new Set(
      activeChatsForShare.filter((c) => c.type === 'direct').map((c) => c.peerUid)
    );
    return profiles.filter((p) => p.uid !== currentUser.uid && !existingPeers.has(p.uid));
  }, [profiles, activeChatsForShare, currentUser.uid]);

  const handleForwardToConv = async (conversationId: string) => {
    if (!activeVideo && !shareVideo) return;
    const targetVideo = shareVideo ?? activeVideo!;
    setForwardingId(conversationId);
    try {
      await onForwardVideoToChat({ conversationId, video: targetVideo });
      setShareVideo(null);
    } finally {
      setForwardingId(null);
    }
  };

  const handleForwardToPeer = async (peer: PublicProfile) => {
    if (!activeVideo && !shareVideo) return;
    const targetVideo = shareVideo ?? activeVideo!;
    setForwardingId(peer.uid);
    try {
      await onForwardVideoToChat({ peerProfile: peer, video: targetVideo });
      setShareVideo(null);
    } finally {
      setForwardingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-20 w-screen h-[100dvh] overflow-hidden bg-black text-white select-none">
      {/* Floating Top Bar */}
      <header
        className="absolute top-0 left-0 right-0 z-20 px-3 sm:px-5 pt-3 pb-7 pointer-events-none"
        style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.45) 60%, transparent 100%)' }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 pointer-events-auto">
          <div className="flex items-center gap-2 sm:gap-2.5">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                aria-label="Back"
                className="hidden md:flex w-9 h-9 rounded-full bg-black/45 hover:bg-black/65 backdrop-blur-xs text-white items-center justify-center cursor-pointer transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-[#FFFC00] text-slate-950 flex items-center justify-center shadow-xs shrink-0">
              <Film className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <h1 className="font-display text-base sm:text-lg font-bold text-white leading-tight drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]">
              Spotlight
            </h1>
          </div>

          {/* Segmented Filter */}
          <div
            className="flex items-center bg-black/45 backdrop-blur-md p-1 rounded-2xl border border-white/15"
            role="tablist"
            aria-label="Spotlight feed filter"
          >
            {(
              [
                { id: 'foryou', label: 'For You' },
                { id: 'following', label: 'Following' },
                { id: 'mine', label: 'My Videos' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={filter === tab.id}
                onClick={() => setFilter(tab.id)}
                className={`px-2.5 sm:px-3 py-1 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                  filter === tab.id
                    ? 'bg-[#FFFC00] text-slate-950 shadow-xs'
                    : 'text-white/80 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Record & Post Controls */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={onOpenCameraForSpotlight}
              className="h-9 px-3 sm:px-3.5 rounded-full bg-[#FFFC00] hover:bg-[#F5E600] text-black text-xs font-bold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
            >
              <Camera className="w-4 h-4" />
              <span className="hidden xs:inline sm:inline">Record 720p</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setUploadError('');
                setShowUploadModal(true);
              }}
              className="h-9 px-3 sm:px-3.5 rounded-full bg-[#0E8CFF] hover:bg-[#0B7BE0] text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Post Video</span>
            </button>
          </div>
        </div>
      </header>

      {/* Full-Screen Vertical Snap Feed */}
      {filteredVideos.length === 0 ? (
        <div className="w-screen h-[100dvh] bg-black flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white/10 backdrop-blur-md border border-white/15 rounded-3xl p-8 text-center">
            <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-[#FFFC00] text-slate-950 flex items-center justify-center">
              <Film className="w-7 h-7" />
            </div>
            <h2 className="font-display text-xl font-bold text-white mb-2">
              {filter === 'mine'
                ? 'You haven’t posted a Spotlight video yet'
                : filter === 'following'
                ? 'No videos from friends yet'
                : 'Spotlight Feed is Ready'}
            </h2>
            <p className="text-sm text-white/75 mb-6 leading-relaxed">
              Record a 720p HD clip with sound or upload a short video with music to share it on the feed.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={onOpenCameraForSpotlight}
                className="h-11 px-5 rounded-full bg-[#FFFC00] hover:bg-[#F5E600] text-black text-sm font-bold flex items-center gap-2 cursor-pointer"
              >
                <Camera className="w-4 h-4" />
                <span>Record 720p Video</span>
              </button>
              <button
                type="button"
                onClick={() => setShowUploadModal(true)}
                className="h-11 px-5 rounded-full bg-[#0E8CFF] hover:bg-[#0B7BE0] text-white text-sm font-semibold flex items-center gap-2 cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                <span>Upload Video</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div
          ref={scrollContainerRef}
          className="h-[100dvh] w-screen overflow-y-auto snap-y snap-mandatory overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden bg-black"
        >
          {filteredVideos.map((vid, idx) => {
            const isSlideActive = idx === safeIndex;
            const slideSrc =
              vid.videoData || resolvedSrcById[vid.id] || (isSlideActive ? resolvedSrc : '');
            const slideAuthorProfile = profilesByUid[vid.authorId];
            const slideLikedByMe = vid.likedBy.includes(currentUser.uid);
            const slideIsOwner = vid.authorId === currentUser.uid;
            const slideIsFollowing = (currentUser.following || []).includes(vid.authorId);

            return (
              <section
                key={vid.id}
                data-slide-index={idx}
                className="relative w-screen h-[100dvh] snap-start snap-always overflow-hidden bg-black flex items-center justify-center"
              >
                {/* Edge-to-Edge Full-Screen Video */}
                {!slideSrc ? (
                  <div className="flex flex-col items-center gap-3 text-white/80">
                    <Loader2 className="w-8 h-8 animate-spin text-[#FFFC00]" />
                    <span className="text-xs font-medium">
                      {loadingVideo && isSlideActive ? 'Loading 720p video...' : 'Loading video...'}
                    </span>
                  </div>
                ) : (
                  <video
                    ref={isSlideActive ? videoPlayerRef : undefined}
                    src={slideSrc}
                    autoPlay={isSlideActive}
                    loop
                    playsInline
                    preload="metadata"
                    muted={isSlideActive ? muted || autoplayAudioBlocked : true}
                    onLoadedMetadata={(e) => {
                      if (!isSlideActive) return;
                      const vw = e.currentTarget.videoWidth;
                      const vh = e.currentTarget.videoHeight;
                      const shortEdge = Math.min(vw, vh);
                      if (shortEdge >= 700) {
                        setVideoDimsLabel('720p HD');
                      } else if (shortEdge > 0) {
                        setVideoDimsLabel(`${shortEdge}p`);
                      }
                    }}
                    onClick={isSlideActive ? togglePlayPause : undefined}
                    className="absolute inset-0 w-full h-full object-cover cursor-pointer"
                  />
                )}

                {/* Bottom Gradient Scrim over Video */}
                <div
                  className="pointer-events-none absolute inset-0 z-[4]"
                  style={{ background: 'linear-gradient(to top, black 0%, transparent 30%)' }}
                />

                {/* Floating HUD below Header: Views + 720p + Sound Toggle */}
                <div className="absolute top-16 sm:top-[4.5rem] left-3 sm:left-5 right-3 sm:right-5 z-10 flex items-center justify-between pointer-events-none">
                  <div className="px-2.5 py-1 rounded-full bg-black/45 backdrop-blur-xs text-white text-xs font-mono-tabular font-medium flex items-center gap-1.5">
                    <Eye className="w-3.5 h-3.5 text-[#FFFC00]" />
                    <span>{formatCompactCount(vid.viewCount)} views</span>
                    <span className="text-white/45">·</span>
                    <span className="text-[#FFFC00] font-semibold">
                      {isSlideActive ? videoDimsLabel : vid.resolution || '720p HD'}
                    </span>
                    <span className="text-white/45">·</span>
                    <span>
                      {idx + 1}/{filteredVideos.length}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      if (autoplayAudioBlocked || muted) {
                        handleEnableSound();
                      } else {
                        setMuted(true);
                        stopSpotlightTrack();
                      }
                    }}
                    aria-label={muted || autoplayAudioBlocked ? 'Unmute video' : 'Mute video'}
                    className={`pointer-events-auto w-11 h-11 rounded-full flex items-center justify-center backdrop-blur-xs cursor-pointer transition-colors ${
                      muted || autoplayAudioBlocked
                        ? 'bg-[#FFFC00] text-slate-950'
                        : 'bg-black/45 hover:bg-black/65 text-white'
                    }`}
                  >
                    {muted || autoplayAudioBlocked ? (
                      <VolumeX className="w-5 h-5" />
                    ) : (
                      <Volume2 className="w-5 h-5" />
                    )}
                  </button>
                </div>

                {/* Tap-for-sound button when browser blocks initial unmuted autoplay */}
                {isSlideActive && (autoplayAudioBlocked || muted) && slideSrc && (
                  <button
                    type="button"
                    onClick={handleEnableSound}
                    className="absolute top-28 sm:top-32 left-1/2 -translate-x-1/2 z-10 h-9 px-4 rounded-full bg-[#FFFC00] hover:bg-[#F5E600] text-black text-xs font-bold flex items-center gap-1.5 shadow-lg cursor-pointer whitespace-nowrap"
                  >
                    <Volume2 className="w-4 h-4" />
                    <span>Tap to Hear Music &amp; Sound</span>
                  </button>
                )}

                {/* Silent clip indicator with quick Add Music CTA for author */}
                {isSlideActive &&
                  !autoplayAudioBlocked &&
                  !muted &&
                  clipHasNoAudio &&
                  (!vid.soundTrackId || vid.soundTrackId === 'original') &&
                  slideSrc && (
                    <div className="absolute top-28 sm:top-32 left-1/2 -translate-x-1/2 z-10">
                      {slideIsOwner ? (
                        <button
                          type="button"
                          onClick={() => {
                            void resumeSpotlightAudioContext();
                            setEditingMusicTrackId('lofi');
                            setEditMusicVideo(vid);
                          }}
                          className="h-9 px-4 rounded-full bg-[#FFFC00] hover:bg-[#F5E600] text-black text-xs font-bold flex items-center gap-1.5 shadow-lg cursor-pointer whitespace-nowrap"
                        >
                          <Music2 className="w-4 h-4" />
                          <span>Clip has no sound · Add Music</span>
                        </button>
                      ) : (
                        <span className="h-8 px-3 rounded-full bg-black/65 text-white/85 text-[11px] font-medium flex items-center gap-1.5 whitespace-nowrap backdrop-blur-xs">
                          <VolumeX className="w-3.5 h-3.5 text-white/70" />
                          <span>Silent video (no audio track)</span>
                        </span>
                      )}
                    </div>
                  )}

                {/* Center Pause Indicator */}
                {isSlideActive && paused && slideSrc && (
                  <button
                    type="button"
                    onClick={togglePlayPause}
                    aria-label="Resume video"
                    className="absolute inset-0 z-10 flex items-center justify-center bg-black/20 cursor-pointer"
                  >
                    <span className="w-16 h-16 rounded-full bg-black/60 text-white flex items-center justify-center backdrop-blur-xs">
                      <Play className="w-7 h-7 fill-white ml-0.5" />
                    </span>
                  </button>
                )}

                {/* Floating Bottom Metadata + Floating Right Action Rail */}
                <div className="absolute inset-x-0 bottom-[4.25rem] md:bottom-6 px-4 sm:px-6 z-10 flex items-end justify-between gap-4 pointer-events-none">
                  {/* Creator Info & Caption */}
                  <div className="min-w-0 flex-1 max-w-xl space-y-2 pointer-events-auto drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)]">
                    <div className="flex items-center gap-2.5">
                      <Avatar
                        name={vid.authorName}
                        photoURL={slideAuthorProfile?.photoURL || vid.authorPhotoURL}
                        avatarSeed={slideAuthorProfile?.avatarSeed || vid.authorAvatarSeed}
                        size="sm"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-white truncate">{vid.authorName}</p>
                        <p className="text-xs text-white/80 truncate">
                          @{vid.authorHandle} · {formatRelativeTime(vid.createdAt)}
                        </p>
                      </div>
                      {!slideIsOwner && onToggleFollow && (
                        <button
                          type="button"
                          onClick={() => void onToggleFollow(vid.authorId, slideIsFollowing)}
                          className={`h-7 px-2.5 rounded-full text-[11px] font-bold flex items-center gap-1 shrink-0 cursor-pointer transition-colors ${
                            slideIsFollowing ? 'bg-white/20 text-white' : 'bg-[#FFFC00] text-slate-950'
                          }`}
                        >
                          {slideIsFollowing ? (
                            <>
                              <UserCheck className="w-3 h-3" />
                              <span>Following</span>
                            </>
                          ) : (
                            <>
                              <UserPlus className="w-3 h-3" />
                              <span>Follow</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>

                    {vid.caption && (
                      <p className="text-sm text-white leading-snug line-clamp-3">{vid.caption}</p>
                    )}

                    <div className="flex items-center gap-1.5 text-xs text-white/95">
                      <Music2 className="w-3.5 h-3.5 text-[#FFFC00] shrink-0" />
                      <span className="truncate font-medium">
                        {vid.soundTitle || `Original Sound · ${vid.authorName}`}
                      </span>
                    </div>
                  </div>

                  {/* Vertical Right Action Stack */}
                  <div className="flex flex-col items-center gap-3 shrink-0 pointer-events-auto">
                    <button
                      type="button"
                      onClick={() => void onToggleLike(vid)}
                      aria-label={slideLikedByMe ? 'Unlike video' : 'Like video'}
                      className="flex flex-col items-center gap-1 cursor-pointer group"
                    >
                      <span
                        className={`w-11 h-11 rounded-full flex items-center justify-center backdrop-blur-xs transition-transform active:scale-90 ${
                          slideLikedByMe
                            ? 'bg-rose-500 text-white'
                            : 'bg-black/45 hover:bg-black/65 text-white'
                        }`}
                      >
                        <Heart className={`w-5 h-5 ${slideLikedByMe ? 'fill-white' : ''}`} />
                      </span>
                      <span className="text-[11px] font-mono-tabular font-semibold text-white">
                        {formatCompactCount(vid.likedBy.length)}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setCommentsVideo(vid)}
                      aria-label="Open comments"
                      className="flex flex-col items-center gap-1 cursor-pointer"
                    >
                      <span className="w-11 h-11 rounded-full bg-black/45 hover:bg-black/65 text-white flex items-center justify-center backdrop-blur-xs transition-transform active:scale-90">
                        <MessageSquare className="w-5 h-5" />
                      </span>
                      <span className="text-[11px] font-mono-tabular font-semibold text-white">
                        {formatCompactCount(vid.commentCount || 0)}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setShareVideo(vid)}
                      aria-label="Send video to chat"
                      className="flex flex-col items-center gap-1 cursor-pointer"
                    >
                      <span className="w-11 h-11 rounded-full bg-black/45 hover:bg-black/65 text-white flex items-center justify-center backdrop-blur-xs transition-transform active:scale-90">
                        <Send className="w-5 h-5" />
                      </span>
                      <span className="text-[11px] font-medium text-white">Send</span>
                    </button>

                    {onSaveToMemory && slideSrc && (
                      <button
                        type="button"
                        onClick={() => {
                          void onSaveToMemory(vid, slideSrc).then(() => {
                            setSavedToastId(vid.id);
                            setTimeout(() => setSavedToastId(null), 2000);
                          });
                        }}
                        aria-label="Save video to Memories"
                        className="flex flex-col items-center gap-1 cursor-pointer"
                      >
                        <span
                          className={`w-11 h-11 rounded-full flex items-center justify-center backdrop-blur-xs transition-transform active:scale-90 ${
                            savedToastId === vid.id
                              ? 'bg-[#FFFC00] text-slate-950'
                              : 'bg-black/45 hover:bg-black/65 text-white'
                          }`}
                        >
                          <Bookmark className="w-5 h-5" />
                        </span>
                        <span className="text-[11px] font-medium text-white">
                          {savedToastId === vid.id ? 'Saved!' : 'Save'}
                        </span>
                      </button>
                    )}

                    {!slideIsOwner && slideAuthorProfile && (
                      <button
                        type="button"
                        onClick={() => void onStartDirectChat(slideAuthorProfile)}
                        aria-label={`Chat with ${vid.authorName}`}
                        className="flex flex-col items-center gap-1 cursor-pointer"
                      >
                        <span className="w-11 h-11 rounded-full bg-[#0E8CFF] hover:bg-[#0B7BE0] text-white flex items-center justify-center transition-transform active:scale-90">
                          <MessageCircle className="w-5 h-5" />
                        </span>
                        <span className="text-[11px] font-medium text-white">Chat</span>
                      </button>
                    )}

                    {slideIsOwner && (
                      <button
                        type="button"
                        onClick={() => {
                          void resumeSpotlightAudioContext();
                          setEditingMusicTrackId(
                            vid.soundTrackId && vid.soundTrackId !== 'original'
                              ? vid.soundTrackId
                              : 'lofi'
                          );
                          setEditMusicVideo(vid);
                        }}
                        aria-label="Add or change music track"
                        className="flex flex-col items-center gap-1 cursor-pointer"
                      >
                        <span className="w-11 h-11 rounded-full bg-[#FFFC00] hover:bg-[#F5E600] text-black flex items-center justify-center transition-transform active:scale-90">
                          <Music2 className="w-5 h-5" />
                        </span>
                        <span className="text-[11px] font-medium text-white">Music</span>
                      </button>
                    )}

                    {slideIsOwner && (
                      <button
                        type="button"
                        onClick={() => {
                          if (confirmDeleteId === vid.id) {
                            void onDeleteVideo(vid);
                            setConfirmDeleteId(null);
                          } else {
                            setConfirmDeleteId(vid.id);
                          }
                        }}
                        aria-label="Delete Spotlight video"
                        className="flex flex-col items-center gap-1 cursor-pointer"
                      >
                        <span
                          className={`w-11 h-11 rounded-full flex items-center justify-center backdrop-blur-xs transition-colors ${
                            confirmDeleteId === vid.id
                              ? 'bg-rose-600 text-white'
                              : 'bg-black/45 hover:bg-rose-600/90 text-white'
                          }`}
                        >
                          <Trash2 className="w-5 h-5" />
                        </span>
                        <span className="text-[11px] font-medium text-white">
                          {confirmDeleteId === vid.id ? 'Confirm' : 'Delete'}
                        </span>
                      </button>
                    )}

                    <div className="flex flex-col gap-1.5 pt-1">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => scrollToSlide(idx - 1)}
                        aria-label="Previous video"
                        className="w-11 h-11 rounded-full bg-black/45 hover:bg-black/65 disabled:opacity-35 text-white flex items-center justify-center backdrop-blur-xs cursor-pointer"
                      >
                        <ChevronUp className="w-5 h-5" />
                      </button>
                      <button
                        type="button"
                        disabled={idx >= filteredVideos.length - 1}
                        onClick={() => scrollToSlide(idx + 1)}
                        aria-label="Next video"
                        className="w-11 h-11 rounded-full bg-black/45 hover:bg-black/65 disabled:opacity-35 text-white flex items-center justify-center backdrop-blur-xs cursor-pointer"
                      >
                        <ChevronDown className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Upload / Post Spotlight Video Modal */}
      {showUploadModal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setShowUploadModal(false)}
        >
          <div
            className="w-full max-w-md max-h-[90vh] bg-white dark:bg-[#141414] border border-slate-100 dark:border-white/10 rounded-3xl overflow-hidden shadow-xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-100 dark:border-white/10 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-full bg-[#FFFC00] text-slate-950 flex items-center justify-center">
                  <Film className="w-4 h-4" />
                </span>
                <h3 className="font-display text-lg font-extrabold tracking-[-0.03em] text-slate-900 dark:text-white">
                  Post 720p Video to Spotlight
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowUploadModal(false)}
                aria-label="Close upload modal"
                className="w-9 h-9 rounded-full hover:bg-[#F7F7F7] dark:hover:bg-white/5 text-slate-500 flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={handlePostUploadedVideo}
              className="flex-1 overflow-y-auto chat-scroll p-5 space-y-4"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                onChange={handleVideoFileSelected}
                className="hidden"
              />

              {!uploadVideoData ? (
                <button
                  type="button"
                  disabled={processingFile}
                  onClick={() => {
                    void resumeSpotlightAudioContext();
                    unlockVideoTranscodeAudio();
                    fileInputRef.current?.click();
                  }}
                  className="w-full py-9 px-4 rounded-2xl border-2 border-dashed border-slate-300 dark:border-white/10 hover:border-[#0E8CFF] bg-[#FAFAFA] dark:bg-[#101010] flex flex-col items-center justify-center gap-2 text-center cursor-pointer transition-colors"
                >
                  <span className="w-12 h-12 rounded-full bg-[#FFFC00] text-slate-950 flex items-center justify-center">
                    {processingFile ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Upload className="w-5 h-5" />
                    )}
                  </span>
                  <span className="text-sm font-semibold text-slate-900 dark:text-white">
                    {processingFile ? 'Preparing 720p HD video with audio...' : 'Select a video file'}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    MP4, WebM, or MOV · 720p HD with original sound
                  </span>
                </button>
              ) : (
                <div className="space-y-2">
                  <div className="relative rounded-2xl overflow-hidden bg-black aspect-[9/12] max-h-60 flex items-center justify-center">
                    <video
                      ref={uploadPreviewRef}
                      src={uploadVideoData}
                      autoPlay
                      loop
                      muted={uploadPreviewMuted}
                      playsInline
                      controls
                      onTimeUpdate={(e) => {
                        const v = e.currentTarget as HTMLVideoElement & {
                          webkitAudioDecodedByteCount?: number;
                          mozHasAudio?: boolean;
                          audioTracks?: { length: number };
                        };
                        if (v.currentTime > 0.45 && !v.muted) {
                          const hasAudio =
                            v.mozHasAudio === true ||
                            Boolean(v.audioTracks && v.audioTracks.length > 0) ||
                            (typeof v.webkitAudioDecodedByteCount === 'number' &&
                              v.webkitAudioDecodedByteCount > 0);
                          setUploadClipHasNoAudio(!hasAudio && typeof v.webkitAudioDecodedByteCount === 'number');
                        }
                      }}
                      className="w-full h-full object-contain"
                    />
                    <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          void resumeSpotlightAudioContext();
                          setUploadPreviewMuted((m) => !m);
                        }}
                        className="h-8 w-8 rounded-full bg-black/65 text-white flex items-center justify-center cursor-pointer"
                        aria-label={uploadPreviewMuted ? 'Unmute preview' : 'Mute preview'}
                      >
                        {uploadPreviewMuted ? (
                          <VolumeX className="w-4 h-4" />
                        ) : (
                          <Volume2 className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setUploadVideoData('');
                          setUploadClipHasNoAudio(false);
                        }}
                        className="h-8 px-3 rounded-full bg-black/65 text-white text-xs font-semibold cursor-pointer"
                      >
                        Change
                      </button>
                    </div>
                  </div>
                  {uploadClipHasNoAudio && uploadSoundTrackId === 'original' && (
                    <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                      This video file has no audio track — choose a Music Track below so viewers can hear sound!
                    </p>
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                  Caption
                </label>
                <input
                  type="text"
                  value={uploadCaption}
                  maxLength={LIMITS.STORY_CAPTION_MAX}
                  onChange={(e) => setUploadCaption(e.target.value)}
                  placeholder="Describe your video or add #hashtags..."
                  className="w-full h-11 px-3.5 rounded-2xl bg-[#F2F2F2] dark:bg-white/10/80 border border-slate-100 dark:border-white/10 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-[#0E8CFF]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                  Music &amp; Audio Track (tap to preview)
                </label>
                <div className="grid grid-cols-1 gap-1.5 max-h-44 overflow-y-auto chat-scroll pr-1">
                  {SPOTLIGHT_SOUND_TRACKS.map((track) => {
                    const selected = track.id === uploadSoundTrackId;
                    return (
                      <button
                        key={track.id}
                        type="button"
                        onClick={() => {
                          resumeSpotlightAudioContext();
                          setUploadSoundTrackId(track.id);
                          setUploadPreviewMuted(false);
                          if (track.id !== 'original') {
                            setUploadSoundTitle(track.title);
                          }
                        }}
                        className={`px-3 py-2 rounded-2xl border flex items-center justify-between text-left transition-colors cursor-pointer ${
                          selected
                            ? 'border-[#0E8CFF] bg-[#0E8CFF]/10 dark:bg-[#0E8CFF]/15'
                            : 'border-slate-100 dark:border-white/10/80 hover:bg-[#F2F2F2] dark:hover:bg-white/5/50'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Music2
                            className={`w-4 h-4 shrink-0 ${
                              selected ? 'text-[#0E8CFF]' : 'text-slate-400'
                            }`}
                          />
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                              {track.title}
                            </p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              {track.subtitle}
                            </p>
                          </div>
                        </div>
                        {selected && <Check className="w-4 h-4 text-[#0E8CFF] shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                  Sound Label
                </label>
                <input
                  type="text"
                  value={uploadSoundTitle}
                  maxLength={LIMITS.SOUND_TITLE_MAX}
                  onChange={(e) => setUploadSoundTitle(e.target.value)}
                  placeholder={`Original Sound · ${currentUser.displayName.split(' ')[0]}`}
                  className="w-full h-11 px-3.5 rounded-2xl bg-[#F2F2F2] dark:bg-white/10/80 border border-slate-100 dark:border-white/10 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-[#0E8CFF]"
                />
              </div>

              {uploadError && (
                <p className="text-xs font-medium text-rose-600 dark:text-rose-400">{uploadError}</p>
              )}

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setShowUploadModal(false);
                    onOpenCameraForSpotlight();
                  }}
                  className="h-11 px-4 rounded-2xl border border-slate-100 dark:border-white/10 text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer"
                >
                  <Camera className="w-4 h-4" />
                  <span>Use Camera</span>
                </button>
                <button
                  type="submit"
                  disabled={!uploadVideoData || processingFile || postingVideo}
                  className="flex-1 h-11 rounded-full bg-[#FFFC00] hover:bg-[#F5E600] disabled:opacity-50 text-slate-950 text-sm font-bold cursor-pointer transition-colors"
                >
                  {postingVideo ? 'Uploading 720p...' : 'Post to Spotlight'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Forward Spotlight Video to Chat Modal */}
      {shareVideo && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setShareVideo(null)}
        >
          <div
            className="w-full max-w-md max-h-[80vh] bg-white dark:bg-[#141414] border border-slate-100 dark:border-white/10 rounded-3xl overflow-hidden shadow-xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-100 dark:border-white/10 flex items-center justify-between">
              <h3 className="font-display text-lg font-extrabold tracking-[-0.03em] text-slate-900 dark:text-white">
                Send Video to Chat
              </h3>
              <button
                type="button"
                onClick={() => setShareVideo(null)}
                aria-label="Close share picker"
                className="w-9 h-9 rounded-full hover:bg-[#F7F7F7] dark:hover:bg-white/5 text-slate-500 flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto chat-scroll p-3 space-y-1.5">
              {activeChatsForShare.length === 0 && otherPeersForShare.length === 0 && (
                <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-8">
                  Add friends or start a chat first to send this video.
                </p>
              )}

              {activeChatsForShare.map((chat) => (
                <button
                  key={chat.conversationId}
                  type="button"
                  disabled={forwardingId !== null}
                  onClick={() => void handleForwardToConv(chat.conversationId)}
                  className="w-full px-3 py-2.5 rounded-2xl hover:bg-[#F2F2F2] dark:hover:bg-white/5/60 flex items-center justify-between gap-3 cursor-pointer disabled:opacity-50"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar
                      name={chat.title}
                      photoURL={chat.photoURL}
                      size="sm"
                      isGroup={chat.type === 'group'}
                      isSaved={chat.conversationId === `saved_${currentUser.uid}`}
                    />
                    <span className="text-sm font-medium text-slate-900 dark:text-white truncate">
                      {chat.title}
                    </span>
                  </div>
                  <span className="h-8 px-3 rounded-full bg-[#0E8CFF] text-white text-xs font-semibold flex items-center gap-1 shrink-0">
                    <Send className="w-3.5 h-3.5" />
                    <span>{forwardingId === chat.conversationId ? 'Sending' : 'Send'}</span>
                  </span>
                </button>
              ))}

              {otherPeersForShare.map((peer) => (
                <button
                  key={peer.uid}
                  type="button"
                  disabled={forwardingId !== null}
                  onClick={() => void handleForwardToPeer(peer)}
                  className="w-full px-3 py-2.5 rounded-2xl hover:bg-[#F2F2F2] dark:hover:bg-white/5/60 flex items-center justify-between gap-3 cursor-pointer disabled:opacity-50"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar
                      name={peer.displayName}
                      photoURL={peer.photoURL}
                      avatarSeed={peer.avatarSeed}
                      size="sm"
                    />
                    <div className="min-w-0 text-left">
                      <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                        {peer.displayName}
                      </p>
                      <p className="text-xs text-slate-400 truncate">@{peer.handle}</p>
                    </div>
                  </div>
                  <span className="h-8 px-3 rounded-full bg-[#0E8CFF] text-white text-xs font-semibold flex items-center gap-1 shrink-0">
                    <Send className="w-3.5 h-3.5" />
                    <span>{forwardingId === peer.uid ? 'Sending' : 'Send'}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Edit / Add Music Modal for Posted Video */}
      {editMusicVideo && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setEditMusicVideo(null)}
        >
          <div
            className="w-full max-w-md bg-white dark:bg-[#141414] border border-slate-100 dark:border-white/10 rounded-3xl overflow-hidden shadow-xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-100 dark:border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-full bg-[#FFFC00] text-slate-950 flex items-center justify-center">
                  <Music2 className="w-4 h-4" />
                </span>
                <h3 className="font-display text-lg font-extrabold tracking-[-0.03em] text-slate-900 dark:text-white">
                  Add Music to Spotlight Video
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditMusicVideo(null)}
                aria-label="Close music picker"
                className="w-9 h-9 rounded-full hover:bg-[#F7F7F7] dark:hover:bg-white/5 text-slate-500 flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-2 max-h-[65vh] overflow-y-auto chat-scroll">
              {SPOTLIGHT_SOUND_TRACKS.map((track) => {
                const selected = track.id === editingMusicTrackId;
                return (
                  <button
                    key={track.id}
                    type="button"
                    onClick={() => {
                      void resumeSpotlightAudioContext();
                      setEditingMusicTrackId(track.id);
                    }}
                    className={`w-full px-3.5 py-2.5 rounded-2xl border flex items-center justify-between text-left transition-colors cursor-pointer ${
                      selected
                        ? 'border-[#0E8CFF] bg-[#0E8CFF]/10 dark:bg-[#0E8CFF]/15'
                        : 'border-slate-100 dark:border-white/10/80 hover:bg-[#F2F2F2] dark:hover:bg-white/5/50'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Music2
                        className={`w-4 h-4 shrink-0 ${
                          selected ? 'text-[#0E8CFF]' : 'text-slate-400'
                        }`}
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                          {track.title}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {track.subtitle}
                        </p>
                      </div>
                    </div>
                    {selected && <Check className="w-4 h-4 text-[#0E8CFF] shrink-0" />}
                  </button>
                );
              })}
            </div>

            <div className="p-4 border-t border-slate-100 dark:border-white/10 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEditMusicVideo(null)}
                className="h-11 px-4 rounded-2xl border border-slate-100 dark:border-white/10 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingMusic}
                onClick={async () => {
                  const target = editMusicVideo;
                  const meta = SPOTLIGHT_SOUND_TRACKS.find((t) => t.id === editingMusicTrackId);
                  const soundTitle =
                    editingMusicTrackId === 'original'
                      ? `Original Sound · ${currentUser.displayName.split(' ')[0]}`
                      : meta?.title || 'Spotlight Music';
                  setSavingMusic(true);
                  try {
                    await onUpdateVideoSound(target, editingMusicTrackId, soundTitle);
                    setMuted(false);
                    setAutoplayAudioBlocked(false);
                    setEditMusicVideo(null);
                  } finally {
                    setSavingMusic(false);
                  }
                }}
                className="flex-1 h-11 rounded-full bg-[#FFFC00] hover:bg-[#F5E600] disabled:opacity-50 text-slate-950 text-sm font-bold cursor-pointer"
              >
                {savingMusic ? 'Saving Music...' : 'Save Music Track'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Spotlight Comments Sheet */}
      {commentsVideo && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setCommentsVideo(null)}
        >
          <div
            className="w-full max-w-md max-h-[75vh] bg-white dark:bg-[#141414] border border-slate-100 dark:border-white/10 rounded-t-3xl sm:rounded-3xl overflow-hidden shadow-xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-100 dark:border-white/10 flex items-center justify-between">
              <div>
                <h3 className="font-display text-lg font-extrabold tracking-[-0.03em] text-slate-900 dark:text-white">
                  Comments ({comments.length})
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {commentsVideo.caption || `@${commentsVideo.authorHandle}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCommentsVideo(null)}
                aria-label="Close comments"
                className="w-9 h-9 rounded-full hover:bg-[#F7F7F7] dark:hover:bg-white/5 text-slate-500 flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto chat-scroll p-4 space-y-3">
              {comments.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-8">
                  No comments yet. Start the conversation!
                </p>
              ) : (
                comments.map((cmt) => (
                  <div key={cmt.id} className="flex items-start gap-2.5">
                    <Avatar
                      name={cmt.authorName}
                      photoURL={cmt.authorPhotoURL}
                      size="xs"
                    />
                    <div className="flex-1 min-w-0 bg-[#F2F2F2] dark:bg-white/10/70 rounded-2xl px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                          {cmt.authorName}
                        </span>
                        {cmt.authorId === currentUser.uid && (
                          <button
                            type="button"
                            onClick={() => void deleteSpotlightComment(commentsVideo.id, cmt.id)}
                            aria-label="Delete comment"
                            className="text-slate-400 hover:text-rose-500 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-slate-700 dark:text-slate-200 mt-0.5 break-words">
                        {cmt.text}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!commentText.trim() || postingComment) return;
                setPostingComment(true);
                try {
                  await addSpotlightComment({
                    videoId: commentsVideo.id,
                    videoAuthorId: commentsVideo.authorId,
                    author: currentUser,
                    text: commentText,
                  });
                  setCommentText('');
                } finally {
                  setPostingComment(false);
                }
              }}
              className="p-3 border-t border-slate-100 dark:border-white/10 flex items-center gap-2"
            >
              <input
                type="text"
                value={commentText}
                maxLength={500}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Add a comment..."
                className="flex-1 h-10 px-3.5 rounded-full bg-[#F2F2F2] dark:bg-white/10 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none"
              />
              <button
                type="submit"
                disabled={!commentText.trim() || postingComment}
                className="h-10 px-4 rounded-full bg-[#FFFC00] hover:bg-[#F5E600] disabled:opacity-50 text-slate-950 text-xs font-bold cursor-pointer"
              >
                Post
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
