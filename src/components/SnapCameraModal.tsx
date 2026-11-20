import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  Bookmark,
  Camera,
  Check,
  Crop,
  Film,
  FolderHeart,
  ImagePlus,
  MapPin,
  Music2,
  Pencil,
  RefreshCw,
  Search,
  Send,
  Settings,
  Smile,
  SmilePlus,
  Sparkles,
  SunMedium,
  Timer,
  Type,
  Undo2,
  UserPlus,
  Video,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react';
import {
  resumeSpotlightAudioContext,
  SPOTLIGHT_SOUND_TRACKS,
  startSpotlightTrack,
  stopSpotlightTrack,
} from '../lib/spotlightMusic';
import {
  blobToBoundedDataUrl,
  compressCanvasToDataUrl,
  LIMITS,
  pickSupportedVideoMimeType,
  prepare720pVideoDataUrl,
  unlockVideoTranscodeAudio,
} from '../lib/validation';
import type { PublicProfile, UserChatIndex } from '../types/messenger';
import { Avatar } from './Avatar';

interface LensOption {
  id: string;
  label: string;
  badge: string;
  cssFilter: string;
  overlayType?: 'dog' | 'crown' | 'funny' | 'cartoon';
}

const LENSES: LensOption[] = [
  { id: 'normal', label: 'Natural', badge: '✨', cssFilter: 'none' },
  { id: 'dog', label: 'Dog Ears', badge: '🐶', cssFilter: 'saturate(1.12) brightness(1.03)', overlayType: 'dog' },
  { id: 'crown', label: 'Flower Crown', badge: '🌸', cssFilter: 'brightness(1.06) saturate(1.18)', overlayType: 'crown' },
  { id: 'funny', label: 'Funny Face', badge: '🤪', cssFilter: 'contrast(1.18) saturate(1.3)', overlayType: 'funny' },
  { id: 'beauty', label: 'Beauty Smooth', badge: '💫', cssFilter: 'brightness(1.08) contrast(0.94) saturate(1.1) blur(0.4px)' },
  { id: 'bw', label: 'Black & White', badge: '🖤', cssFilter: 'grayscale(1) contrast(1.25)' },
  { id: 'vintage', label: 'Vintage', badge: '🎞️', cssFilter: 'sepia(0.55) contrast(1.1) brightness(0.95)' },
  { id: 'cartoon', label: 'Cartoon', badge: '🎨', cssFilter: 'saturate(1.85) contrast(1.35) brightness(1.04)', overlayType: 'cartoon' },
];

const PEN_COLORS = ['#FFFFFF', '#FFFC00', '#0E8CFF', '#F43F5E', '#10B981'];
const STICKER_OPTIONS = ['🔥', '😂', '❤️', '👻', '⚡', '🎉', '✨', '😎', '💯', '☕', '🐶', '🌸', '🌈', '🥳'];
const GIF_BADGE_STICKERS = ['🔥 VIBES', '😂 LMAO', '✨ SLAY', '⚡ SNAP!', '🎉 PARTY', '💖 LOVE U'];
const VIEW_TIMER_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0] as const; // 0 => infinite
const CAPTURE_TIMER_OPTIONS = [0, 3, 10] as const;
const CROP_RATIOS = ['original', '9:16', '1:1', '4:3'] as const;
type CropRatio = (typeof CROP_RATIOS)[number];

interface Stroke {
  color: string;
  points: { x: number; y: number }[];
}

interface PlacedSticker {
  id: string;
  content: string;
  kind: 'emoji' | 'badge';
  x: number; // 0..1
  y: number; // 0..1
}

interface SnapCameraModalProps {
  embedded?: boolean;
  currentUser: PublicProfile;
  chats: UserChatIndex[];
  profiles: PublicProfile[];
  preselectedConversationId?: string | null;
  initialMode?: 'snap' | 'story' | 'spotlight';
  initialCaptureKind?: 'photo' | 'video';
  unreadNotificationsCount?: number;
  onOpenProfile?: () => void;
  onOpenSearch?: () => void;
  onOpenAddFriend?: () => void;
  onOpenNotifications?: () => void;
  onOpenSettings?: () => void;
  onOpenMemories?: () => void;
  onSaveToMemory?: (params: {
    mediaUrl: string;
    mediaType: 'photo' | 'video';
    caption: string;
  }) => Promise<void>;
  onClose: () => void;
  onSendSnapToConversations: (params: {
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
  }) => Promise<void>;
}

function drawLensOverlayOnCanvas(
  ctx: CanvasRenderingContext2D,
  overlayType: LensOption['overlayType'],
  w: number,
  h: number
) {
  if (!overlayType) return;
  ctx.save();
  if (overlayType === 'dog') {
    ctx.font = `${Math.round(w * 0.19)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🐶', w * 0.5, h * 0.28);
    ctx.font = `${Math.round(w * 0.14)}px system-ui, sans-serif`;
    ctx.fillText('🐾', w * 0.18, h * 0.8);
    ctx.fillText('🐾', w * 0.82, h * 0.8);
  } else if (overlayType === 'crown') {
    const crownY = h * 0.2;
    const items = ['🌸', '🌺', '🌼', '🌻', '🌸'];
    ctx.font = `${Math.round(w * 0.1)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    items.forEach((em, idx) => {
      const px = w * (0.26 + idx * 0.12);
      const arc = Math.abs(idx - 2) * (h * 0.015);
      ctx.fillText(em, px, crownY + arc);
    });
  } else if (overlayType === 'funny') {
    ctx.font = `${Math.round(w * 0.15)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('👀', w * 0.5, h * 0.3);
    ctx.fillText('😜', w * 0.5, h * 0.62);
  } else if (overlayType === 'cartoon') {
    ctx.strokeStyle = '#FFFC00';
    ctx.lineWidth = Math.max(8, Math.round(w * 0.02));
    ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth);
    ctx.font = `900 ${Math.round(w * 0.08)}px "Plus Jakarta Sans", sans-serif`;
    ctx.fillStyle = '#FFFC00';
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 5;
    ctx.textAlign = 'left';
    ctx.strokeText('POW!', w * 0.08, h * 0.15);
    ctx.fillText('POW!', w * 0.08, h * 0.15);
  }
  ctx.restore();
}

export function SnapCameraModal({
  embedded = false,
  currentUser,
  chats,
  profiles,
  preselectedConversationId = null,
  initialMode = 'snap',
  initialCaptureKind,
  unreadNotificationsCount = 0,
  onOpenProfile,
  onOpenSearch,
  onOpenAddFriend,
  onOpenNotifications,
  onOpenSettings,
  onOpenMemories,
  onSaveToMemory,
  onClose,
  onSendSnapToConversations,
}: SnapCameraModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const drawCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewContainerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const draggingStickerRef = useRef<string | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdStartedRecordingRef = useRef(false);

  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [flashOn, setFlashOn] = useState(false);
  const [flashPulse, setFlashPulse] = useState(false);
  const [captureTimerSec, setCaptureTimerSec] = useState<number>(0);
  const [countdownLeft, setCountdownLeft] = useState<number | null>(null);

  const [captureKind, setCaptureKind] = useState<'photo' | 'video'>(
    initialCaptureKind ?? (initialMode === 'spotlight' ? 'video' : 'photo')
  );
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSec, setRecordingSec] = useState(0);

  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [selectedLens, setSelectedLens] = useState<LensOption>(LENSES[0]);
  const [showLensesRow, setShowLensesRow] = useState(true);

  const [capturedMedia, setCapturedMedia] = useState<{
    dataUrl: string;
    mediaType: 'photo' | 'video';
  } | null>(null);
  const [photoDims, setPhotoDims] = useState<{ w: number; h: number }>({ w: 720, h: 960 });

  // Editor tools
  const [caption, setCaption] = useState('');
  const [showCaptionInput, setShowCaptionInput] = useState(false);
  const [drawingMode, setDrawingMode] = useState(false);
  const [penColor, setPenColor] = useState(PEN_COLORS[1]);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const activeStrokeRef = useRef<Stroke | null>(null);

  const [showStickerBar, setShowStickerBar] = useState(false);
  const [stickerTab, setStickerTab] = useState<'emoji' | 'gif' | 'info'>('emoji');
  const [stickers, setStickers] = useState<PlacedSticker[]>([]);
  const [cropRatio, setCropRatio] = useState<CropRatio>('original');

  const [durationSec, setDurationSec] = useState<number>(5);
  const [showSendPicker, setShowSendPicker] = useState(false);
  const [postToStory, setPostToStory] = useState(initialMode === 'story');
  const [postToSpotlight, setPostToSpotlight] = useState(initialMode === 'spotlight');
  const [selectedSoundTrackId, setSelectedSoundTrackId] = useState<string>('original');
  const [showSoundPicker, setShowSoundPicker] = useState(false);
  const [previewMuted, setPreviewMuted] = useState(false);
  const [selectedConvIds, setSelectedConvIds] = useState<string[]>(
    preselectedConversationId ? [preselectedConversationId] : []
  );
  const [selectedPeerUids, setSelectedPeerUids] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [savingMemory, setSavingMemory] = useState(false);
  const [savedToMemoryFeedback, setSavedToMemoryFeedback] = useState(false);
  const [sendError, setSendError] = useState('');

  // Start/restart camera stream
  useEffect(() => {
    if (capturedMedia) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      return;
    }

    let cancelled = false;
    setCameraError('');
    setCameraReady(false);

    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('Camera unavailable here — upload a 720p photo or video below.');
        return;
      }
      const isPortraitViewport = window.innerHeight >= window.innerWidth;
      const videoConstraint: MediaTrackConstraints = {
        facingMode,
        width: { ideal: isPortraitViewport ? 720 : 1280 },
        height: { ideal: isPortraitViewport ? 1280 : 720 },
        frameRate: { ideal: 30 },
      };

      try {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: videoConstraint,
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({
            video: videoConstraint,
            audio: false,
          });
        }
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
          setCameraReady(true);
        }
      } catch {
        if (!cancelled) {
          setCameraError('Camera permission not granted — upload a photo or 720p video below.');
        }
      }
    }

    void startCamera();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [facingMode, capturedMedia]);

  // Sync muted & volume on captured video preview
  useEffect(() => {
    const el = previewVideoRef.current;
    if (!el || capturedMedia?.mediaType !== 'video') return;
    let cancelled = false;
    el.muted = previewMuted;
    el.volume = 1;
    void el.play().catch(() => {
      if (!cancelled && !previewMuted) {
        el.muted = true;
        setPreviewMuted(true);
        void el.play().catch(() => {});
      }
    });
    return () => {
      cancelled = true;
    };
  }, [capturedMedia, previewMuted]);

  // Sync background music track preview
  useEffect(() => {
    if (
      capturedMedia?.mediaType === 'video' &&
      !previewMuted &&
      !showSendPicker &&
      selectedSoundTrackId !== 'original'
    ) {
      startSpotlightTrack(selectedSoundTrackId);
    } else {
      stopSpotlightTrack();
    }
    return () => {
      stopSpotlightTrack();
    };
  }, [capturedMedia, previewMuted, showSendPicker, selectedSoundTrackId]);

  // Try applying torch constraint when flash toggles
  useEffect(() => {
    const track = streamRef.current?.getVideoTracks()?.[0];
    if (!track || typeof track.applyConstraints !== 'function') return;
    track.applyConstraints({
      advanced: [{ torch: flashOn } as MediaTrackConstraintSet],
    }).catch(() => {});
  }, [flashOn, cameraReady]);

  // Countdown capture timer effect
  useEffect(() => {
    if (countdownLeft === null) return;
    if (countdownLeft <= 0) {
      setCountdownLeft(null);
      if (captureKind === 'photo') {
        executePhotoCapture();
      } else {
        executeVideoToggle();
      }
      return;
    }
    const timer = setTimeout(() => {
      setCountdownLeft((c) => (c === null ? null : c - 1));
    }, 1000);
    return () => clearTimeout(timer);
  });

  // Recording elapsed seconds timer up to 60 seconds
  useEffect(() => {
    if (!isRecording) {
      setRecordingSec(0);
      return;
    }
    const id = setInterval(() => {
      setRecordingSec((prev) => {
        if (prev >= LIMITS.MAX_CAMERA_VIDEO_SEC - 1) {
          recorderRef.current?.stop();
          return LIMITS.MAX_CAMERA_VIDEO_SEC;
        }
        return prev + 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [isRecording]);

  // Redraw doodle strokes
  useEffect(() => {
    const canvas = drawCanvasRef.current;
    if (!canvas || !capturedMedia || capturedMedia.mediaType !== 'photo') return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(4, Math.round(canvas.width * 0.01));

    for (const stroke of strokes) {
      if (stroke.points.length === 0) continue;
      ctx.strokeStyle = stroke.color;
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x * canvas.width, stroke.points[0].y * canvas.height);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x * canvas.width, stroke.points[i].y * canvas.height);
      }
      if (stroke.points.length === 1) {
        ctx.lineTo(stroke.points[0].x * canvas.width + 0.5, stroke.points[0].y * canvas.height);
      }
      ctx.stroke();
    }
  }, [strokes, capturedMedia, photoDims]);

  const executePhotoCapture = () => {
    const video = videoRef.current;
    if (!video || !cameraReady) return;

    if (flashOn) {
      setFlashPulse(true);
      setTimeout(() => setFlashPulse(false), 180);
    }

    const vw = video.videoWidth || 720;
    const vh = video.videoHeight || 1280;
    const maxDim = 1280;
    const scale = Math.min(1, maxDim / Math.max(vw, vh));
    const w = Math.round(vw * scale);
    const h = Math.round(vh * scale);

    const offscreen = document.createElement('canvas');
    offscreen.width = w;
    offscreen.height = h;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.filter = selectedLens.cssFilter;
    if (facingMode === 'user') {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, w, h);
    ctx.restore();

    drawLensOverlayOnCanvas(ctx, selectedLens.overlayType, w, h);

    setPhotoDims({ w, h });
    setCropRatio('original');
    setSavedToMemoryFeedback(false);
    setCapturedMedia({
      dataUrl: offscreen.toDataURL('image/jpeg', 0.92),
      mediaType: 'photo',
    });
    setStrokes([]);
    setStickers([]);
  };

  const executeVideoToggle = () => {
    if (isRecording) {
      recorderRef.current?.stop();
      return;
    }

    const stream = streamRef.current;
    if (!stream || typeof MediaRecorder === 'undefined') {
      setCameraError('Video recording unsupported in this browser.');
      return;
    }

    const chunks: Blob[] = [];
    const mimeType = pickSupportedVideoMimeType();

    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: 1_100_000,
      audioBitsPerSecond: 96_000,
    });

    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) chunks.push(ev.data);
    };

    recorder.onstop = async () => {
      setIsRecording(false);
      setSendError('');
      const blob = new Blob(chunks, { type: mimeType || recorder.mimeType || 'video/webm' });
      if (blob.size < 256) {
        setCameraError('Recorded video was empty. Please try again.');
        return;
      }
      try {
        const dataUrl = await blobToBoundedDataUrl(
          blob,
          '720p Video Snap',
          LIMITS.SPOTLIGHT_TOTAL_MAX
        );
        setSavedToMemoryFeedback(false);
        setCapturedMedia({ dataUrl, mediaType: 'video' });
      } catch (err) {
        setSendError(err instanceof Error ? err.message : 'Video Snap too large.');
      }
    };

    recorderRef.current = recorder;
    recorder.start(250);
    setIsRecording(true);
  };

  // Hold-to-record up to 60s OR tap to capture photo
  const handleShutterPointerDown = () => {
    if (!cameraReady || isRecording) return;
    void resumeSpotlightAudioContext();
    holdStartedRecordingRef.current = false;
    holdTimerRef.current = setTimeout(() => {
      holdStartedRecordingRef.current = true;
      setCaptureKind('video');
      executeVideoToggle();
    }, 340);
  };

  const handleShutterPointerUp = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (holdStartedRecordingRef.current) {
      holdStartedRecordingRef.current = false;
      if (isRecording) {
        executeVideoToggle();
      }
      return;
    }
    // Short tap
    if (!cameraReady) return;
    if (isRecording) {
      executeVideoToggle();
      return;
    }
    if (captureTimerSec > 0 && countdownLeft === null) {
      setCountdownLeft(captureTimerSec);
      return;
    }
    if (captureKind === 'photo') {
      executePhotoCapture();
    } else {
      executeVideoToggle();
    }
  };

  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (file.type.startsWith('video/')) {
      try {
        const videoUrl = await prepare720pVideoDataUrl(file);
        setCapturedMedia({ dataUrl: videoUrl, mediaType: 'video' });
        setStrokes([]);
        setStickers([]);
        setSavedToMemoryFeedback(false);
      } catch (err) {
        setCameraError(err instanceof Error ? err.message : 'Unable to load selected video.');
      }
      return;
    }

    const objUrl = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Invalid image'));
        el.src = objUrl;
      });
      const maxDim = 1280;
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const offscreen = document.createElement('canvas');
      offscreen.width = w;
      offscreen.height = h;
      const ctx = offscreen.getContext('2d');
      if (!ctx) return;
      ctx.filter = selectedLens.cssFilter;
      ctx.drawImage(img, 0, 0, w, h);
      setPhotoDims({ w, h });
      setCropRatio('original');
      setSavedToMemoryFeedback(false);
      setCapturedMedia({
        dataUrl: offscreen.toDataURL('image/jpeg', 0.92),
        mediaType: 'photo',
      });
      setStrokes([]);
      setStickers([]);
    } finally {
      URL.revokeObjectURL(objUrl);
    }
  };

  const getNormCoords = (e: React.PointerEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingMode) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = getNormCoords(e);
    const stroke: Stroke = { color: penColor, points: [pt] };
    activeStrokeRef.current = stroke;
    setStrokes((prev) => [...prev, stroke]);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingMode || !activeStrokeRef.current) return;
    const pt = getNormCoords(e);
    activeStrokeRef.current.points.push(pt);
    setStrokes((prev) => [...prev.slice(0, -1), { ...activeStrokeRef.current! }]);
  };

  const handlePointerUp = () => {
    activeStrokeRef.current = null;
  };

  const handleAddSticker = (content: string, kind: 'emoji' | 'badge') => {
    setStickers((prev) => [
      ...prev,
      {
        id: `${Date.now()}_${Math.random()}`,
        content,
        kind,
        x: 0.35 + (prev.length % 4) * 0.08,
        y: 0.32 + Math.floor(prev.length / 4) * 0.1,
      },
    ]);
    setShowStickerBar(false);
  };

  const addTimeWeatherSticker = () => {
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    handleAddSticker(`☀️ 72°F · ${timeStr}`, 'badge');
  };

  const addLocationSticker = () => {
    const label = currentUser.locationLabel || 'Nearby · Snap Map';
    handleAddSticker(`📍 ${label}`, 'badge');
  };

  const flattenSnapToDataUrl = async (): Promise<string> => {
    if (!capturedMedia) throw new Error('No Snap captured.');
    if (capturedMedia.mediaType === 'video') {
      return capturedMedia.dataUrl;
    }

    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not render Snap.'));
      el.src = capturedMedia.dataUrl;
    });

    // Apply aspect crop if chosen
    let sx = 0;
    let sy = 0;
    let sw = photoDims.w;
    let sh = photoDims.h;
    if (cropRatio !== 'original') {
      const targetRatio = cropRatio === '9:16' ? 9 / 16 : cropRatio === '1:1' ? 1 : 4 / 3;
      const srcRatio = sw / sh;
      if (srcRatio > targetRatio) {
        sw = Math.round(sh * targetRatio);
        sx = Math.round((photoDims.w - sw) / 2);
      } else {
        sh = Math.round(sw / targetRatio);
        sy = Math.round((photoDims.h - sh) / 2);
      }
    }

    const out = document.createElement('canvas');
    out.width = sw;
    out.height = sh;
    const ctx = out.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable.');

    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

    // Draw strokes
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(4, Math.round(out.width * 0.01));
    for (const stroke of strokes) {
      if (stroke.points.length === 0) continue;
      ctx.strokeStyle = stroke.color;
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x * out.width, stroke.points[0].y * out.height);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x * out.width, stroke.points[i].y * out.height);
      }
      ctx.stroke();
    }

    // Bake Stickers & Badges
    for (const st of stickers) {
      if (st.kind === 'emoji') {
        const stickerPx = Math.max(36, Math.round(out.width * 0.1));
        ctx.font = `${stickerPx}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(st.content, st.x * out.width, st.y * out.height);
      } else {
        const badgeFontPx = Math.max(16, Math.round(out.width * 0.038));
        ctx.font = `700 ${badgeFontPx}px "Plus Jakarta Sans", system-ui, sans-serif`;
        const metrics = ctx.measureText(st.content);
        const padX = badgeFontPx * 0.8;
        const boxW = Math.min(out.width - 24, metrics.width + padX * 2);
        const boxH = badgeFontPx * 1.9;
        const cx = st.x * out.width;
        const cy = st.y * out.height;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.84)';
        ctx.beginPath();
        ctx.roundRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH, 12);
        ctx.fill();
        ctx.fillStyle = '#FFFC00';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(st.content, cx, cy);
      }
    }

    // Bake Caption Strip
    const cleanCap = caption.trim();
    if (cleanCap) {
      const fontSize = Math.max(18, Math.round(out.width * 0.042));
      ctx.font = `600 ${fontSize}px "Plus Jakarta Sans", system-ui, sans-serif`;
      const barH = fontSize * 1.85;
      const barY = Math.round(out.height * 0.56);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.58)';
      ctx.fillRect(0, barY, out.width, barH);
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(cleanCap.slice(0, 80), out.width / 2, barY + barH / 2, out.width - 32);
    }

    return compressCanvasToDataUrl(out);
  };

  const activeChats = useMemo(() => chats.filter((c) => !c.archived), [chats]);

  const otherProfiles = useMemo(() => {
    const existingPeerUids = new Set(
      activeChats.filter((c) => c.type === 'direct').map((c) => c.peerUid)
    );
    return profiles.filter(
      (p) => p.uid !== currentUser.uid && !existingPeerUids.has(p.uid)
    );
  }, [profiles, activeChats, currentUser.uid]);

  const selectedTrackMeta = useMemo(
    () => SPOTLIGHT_SOUND_TRACKS.find((t) => t.id === selectedSoundTrackId) || SPOTLIGHT_SOUND_TRACKS[0],
    [selectedSoundTrackId]
  );

  const handleSaveMemoryClick = async () => {
    if (!onSaveToMemory || !capturedMedia || savingMemory) return;
    setSavingMemory(true);
    setSendError('');
    try {
      const dataUrl = await flattenSnapToDataUrl();
      await onSaveToMemory({
        mediaUrl: dataUrl,
        mediaType: capturedMedia.mediaType,
        caption: caption.trim(),
      });
      setSavedToMemoryFeedback(true);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Unable to save to Memories.');
    } finally {
      setSavingMemory(false);
    }
  };

  const handleConfirmSend = async () => {
    if (sending) return;
    const isVideo = capturedMedia?.mediaType === 'video';
    const shouldSpotlight = isVideo && postToSpotlight;
    if (!postToStory && !shouldSpotlight && selectedConvIds.length === 0 && selectedPeerUids.length === 0) {
      setSendError('Select My Story, Spotlight, or at least one chat to send your Snap.');
      return;
    }

    setSending(true);
    setSendError('');
    try {
      const dataUrl = await flattenSnapToDataUrl();
      const peersToOpen = profiles.filter((p) => selectedPeerUids.includes(p.uid));
      await onSendSnapToConversations({
        conversationIds: selectedConvIds,
        directPeerProfiles: peersToOpen,
        imageData: dataUrl,
        mediaType: capturedMedia?.mediaType || 'photo',
        caption: caption.trim(),
        durationSec: durationSec === 0 ? 99 : durationSec,
        postToStory,
        postToSpotlight: shouldSpotlight,
        soundTrackId: selectedSoundTrackId,
        soundTitle:
          selectedSoundTrackId === 'original'
            ? `Original Sound · ${currentUser.displayName.split(' ')[0]}`
            : selectedTrackMeta.title,
      });
      if (embedded) {
        setCapturedMedia(null);
        setShowSendPicker(false);
        setStrokes([]);
        setStickers([]);
        setCaption('');
      } else {
        onClose();
      }
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Unable to send Snap.');
    } finally {
      setSending(false);
    }
  };

  const formatRecTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div
      className={
        embedded
          ? 'relative flex-1 w-full h-full bg-black flex items-center justify-center overflow-hidden pb-14 md:pb-0'
          : 'fixed inset-0 z-50 bg-black flex items-center justify-center sm:p-4'
      }
    >
      <div
        className={
          embedded
            ? 'relative w-full h-full bg-[#0A0A0A] flex flex-col overflow-hidden'
            : 'relative w-full h-full sm:max-w-[440px] sm:max-h-[840px] sm:rounded-3xl overflow-hidden bg-[#0A0A0A] border border-slate-800 flex flex-col'
        }
      >
        {flashPulse && <div className="absolute inset-0 z-40 bg-white pointer-events-none" />}

        {/* Top Bar Overlay */}
        <div className="absolute top-0 left-0 right-0 z-20 p-3 sm:p-4 flex items-center justify-between bg-gradient-to-b from-black/75 to-transparent">
          {!capturedMedia ? (
            embedded ? (
              <>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onOpenProfile}
                    aria-label="Open profile"
                    className="rounded-full p-0.5 bg-[#FFFC00] shadow-xs cursor-pointer"
                  >
                    <Avatar
                      name={currentUser.displayName}
                      photoURL={currentUser.photoURL}
                      avatarSeed={currentUser.avatarSeed}
                      size="sm"
                    />
                  </button>
                  <button
                    type="button"
                    onClick={onOpenSearch}
                    aria-label="Search friends"
                    className="w-9 h-9 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center backdrop-blur-xs cursor-pointer"
                  >
                    <Search className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setFacingMode((m) => (m === 'user' ? 'environment' : 'user'))}
                    aria-label="Flip camera"
                    className="w-9 h-9 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center backdrop-blur-xs cursor-pointer"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={onOpenAddFriend}
                    aria-label="Add friends"
                    className="w-9 h-9 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center backdrop-blur-xs cursor-pointer"
                  >
                    <UserPlus className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={onOpenNotifications}
                    aria-label="Notifications"
                    className="relative w-9 h-9 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center backdrop-blur-xs cursor-pointer"
                  >
                    <Bell className="w-4 h-4" />
                    {unreadNotificationsCount > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[#FFFC00] text-slate-950 text-[10px] font-bold flex items-center justify-center">
                        {unreadNotificationsCount}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    aria-label="Settings"
                    className="w-9 h-9 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center backdrop-blur-xs cursor-pointer"
                  >
                    <Settings className="w-4 h-4" />
                  </button>
                </div>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close camera"
                  className="w-10 h-10 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center backdrop-blur-xs cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setFacingMode((m) => (m === 'user' ? 'environment' : 'user'))}
                    aria-label="Flip camera"
                    className="w-10 h-10 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center backdrop-blur-xs cursor-pointer"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>
              </>
            )
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  if (showSendPicker) {
                    setShowSendPicker(false);
                  } else {
                    setCapturedMedia(null);
                    setStrokes([]);
                    setStickers([]);
                    setCaption('');
                    setShowCaptionInput(false);
                    setSelectedSoundTrackId('original');
                    setShowSoundPicker(false);
                    setPreviewMuted(false);
                    setSendError('');
                  }
                }}
                aria-label="Retake or close editor"
                className="w-10 h-10 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center backdrop-blur-xs cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-1.5 flex-wrap justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setDrawingMode(false);
                    setShowStickerBar(false);
                    setShowCaptionInput((v) => !v);
                  }}
                  title="Text caption"
                  className={`w-9 h-9 rounded-full flex items-center justify-center backdrop-blur-xs cursor-pointer ${
                    showCaptionInput || caption ? 'bg-[#FFFC00] text-slate-950' : 'bg-black/55 text-white'
                  }`}
                >
                  <Type className="w-4 h-4" />
                </button>
                {capturedMedia.mediaType === 'photo' && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setShowStickerBar(false);
                        setDrawingMode((v) => !v);
                      }}
                      title="Draw"
                      className={`w-9 h-9 rounded-full flex items-center justify-center backdrop-blur-xs cursor-pointer ${
                        drawingMode ? 'bg-[#FFFC00] text-slate-950' : 'bg-black/55 text-white'
                      }`}
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDrawingMode(false);
                        setShowStickerBar((v) => !v);
                      }}
                      title="Stickers, GIFs, Location & Weather"
                      className={`w-9 h-9 rounded-full flex items-center justify-center backdrop-blur-xs cursor-pointer ${
                        showStickerBar ? 'bg-[#FFFC00] text-slate-950' : 'bg-black/55 text-white'
                      }`}
                    >
                      <SmilePlus className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const idx = CROP_RATIOS.indexOf(cropRatio);
                        setCropRatio(CROP_RATIOS[(idx + 1) % CROP_RATIOS.length]);
                      }}
                      title="Crop ratio"
                      className={`h-9 px-2.5 rounded-full flex items-center gap-1 text-[11px] font-bold backdrop-blur-xs cursor-pointer ${
                        cropRatio !== 'original' ? 'bg-[#FFFC00] text-slate-950' : 'bg-black/55 text-white'
                      }`}
                    >
                      <Crop className="w-3.5 h-3.5" />
                      <span>{cropRatio === 'original' ? 'Crop' : cropRatio}</span>
                    </button>
                  </>
                )}
                {strokes.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setStrokes((prev) => prev.slice(0, -1))}
                    title="Undo drawing"
                    className="w-9 h-9 rounded-full bg-black/55 text-white flex items-center justify-center backdrop-blur-xs cursor-pointer"
                  >
                    <Undo2 className="w-4 h-4" />
                  </button>
                )}
                {capturedMedia.mediaType === 'video' && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        void resumeSpotlightAudioContext();
                        setPreviewMuted((m) => !m);
                      }}
                      title={previewMuted ? 'Unmute video' : 'Mute preview'}
                      className={`w-9 h-9 rounded-full flex items-center justify-center backdrop-blur-xs cursor-pointer ${
                        !previewMuted ? 'bg-[#FFFC00] text-slate-950' : 'bg-black/55 text-white'
                      }`}
                    >
                      {previewMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void resumeSpotlightAudioContext();
                        setShowCaptionInput(false);
                        setShowSoundPicker((v) => !v);
                      }}
                      title="Add Music"
                      className={`h-9 px-2.5 rounded-full flex items-center gap-1 text-xs font-semibold backdrop-blur-xs cursor-pointer ${
                        showSoundPicker || selectedSoundTrackId !== 'original'
                          ? 'bg-[#FFFC00] text-slate-950'
                          : 'bg-black/55 text-white'
                      }`}
                    >
                      <Music2 className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => {
                    const idx = VIEW_TIMER_OPTIONS.indexOf(
                      durationSec as (typeof VIEW_TIMER_OPTIONS)[number]
                    );
                    setDurationSec(VIEW_TIMER_OPTIONS[(idx + 1) % VIEW_TIMER_OPTIONS.length]);
                  }}
                  title="Snap timer (1-10s or ∞)"
                  className="h-9 px-2.5 rounded-full bg-black/55 text-white text-xs font-mono-tabular font-semibold flex items-center gap-1 backdrop-blur-xs cursor-pointer"
                >
                  <Timer className="w-3.5 h-3.5 text-[#FFFC00]" />
                  <span>{durationSec === 0 ? '∞' : `${durationSec}s`}</span>
                </button>
              </div>
            </>
          )}
        </div>

        {/* Live Camera Right Side Tools Column */}
        {!capturedMedia && (
          <div className="absolute right-3 top-20 z-20 flex flex-col items-center gap-2.5 bg-black/40 backdrop-blur-xs py-2.5 px-1.5 rounded-full">
            <button
              type="button"
              onClick={() => setFlashOn((v) => !v)}
              title="Flash"
              className={`w-9 h-9 rounded-full flex items-center justify-center cursor-pointer ${
                flashOn ? 'bg-[#FFFC00] text-slate-950' : 'text-white hover:bg-white/15'
              }`}
            >
              <Zap className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                const idx = CAPTURE_TIMER_OPTIONS.indexOf(
                  captureTimerSec as (typeof CAPTURE_TIMER_OPTIONS)[number]
                );
                setCaptureTimerSec(CAPTURE_TIMER_OPTIONS[(idx + 1) % CAPTURE_TIMER_OPTIONS.length]);
              }}
              title="Capture Timer"
              className={`w-9 h-9 rounded-full flex flex-col items-center justify-center cursor-pointer ${
                captureTimerSec > 0 ? 'bg-[#FFFC00] text-slate-950' : 'text-white hover:bg-white/15'
              }`}
            >
              <Timer className="w-4 h-4" />
              {captureTimerSec > 0 && (
                <span className="text-[9px] font-bold leading-none">{captureTimerSec}s</span>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                const idx = LENSES.findIndex((l) => l.id === selectedLens.id);
                setSelectedLens(LENSES[(idx + 1) % LENSES.length]);
              }}
              title="Next Filter"
              className="w-9 h-9 rounded-full text-white hover:bg-white/15 flex items-center justify-center cursor-pointer"
            >
              <Sparkles className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setShowLensesRow((v) => !v)}
              title="Toggle Lens Carousel"
              className={`w-9 h-9 rounded-full flex items-center justify-center cursor-pointer ${
                showLensesRow ? 'bg-[#FFFC00] text-slate-950' : 'text-white hover:bg-white/15'
              }`}
            >
              <Smile className="w-4 h-4" />
            </button>
            {onOpenMemories && (
              <button
                type="button"
                onClick={onOpenMemories}
                title="Open Memories"
                className="w-9 h-9 rounded-full text-white hover:bg-white/15 flex items-center justify-center cursor-pointer"
              >
                <FolderHeart className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        {/* Pen Color Picker Strip */}
        {capturedMedia && drawingMode && (
          <div className="absolute top-16 right-4 z-20 flex flex-col gap-2 bg-black/60 p-2 rounded-full backdrop-blur-xs">
            {PEN_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setPenColor(c)}
                style={{ backgroundColor: c }}
                className={`w-6 h-6 rounded-full cursor-pointer transition-transform ${
                  penColor === c ? 'ring-2 ring-white scale-115' : ''
                }`}
              />
            ))}
          </div>
        )}

        {/* Sticker / GIF / Location / Weather Picker Overlay */}
        {capturedMedia && showStickerBar && (
          <div className="absolute top-16 left-4 right-4 z-20 p-3 rounded-2xl bg-black/85 border border-white/15 backdrop-blur-md space-y-2.5">
            <div className="flex items-center gap-1.5">
              {(
                [
                  { id: 'emoji', label: 'Emojis' },
                  { id: 'gif', label: 'GIF Stickers' },
                  { id: 'info', label: 'Location & Time' },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setStickerTab(t.id)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold cursor-pointer ${
                    stickerTab === t.id ? 'bg-[#FFFC00] text-slate-950' : 'bg-white/10 text-white'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {stickerTab === 'emoji' && (
              <div className="flex items-center justify-center flex-wrap gap-2">
                {STICKER_OPTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => handleAddSticker(emoji, 'emoji')}
                    className="w-10 h-10 rounded-2xl bg-white/10 hover:bg-white/25 text-2xl flex items-center justify-center cursor-pointer"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}

            {stickerTab === 'gif' && (
              <div className="grid grid-cols-2 gap-2">
                {GIF_BADGE_STICKERS.map((badge) => (
                  <button
                    key={badge}
                    type="button"
                    onClick={() => handleAddSticker(badge, 'badge')}
                    className="h-10 rounded-2xl bg-gradient-to-r from-[#FFFC00] to-amber-300 text-slate-950 text-xs font-extrabold tracking-wide flex items-center justify-center cursor-pointer"
                  >
                    {badge}
                  </button>
                ))}
              </div>
            )}

            {stickerTab === 'info' && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={addLocationSticker}
                  className="h-10 px-3 rounded-2xl bg-white/15 hover:bg-white/25 text-white text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <MapPin className="w-3.5 h-3.5 text-[#FFFC00]" />
                  <span>Location Sticker</span>
                </button>
                <button
                  type="button"
                  onClick={addTimeWeatherSticker}
                  className="h-10 px-3 rounded-2xl bg-white/15 hover:bg-white/25 text-white text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <SunMedium className="w-3.5 h-3.5 text-[#FFFC00]" />
                  <span>Time &amp; Weather</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Spotlight Music Picker Overlay */}
        {capturedMedia?.mediaType === 'video' && showSoundPicker && (
          <div className="absolute top-16 left-4 right-4 z-20 p-3 rounded-2xl bg-black/85 border border-white/15 backdrop-blur-md space-y-1.5">
            <div className="flex items-center justify-between px-1 pb-1">
              <span className="text-xs font-bold text-white flex items-center gap-1.5">
                <Music2 className="w-3.5 h-3.5 text-[#FFFC00]" />
                <span>Select Music Track</span>
              </span>
              <button
                type="button"
                onClick={() => setShowSoundPicker(false)}
                className="text-xs text-[#FFFC00] font-semibold cursor-pointer"
              >
                Done
              </button>
            </div>
            {SPOTLIGHT_SOUND_TRACKS.map((track) => {
              const selected = track.id === selectedSoundTrackId;
              return (
                <button
                  key={track.id}
                  type="button"
                  onClick={() => {
                    setSelectedSoundTrackId(track.id);
                    setPreviewMuted(false);
                  }}
                  className={`w-full px-3 py-2 rounded-2xl flex items-center justify-between text-left cursor-pointer ${
                    selected ? 'bg-[#FFFC00] text-slate-950' : 'bg-white/10 hover:bg-white/20 text-white'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-xs font-bold truncate">{track.title}</p>
                    <p className={`text-[11px] truncate ${selected ? 'text-slate-800' : 'text-white/65'}`}>
                      {track.subtitle}
                    </p>
                  </div>
                  {selected && <Check className="w-4 h-4 shrink-0" />}
                </button>
              );
            })}
          </div>
        )}

        {/* Viewfinder or Captured Media Canvas */}
        <div
          ref={previewContainerRef}
          onPointerMove={(e) => {
            if (!draggingStickerRef.current || !previewContainerRef.current) return;
            const rect = previewContainerRef.current.getBoundingClientRect();
            const x = Math.min(0.95, Math.max(0.05, (e.clientX - rect.left) / rect.width));
            const y = Math.min(0.92, Math.max(0.08, (e.clientY - rect.top) / rect.height));
            setStickers((prev) =>
              prev.map((st) => (st.id === draggingStickerRef.current ? { ...st, x, y } : st))
            );
          }}
          onPointerUp={() => {
            draggingStickerRef.current = null;
          }}
          className="relative flex-1 bg-black flex items-center justify-center overflow-hidden"
        >
          {!capturedMedia ? (
            <>
              <video
                ref={videoRef}
                playsInline
                muted
                style={{
                  filter: selectedLens.cssFilter,
                  transform: facingMode === 'user' ? 'scaleX(-1)' : 'none',
                }}
                className="w-full h-full object-cover"
              />
              {/* Live Lens Overlay Preview */}
              {selectedLens.overlayType === 'dog' && (
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-7xl -mt-36 drop-shadow-lg">🐶</span>
                </div>
              )}
              {selectedLens.overlayType === 'crown' && (
                <div className="pointer-events-none absolute top-[18%] left-0 right-0 flex justify-center gap-1 text-4xl drop-shadow-lg">
                  <span>🌸</span>
                  <span className="-mt-2">🌺</span>
                  <span className="-mt-3">🌼</span>
                  <span className="-mt-2">🌻</span>
                  <span>🌸</span>
                </div>
              )}
              {selectedLens.overlayType === 'funny' && (
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-6">
                  <span className="text-6xl drop-shadow-lg">👀</span>
                  <span className="text-6xl drop-shadow-lg">😜</span>
                </div>
              )}
              {selectedLens.overlayType === 'cartoon' && (
                <div className="pointer-events-none absolute inset-3 border-4 border-[#FFFC00] rounded-3xl">
                  <span className="inline-block m-3 px-2.5 py-1 rounded-full bg-[#FFFC00] text-slate-950 font-black text-sm tracking-wider">
                    POW!
                  </span>
                </div>
              )}

              {countdownLeft !== null && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/25">
                  <span className="text-7xl font-display font-bold text-[#FFFC00] drop-shadow-lg font-mono-tabular">
                    {countdownLeft}
                  </span>
                </div>
              )}
              {isRecording && (
                <div className="absolute top-16 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-rose-600 text-white text-xs font-mono-tabular font-bold flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                  <span>REC {formatRecTime(recordingSec)} / 1:00</span>
                </div>
              )}
              {cameraError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-slate-950/90">
                  <div className="w-14 h-14 rounded-full bg-[#FFFC00] text-slate-950 flex items-center justify-center mb-4">
                    <Camera className="w-7 h-7" />
                  </div>
                  <p className="text-sm font-medium text-white mb-2">Snap Studio</p>
                  <p className="text-xs text-slate-400 max-w-xs mb-5">{cameraError}</p>
                  <button
                    type="button"
                    onClick={() => {
                      void resumeSpotlightAudioContext();
                      unlockVideoTranscodeAudio();
                      fileInputRef.current?.click();
                    }}
                    className="h-11 px-5 rounded-full bg-[#FFFC00] hover:bg-[#F5E600] text-black text-sm font-bold flex items-center gap-2 cursor-pointer"
                  >
                    <ImagePlus className="w-4 h-4" />
                    <span>Upload Photo or Video</span>
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="relative w-full h-full flex items-center justify-center bg-black">
              {capturedMedia.mediaType === 'video' ? (
                <video
                  ref={previewVideoRef}
                  src={capturedMedia.dataUrl}
                  autoPlay
                  loop
                  playsInline
                  controls
                  muted={previewMuted}
                  className="max-w-full max-h-full object-contain"
                />
              ) : (
                <div
                  className={`relative flex items-center justify-center overflow-hidden ${
                    cropRatio === '9:16'
                      ? 'aspect-[9/16] h-full max-w-full'
                      : cropRatio === '1:1'
                      ? 'aspect-square max-h-full max-w-full'
                      : cropRatio === '4:3'
                      ? 'aspect-[4/3] max-h-full max-w-full'
                      : 'w-full h-full'
                  }`}
                >
                  <img
                    src={capturedMedia.dataUrl}
                    alt="Captured Snap"
                    className="w-full h-full object-cover select-none pointer-events-none"
                  />
                  <canvas
                    ref={drawCanvasRef}
                    width={photoDims.w}
                    height={photoDims.h}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                    className={`absolute inset-0 w-full h-full object-contain touch-none ${
                      drawingMode ? 'cursor-crosshair' : 'pointer-events-none'
                    }`}
                  />
                  {stickers.map((st) => (
                    <span
                      key={st.id}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        draggingStickerRef.current = st.id;
                      }}
                      style={{
                        left: `${st.x * 100}%`,
                        top: `${st.y * 100}%`,
                        transform: 'translate(-50%, -50%)',
                      }}
                      className={
                        st.kind === 'emoji'
                          ? 'absolute z-10 text-4xl select-none cursor-grab active:cursor-grabbing'
                          : 'absolute z-10 px-3 py-1 rounded-2xl bg-slate-950/85 text-[#FFFC00] text-xs font-extrabold shadow-lg border border-white/15 select-none cursor-grab active:cursor-grabbing whitespace-nowrap'
                      }
                    >
                      {st.content}
                    </span>
                  ))}
                </div>
              )}

              {(showCaptionInput || caption) && (
                <div className="absolute left-0 right-0 top-[56%] z-10 bg-black/60 backdrop-blur-[2px] px-4 py-2">
                  <input
                    type="text"
                    value={caption}
                    maxLength={LIMITS.STORY_CAPTION_MAX}
                    onChange={(e) => setCaption(e.target.value)}
                    placeholder="Add a caption..."
                    autoFocus={showCaptionInput}
                    className="w-full bg-transparent text-center text-white text-base font-semibold placeholder:text-white/60 outline-none"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          onChange={handleUploadFile}
          className="hidden"
        />

        {!capturedMedia ? (
          <div className="px-4 pt-2 pb-4 bg-gradient-to-t from-black via-black/90 to-transparent flex flex-col gap-2.5">
            {/* Lenses Strip */}
            {showLensesRow && (
              <div className="flex items-center gap-2 overflow-x-auto chat-scroll pb-1">
                {LENSES.map((lens) => (
                  <button
                    key={lens.id}
                    type="button"
                    onClick={() => setSelectedLens(lens)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer transition-colors ${
                      selectedLens.id === lens.id
                        ? 'bg-[#FFFC00] text-slate-950 font-bold'
                        : 'bg-white/12 text-white hover:bg-white/20'
                    }`}
                  >
                    <span>{lens.badge}</span>
                    <span>{lens.label}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Mode Switch */}
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setCaptureKind('photo')}
                className={`h-7 px-3 rounded-full text-xs font-medium cursor-pointer flex items-center gap-1 ${
                  captureKind === 'photo' ? 'bg-white text-slate-950 font-semibold' : 'text-white/70 hover:text-white'
                }`}
              >
                <Camera className="w-3 h-3" />
                <span>Photo (Hold for Video)</span>
              </button>
              <button
                type="button"
                onClick={() => setCaptureKind('video')}
                className={`h-7 px-3 rounded-full text-xs font-medium cursor-pointer flex items-center gap-1 ${
                  captureKind === 'video' ? 'bg-[#8B5CF6] text-white font-semibold' : 'text-white/70 hover:text-white'
                }`}
              >
                <Video className="w-3 h-3" />
                <span>60s Video</span>
              </button>
            </div>

            {/* Shutter Row */}
            <div className="flex items-center justify-around">
              <button
                type="button"
                onClick={() => {
                  void resumeSpotlightAudioContext();
                  unlockVideoTranscodeAudio();
                  fileInputRef.current?.click();
                }}
                title="Camera Roll Upload"
                className="w-11 h-11 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center cursor-pointer"
              >
                <ImagePlus className="w-5 h-5" />
              </button>

              <button
                type="button"
                disabled={!cameraReady}
                onPointerDown={handleShutterPointerDown}
                onPointerUp={handleShutterPointerUp}
                onPointerCancel={() => {
                  if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
                }}
                aria-label={isRecording ? 'Stop recording' : 'Tap for photo, hold for video'}
                className={`w-[76px] h-[76px] rounded-full border-4 flex items-center justify-center transition-transform active:scale-95 cursor-pointer disabled:opacity-35 select-none touch-none ${
                  isRecording
                    ? 'border-rose-500 bg-rose-500/30'
                    : captureKind === 'video'
                    ? 'border-[#8B5CF6] bg-white/20'
                    : 'border-[#FFFC00] bg-white/20'
                }`}
              >
                <span
                  className={`${
                    isRecording
                      ? 'w-7 h-7 rounded-md bg-rose-500'
                      : captureKind === 'video'
                      ? 'w-14 h-14 rounded-full bg-[#8B5CF6]'
                      : 'w-14 h-14 rounded-full bg-[#FFFC00]'
                  }`}
                />
              </button>

              {onOpenMemories ? (
                <button
                  type="button"
                  onClick={onOpenMemories}
                  title="Memories"
                  className="w-11 h-11 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center cursor-pointer"
                >
                  <FolderHeart className="w-5 h-5" />
                </button>
              ) : (
                <div className="w-11 h-11" />
              )}
            </div>
          </div>
        ) : !showSendPicker ? (
          <div className="bg-black/90 border-t border-slate-800">
            {sendError && <p className="px-4 pt-3 text-xs font-medium text-rose-400">{sendError}</p>}
            <div className="px-3 sm:px-4 py-3.5 flex items-center justify-between gap-2 overflow-x-auto">
              {onSaveToMemory && (
                <button
                  type="button"
                  disabled={savingMemory || savedToMemoryFeedback}
                  onClick={handleSaveMemoryClick}
                  title="Save to Memories"
                  className={`h-11 px-3 rounded-2xl text-xs font-semibold flex items-center gap-1.5 shrink-0 cursor-pointer ${
                    savedToMemoryFeedback
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-white/12 hover:bg-white/20 text-white'
                  }`}
                >
                  <Bookmark className="w-3.5 h-3.5" />
                  <span>{savedToMemoryFeedback ? 'Saved' : savingMemory ? 'Saving...' : 'Save'}</span>
                </button>
              )}

              <button
                type="button"
                disabled={sending}
                onClick={async () => {
                  setPostToStory(true);
                  setSending(true);
                  setSendError('');
                  try {
                    const dataUrl = await flattenSnapToDataUrl();
                    await onSendSnapToConversations({
                      conversationIds: [],
                      directPeerProfiles: [],
                      imageData: dataUrl,
                      mediaType: capturedMedia.mediaType,
                      caption: caption.trim(),
                      durationSec: durationSec === 0 ? 5 : durationSec,
                      postToStory: true,
                    });
                    if (embedded) {
                      setCapturedMedia(null);
                      setStrokes([]);
                      setStickers([]);
                      setCaption('');
                    } else {
                      onClose();
                    }
                  } catch (err) {
                    setSendError(err instanceof Error ? err.message : 'Unable to post story.');
                  } finally {
                    setSending(false);
                  }
                }}
                className="h-11 px-3 rounded-2xl bg-white/12 hover:bg-white/20 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 shrink-0 cursor-pointer"
              >
                <span>{sending && postToStory ? 'Posting...' : '+ Story'}</span>
              </button>

              {capturedMedia.mediaType === 'video' && (
                <button
                  type="button"
                  disabled={sending}
                  onClick={async () => {
                    setPostToSpotlight(true);
                    setSending(true);
                    setSendError('');
                    try {
                      const dataUrl = await flattenSnapToDataUrl();
                      await onSendSnapToConversations({
                        conversationIds: [],
                        directPeerProfiles: [],
                        imageData: dataUrl,
                        mediaType: 'video',
                        caption: caption.trim(),
                        durationSec: durationSec === 0 ? 5 : durationSec,
                        postToStory: false,
                        postToSpotlight: true,
                        soundTrackId: selectedSoundTrackId,
                        soundTitle:
                          selectedSoundTrackId === 'original'
                            ? `Original Sound · ${currentUser.displayName.split(' ')[0]}`
                            : selectedTrackMeta.title,
                      });
                      if (embedded) {
                        setCapturedMedia(null);
                      } else {
                        onClose();
                      }
                    } catch (err) {
                      setSendError(err instanceof Error ? err.message : 'Unable to post to Spotlight.');
                    } finally {
                      setSending(false);
                    }
                  }}
                  className="h-11 px-3 rounded-full bg-[#FFFC00]/20 hover:bg-[#FFFC00]/30 disabled:opacity-50 text-[#FFFC00] text-xs font-semibold flex items-center gap-1.5 shrink-0 cursor-pointer"
                >
                  <Film className="w-3.5 h-3.5" />
                  <span>{sending && postToSpotlight ? 'Posting...' : '+ Spotlight'}</span>
                </button>
              )}

              <button
                type="button"
                disabled={sending}
                onClick={() => {
                  setSendError('');
                  setShowSendPicker(true);
                }}
                className="h-11 px-4 rounded-full bg-[#FFFC00] hover:bg-[#F5E600] disabled:opacity-50 text-slate-950 text-sm font-bold flex items-center gap-2 shrink-0 cursor-pointer ml-auto"
              >
                <span>Send To</span>
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 z-30 bg-white dark:bg-[#141414] flex flex-col">
            <div className="px-4 py-3.5 border-b border-slate-100 dark:border-white/10 flex items-center justify-between">
              <h3 className="font-display text-lg font-extrabold tracking-[-0.03em] text-slate-900 dark:text-white">
                Send Snap To
              </h3>
              <button
                type="button"
                onClick={() => setShowSendPicker(false)}
                className="text-xs font-medium text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
              >
                Back to Edit
              </button>
            </div>

            <div className="flex-1 overflow-y-auto chat-scroll p-3 space-y-2">
              <button
                type="button"
                onClick={() => setPostToStory((v) => !v)}
                className={`w-full px-3 py-2.5 rounded-2xl flex items-center justify-between border transition-colors cursor-pointer ${
                  postToStory ? 'border-[#8B5CF6] bg-[#8B5CF6]/10' : 'border-slate-100 dark:border-white/10'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Avatar
                    name={currentUser.displayName}
                    photoURL={currentUser.photoURL}
                    avatarSeed={currentUser.avatarSeed}
                    size="md"
                  />
                  <div className="text-left">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">My Story</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Visible for 24 hours</p>
                  </div>
                </div>
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center border ${
                    postToStory ? 'bg-[#8B5CF6] border-[#8B5CF6] text-white' : 'border-slate-300 dark:border-slate-600'
                  }`}
                >
                  {postToStory && <Check className="w-3.5 h-3.5" />}
                </span>
              </button>

              {capturedMedia?.mediaType === 'video' && (
                <button
                  type="button"
                  onClick={() => setPostToSpotlight((v) => !v)}
                  className={`w-full px-3 py-2.5 rounded-2xl flex items-center justify-between border transition-colors cursor-pointer ${
                    postToSpotlight ? 'border-[#FFFC00] bg-[#FFFC00]/15' : 'border-slate-100 dark:border-white/10'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="w-11 h-11 rounded-full bg-[#FFFC00] text-slate-950 flex items-center justify-center shrink-0">
                      <Film className="w-5 h-5" />
                    </span>
                    <div className="text-left">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">
                        Spotlight Feed (Public)
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">Post to CoolerUp Video Feed</p>
                    </div>
                  </div>
                  <span
                    className={`w-5 h-5 rounded-full flex items-center justify-center border ${
                      postToSpotlight
                        ? 'bg-[#FFFC00] border-[#FFFC00] text-slate-950'
                        : 'border-slate-300 dark:border-slate-600'
                    }`}
                  >
                    {postToSpotlight && <Check className="w-3.5 h-3.5" />}
                  </span>
                </button>
              )}

              <p className="px-2 pt-2 text-xs font-medium text-slate-400">Recent Chats</p>

              {activeChats.map((chat) => {
                const isSelected = selectedConvIds.includes(chat.conversationId);
                return (
                  <button
                    key={chat.conversationId}
                    type="button"
                    onClick={() =>
                      setSelectedConvIds((prev) =>
                        prev.includes(chat.conversationId)
                          ? prev.filter((id) => id !== chat.conversationId)
                          : [...prev, chat.conversationId]
                      )
                    }
                    className="w-full px-3 py-2 rounded-2xl hover:bg-[#F2F2F2] dark:hover:bg-white/5/60 flex items-center justify-between gap-3 cursor-pointer"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar
                        name={chat.title}
                        photoURL={chat.photoURL}
                        size="sm"
                        isGroup={chat.type === 'group'}
                        isSaved={chat.conversationId === `saved_${currentUser.uid}`}
                      />
                      <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                        {chat.title}
                      </span>
                    </div>
                    <span
                      className={`w-5 h-5 rounded-full flex items-center justify-center border shrink-0 ${
                        isSelected
                          ? 'bg-[#0E8CFF] border-[#0E8CFF] text-white'
                          : 'border-slate-300 dark:border-slate-600'
                      }`}
                    >
                      {isSelected && <Check className="w-3.5 h-3.5" />}
                    </span>
                  </button>
                );
              })}

              {otherProfiles.length > 0 && (
                <>
                  <p className="px-2 pt-2 text-xs font-medium text-slate-400">Friends</p>
                  {otherProfiles.map((peer) => {
                    const isSelected = selectedPeerUids.includes(peer.uid);
                    return (
                      <button
                        key={peer.uid}
                        type="button"
                        onClick={() =>
                          setSelectedPeerUids((prev) =>
                            prev.includes(peer.uid)
                              ? prev.filter((id) => id !== peer.uid)
                              : [...prev, peer.uid]
                          )
                        }
                        className="w-full px-3 py-2 rounded-2xl hover:bg-[#F2F2F2] dark:hover:bg-white/5/60 flex items-center justify-between gap-3 cursor-pointer"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <Avatar
                            name={peer.displayName}
                            photoURL={peer.photoURL}
                            avatarSeed={peer.avatarSeed}
                            size="sm"
                          />
                          <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                            {peer.displayName}
                          </span>
                        </div>
                        <span
                          className={`w-5 h-5 rounded-full flex items-center justify-center border shrink-0 ${
                            isSelected
                              ? 'bg-[#0E8CFF] border-[#0E8CFF] text-white'
                              : 'border-slate-300 dark:border-slate-600'
                          }`}
                        >
                          {isSelected && <Check className="w-3.5 h-3.5" />}
                        </span>
                      </button>
                    );
                  })}
                </>
              )}
            </div>

            {sendError && <p className="px-4 py-2 text-xs text-rose-600 dark:text-rose-400">{sendError}</p>}

            <div className="p-4 border-t border-slate-100 dark:border-white/10">
              <button
                type="button"
                disabled={sending}
                onClick={handleConfirmSend}
                className="w-full h-11 rounded-full bg-[#0E8CFF] hover:bg-[#0B7BE0] disabled:opacity-50 text-white text-sm font-bold flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>{sending ? 'Sending Snap...' : 'Send Snap'}</span>
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
