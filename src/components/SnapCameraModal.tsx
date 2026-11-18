import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Check,
  Film,
  ImagePlus,
  Music2,
  Pencil,
  RefreshCw,
  Send,
  SmilePlus,
  Sparkles,
  Timer,
  Type,
  Undo2,
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
  cssFilter: string;
}

const LENSES: LensOption[] = [
  { id: 'normal', label: 'Natural', cssFilter: 'none' },
  { id: 'warm', label: 'Golden', cssFilter: 'sepia(0.28) saturate(1.35) brightness(1.04)' },
  { id: 'cool', label: 'CoolerUp', cssFilter: 'hue-rotate(15deg) saturate(1.2) contrast(1.06)' },
  { id: 'noir', label: 'Noir', cssFilter: 'grayscale(1) contrast(1.25)' },
  { id: 'retro', label: 'Film', cssFilter: 'sepia(0.45) contrast(1.1) brightness(0.95)' },
  { id: 'vivid', label: 'Vivid', cssFilter: 'saturate(1.6) contrast(1.12)' },
];

const PEN_COLORS = ['#FFFFFF', '#FFFC00', '#00A6FF', '#F43F5E', '#10B981'];
const STICKER_OPTIONS = ['🔥', '😂', '❤️', '👻', '⚡', '🎉', '✨', '😎', '💯', '☕'];
const VIEW_TIMER_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0] as const; // 0 => infinite (99)
const CAPTURE_TIMER_OPTIONS = [0, 3, 10] as const;

interface Stroke {
  color: string;
  points: { x: number; y: number }[];
}

interface PlacedSticker {
  id: string;
  emoji: string;
  x: number; // 0..1
  y: number; // 0..1
}

interface SnapCameraModalProps {
  currentUser: PublicProfile;
  chats: UserChatIndex[];
  profiles: PublicProfile[];
  preselectedConversationId?: string | null;
  initialMode?: 'snap' | 'story' | 'spotlight';
  initialCaptureKind?: 'photo' | 'video';
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

export function SnapCameraModal({
  currentUser,
  chats,
  profiles,
  preselectedConversationId = null,
  initialMode = 'snap',
  initialCaptureKind,
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
  const [stickers, setStickers] = useState<PlacedSticker[]>([]);

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
            audio:
              captureKind === 'video'
                ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
                : false,
          });
        } catch {
          // Fallback to video-only if microphone permission was denied
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
  }, [facingMode, capturedMedia, captureKind]);

  // Imperatively sync muted & volume on captured video preview and fallback safely if autoplay blocked
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

  // Sync background music track preview when reviewing captured video
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

  // Try applying hardware torch constraint when flash toggles
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

  // Recording elapsed seconds timer (up to 12 seconds at 720p HD with audio)
  useEffect(() => {
    if (!isRecording) {
      setRecordingSec(0);
      return;
    }
    const id = setInterval(() => {
      setRecordingSec((prev) => {
        if (prev >= 11) {
          recorderRef.current?.stop();
          return 12;
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

    ctx.filter = selectedLens.cssFilter;
    if (facingMode === 'user') {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, w, h);

    setPhotoDims({ w, h });
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
      videoBitsPerSecond: 1_400_000,
      audioBitsPerSecond: 128_000,
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
        setCapturedMedia({ dataUrl, mediaType: 'video' });
      } catch (err) {
        setSendError(err instanceof Error ? err.message : 'Video Snap too large.');
      }
    };

    recorderRef.current = recorder;
    recorder.start(250);
    setIsRecording(true);
  };

  const handleShutterClick = () => {
    if (!cameraReady) return;
    void resumeSpotlightAudioContext();
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

  const handleAddSticker = (emoji: string) => {
    setStickers((prev) => [
      ...prev,
      {
        id: `${Date.now()}_${Math.random()}`,
        emoji,
        x: 0.35 + (prev.length % 4) * 0.08,
        y: 0.32 + Math.floor(prev.length / 4) * 0.1,
      },
    ]);
    setShowStickerBar(false);
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

    const out = document.createElement('canvas');
    out.width = photoDims.w;
    out.height = photoDims.h;
    const ctx = out.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable.');

    ctx.drawImage(img, 0, 0, out.width, out.height);

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

    // Bake Stickers
    if (stickers.length > 0) {
      const stickerPx = Math.max(36, Math.round(out.width * 0.1));
      ctx.font = `${stickerPx}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const st of stickers) {
        ctx.fillText(st.emoji, st.x * out.width, st.y * out.height);
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

  const activeChats = useMemo(
    () => chats.filter((c) => !c.archived),
    [chats]
  );

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
      onClose();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Unable to send Snap.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex items-center justify-center sm:p-4">
      <div className="relative w-full h-full sm:max-w-[440px] sm:max-h-[840px] sm:rounded-3xl overflow-hidden bg-[#0B0F17] border border-slate-800 flex flex-col">
        {flashPulse && (
          <div className="absolute inset-0 z-40 bg-white pointer-events-none" />
        )}

        {/* Top Controls Overlay */}
        <div className="absolute top-0 left-0 right-0 z-20 p-4 flex items-center justify-between bg-gradient-to-b from-black/75 to-transparent">
          <button
            type="button"
            onClick={() => {
              if (showSendPicker) {
                setShowSendPicker(false);
              } else if (capturedMedia) {
                setCapturedMedia(null);
                setStrokes([]);
                setStickers([]);
                setCaption('');
                setShowCaptionInput(false);
                setSelectedSoundTrackId('original');
                setShowSoundPicker(false);
                setPreviewMuted(false);
                setSendError('');
              } else {
                onClose();
              }
            }}
            aria-label="Close or retake"
            className="w-10 h-10 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center backdrop-blur-xs cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>

          {!capturedMedia ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const idx = CAPTURE_TIMER_OPTIONS.indexOf(
                    captureTimerSec as (typeof CAPTURE_TIMER_OPTIONS)[number]
                  );
                  setCaptureTimerSec(CAPTURE_TIMER_OPTIONS[(idx + 1) % CAPTURE_TIMER_OPTIONS.length]);
                }}
                title="Capture Timer"
                className={`h-10 px-3 rounded-full text-xs font-mono-tabular font-semibold flex items-center gap-1 backdrop-blur-xs cursor-pointer ${
                  captureTimerSec > 0 ? 'bg-[#FFFC00] text-slate-950' : 'bg-black/50 text-white'
                }`}
              >
                <Timer className="w-4 h-4" />
                <span>{captureTimerSec > 0 ? `${captureTimerSec}s` : 'Timer'}</span>
              </button>

              <button
                type="button"
                onClick={() => setFlashOn((v) => !v)}
                title="Flash"
                aria-label="Toggle flash"
                className={`w-10 h-10 rounded-full flex items-center justify-center backdrop-blur-xs cursor-pointer ${
                  flashOn ? 'bg-[#FFFC00] text-slate-950' : 'bg-black/50 text-white'
                }`}
              >
                <Zap className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => setFacingMode((m) => (m === 'user' ? 'environment' : 'user'))}
                title="Flip camera"
                aria-label="Flip camera"
                className="w-10 h-10 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center backdrop-blur-xs cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setDrawingMode(false);
                  setShowCaptionInput((v) => !v);
                }}
                title="Add caption"
                className={`w-9 h-9 rounded-full flex items-center justify-center backdrop-blur-xs cursor-pointer ${
                  showCaptionInput || caption ? 'bg-[#FFFC00] text-slate-950' : 'bg-black/50 text-white'
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
                      drawingMode ? 'bg-[#FFFC00] text-slate-950' : 'bg-black/50 text-white'
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
                    title="Stickers"
                    className={`w-9 h-9 rounded-full flex items-center justify-center backdrop-blur-xs cursor-pointer ${
                      showStickerBar ? 'bg-[#FFFC00] text-slate-950' : 'bg-black/50 text-white'
                    }`}
                  >
                    <SmilePlus className="w-4 h-4" />
                  </button>
                </>
              )}
              {strokes.length > 0 && (
                <button
                  type="button"
                  onClick={() => setStrokes((prev) => prev.slice(0, -1))}
                  title="Undo drawing"
                  className="w-9 h-9 rounded-full bg-black/50 text-white flex items-center justify-center backdrop-blur-xs cursor-pointer"
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
                    title={previewMuted ? 'Unmute video & music' : 'Mute preview'}
                    className={`w-9 h-9 rounded-full flex items-center justify-center backdrop-blur-xs cursor-pointer ${
                      !previewMuted ? 'bg-[#FFFC00] text-slate-950' : 'bg-black/50 text-white'
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
                    title="Choose Music Track"
                    className={`h-9 px-2.5 rounded-full flex items-center gap-1 text-xs font-semibold backdrop-blur-xs cursor-pointer ${
                      showSoundPicker || selectedSoundTrackId !== 'original'
                        ? 'bg-[#FFFC00] text-slate-950'
                        : 'bg-black/50 text-white'
                    }`}
                  >
                    <Music2 className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Music</span>
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
                title="View duration (1-10s or infinite)"
                className="h-9 px-3 rounded-full bg-black/55 text-white text-xs font-mono-tabular font-semibold flex items-center gap-1 backdrop-blur-xs cursor-pointer"
              >
                <Timer className="w-3.5 h-3.5 text-[#FFFC00]" />
                <span>{durationSec === 0 ? '∞' : `${durationSec}s`}</span>
              </button>
            </div>
          )}
        </div>

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

        {/* Sticker Picker Overlay */}
        {capturedMedia && showStickerBar && (
          <div className="absolute top-16 left-4 right-4 z-20 p-2.5 rounded-2xl bg-black/75 backdrop-blur-md flex items-center justify-center flex-wrap gap-2">
            {STICKER_OPTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => handleAddSticker(emoji)}
                className="w-10 h-10 rounded-xl bg-white/10 hover:bg-white/25 text-2xl flex items-center justify-center cursor-pointer"
              >
                {emoji}
              </button>
            ))}
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
                  className={`w-full px-3 py-2 rounded-xl flex items-center justify-between text-left cursor-pointer ${
                    selected
                      ? 'bg-[#FFFC00] text-slate-950'
                      : 'bg-white/10 hover:bg-white/20 text-white'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-xs font-bold truncate">{track.title}</p>
                    <p
                      className={`text-[11px] truncate ${
                        selected ? 'text-slate-800' : 'text-white/65'
                      }`}
                    >
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
              {countdownLeft !== null && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/25">
                  <span className="text-7xl font-display font-bold text-[#FFFC00] drop-shadow-lg font-mono-tabular">
                    {countdownLeft}
                  </span>
                </div>
              )}
              {isRecording && (
                <div className="absolute top-16 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-rose-600 text-white text-xs font-mono-tabular font-bold flex items-center gap-1.5">
                  <span>REC {recordingSec}s / 12s</span>
                </div>
              )}
              {cameraError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-slate-950/90">
                  <div className="w-14 h-14 rounded-2xl bg-[#FFFC00] text-slate-950 flex items-center justify-center mb-4">
                    <Camera className="w-7 h-7" />
                  </div>
                  <p className="text-sm font-medium text-white mb-2">
                    720p Snap Studio
                  </p>
                  <p className="text-xs text-slate-400 max-w-xs mb-5">
                    {cameraError}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      void resumeSpotlightAudioContext();
                      unlockVideoTranscodeAudio();
                      fileInputRef.current?.click();
                    }}
                    className="h-11 px-5 rounded-xl bg-[#FFFC00] hover:bg-[#F5E600] text-slate-950 text-sm font-bold flex items-center gap-2 cursor-pointer"
                  >
                    <ImagePlus className="w-4 h-4" />
                    <span>Upload 720p Photo or Video</span>
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
                <>
                  <img
                    src={capturedMedia.dataUrl}
                    alt="Captured Snap"
                    className="max-w-full max-h-full object-contain select-none pointer-events-none"
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
                      className="absolute z-10 text-4xl select-none cursor-grab active:cursor-grabbing"
                    >
                      {st.emoji}
                    </span>
                  ))}
                </>
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
          <div className="px-4 pt-3 pb-5 bg-gradient-to-t from-black via-black/90 to-transparent flex flex-col gap-3">
            {/* Lenses Strip */}
            <div className="flex items-center gap-2 overflow-x-auto chat-scroll pb-1">
              {LENSES.map((lens) => (
                <button
                  key={lens.id}
                  type="button"
                  onClick={() => setSelectedLens(lens)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap shrink-0 flex items-center gap-1 cursor-pointer transition-colors ${
                    selectedLens.id === lens.id
                      ? 'bg-[#FFFC00] text-slate-950 font-semibold'
                      : 'bg-white/12 text-white hover:bg-white/20'
                  }`}
                >
                  <Sparkles className="w-3 h-3" />
                  <span>{lens.label}</span>
                </button>
              ))}
            </div>

            {/* Mode Switch (Photo / Video) */}
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setCaptureKind('photo')}
                className={`h-7 px-3 rounded-full text-xs font-medium cursor-pointer flex items-center gap-1 ${
                  captureKind === 'photo'
                    ? 'bg-white text-slate-950 font-semibold'
                    : 'text-white/70 hover:text-white'
                }`}
              >
                <Camera className="w-3 h-3" />
                <span>Photo</span>
              </button>
              <button
                type="button"
                onClick={() => setCaptureKind('video')}
                className={`h-7 px-3 rounded-full text-xs font-medium cursor-pointer flex items-center gap-1 ${
                  captureKind === 'video'
                    ? 'bg-[#8B5CF6] text-white font-semibold'
                    : 'text-white/70 hover:text-white'
                }`}
              >
                <Video className="w-3 h-3" />
                <span>Video</span>
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
                title="Upload photo or 720p video from device"
                className="w-11 h-11 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center cursor-pointer"
              >
                <ImagePlus className="w-5 h-5" />
              </button>

              <button
                type="button"
                disabled={!cameraReady}
                onClick={handleShutterClick}
                aria-label={isRecording ? 'Stop recording' : 'Take Snap'}
                className={`w-[74px] h-[74px] rounded-full border-4 flex items-center justify-center transition-transform active:scale-95 cursor-pointer disabled:opacity-35 ${
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
                      : 'w-14 h-14 rounded-full bg-white'
                  }`}
                />
              </button>

              <div className="w-11 h-11" />
            </div>
          </div>
        ) : !showSendPicker ? (
          <div className="bg-black/90 border-t border-slate-800">
            {sendError && (
              <p className="px-4 pt-3 text-xs font-medium text-rose-400">{sendError}</p>
            )}
            <div className="px-4 py-4 flex items-center justify-between gap-2">
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
                    onClose();
                  } catch (err) {
                    setSendError(err instanceof Error ? err.message : 'Unable to post story.');
                  } finally {
                    setSending(false);
                  }
                }}
                className="h-11 px-3.5 rounded-xl bg-white/12 hover:bg-white/20 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <span>{sending && postToStory ? 'Posting...' : '+ My Story'}</span>
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
                      onClose();
                    } catch (err) {
                      setSendError(err instanceof Error ? err.message : 'Unable to post to Spotlight.');
                    } finally {
                      setSending(false);
                    }
                  }}
                  className="h-11 px-3.5 rounded-xl bg-[#FFFC00]/20 hover:bg-[#FFFC00]/30 disabled:opacity-50 text-[#FFFC00] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
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
                className="h-11 px-5 rounded-xl bg-[#FFFC00] hover:bg-[#F5E600] disabled:opacity-50 text-slate-950 text-sm font-bold flex items-center gap-2 cursor-pointer ml-auto"
              >
                <span>Send To</span>
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 z-30 bg-white dark:bg-[#121824] flex flex-col">
            <div className="px-4 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
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
                  postToStory
                    ? 'border-[#8B5CF6] bg-[#8B5CF6]/10'
                    : 'border-slate-200 dark:border-slate-800'
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
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">
                      My Story
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Visible for 24 hours
                    </p>
                  </div>
                </div>
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center border ${
                    postToStory
                      ? 'bg-[#8B5CF6] border-[#8B5CF6] text-white'
                      : 'border-slate-300 dark:border-slate-600'
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
                    postToSpotlight
                      ? 'border-[#FFFC00] bg-[#FFFC00]/15'
                      : 'border-slate-200 dark:border-slate-800'
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
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Post to CoolerUp Video Feed
                      </p>
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

              <p className="px-2 pt-2 text-xs font-medium text-slate-400">
                Recent Chats
              </p>

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
                    className="w-full px-3 py-2 rounded-xl hover:bg-[#F4F6F9] dark:hover:bg-slate-800/60 flex items-center justify-between gap-3 cursor-pointer"
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
                          ? 'bg-[#00A6FF] border-[#00A6FF] text-white'
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
                  <p className="px-2 pt-2 text-xs font-medium text-slate-400">
                    Friends
                  </p>
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
                        className="w-full px-3 py-2 rounded-xl hover:bg-[#F4F6F9] dark:hover:bg-slate-800/60 flex items-center justify-between gap-3 cursor-pointer"
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
                              ? 'bg-[#00A6FF] border-[#00A6FF] text-white'
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

            {sendError && (
              <p className="px-4 py-2 text-xs text-rose-600 dark:text-rose-400">{sendError}</p>
            )}

            <div className="p-4 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                disabled={sending}
                onClick={handleConfirmSend}
                className="w-full h-11 rounded-xl bg-[#00A6FF] hover:bg-[#0090E0] disabled:opacity-50 text-white text-sm font-bold flex items-center justify-center gap-2 cursor-pointer"
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
