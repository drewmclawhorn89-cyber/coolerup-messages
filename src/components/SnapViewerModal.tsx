import { useEffect, useRef, useState } from 'react';
import { Camera, RotateCcw, Timer, X } from 'lucide-react';
import { formatMessageTime } from '../lib/dateFormat';
import type { Message } from '../types/messenger';
import { Avatar } from './Avatar';

interface SnapViewerModalProps {
  message: Message;
  canReplay: boolean;
  onReplay: () => Promise<void>;
  onScreenshot: () => Promise<void>;
  onClose: () => void;
}

export function SnapViewerModal({
  message,
  canReplay,
  onReplay,
  onScreenshot,
  onClose,
}: SnapViewerModalProps) {
  const totalSec = message.snapDurationSec && message.snapDurationSec < 90
    ? message.snapDurationSec
    : 0;
  const [remainingMs, setRemainingMs] = useState(totalSec > 0 ? totalSec * 1000 : 0);
  const [paused, setPaused] = useState(false);
  const [replayedThisSession, setReplayedThisSession] = useState(false);
  const [screenshottedToast, setScreenshottedToast] = useState(false);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (totalSec === 0 || paused) return;

    const interval = setInterval(() => {
      setRemainingMs((prev) => (prev <= 50 ? 0 : prev - 50));
    }, 50);

    return () => clearInterval(interval);
  }, [totalSec, paused]);

  useEffect(() => {
    if (totalSec > 0 && remainingMs <= 0) {
      onCloseRef.current();
    }
  }, [totalSec, remainingMs]);

  // Keyboard PrintScreen screenshot detection
  useEffect(() => {
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'PrintScreen') {
        setScreenshottedToast(true);
        void onScreenshot();
        setTimeout(() => setScreenshottedToast(false), 2200);
      }
    };
    window.addEventListener('keyup', handleKeyUp);
    return () => window.removeEventListener('keyup', handleKeyUp);
  }, [onScreenshot]);

  const progressPct = totalSec > 0 ? Math.max(0, (remainingMs / (totalSec * 1000)) * 100) : 100;
  const isVideo = message.mediaType === 'video' || message.imageData.startsWith('data:video');

  const handleTriggerReplay = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canReplay || replayedThisSession) return;
    setReplayedThisSession(true);
    setRemainingMs(totalSec > 0 ? totalSec * 1000 : 0);
    await onReplay();
  };

  const handleTriggerScreenshot = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setScreenshottedToast(true);
    await onScreenshot();
    setTimeout(() => setScreenshottedToast(false), 2200);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black flex items-center justify-center select-none"
      onPointerDown={() => setPaused(true)}
      onPointerUp={() => setPaused(false)}
      onPointerLeave={() => setPaused(false)}
    >
      <div className="relative w-full h-full sm:max-w-[440px] sm:max-h-[820px] sm:rounded-3xl overflow-hidden bg-black flex flex-col">
        {/* Progress Bar */}
        <div className="absolute top-0 left-0 right-0 z-20 p-3 bg-gradient-to-b from-black/75 to-transparent">
          <div className="w-full h-1 rounded-full bg-white/25 overflow-hidden mb-3">
            <div
              style={{ width: `${progressPct}%` }}
              className="h-full bg-[#FFFC00] transition-[width] duration-75"
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <Avatar name={message.senderName} photoURL={message.senderPhotoURL} size="sm" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white truncate">
                  {message.senderName}
                </p>
                <p className="text-[11px] text-white/75 font-mono-tabular">
                  {formatMessageTime(message.createdAt)}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              {totalSec > 0 && (
                <span className="h-8 px-2.5 rounded-full bg-black/55 text-white text-xs font-mono-tabular flex items-center gap-1">
                  <Timer className="w-3.5 h-3.5 text-[#FFFC00]" />
                  <span>{Math.ceil(remainingMs / 1000)}s</span>
                </span>
              )}
              {canReplay && !replayedThisSession && (
                <button
                  type="button"
                  onClick={handleTriggerReplay}
                  title="Replay Snap"
                  className="h-8 px-2.5 rounded-full bg-white/15 hover:bg-white/25 text-white text-xs font-medium flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Replay</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleTriggerScreenshot}
                title="Screenshot Snap (notifies sender)"
                className="w-8 h-8 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center cursor-pointer"
              >
                <Camera className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose();
                }}
                aria-label="Close Snap"
                className="w-8 h-8 rounded-full bg-black/55 hover:bg-black/80 text-white flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {screenshottedToast && (
            <div className="mt-2 px-3 py-1.5 rounded-xl bg-rose-600/90 text-white text-xs font-medium text-center">
              You took a screenshot! Sender notified.
            </div>
          )}
        </div>

        {/* Snap Media */}
        <div className="flex-1 flex items-center justify-center bg-black" onClick={onClose}>
          {isVideo ? (
            <video
              src={message.imageData}
              autoPlay
              loop
              playsInline
              className="max-w-full max-h-full object-contain"
            />
          ) : (
            <img
              src={message.imageData}
              alt="Disappearing Snap"
              className="max-w-full max-h-full object-contain"
            />
          )}
        </div>

        <div className="absolute bottom-3 left-0 right-0 text-center pointer-events-none">
          <span className="text-[11px] text-white/65">
            Hold to pause · Tap to close (disappears after closing)
          </span>
        </div>
      </div>
    </div>
  );
}
