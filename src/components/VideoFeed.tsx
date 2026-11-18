import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, limit, onSnapshot, query, where } from 'firebase/firestore';
import {
  ArrowDown,
  Camera,
  Heart,
  Loader2,
  MessageCircle,
  Music2,
  Pause,
  Play,
  Share2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  db,
  handleFirestoreError,
  isQuotaExceededError,
  isReadQuotaPaused,
  markReadQuotaExceeded,
  OperationType,
} from '../lib/firebase';
import { mergeServerCacheList, subscribeLocalCacheKey } from '../lib/localFallbackStore';
import {
  resumeSpotlightAudioContext,
  startSpotlightTrack,
  stopSpotlightTrack,
} from '../lib/spotlightMusic';
import { resolveSpotlightVideoSrc } from '../services/messengerService';
import type { SpotlightVideo, Story } from '../types/messenger';

interface VideoFeedProps {
  stories?: Story[];
  spotlightVideos?: SpotlightVideo[];
  currentUserUid?: string;
  onPostVideo?: () => void;
  onToggleLikeSpotlight?: (video: SpotlightVideo) => Promise<void>;
  onClose: () => void;
}

interface UnifiedFeedVideo {
  id: string;
  kind: 'spotlight' | 'story';
  authorName: string;
  authorHandle: string;
  authorPhotoURL: string;
  caption: string;
  createdAtMs: number;
  soundTitle?: string;
  soundTrackId?: string;
  directSrc?: string;
  spotlight?: SpotlightVideo;
  likedCount: number;
  likedByMe: boolean;
}

export function VideoFeed({
  stories: storiesProp,
  spotlightVideos: spotlightProp,
  currentUserUid = '',
  onPostVideo,
  onToggleLikeSpotlight,
  onClose,
}: VideoFeedProps) {
  const [fallbackStories, setFallbackStories] = useState<Story[]>([]);
  const [fallbackSpotlight, setFallbackSpotlight] = useState<SpotlightVideo[]>([]);
  const [loading, setLoading] = useState(
    () => storiesProp === undefined && spotlightProp === undefined
  );
  const [likedIds, setLikedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (storiesProp !== undefined) {
      setLoading(false);
      return;
    }

    const unsubLocal = subscribeLocalCacheKey<Story[]>('stories', (cached) => {
      if (cached) {
        setFallbackStories(cached);
        setLoading(false);
      }
    });
    if (isReadQuotaPaused()) {
      setLoading(false);
      return () => unsubLocal();
    }

    const unsubscribe = onSnapshot(
      query(collection(db, 'stories'), where('isPublicStory', '==', true), limit(30)),
      (snapshot) => {
        const list = snapshot.docs.map((item) => item.data() as Story);
        void mergeServerCacheList<Story>('stories', list).then((merged) => {
          setFallbackStories(merged);
          setLoading(false);
        });
      },
      (error) => {
        if (isQuotaExceededError(error)) {
          markReadQuotaExceeded();
          setLoading(false);
          return;
        }
        handleFirestoreError(error, OperationType.LIST, 'stories');
        setLoading(false);
      }
    );
    return () => {
      unsubscribe();
      unsubLocal();
    };
  }, [storiesProp]);

  useEffect(() => {
    if (spotlightProp !== undefined) return;
    const unsubLocal = subscribeLocalCacheKey<SpotlightVideo[]>('spotlightVideos', (cached) => {
      if (cached) setFallbackSpotlight(cached);
    });
    if (isReadQuotaPaused()) {
      return () => unsubLocal();
    }

    const unsubscribe = onSnapshot(
      query(collection(db, 'spotlightVideos'), where('isPublic', '==', true), limit(20)),
      (snapshot) => {
        const list = snapshot.docs.map((item) => item.data() as SpotlightVideo);
        void mergeServerCacheList<SpotlightVideo>('spotlightVideos', list).then((merged) => {
          setFallbackSpotlight(merged);
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
      unsubscribe();
      unsubLocal();
    };
  }, [spotlightProp]);

  useEffect(() => {
    return () => {
      stopSpotlightTrack();
    };
  }, []);

  const stories = storiesProp ?? fallbackStories;
  const spotlightVideos = spotlightProp ?? fallbackSpotlight;

  const videos = useMemo<UnifiedFeedVideo[]>(() => {
    const now = Date.now();
    const storyItems: UnifiedFeedVideo[] = stories
      .filter((story) => {
        const expiresAt = story.expiresAt?.toMillis?.();
        return (
          (story.mediaType === 'video' || story.imageData.startsWith('data:video')) &&
          (!expiresAt || expiresAt > now) &&
          !!story.imageData
        );
      })
      .map((story) => ({
        id: `story_${story.id}`,
        kind: 'story',
        authorName: story.authorName,
        authorHandle: story.authorHandle || story.authorName,
        authorPhotoURL: story.authorPhotoURL,
        caption: story.caption,
        createdAtMs: story.createdAt?.toMillis?.() ?? 0,
        directSrc: story.imageData,
        likedCount: likedIds.has(`story_${story.id}`) ? 1 : 0,
        likedByMe: likedIds.has(`story_${story.id}`),
      }));

    const spotlightItems: UnifiedFeedVideo[] = spotlightVideos.map((vid) => ({
      id: `spot_${vid.id}`,
      kind: 'spotlight',
      authorName: vid.authorName,
      authorHandle: vid.authorHandle || vid.authorName,
      authorPhotoURL: vid.authorPhotoURL,
      caption: vid.caption,
      createdAtMs: vid.createdAt?.toMillis?.() ?? 0,
      soundTitle: vid.soundTitle,
      soundTrackId: vid.soundTrackId,
      directSrc: vid.videoData || undefined,
      spotlight: vid,
      likedCount: vid.likedBy.length,
      likedByMe: Boolean(currentUserUid && vid.likedBy.includes(currentUserUid)),
    }));

    return [...spotlightItems, ...storyItems].sort((a, b) => b.createdAtMs - a.createdAtMs);
  }, [stories, spotlightVideos, likedIds, currentUserUid]);

  const toggleLike = (item: UnifiedFeedVideo) => {
    if (item.kind === 'spotlight' && item.spotlight && onToggleLikeSpotlight) {
      void onToggleLikeSpotlight(item.spotlight);
      return;
    }
    setLikedIds((current) => {
      const next = new Set(current);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  };

  const shareVideo = async (item: UnifiedFeedVideo) => {
    const shareData = {
      title: `${item.authorName} on CoolerUp`,
      text: item.caption || 'Watch this video on CoolerUp',
    };
    try {
      if (navigator.share) await navigator.share(shareData);
      else if (navigator.clipboard) {
        await navigator.clipboard.writeText(`${shareData.text} — ${window.location.origin}`);
      }
    } catch {
      // Sharing can be dismissed by the user; no action is needed.
    }
  };

  return (
    <div
      className="fixed inset-0 z-[45] bg-black text-white"
      role="dialog"
      aria-modal="true"
      aria-label="Video feed"
    >
      <button
        type="button"
        onClick={() => {
          stopSpotlightTrack();
          onClose();
        }}
        aria-label="Close video feed"
        className="absolute left-4 top-4 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-black/45 backdrop-blur hover:bg-black/65 cursor-pointer"
      >
        <X className="h-5 w-5" />
      </button>

      <div className="pointer-events-none absolute left-1/2 top-5 z-10 -translate-x-1/2 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/60">
          CoolerUp
        </p>
        <h1 className="font-display text-lg font-bold">For you</h1>
      </div>

      {onPostVideo && (
        <button
          type="button"
          onClick={() => {
            stopSpotlightTrack();
            onPostVideo();
          }}
          className="absolute right-4 top-4 z-20 flex h-10 items-center gap-1.5 rounded-full bg-[#FFFC00] hover:bg-[#F5E600] px-4 text-xs font-bold text-slate-950 shadow-lg cursor-pointer"
        >
          <Camera className="h-4 w-4" />
          <span>Post Video</span>
        </button>
      )}

      {loading ? (
        <div className="flex h-full items-center justify-center text-sm text-white/70">
          Loading videos…
        </div>
      ) : videos.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center px-8 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white/10">
            <Play className="h-7 w-7" />
          </div>
          <h2 className="font-display text-xl font-bold">Your video feed is waiting</h2>
          <p className="mt-2 max-w-xs text-sm leading-6 text-white/60">
            Record or upload a 720p video with music to share it to the feed.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            {onPostVideo && (
              <button
                type="button"
                onClick={onPostVideo}
                className="rounded-full bg-[#FFFC00] hover:bg-[#F5E600] px-5 py-2.5 text-sm font-bold text-slate-950 flex items-center gap-2 cursor-pointer"
              >
                <Camera className="h-4 w-4" />
                <span>Post a Video</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-full bg-white/15 hover:bg-white/25 px-5 py-2.5 text-sm font-semibold text-white cursor-pointer"
            >
              Back to chats
            </button>
          </div>
        </div>
      ) : (
        <div className="h-full snap-y snap-mandatory overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {videos.map((item) => (
            <VideoCard
              key={item.id}
              item={item}
              onLike={() => toggleLike(item)}
              onShare={() => void shareVideo(item)}
            />
          ))}
        </div>
      )}
      {videos.length > 1 && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 text-[10px] font-medium text-white/60">
          <ArrowDown className="h-3 w-3" /> Swipe for more
        </div>
      )}
    </div>
  );
}

function VideoCard({
  item,
  onLike,
  onShare,
}: {
  item: UnifiedFeedVideo;
  onLike: () => void;
  onShare: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string>(item.directSrc || '');
  const [resolving, setResolving] = useState<boolean>(() => !item.directSrc && !!item.spotlight);
  const [playing, setPlaying] = useState(false);
  const [inView, setInView] = useState(false);
  const [muted, setMuted] = useState(false);
  const [autoplayAudioBlocked, setAutoplayAudioBlocked] = useState(false);

  useEffect(() => {
    if (item.directSrc) {
      setSrc(item.directSrc);
      setResolving(false);
      return;
    }
    if (!item.spotlight) return;
    let cancelled = false;
    setResolving(true);
    void resolveSpotlightVideoSrc(item.spotlight)
      .then((url) => {
        if (!cancelled) {
          setSrc(url);
          setResolving(false);
        }
      })
      .catch(() => {
        if (!cancelled) setResolving(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item.directSrc, item.spotlight]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    const tryPlay = () => {
      video.muted = muted || autoplayAudioBlocked;
      video.volume = 1;
      void video
        .play()
        .then(() => {
          setPlaying(true);
        })
        .catch(() => {
          if (!muted && !autoplayAudioBlocked) {
            video.muted = true;
            setAutoplayAudioBlocked(true);
            void video
              .play()
              .then(() => setPlaying(true))
              .catch(() => setPlaying(false));
          } else {
            setPlaying(false);
          }
        });
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        setInView(entry.isIntersecting);
        if (entry.isIntersecting) {
          tryPlay();
        } else {
          video.pause();
          setPlaying(false);
        }
      },
      { threshold: 0.65 }
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, [src, muted, autoplayAudioBlocked]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted || autoplayAudioBlocked;
    video.volume = 1;
  }, [muted, autoplayAudioBlocked]);

  useEffect(() => {
    if (
      inView &&
      playing &&
      !muted &&
      !autoplayAudioBlocked &&
      item.soundTrackId &&
      item.soundTrackId !== 'original'
    ) {
      startSpotlightTrack(item.soundTrackId);
    } else if (!inView || !playing || muted || autoplayAudioBlocked) {
      if (inView) stopSpotlightTrack();
    }
  }, [inView, playing, muted, autoplayAudioBlocked, item.soundTrackId]);

  const enableSound = () => {
    void resumeSpotlightAudioContext();
    const video = videoRef.current;
    setMuted(false);
    setAutoplayAudioBlocked(false);
    if (video) {
      video.muted = false;
      video.volume = 1;
      void video.play().then(() => setPlaying(true)).catch(() => {});
    }
  };

  const togglePlayback = () => {
    void resumeSpotlightAudioContext();
    const video = videoRef.current;
    if (!video) return;
    if (muted || autoplayAudioBlocked) {
      enableSound();
      return;
    }
    if (video.paused) {
      video.muted = false;
      video.volume = 1;
      void video.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      video.pause();
      setPlaying(false);
    }
  };

  const isEffectiveMuted = muted || autoplayAudioBlocked;

  return (
    <article className="relative flex h-[100dvh] w-screen snap-start snap-always items-center justify-center overflow-hidden bg-black">
      {resolving || !src ? (
        <div className="flex flex-col items-center gap-2 text-white/75">
          <Loader2 className="h-8 w-8 animate-spin text-[#FFFC00]" />
          <span className="text-xs font-medium">Loading 720p video...</span>
        </div>
      ) : (
        <video
          ref={videoRef}
          src={src}
          className="absolute inset-0 h-full w-full object-cover cursor-pointer"
          playsInline
          loop
          muted={isEffectiveMuted}
          preload="metadata"
          onClick={togglePlayback}
          aria-label={`Video by ${item.authorName}`}
        />
      )}
      <div
        className="pointer-events-none absolute top-0 left-0 right-0 h-36 z-[4]"
        style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.45) 60%, transparent 100%)' }}
      />
      <div
        className="pointer-events-none absolute bottom-0 left-0 right-0 h-[35dvh] z-[4]"
        style={{ background: 'linear-gradient(to top, black 0%, transparent 100%)' }}
      />
      {isEffectiveMuted && src && (
        <button
          type="button"
          onClick={enableSound}
          className="absolute top-16 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 rounded-full bg-[#FFFC00] px-4 py-2 text-xs font-bold text-slate-950 shadow-lg cursor-pointer"
        >
          <Volume2 className="h-4 w-4" />
          <span>Tap for Sound</span>
        </button>
      )}
      {!playing && src && (
        <button
          type="button"
          onClick={togglePlayback}
          aria-label="Play video"
          className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/35 p-4 text-white backdrop-blur-sm cursor-pointer"
        >
          <Play className="h-8 w-8 fill-current" />
        </button>
      )}

      <div className="absolute bottom-[max(5rem,env(safe-area-inset-bottom))] left-4 right-20 z-10 md:bottom-8 md:left-6 md:right-28">
        <p className="text-base font-bold drop-shadow">@{item.authorHandle || item.authorName}</p>
        {item.caption && <p className="mt-2 line-clamp-3 text-sm leading-5 drop-shadow">{item.caption}</p>}
        <p className="mt-3 text-[11px] font-medium text-white/75 flex items-center gap-1.5">
          {item.soundTitle ? (
            <>
              <Music2 className="h-3.5 w-3.5 text-[#FFFC00] shrink-0" />
              <span className="truncate">{item.soundTitle}</span>
            </>
          ) : (
            <span>CoolerUp video · 24-hour Story</span>
          )}
        </p>
      </div>

      <div className="absolute bottom-[max(5rem,env(safe-area-inset-bottom))] right-3 z-10 flex flex-col items-center gap-5 md:bottom-8 md:right-6">
        <div className="mb-1 h-11 w-11 overflow-hidden rounded-full border-2 border-white bg-slate-700">
          {item.authorPhotoURL && <img src={item.authorPhotoURL} alt="" className="h-full w-full object-cover" />}
        </div>
        <button
          type="button"
          onClick={onLike}
          aria-label={item.likedByMe ? 'Unlike video' : 'Like video'}
          aria-pressed={item.likedByMe}
          className="flex flex-col items-center gap-1 cursor-pointer"
        >
          <Heart className={`h-7 w-7 drop-shadow ${item.likedByMe ? 'fill-rose-500 text-rose-500' : 'text-white'}`} />
          <span className="text-[11px] font-semibold">{item.likedCount > 0 ? item.likedCount : 'Like'}</span>
        </button>
        <button
          type="button"
          onClick={() => {
            if (isEffectiveMuted) {
              enableSound();
            } else {
              stopSpotlightTrack();
              setMuted(true);
            }
          }}
          aria-label={isEffectiveMuted ? 'Unmute video' : 'Mute video'}
          className="flex flex-col items-center gap-1 cursor-pointer"
        >
          {isEffectiveMuted ? <VolumeX className="h-6 w-6 drop-shadow text-[#FFFC00]" /> : <Volume2 className="h-6 w-6 drop-shadow" />}
          <span className="text-[11px] font-semibold">{isEffectiveMuted ? 'Unmute' : 'Sound'}</span>
        </button>
        <button type="button" onClick={onShare} aria-label="Share video" className="flex flex-col items-center gap-1 cursor-pointer">
          <Share2 className="h-6 w-6 drop-shadow" />
          <span className="text-[11px] font-semibold">Share</span>
        </button>
        <span className="sr-only">
          <MessageCircle /> Comments are available in chat.
        </span>
        {!playing && <Pause className="hidden" />}
      </div>
    </article>
  );
}
