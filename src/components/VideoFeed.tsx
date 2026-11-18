import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, limit, onSnapshot, query, where } from 'firebase/firestore';
import { ArrowDown, Heart, MessageCircle, Pause, Play, Share2, Volume2, VolumeX, X } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import type { Story } from '../types/messenger';

interface VideoFeedProps {
  onClose: () => void;
}

export function VideoFeed({ onClose }: VideoFeedProps) {
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);
  const [likedIds, setLikedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const unsubscribe = onSnapshot(
      query(collection(db, 'stories'), where('isPublicStory', '==', true), limit(100)),
      (snapshot) => {
        setStories(snapshot.docs.map((item) => item.data() as Story));
        setLoading(false);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'stories');
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  const videos = useMemo(() => {
    const now = Date.now();
    return stories
      .filter((story) => {
        const expiresAt = story.expiresAt?.toMillis?.();
        return story.mediaType === 'video' && (!expiresAt || expiresAt > now) && !!story.imageData;
      })
      .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
  }, [stories]);

  const toggleLike = (storyId: string) => {
    setLikedIds((current) => {
      const next = new Set(current);
      if (next.has(storyId)) next.delete(storyId);
      else next.add(storyId);
      return next;
    });
  };

  const shareVideo = async (story: Story) => {
    const shareData = { title: `${story.authorName} on CoolerUp`, text: story.caption || 'Watch this video on CoolerUp' };
    try {
      if (navigator.share) await navigator.share(shareData);
      else if (navigator.clipboard) await navigator.clipboard.writeText(`${shareData.text} — ${window.location.origin}`);
    } catch {
      // Sharing can be dismissed by the user; no action is needed.
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black text-white" role="dialog" aria-modal="true" aria-label="Video feed">
      <button
        type="button"
        onClick={onClose}
        aria-label="Close video feed"
        className="absolute left-4 top-4 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-black/40 backdrop-blur hover:bg-black/60"
      >
        <X className="h-5 w-5" />
      </button>
      <div className="pointer-events-none absolute left-1/2 top-5 z-10 -translate-x-1/2 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/60">CoolerUp</p>
        <h1 className="font-display text-lg font-bold">For you</h1>
      </div>

      {loading ? (
        <div className="flex h-full items-center justify-center text-sm text-white/70">Loading videos…</div>
      ) : videos.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center px-8 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white/10"><Play className="h-7 w-7" /></div>
          <h2 className="font-display text-xl font-bold">Your video feed is waiting</h2>
          <p className="mt-2 max-w-xs text-sm leading-6 text-white/60">Public video Stories from the CoolerUp community will appear here.</p>
          <button type="button" onClick={onClose} className="mt-6 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-slate-950">Back to chats</button>
        </div>
      ) : (
        <div className="h-full snap-y snap-mandatory overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {videos.map((story) => (
            <VideoCard
              key={story.id}
              story={story}
              liked={likedIds.has(story.id)}
              onLike={() => toggleLike(story.id)}
              onShare={() => void shareVideo(story)}
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
  story,
  liked,
  onLike,
  onShare,
}: {
  story: Story;
  liked: boolean;
  onLike: () => void;
  onShare: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          void video.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
        } else {
          video.pause();
          setPlaying(false);
        }
      },
      { threshold: 0.65 }
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      video.pause();
      setPlaying(false);
    }
  };

  return (
    <article className="relative flex h-[100dvh] w-full snap-start snap-always items-center justify-center overflow-hidden bg-[#101010]">
      <video
        ref={videoRef}
        src={story.imageData}
        className="absolute inset-0 h-full w-full object-contain md:object-cover"
        playsInline
        loop
        muted={muted}
        preload="metadata"
        onClick={togglePlayback}
        aria-label={`Video by ${story.authorName}`}
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/20" />
      {!playing && (
        <button type="button" onClick={togglePlayback} aria-label="Play video" className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/35 p-4 text-white backdrop-blur-sm">
          <Play className="h-8 w-8 fill-current" />
        </button>
      )}

      <div className="absolute bottom-[max(5rem,env(safe-area-inset-bottom))] left-4 right-20 z-10 md:bottom-8 md:left-[calc(50%-210px)] md:right-auto md:w-[330px]">
        <p className="text-base font-bold drop-shadow">@{story.authorHandle || story.authorName}</p>
        {story.caption && <p className="mt-2 line-clamp-3 text-sm leading-5 drop-shadow">{story.caption}</p>}
        <p className="mt-3 text-[11px] font-medium text-white/70">CoolerUp video · 24-hour Story</p>
      </div>

      <div className="absolute bottom-[max(5rem,env(safe-area-inset-bottom))] right-3 z-10 flex flex-col items-center gap-5 md:bottom-8 md:right-[calc(50%-235px)]">
        <div className="mb-1 h-11 w-11 overflow-hidden rounded-full border-2 border-white bg-slate-700">
          {story.authorPhotoURL && <img src={story.authorPhotoURL} alt="" className="h-full w-full object-cover" />}
        </div>
        <button type="button" onClick={onLike} aria-label={liked ? 'Unlike video' : 'Like video'} aria-pressed={liked} className="flex flex-col items-center gap-1">
          <Heart className={`h-7 w-7 drop-shadow ${liked ? 'fill-rose-500 text-rose-500' : 'text-white'}`} />
          <span className="text-[11px] font-semibold">{liked ? '1' : 'Like'}</span>
        </button>
        <button type="button" onClick={() => setMuted((value) => !value)} aria-label={muted ? 'Unmute video' : 'Mute video'} className="flex flex-col items-center gap-1">
          {muted ? <VolumeX className="h-6 w-6 drop-shadow" /> : <Volume2 className="h-6 w-6 drop-shadow" />}
          <span className="text-[11px] font-semibold">Sound</span>
        </button>
        <button type="button" onClick={onShare} aria-label="Share video" className="flex flex-col items-center gap-1">
          <Share2 className="h-6 w-6 drop-shadow" />
          <span className="text-[11px] font-semibold">Share</span>
        </button>
        <span className="sr-only"><MessageCircle /> Comments are available in chat.</span>
        {!playing && <Pause className="hidden" />}
      </div>
    </article>
  );
}
