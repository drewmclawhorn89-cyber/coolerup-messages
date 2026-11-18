import { useMemo, useRef, useState } from 'react';
import {
  Camera,
  FolderHeart,
  ImagePlus,
  KeyRound,
  Lock,
  LockOpen,
  Play,
  Share2,
  Trash2,
  X,
} from 'lucide-react';
import {
  compressImageToDataUrl,
  transcodeVideoFileToBoundedDataUrl,
} from '../lib/validation';
import { hashMyEyesOnlyPin } from '../services/messengerService';
import type { MemoryItem, PrivateUserInfo } from '../types/messenger';

interface MemoriesModalProps {
  userId: string;
  memories: MemoryItem[];
  privateInfo: PrivateUserInfo | null;
  onSaveCameraRollItem: (params: {
    mediaUrl: string;
    mediaType: 'photo' | 'video';
    caption: string;
  }) => Promise<void>;
  onToggleLock: (memoryId: string, locked: boolean) => Promise<void>;
  onDelete: (memoryId: string) => Promise<void>;
  onSetPinHash: (pinHash: string) => Promise<void>;
  onPostMemoryToStory: (item: MemoryItem) => Promise<void>;
  onOpenCamera: () => void;
  onClose: () => void;
}

export function MemoriesModal({
  memories,
  privateInfo,
  onSaveCameraRollItem,
  onToggleLock,
  onDelete,
  onSetPinHash,
  onPostMemoryToStory,
  onOpenCamera,
  onClose,
}: MemoriesModalProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [tab, setTab] = useState<'snaps' | 'camera_roll' | 'my_eyes_only'>('snaps');
  const [pinInput, setPinInput] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [pinError, setPinError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [previewItem, setPreviewItem] = useState<MemoryItem | null>(null);

  const hasExistingPin = Boolean(privateInfo?.myEyesOnlyPinHash);

  const filteredItems = useMemo(() => {
    if (tab === 'my_eyes_only') {
      return memories.filter((m) => m.locked);
    }
    if (tab === 'camera_roll') {
      return memories.filter((m) => !m.locked && m.source === 'camera_roll');
    }
    return memories.filter((m) => !m.locked);
  }, [memories, tab]);

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = pinInput.trim();
    if (!/^\d{4,8}$/.test(clean)) {
      setPinError('Enter a 4 to 8 digit numeric PIN.');
      return;
    }
    setPinError('');
    const digest = await hashMyEyesOnlyPin(clean);
    if (!hasExistingPin) {
      await onSetPinHash(digest);
      setUnlocked(true);
      setPinInput('');
      return;
    }
    if (digest === privateInfo?.myEyesOnlyPinHash) {
      setUnlocked(true);
      setPinInput('');
    } else {
      setPinError('Incorrect PIN. Please try again.');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      if (file.type.startsWith('video/')) {
        const mediaUrl = await transcodeVideoFileToBoundedDataUrl(file);
        await onSaveCameraRollItem({ mediaUrl, mediaType: 'video', caption: file.name.slice(0, 60) });
      } else {
        const mediaUrl = await compressImageToDataUrl(file);
        await onSaveCameraRollItem({ mediaUrl, mediaType: 'photo', caption: '' });
      }
      setTab('camera_roll');
    } catch (err) {
      setPinError(err instanceof Error ? err.message : 'Unable to import media.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl h-[86vh] rounded-3xl bg-white dark:bg-[#121824] border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#FFFC00] text-slate-950 flex items-center justify-center">
              <FolderHeart className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                Memories
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Cloud-synced Snaps, Camera Roll &amp; My Eyes Only
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              className="h-9 px-3 rounded-xl bg-[#00A6FF] hover:bg-[#0090E0] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <ImagePlus className="w-4 h-4" />
              <span>{uploading ? 'Importing...' : 'Import'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Memories"
              className="w-9 h-9 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 flex items-center justify-center cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          onChange={handleFileUpload}
          className="hidden"
        />

        {/* Tabs */}
        <div className="px-4 pt-3 pb-2 border-b border-slate-100 dark:border-slate-800/80 grid grid-cols-3 gap-1.5">
          {(
            [
              { id: 'snaps', label: 'Snaps' },
              { id: 'camera_roll', label: 'Camera Roll' },
              { id: 'my_eyes_only', label: 'My Eyes Only 🔒' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id);
                setPinError('');
              }}
              className={`h-9 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                tab === t.id
                  ? 'bg-[#FFFC00] text-slate-950'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto chat-scroll p-4">
          {tab === 'my_eyes_only' && !unlocked ? (
            <div className="max-w-xs mx-auto py-10 text-center space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-slate-900 dark:bg-slate-800 text-[#FFFC00] flex items-center justify-center mx-auto">
                <KeyRound className="w-7 h-7" />
              </div>
              <div>
                <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                  {hasExistingPin ? 'Enter My Eyes Only PIN' : 'Create My Eyes Only PIN'}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {hasExistingPin
                    ? 'Unlock private locked Snaps synced to your account.'
                    : 'Set a 4–8 digit PIN to protect private Snaps.'}
                </p>
              </div>
              {pinError && <p className="text-xs text-rose-500 font-medium">{pinError}</p>}
              <form onSubmit={handlePinSubmit} className="space-y-3">
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={8}
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value)}
                  placeholder="Enter PIN (e.g. 1234)"
                  className="w-full h-11 px-4 rounded-xl bg-slate-100 dark:bg-slate-800 text-center text-lg font-mono-tabular tracking-widest text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-[#FFFC00]"
                />
                <button
                  type="submit"
                  className="w-full h-11 rounded-xl bg-[#FFFC00] hover:bg-[#F5E600] text-slate-950 text-sm font-bold cursor-pointer"
                >
                  {hasExistingPin ? 'Unlock' : 'Set PIN & Open'}
                </button>
              </form>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="py-16 text-center space-y-3">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                {tab === 'my_eyes_only'
                  ? 'No locked items in My Eyes Only'
                  : tab === 'camera_roll'
                  ? 'No imported Camera Roll photos or videos yet'
                  : 'No saved Memories yet'}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto">
                Tap Save after taking a Snap or import media from your device.
              </p>
              <div className="flex items-center justify-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenCamera();
                  }}
                  className="h-9 px-4 rounded-xl bg-[#FFFC00] text-slate-950 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>Take a Snap</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {filteredItems.map((item) => (
                <div
                  key={item.id}
                  className="group relative aspect-[3/4] rounded-2xl overflow-hidden bg-slate-900 border border-slate-200 dark:border-slate-800"
                >
                  {item.mediaType === 'video' ? (
                    <div
                      onClick={() => setPreviewItem(item)}
                      className="w-full h-full relative cursor-pointer"
                    >
                      <video
                        src={item.mediaUrl}
                        muted
                        playsInline
                        preload="metadata"
                        className="w-full h-full object-cover"
                      />
                      <span className="absolute top-2 left-2 w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center">
                        <Play className="w-3.5 h-3.5 fill-white" />
                      </span>
                    </div>
                  ) : (
                    <img
                      src={item.mediaUrl}
                      alt={item.caption || 'Saved Memory'}
                      onClick={() => setPreviewItem(item)}
                      className="w-full h-full object-cover cursor-pointer"
                    />
                  )}

                  <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 via-black/40 to-transparent flex items-center justify-between gap-1">
                    <button
                      type="button"
                      onClick={() => void onToggleLock(item.id, !item.locked)}
                      title={item.locked ? 'Move out of My Eyes Only' : 'Move to My Eyes Only'}
                      className="w-7 h-7 rounded-lg bg-white/15 hover:bg-white/30 text-white flex items-center justify-center cursor-pointer"
                    >
                      {item.locked ? <LockOpen className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                    </button>

                    <button
                      type="button"
                      onClick={() => void onPostMemoryToStory(item)}
                      title="Post to My Story"
                      className="h-7 px-2 rounded-lg bg-[#FFFC00] text-slate-950 text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Share2 className="w-3 h-3" />
                      <span>Story</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => void onDelete(item.id)}
                      title="Delete memory"
                      className="w-7 h-7 rounded-lg bg-rose-500/80 hover:bg-rose-600 text-white flex items-center justify-center cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {previewItem && (
          <div
            className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
            onClick={() => setPreviewItem(null)}
          >
            <button
              type="button"
              onClick={() => setPreviewItem(null)}
              aria-label="Close memory preview"
              className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/15 text-white flex items-center justify-center cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
            <div onClick={(e) => e.stopPropagation()} className="max-w-md max-h-[85vh]">
              {previewItem.mediaType === 'video' ? (
                <video
                  src={previewItem.mediaUrl}
                  controls
                  autoPlay
                  playsInline
                  className="max-h-[80vh] rounded-2xl"
                />
              ) : (
                <img
                  src={previewItem.mediaUrl}
                  alt={previewItem.caption || 'Memory'}
                  className="max-h-[80vh] rounded-2xl object-contain"
                />
              )}
              {previewItem.caption && (
                <p className="text-center text-white text-sm font-medium mt-3">
                  {previewItem.caption}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
