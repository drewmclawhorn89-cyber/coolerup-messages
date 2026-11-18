import { useEffect, useRef, useState } from 'react';
import { ChevronUp, Eye, Send, Volume2, VolumeX, X } from 'lucide-react';
import { formatConversationTime } from '../lib/dateFormat';
import type { PublicProfile, Story } from '../types/messenger';
import { Avatar } from './Avatar';

interface StoryViewerModalProps {
  stories: Story[];
  currentUser: PublicProfile;
  profilesByUid: Record<string, PublicProfile>;
  onMarkViewed: (storyId: string) => void;
  onReplyToAuthor: (authorId: string, replyText: string) => Promise<void>;
  onClose: () => void;
}

export function StoryViewerModal({
  stories,
  currentUser,
  profilesByUid,
  onMarkViewed,
  onReplyToAuthor,
  onClose,
}: StoryViewerModalProps) {
  const [index, setIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [replyText, setReplyText] = useState('');
  const [replyFocused, setReplyFocused] = useState(false);
  const [showViewersSheet, setShowViewersSheet] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);
  const [muted, setMuted] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onMarkViewedRef = useRef(onMarkViewed);
  onMarkViewedRef.current = onMarkViewed;

  const activeStory = stories[index];
  const activeStoryId = activeStory?.id;
  const activeDurationSec = activeStory?.durationSec || 5;
  const alreadyViewed = activeStory
    ? activeStory.viewerIds.includes(currentUser.uid) || activeStory.authorId === currentUser.uid
    : true;

  useEffect(() => {
    if (!activeStoryId) {
      onCloseRef.current();
      return;
    }
    if (!alreadyViewed) {
      onMarkViewedRef.current(activeStoryId);
    }
  }, [activeStoryId, alreadyViewed]);

  useEffect(() => {
    if (!activeStoryId) return;
    setProgress(0);
  }, [activeStoryId]);

  useEffect(() => {
    if (!activeStoryId || replyFocused || sendingReply || showViewersSheet) return;
    const totalMs = activeDurationSec * 1000;
    const stepMs = 50;
    const timer = setInterval(() => {
      setProgress((prev) => Math.min(100, prev + (stepMs / totalMs) * 100));
    }, stepMs);

    return () => clearInterval(timer);
  }, [activeStoryId, activeDurationSec, replyFocused, sendingReply, showViewersSheet]);

  useEffect(() => {
    if (progress < 100 || !activeStoryId) return;
    if (index < stories.length - 1) {
      setIndex((i) => i + 1);
    } else {
      onCloseRef.current();
    }
  }, [progress, activeStoryId, index, stories.length]);

  const isVideo = Boolean(
    activeStory &&
      (activeStory.mediaType === 'video' || activeStory.imageData.startsWith('data:video'))
  );

  useEffect(() => {
    const el = videoRef.current;
    if (!isVideo || !el || !activeStoryId) return;
    let cancelled = false;
    el.muted = muted;
    el.volume = 1;
    void el.play().catch(() => {
      if (!cancelled && !muted) {
        el.muted = true;
        setMuted(true);
        void el.play().catch(() => {});
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isVideo, activeStoryId, muted]);

  if (!activeStory) return null;

  const isOwnStory = activeStory.authorId === currentUser.uid;
  const viewers = activeStory.viewerIds.map((uid) => ({
    uid,
    profile: profilesByUid[uid],
  }));

  const handleSendReply = async () => {
    const trimmed = replyText.trim();
    if (!trimmed || sendingReply) return;
    setSendingReply(true);
    try {
      await onReplyToAuthor(activeStory.authorId, trimmed);
      setReplyText('');
      onClose();
    } finally {
      setSendingReply(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex items-center justify-center">
      <div className="relative w-full h-full sm:max-w-[440px] sm:max-h-[820px] sm:rounded-3xl overflow-hidden bg-black flex flex-col">
        {/* Segmented Progress Bars + Header */}
        <div className="absolute top-0 left-0 right-0 z-20 p-3 bg-gradient-to-b from-black/75 to-transparent">
          <div className="flex items-center gap-1 mb-3">
            {stories.map((s, idx) => (
              <div
                key={s.id}
                className="flex-1 h-1 rounded-full bg-white/30 overflow-hidden"
              >
                <div
                  style={{
                    width:
                      idx < index
                        ? '100%'
                        : idx === index
                        ? `${progress}%`
                        : '0%',
                  }}
                  className="h-full bg-white transition-[width] duration-75"
                />
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <Avatar
                name={activeStory.authorName}
                photoURL={activeStory.authorPhotoURL}
                size="sm"
              />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white truncate">
                  {activeStory.authorName}
                </p>
                <p className="text-[11px] text-white/75 font-mono-tabular">
                  {formatConversationTime(activeStory.createdAt)}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              {isVideo && (
                <button
                  type="button"
                  onClick={() => {
                    const next = !muted;
                    setMuted(next);
                    if (videoRef.current) {
                      videoRef.current.muted = next;
                      videoRef.current.volume = 1;
                      void videoRef.current.play().catch(() => {});
                    }
                  }}
                  aria-label={muted ? 'Unmute story video' : 'Mute story video'}
                  className="w-9 h-9 rounded-full bg-black/50 hover:bg-black/75 text-white flex items-center justify-center cursor-pointer"
                >
                  {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close story"
                className="w-9 h-9 rounded-full bg-black/50 hover:bg-black/75 text-white flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        {/* Story Media with Left/Right Tap Navigation */}
        <div className="relative flex-1 flex items-center justify-center bg-black">
          {isVideo ? (
            <video
              ref={videoRef}
              src={activeStory.imageData}
              autoPlay
              loop
              playsInline
              muted={muted}
              className="max-w-full max-h-full object-contain"
            />
          ) : (
            <img
              src={activeStory.imageData}
              alt={activeStory.caption || 'Story'}
              className="max-w-full max-h-full object-contain"
            />
          )}

          <button
            type="button"
            aria-label="Previous story"
            onClick={() => {
              if (index > 0) setIndex((i) => i - 1);
            }}
            className="absolute inset-y-16 left-0 w-1/3 cursor-pointer"
          />
          <button
            type="button"
            aria-label="Next story"
            onClick={() => {
              if (index < stories.length - 1) setIndex((i) => i + 1);
              else onClose();
            }}
            className="absolute inset-y-16 right-0 w-2/3 cursor-pointer"
          />
        </div>

        {/* Footer: Viewers List (own) OR Quick Chat Reply (friends) */}
        <div className="p-3.5 bg-gradient-to-t from-black/90 via-black/70 to-transparent">
          {isOwnStory ? (
            <button
              type="button"
              onClick={() => setShowViewersSheet((v) => !v)}
              className="w-full flex items-center justify-center gap-2 text-xs text-white/95 py-2 rounded-xl hover:bg-white/10 transition-colors cursor-pointer font-mono-tabular"
            >
              <Eye className="w-4 h-4" />
              <span>Viewed by {activeStory.viewerIds.length}</span>
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onFocus={() => setReplyFocused(true)}
                onBlur={() => setReplyFocused(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSendReply();
                }}
                placeholder={`Reply to ${activeStory.authorName.split(' ')[0]}...`}
                className="flex-1 h-10 px-4 rounded-full bg-white/15 border border-white/20 text-sm text-white placeholder:text-white/60 outline-none focus:border-white/50"
              />
              <button
                type="button"
                disabled={!replyText.trim() || sendingReply}
                onClick={handleSendReply}
                className="w-10 h-10 rounded-full bg-[#00A6FF] hover:bg-[#0090E0] disabled:opacity-40 text-white flex items-center justify-center cursor-pointer shrink-0"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Own Story Viewers Sheet */}
        {isOwnStory && showViewersSheet && (
          <div className="absolute inset-x-0 bottom-0 z-30 max-h-[55%] bg-white dark:bg-[#121824] rounded-t-3xl border-t border-slate-200 dark:border-slate-800 flex flex-col">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-900 dark:text-white">
                Story Viewers · {viewers.length}
              </span>
              <button
                type="button"
                onClick={() => setShowViewersSheet(false)}
                className="text-xs font-medium text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
              >
                Close
              </button>
            </div>
            <div className="flex-1 overflow-y-auto chat-scroll p-3 space-y-2">
              {viewers.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 text-center py-6">
                  Nobody has viewed this Story yet.
                </p>
              ) : (
                viewers.map(({ uid, profile }) => (
                  <div key={uid} className="flex items-center gap-3 px-2 py-1.5">
                    <Avatar
                      name={profile?.displayName || 'Friend'}
                      photoURL={profile?.photoURL}
                      avatarSeed={profile?.avatarSeed}
                      size="sm"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                        {profile?.displayName || 'CoolerUp User'}
                      </p>
                      {profile?.handle && (
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          @{profile.handle}
                        </p>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
