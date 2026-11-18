import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  Film,
  Heart,
  Loader2,
  MessageCircle,
  Music2,
  Pause,
  Play,
  Plus,
  Send,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  resumeSpotlightAudioContext,
  SPOTLIGHT_SOUND_TRACKS,
  startSpotlightTrack,
  stopSpotlightTrack,
} from '../lib/spotlightMusic';
import { LIMITS, prepare720pVideoDataUrl, unlockVideoTranscodeAudio } from '../lib/validation';
import { resolveSpotlightVideoSrc } from '../services/messengerService';
import type {
  Friendship,
  PublicProfile,
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
  onStartDirectChat: (peer: PublicProfile) => Promise<void>;
  onForwardVideoToChat: (params: {
    conversationId?: string;
    peerProfile?: PublicProfile;
    video: SpotlightVideo;
  }) => Promise<void>;
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
  onStartDirectChat,
  onForwardVideoToChat,
}: SpotlightFeedPanelProps) {
  const [filter, setFilter] = useState<FeedFilter>('foryou');
  const [activeIndex, setActiveIndex] = useState(0);
  const [muted, setMuted] = useState(false);
  const [autoplayAudioBlocked, setAutoplayAudioBlocked] = useState(false);
  const [paused, setPaused] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [clipHasNoAudio, setClipHasNoAudio] = useState(false);

  // Resolved video src (supports inline & chunked 720p videos)
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

  const videoPlayerRef = useRef<HTMLVideoElement | null>(null);
  const uploadPreviewRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const viewedIdsRef = useRef<Set<string>>(new Set());
  const touchStartYRef = useRef<number | null>(null);

  const friendUids = useMemo(() => {
    const set = new Set<string>([currentUser.uid]);
    for (const f of friendships) {
      if (f.status !== 'accepted') continue;
      for (const uid of f.userIds) {
        set.add(uid);
      }
    }
    return set;
  }, [friendships, currentUser.uid]);

  const filteredVideos = useMemo(() => {
    if (filter === 'mine') {
      return videos.filter((v) => v.authorId === currentUser.uid);
    }
    if (filter === 'following') {
      return videos.filter((v) => friendUids.has(v.authorId));
    }
    return videos;
  }, [videos, filter, friendUids, currentUser.uid]);

  const safeIndex = filteredVideos.length > 0 ? Math.min(activeIndex, filteredVideos.length - 1) : 0;
  const activeVideo = filteredVideos[safeIndex] ?? null;

  useEffect(() => {
    setActiveIndex(0);
    setPaused(false);
    setConfirmDeleteId(null);
  }, [filter]);

  // Resolve inline or chunked 720p video URL whenever activeVideo changes
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

    if (activeVideo.videoData) {
      setResolvedSrc(activeVideo.videoData);
      setLoadingVideo(false);
    } else {
      setLoadingVideo(true);
      setResolvedSrc('');
      void resolveSpotlightVideoSrc(activeVideo)
        .then((url) => {
          if (!cancelled) {
            setResolvedSrc(url);
            setLoadingVideo(false);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setLoadingVideo(false);
          }
        });
    }

    if (!viewedIdsRef.current.has(activeVideo.id)) {
      viewedIdsRef.current.add(activeVideo.id);
      void onIncrementView(activeVideo.id);
    }

    return () => {
      cancelled = true;
    };
  }, [activeVideo, onIncrementView]);

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
      if (showUploadModal || shareVideo || editMusicVideo) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => Math.min(Math.max(0, filteredVideos.length - 1), prev + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) => Math.max(0, prev - 1));
      } else if (e.key === ' ') {
        const el = videoPlayerRef.current;
        if (!el) return;
        e.preventDefault();
        resumeSpotlightAudioContext();
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
  }, [filteredVideos.length, showUploadModal, shareVideo]);

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

  const activeAuthorProfile = activeVideo ? profilesByUid[activeVideo.authorId] : undefined;
  const isLikedByMe = activeVideo ? activeVideo.likedBy.includes(currentUser.uid) : false;
  const isOwner = activeVideo ? activeVideo.authorId === currentUser.uid : false;

  return (
    <div className="flex-1 h-full min-h-0 bg-[#F9FAFC] dark:bg-[#0B0F17] flex flex-col overflow-hidden">
      {/* Top Bar */}
      <header className="px-4 sm:px-6 py-3.5 bg-white dark:bg-[#121824] border-b border-slate-200 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#FFFC00] text-slate-950 flex items-center justify-center shadow-xs shrink-0">
            <Film className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-display text-lg sm:text-xl font-bold text-slate-900 dark:text-white leading-tight">
              Spotlight
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 hidden sm:block">
              720p HD vertical videos with music &amp; sound
            </p>
          </div>
        </div>

        {/* Segmented Filter */}
        <div
          className="flex items-center bg-[#F4F6F9] dark:bg-slate-800/70 p-1 rounded-xl border border-slate-200/70 dark:border-slate-700/60"
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
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                filter === tab.id
                  ? 'bg-white dark:bg-[#1E2638] text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Record & Post Controls */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenCameraForSpotlight}
            className="h-10 px-4 rounded-xl bg-[#FFFC00] hover:bg-[#F5E600] text-slate-950 text-xs sm:text-sm font-bold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
          >
            <Camera className="w-4 h-4" />
            <span>Record 720p</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setUploadError('');
              setShowUploadModal(true);
            }}
            className="h-10 px-4 rounded-xl bg-[#00A6FF] hover:bg-[#0090E0] text-white text-xs sm:text-sm font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Post Video</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 min-h-0 overflow-hidden p-3 sm:p-6 pb-16 md:pb-6 flex items-center justify-center">
        {!activeVideo ? (
          <div className="max-w-md w-full bg-white dark:bg-[#121824] border border-slate-200 dark:border-slate-800 rounded-3xl p-8 text-center shadow-xs">
            <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-[#FFFC00] text-slate-950 flex items-center justify-center">
              <Film className="w-7 h-7" />
            </div>
            <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white mb-2">
              {filter === 'mine'
                ? 'You haven’t posted a Spotlight video yet'
                : filter === 'following'
                ? 'No videos from friends yet'
                : 'Spotlight Feed is Ready'}
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 leading-relaxed">
              Record a 720p HD clip with sound or upload a short video with music to share it on the feed.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={onOpenCameraForSpotlight}
                className="h-11 px-5 rounded-xl bg-[#FFFC00] hover:bg-[#F5E600] text-slate-950 text-sm font-bold flex items-center gap-2 cursor-pointer"
              >
                <Camera className="w-4 h-4" />
                <span>Record 720p Video</span>
              </button>
              <button
                type="button"
                onClick={() => setShowUploadModal(true)}
                className="h-11 px-5 rounded-xl bg-[#00A6FF] hover:bg-[#0090E0] text-white text-sm font-semibold flex items-center gap-2 cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                <span>Upload Video</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="w-full max-w-5xl h-full flex items-center justify-center gap-6">
            {/* Vertical 9:16 Theater Video Stage */}
            <div className="relative h-full max-h-[760px] w-full max-w-[420px] aspect-[9/16] rounded-3xl overflow-hidden bg-black shadow-lg border border-slate-200/30 dark:border-slate-800 flex items-center justify-center select-none">
              {loadingVideo || !resolvedSrc ? (
                <div className="flex flex-col items-center gap-3 text-white/80">
                  <Loader2 className="w-8 h-8 animate-spin text-[#FFFC00]" />
                  <span className="text-xs font-medium">Loading 720p video...</span>
                </div>
              ) : (
                <video
                  key={activeVideo.id}
                  ref={videoPlayerRef}
                  src={resolvedSrc}
                  autoPlay
                  loop
                  playsInline
                  muted={muted || autoplayAudioBlocked}
                  onLoadedMetadata={(e) => {
                    const vw = e.currentTarget.videoWidth;
                    const vh = e.currentTarget.videoHeight;
                    const shortEdge = Math.min(vw, vh);
                    if (shortEdge >= 700) {
                      setVideoDimsLabel('720p HD');
                    } else if (shortEdge > 0) {
                      setVideoDimsLabel(`${shortEdge}p`);
                    }
                  }}
                  onClick={togglePlayPause}
                  onTouchStart={(e) => {
                    touchStartYRef.current = e.touches[0]?.clientY ?? null;
                  }}
                  onTouchEnd={(e) => {
                    if (touchStartYRef.current === null) return;
                    const endY = e.changedTouches[0]?.clientY ?? touchStartYRef.current;
                    const delta = touchStartYRef.current - endY;
                    touchStartYRef.current = null;
                    if (delta > 55 && safeIndex < filteredVideos.length - 1) {
                      setActiveIndex((i) => i + 1);
                    } else if (delta < -55 && safeIndex > 0) {
                      setActiveIndex((i) => i - 1);
                    }
                  }}
                  className="w-full h-full object-cover cursor-pointer"
                />
              )}

              {/* Top HUD: Views + 720p + Mute */}
              <div className="absolute top-0 left-0 right-0 p-4 flex items-center justify-between bg-gradient-to-b from-black/75 via-black/25 to-transparent pointer-events-none">
                <div className="px-2.5 py-1 rounded-full bg-black/45 backdrop-blur-xs text-white text-xs font-mono-tabular font-medium flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5 text-[#FFFC00]" />
                  <span>{formatCompactCount(activeVideo.viewCount)} views</span>
                  <span className="text-white/45">·</span>
                  <span className="text-[#FFFC00] font-semibold">{videoDimsLabel}</span>
                  <span className="text-white/45">·</span>
                  <span>
                    {safeIndex + 1}/{filteredVideos.length}
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

              {/* Tap-for-sound pill when browser blocks initial unmuted autoplay */}
              {(autoplayAudioBlocked || muted) && resolvedSrc && (
                <button
                  type="button"
                  onClick={handleEnableSound}
                  className="absolute top-16 left-1/2 -translate-x-1/2 z-20 h-9 px-4 rounded-full bg-[#FFFC00] hover:bg-[#F5E600] text-slate-950 text-xs font-bold flex items-center gap-1.5 shadow-lg cursor-pointer whitespace-nowrap"
                >
                  <Volume2 className="w-4 h-4" />
                  <span>Tap to Hear Music &amp; Sound</span>
                </button>
              )}

              {/* Silent clip indicator with quick Add Music CTA for author */}
              {!autoplayAudioBlocked &&
                !muted &&
                clipHasNoAudio &&
                (!activeVideo.soundTrackId || activeVideo.soundTrackId === 'original') &&
                resolvedSrc && (
                  <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20">
                    {isOwner ? (
                      <button
                        type="button"
                        onClick={() => {
                          void resumeSpotlightAudioContext();
                          setEditingMusicTrackId('lofi');
                          setEditMusicVideo(activeVideo);
                        }}
                        className="h-9 px-4 rounded-full bg-[#FFFC00] hover:bg-[#F5E600] text-slate-950 text-xs font-bold flex items-center gap-1.5 shadow-lg cursor-pointer whitespace-nowrap"
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
              {paused && resolvedSrc && (
                <button
                  type="button"
                  onClick={togglePlayPause}
                  aria-label="Resume video"
                  className="absolute inset-0 flex items-center justify-center bg-black/20 cursor-pointer"
                >
                  <span className="w-16 h-16 rounded-full bg-black/60 text-white flex items-center justify-center backdrop-blur-xs">
                    <Play className="w-7 h-7 fill-white ml-0.5" />
                  </span>
                </button>
              )}

              {/* Bottom Scrim & Metadata + Right Action Column */}
              <div className="absolute inset-x-0 bottom-0 pt-20 pb-4 px-4 bg-gradient-to-t from-black/85 via-black/45 to-transparent flex items-end justify-between gap-3 pointer-events-none">
                {/* Creator Info & Caption */}
                <div className="min-w-0 flex-1 space-y-2 pointer-events-auto">
                  <div className="flex items-center gap-2.5">
                    <Avatar
                      name={activeVideo.authorName}
                      photoURL={activeAuthorProfile?.photoURL || activeVideo.authorPhotoURL}
                      avatarSeed={activeAuthorProfile?.avatarSeed || activeVideo.authorAvatarSeed}
                      size="sm"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-white truncate">
                        {activeVideo.authorName}
                      </p>
                      <p className="text-xs text-white/75 truncate">
                        @{activeVideo.authorHandle} · {formatRelativeTime(activeVideo.createdAt)}
                      </p>
                    </div>
                  </div>

                  {activeVideo.caption && (
                    <p className="text-sm text-white leading-snug line-clamp-3">
                      {activeVideo.caption}
                    </p>
                  )}

                  <div className="flex items-center gap-1.5 text-xs text-white/90">
                    <Music2 className="w-3.5 h-3.5 text-[#FFFC00] shrink-0" />
                    <span className="truncate font-medium">
                      {activeVideo.soundTitle || `Original Sound · ${activeVideo.authorName}`}
                    </span>
                  </div>
                </div>

                {/* Vertical Right Action Stack */}
                <div className="flex flex-col items-center gap-3 shrink-0 pointer-events-auto">
                  <button
                    type="button"
                    onClick={() => void onToggleLike(activeVideo)}
                    aria-label={isLikedByMe ? 'Unlike video' : 'Like video'}
                    className="flex flex-col items-center gap-1 cursor-pointer group"
                  >
                    <span
                      className={`w-11 h-11 rounded-full flex items-center justify-center backdrop-blur-xs transition-transform active:scale-90 ${
                        isLikedByMe
                          ? 'bg-rose-500 text-white'
                          : 'bg-black/45 hover:bg-black/65 text-white'
                      }`}
                    >
                      <Heart className={`w-5 h-5 ${isLikedByMe ? 'fill-white' : ''}`} />
                    </span>
                    <span className="text-[11px] font-mono-tabular font-semibold text-white">
                      {formatCompactCount(activeVideo.likedBy.length)}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShareVideo(activeVideo)}
                    aria-label="Send video to chat"
                    className="flex flex-col items-center gap-1 cursor-pointer"
                  >
                    <span className="w-11 h-11 rounded-full bg-black/45 hover:bg-black/65 text-white flex items-center justify-center backdrop-blur-xs transition-transform active:scale-90">
                      <Send className="w-5 h-5" />
                    </span>
                    <span className="text-[11px] font-medium text-white">Send</span>
                  </button>

                  {!isOwner && activeAuthorProfile && (
                    <button
                      type="button"
                      onClick={() => void onStartDirectChat(activeAuthorProfile)}
                      aria-label={`Chat with ${activeVideo.authorName}`}
                      className="flex flex-col items-center gap-1 cursor-pointer"
                    >
                      <span className="w-11 h-11 rounded-full bg-[#00A6FF] hover:bg-[#0090E0] text-white flex items-center justify-center transition-transform active:scale-90">
                        <MessageCircle className="w-5 h-5" />
                      </span>
                      <span className="text-[11px] font-medium text-white">Chat</span>
                    </button>
                  )}

                  {isOwner && (
                    <button
                      type="button"
                      onClick={() => {
                        void resumeSpotlightAudioContext();
                        setEditingMusicTrackId(
                          activeVideo.soundTrackId && activeVideo.soundTrackId !== 'original'
                            ? activeVideo.soundTrackId
                            : 'lofi'
                        );
                        setEditMusicVideo(activeVideo);
                      }}
                      aria-label="Add or change music track"
                      className="flex flex-col items-center gap-1 cursor-pointer"
                    >
                      <span className="w-11 h-11 rounded-full bg-[#FFFC00] hover:bg-[#F5E600] text-slate-950 flex items-center justify-center transition-transform active:scale-90">
                        <Music2 className="w-5 h-5" />
                      </span>
                      <span className="text-[11px] font-medium text-white">Music</span>
                    </button>
                  )}

                  {isOwner && (
                    <button
                      type="button"
                      onClick={() => {
                        if (confirmDeleteId === activeVideo.id) {
                          void onDeleteVideo(activeVideo);
                          setConfirmDeleteId(null);
                        } else {
                          setConfirmDeleteId(activeVideo.id);
                        }
                      }}
                      aria-label="Delete Spotlight video"
                      className="flex flex-col items-center gap-1 cursor-pointer"
                    >
                      <span
                        className={`w-11 h-11 rounded-full flex items-center justify-center backdrop-blur-xs transition-colors ${
                          confirmDeleteId === activeVideo.id
                            ? 'bg-rose-600 text-white'
                            : 'bg-black/45 hover:bg-rose-600/90 text-white'
                        }`}
                      >
                        <Trash2 className="w-5 h-5" />
                      </span>
                      <span className="text-[11px] font-medium text-white">
                        {confirmDeleteId === activeVideo.id ? 'Confirm' : 'Delete'}
                      </span>
                    </button>
                  )}

                  <div className="flex flex-col gap-1.5 pt-1">
                    <button
                      type="button"
                      disabled={safeIndex === 0}
                      onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
                      aria-label="Previous video"
                      className="w-11 h-11 rounded-full bg-black/45 hover:bg-black/65 disabled:opacity-35 text-white flex items-center justify-center backdrop-blur-xs cursor-pointer"
                    >
                      <ChevronUp className="w-5 h-5" />
                    </button>
                    <button
                      type="button"
                      disabled={safeIndex >= filteredVideos.length - 1}
                      onClick={() =>
                        setActiveIndex((i) => Math.min(filteredVideos.length - 1, i + 1))
                      }
                      aria-label="Next video"
                      className="w-11 h-11 rounded-full bg-black/45 hover:bg-black/65 disabled:opacity-35 text-white flex items-center justify-center backdrop-blur-xs cursor-pointer"
                    >
                      <ChevronDown className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Desktop Wide-Screen Up Next Queue & Creator Rail */}
            <aside className="hidden lg:flex flex-col w-80 h-full max-h-[760px] bg-white dark:bg-[#121824] border border-slate-200 dark:border-slate-800 rounded-3xl overflow-hidden shrink-0">
              <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <div>
                  <h2 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                    Up Next
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {filteredVideos.length} {filteredVideos.length === 1 ? 'video' : 'videos'} · 720p HD
                  </p>
                </div>
                <button
                  type="button"
                  onClick={togglePlayPause}
                  className="h-8 px-3 rounded-lg bg-[#F4F6F9] dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer"
                >
                  {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                  <span>{paused ? 'Play' : 'Pause'}</span>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto chat-scroll p-2.5 space-y-1.5">
                {filteredVideos.map((vid, idx) => {
                  const selected = idx === safeIndex;
                  const liked = vid.likedBy.includes(currentUser.uid);
                  return (
                    <button
                      key={vid.id}
                      type="button"
                      onClick={() => setActiveIndex(idx)}
                      className={`w-full p-2.5 rounded-2xl flex items-center gap-3 text-left transition-colors cursor-pointer ${
                        selected
                          ? 'bg-[#FFFC00]/25 dark:bg-[#FFFC00]/15 ring-1 ring-[#FFFC00]'
                          : 'hover:bg-[#F4F6F9] dark:hover:bg-slate-800/60'
                      }`}
                    >
                      <div className="relative w-12 h-14 rounded-xl overflow-hidden bg-slate-900 text-white flex items-center justify-center shrink-0">
                        {vid.videoData ? (
                          <video
                            src={vid.videoData}
                            muted
                            playsInline
                            preload="metadata"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <Film className="w-5 h-5 text-[#FFFC00]" />
                        )}
                        {selected && (
                          <span className="absolute inset-0 bg-black/35 flex items-center justify-center">
                            <Play className="w-4 h-4 text-white fill-white" />
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                          {vid.authorName}
                        </p>
                        <p className="text-xs text-slate-600 dark:text-slate-300 truncate mt-0.5">
                          {vid.caption || vid.soundTitle}
                        </p>
                        <div className="flex items-center gap-2.5 mt-1 text-[11px] font-mono-tabular text-slate-500 dark:text-slate-400">
                          <span className="flex items-center gap-1">
                            <Heart
                              className={`w-3 h-3 ${liked ? 'text-rose-500 fill-rose-500' : ''}`}
                            />
                            {vid.likedBy.length}
                          </span>
                          <span className="flex items-center gap-1">
                            <Eye className="w-3 h-3" />
                            {vid.viewCount}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-[#F9FAFC] dark:bg-[#0D131F] flex items-center gap-2">
                <button
                  type="button"
                  onClick={onOpenCameraForSpotlight}
                  className="flex-1 h-10 rounded-xl bg-[#FFFC00] hover:bg-[#F5E600] text-slate-950 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Camera className="w-4 h-4" />
                  <span>Record 720p</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowUploadModal(true)}
                  className="h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#121824] text-slate-800 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <Upload className="w-4 h-4" />
                  <span>Upload</span>
                </button>
              </div>
            </aside>
          </div>
        )}
      </div>

      {/* Upload / Post Spotlight Video Modal */}
      {showUploadModal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setShowUploadModal(false)}
        >
          <div
            className="w-full max-w-md max-h-[90vh] bg-white dark:bg-[#121824] border border-slate-200 dark:border-slate-800 rounded-3xl overflow-hidden shadow-xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-lg bg-[#FFFC00] text-slate-950 flex items-center justify-center">
                  <Film className="w-4 h-4" />
                </span>
                <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                  Post 720p Video to Spotlight
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowUploadModal(false)}
                aria-label="Close upload modal"
                className="w-9 h-9 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 flex items-center justify-center cursor-pointer"
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
                  className="w-full py-9 px-4 rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-[#00A6FF] bg-[#F9FAFC] dark:bg-[#0D131F] flex flex-col items-center justify-center gap-2 text-center cursor-pointer transition-colors"
                >
                  <span className="w-12 h-12 rounded-2xl bg-[#FFFC00] text-slate-950 flex items-center justify-center">
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
                  className="w-full h-11 px-3.5 rounded-xl bg-[#F4F6F9] dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-[#00A6FF]"
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
                        className={`px-3 py-2 rounded-xl border flex items-center justify-between text-left transition-colors cursor-pointer ${
                          selected
                            ? 'border-[#00A6FF] bg-[#00A6FF]/10 dark:bg-[#00A6FF]/15'
                            : 'border-slate-200 dark:border-slate-700/80 hover:bg-[#F4F6F9] dark:hover:bg-slate-800/50'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Music2
                            className={`w-4 h-4 shrink-0 ${
                              selected ? 'text-[#00A6FF]' : 'text-slate-400'
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
                        {selected && <Check className="w-4 h-4 text-[#00A6FF] shrink-0" />}
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
                  className="w-full h-11 px-3.5 rounded-xl bg-[#F4F6F9] dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-[#00A6FF]"
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
                  className="h-11 px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer"
                >
                  <Camera className="w-4 h-4" />
                  <span>Use Camera</span>
                </button>
                <button
                  type="submit"
                  disabled={!uploadVideoData || processingFile || postingVideo}
                  className="flex-1 h-11 rounded-xl bg-[#FFFC00] hover:bg-[#F5E600] disabled:opacity-50 text-slate-950 text-sm font-bold cursor-pointer transition-colors"
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
            className="w-full max-w-md max-h-[80vh] bg-white dark:bg-[#121824] border border-slate-200 dark:border-slate-800 rounded-3xl overflow-hidden shadow-xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                Send Video to Chat
              </h3>
              <button
                type="button"
                onClick={() => setShareVideo(null)}
                aria-label="Close share picker"
                className="w-9 h-9 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 flex items-center justify-center cursor-pointer"
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
                  className="w-full px-3 py-2.5 rounded-2xl hover:bg-[#F4F6F9] dark:hover:bg-slate-800/60 flex items-center justify-between gap-3 cursor-pointer disabled:opacity-50"
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
                  <span className="h-8 px-3 rounded-lg bg-[#00A6FF] text-white text-xs font-semibold flex items-center gap-1 shrink-0">
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
                  className="w-full px-3 py-2.5 rounded-2xl hover:bg-[#F4F6F9] dark:hover:bg-slate-800/60 flex items-center justify-between gap-3 cursor-pointer disabled:opacity-50"
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
                  <span className="h-8 px-3 rounded-lg bg-[#00A6FF] text-white text-xs font-semibold flex items-center gap-1 shrink-0">
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
            className="w-full max-w-md bg-white dark:bg-[#121824] border border-slate-200 dark:border-slate-800 rounded-3xl overflow-hidden shadow-xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-lg bg-[#FFFC00] text-slate-950 flex items-center justify-center">
                  <Music2 className="w-4 h-4" />
                </span>
                <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                  Add Music to Spotlight Video
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditMusicVideo(null)}
                aria-label="Close music picker"
                className="w-9 h-9 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 flex items-center justify-center cursor-pointer"
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
                    className={`w-full px-3.5 py-2.5 rounded-xl border flex items-center justify-between text-left transition-colors cursor-pointer ${
                      selected
                        ? 'border-[#00A6FF] bg-[#00A6FF]/10 dark:bg-[#00A6FF]/15'
                        : 'border-slate-200 dark:border-slate-700/80 hover:bg-[#F4F6F9] dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Music2
                        className={`w-4 h-4 shrink-0 ${
                          selected ? 'text-[#00A6FF]' : 'text-slate-400'
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
                    {selected && <Check className="w-4 h-4 text-[#00A6FF] shrink-0" />}
                  </button>
                );
              })}
            </div>

            <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEditMusicVideo(null)}
                className="h-11 px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
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
                className="flex-1 h-11 rounded-xl bg-[#FFFC00] hover:bg-[#F5E600] disabled:opacity-50 text-slate-950 text-sm font-bold cursor-pointer"
              >
                {savingMusic ? 'Saving Music...' : 'Save Music Track'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
