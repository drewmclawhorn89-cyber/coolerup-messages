// Validation boundaries synchronized with firebase-blueprint.json & firestore.rules
export const LIMITS = {
  ID_MAX: 128,
  DISPLAY_NAME_MIN: 1,
  DISPLAY_NAME_MAX: 80,
  HANDLE_MIN: 2,
  HANDLE_MAX: 40,
  PHOTO_URL_MAX: 1000,
  AVATAR_SEED_MAX: 120,
  STATUS_TEXT_MAX: 140,
  TITLE_MIN: 1,
  TITLE_MAX: 100,
  MESSAGE_TEXT_MAX: 2000,
  LAST_MESSAGE_TEXT_MAX: 500,
  IMAGE_DATA_MAX: 650000,
  SPOTLIGHT_INLINE_MAX: 550000,
  SPOTLIGHT_CHUNK_MAX: 500000,
  SPOTLIGHT_MAX_CHUNKS: 20,
  SPOTLIGHT_TOTAL_MAX: 9500000,
  REPLY_TEXT_MAX: 200,
  STORY_CAPTION_MAX: 200,
  SOUND_TITLE_MAX: 80,
  SOUND_TRACK_ID_MAX: 40,
  RESOLUTION_MAX: 20,
  QUICK_EMOJI_MAX: 16,
  MEMBERS_MAX: 20,
} as const;

export const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
export const HANDLE_PATTERN = /^[a-z0-9_.-]+$/;

export function sanitizeHandle(raw: string, fallbackUid: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '')
    .slice(0, LIMITS.HANDLE_MAX);
  if (cleaned.length >= LIMITS.HANDLE_MIN) {
    return cleaned;
  }
  return `user_${fallbackUid.slice(0, 8).toLowerCase()}`;
}

export function clampText(value: string, maxLen: number): string {
  return value.trim().slice(0, maxLen);
}

export function isValidHandle(value: string): boolean {
  return (
    value.length >= LIMITS.HANDLE_MIN &&
    value.length <= LIMITS.HANDLE_MAX &&
    HANDLE_PATTERN.test(value)
  );
}

export function compressCanvasToDataUrl(canvas: HTMLCanvasElement): string {
  let quality = 0.86;
  let dataUrl = canvas.toDataURL('image/webp', quality);
  if (!dataUrl.startsWith('data:image/webp')) {
    dataUrl = canvas.toDataURL('image/jpeg', quality);
  }

  while (dataUrl.length > LIMITS.IMAGE_DATA_MAX - 20000 && quality > 0.25) {
    quality -= 0.1;
    dataUrl = canvas.toDataURL('image/jpeg', quality);
  }

  if (dataUrl.length > LIMITS.IMAGE_DATA_MAX) {
    throw new Error('Captured Snap is too large. Please try a simpler scene.');
  }

  return dataUrl;
}

export async function compressImageToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose a valid image file.');
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Could not decode selected image.'));
      image.src = objectUrl;
    });

    const maxDim = 1280;
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas compression unavailable in this browser.');
    }
    ctx.drawImage(img, 0, 0, width, height);

    return compressCanvasToDataUrl(canvas);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function blobToBoundedDataUrl(
  blob: Blob,
  errorLabel = 'Media recording',
  maxDataUrlLength: number = LIMITS.IMAGE_DATA_MAX
): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error(`Could not encode ${errorLabel}.`));
      }
    };
    reader.onerror = () => reject(new Error(`Could not read ${errorLabel}.`));
    reader.readAsDataURL(blob);
  });

  if (dataUrl.length > maxDataUrlLength) {
    throw new Error(`${errorLabel} is too long to save (keep clips brief).`);
  }
  return dataUrl;
}

let transcodeUnlockCtx: AudioContext | null = null;

/**
 * Call synchronously inside file-picker / record button clicks so browsers keep
 * AudioContext unlocked for audio-preserving video transcoding if needed.
 */
export function unlockVideoTranscodeAudio(): void {
  if (typeof window === 'undefined') return;
  const AudioCtor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtor) return;
  try {
    if (!transcodeUnlockCtx || transcodeUnlockCtx.state === 'closed') {
      transcodeUnlockCtx = new AudioCtor();
    }
    if (transcodeUnlockCtx.state === 'suspended') {
      void transcodeUnlockCtx.resume().catch(() => {});
    }
  } catch {
    // Ignore if AudioContext unavailable
  }
}

/**
 * Transcodes a video Blob or File while PRESERVING its audio track via Web Audio
 * (createMediaElementSource -> createMediaStreamDestination) so audio/music is never muted out.
 */
async function transcodeVideoSourceWithAudio(params: {
  source: Blob | File | string;
  targetShortSide: number;
  videoBitsPerSecond: number;
  maxDurationMs: number;
  maxOutputLength: number;
  errorLabel: string;
}): Promise<string> {
  const {
    source,
    targetShortSide,
    videoBitsPerSecond,
    maxDurationMs,
    maxOutputLength,
    errorLabel,
  } = params;

  if (typeof MediaRecorder === 'undefined') {
    throw new Error(`Video encoding unavailable in this browser for ${errorLabel}.`);
  }

  const isStringUrl = typeof source === 'string';
  const objectUrl = isStringUrl ? source : URL.createObjectURL(source);
  let audioCtx: AudioContext | null = null;

  try {
    const video = document.createElement('video');
    video.src = objectUrl;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    // Keep video unmuted so AudioContext / captureStream can tap the real audio track
    video.muted = false;
    video.volume = 1;

    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Could not decode selected video file.'));
    });

    const rawW = video.videoWidth || 720;
    const rawH = video.videoHeight || 1280;
    // Scale so short side becomes targetShortSide (e.g., 720 for 720p HD) preserving exact aspect ratio
    const scale = targetShortSide / Math.max(1, Math.min(rawW, rawH));
    // Ensure even dimensions for VP8/VP9 encoders
    const width = Math.max(180, Math.round((rawW * scale) / 2) * 2);
    const height = Math.max(180, Math.round((rawH * scale) / 2) * 2);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Video processing unavailable in this browser.');
    }

    const canvasStream = canvas.captureStream(24);
    const combinedTracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()];

    // Capture audio cleanly via Web Audio (reusing gesture-unlocked ctx when possible) with captureStream fallback
    let capturedAudio = false;
    try {
      const AudioCtor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtor) {
        audioCtx = new AudioCtor();
        if (audioCtx.state === 'suspended') {
          await audioCtx.resume().catch(() => {});
        }
        if (audioCtx.state === 'running') {
          const elemSource = audioCtx.createMediaElementSource(video);
          const dest = audioCtx.createMediaStreamDestination();
          elemSource.connect(dest);
          for (const audioTrack of dest.stream.getAudioTracks()) {
            combinedTracks.push(audioTrack);
            capturedAudio = true;
          }
        } else {
          void audioCtx.close().catch(() => {});
          audioCtx = null;
        }
      }
    } catch {
      audioCtx = null;
    }

    if (!capturedAudio) {
      const vidWithCapture = video as HTMLVideoElement & {
        captureStream?: () => MediaStream;
        mozCaptureStream?: () => MediaStream;
      };
      const elStream = vidWithCapture.captureStream?.() || vidWithCapture.mozCaptureStream?.();
      if (elStream) {
        for (const audioTrack of elStream.getAudioTracks()) {
          combinedTracks.push(audioTrack);
        }
      }
    }

    const outputStream = new MediaStream(combinedTracks);
    const preferredMime = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
      ? 'video/webm;codecs=vp8,opus'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus'
      : 'video/webm';

    const recorder = new MediaRecorder(outputStream, {
      mimeType: preferredMime,
      videoBitsPerSecond,
      audioBitsPerSecond: 128_000,
    });

    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) chunks.push(ev.data);
    };

    const done = new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        resolve(new Blob(chunks, { type: preferredMime }));
      };
    });

    let rafId = 0;
    const drawFrame = () => {
      if (video.paused || video.ended) return;
      ctx.drawImage(video, 0, 0, width, height);
      rafId = requestAnimationFrame(drawFrame);
    };

    try {
      await video.play();
    } catch {
      // Fallback if browser blocked unmuted offscreen play after file dialog
      video.muted = true;
      await video.play();
    }
    ctx.drawImage(video, 0, 0, width, height);
    recorder.start(200);
    drawFrame();

    const clipMs = Math.min(
      maxDurationMs,
      Math.max(1200, Math.round((Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 8) * 1000))
    );
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, clipMs);
      video.onended = () => {
        clearTimeout(timer);
        resolve();
      };
    });

    cancelAnimationFrame(rafId);
    video.pause();
    if (recorder.state !== 'inactive') {
      recorder.stop();
    }

    const encodedBlob = await done;
    return blobToBoundedDataUrl(encodedBlob, errorLabel, maxOutputLength);
  } finally {
    if (!isStringUrl) {
      URL.revokeObjectURL(objectUrl);
    }
    if (audioCtx && audioCtx.state !== 'closed') {
      void audioCtx.close().catch(() => {});
    }
  }
}

/**
 * Prepares a 720p+ HD video with its original music/audio intact for Spotlight feed.
 * Preserves native MP4/WebM files directly whenever they fit within multi-chunk storage (~7 MB),
 * keeping 100% original stereo music and zero re-encoding loss; only transcodes larger files to 720p.
 */
export async function prepare720pVideoDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('video/')) {
    throw new Error('Please select a valid video file (MP4, WebM, or MOV).');
  }

  const objectUrl = URL.createObjectURL(file);
  let durationSec = 5;
  try {
    const meta = await new Promise<{ d: number }>((resolve, reject) => {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.src = objectUrl;
      v.onloadedmetadata = () =>
        resolve({
          d: Number.isFinite(v.duration) ? v.duration : 5,
        });
      v.onerror = () => reject(new Error('Could not read video metadata.'));
    });
    durationSec = meta.d;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }

  const directEstimate = Math.ceil((file.size * 4) / 3) + 128;

  // Preserve original MP4/WebM file losslessly (100% original music & video) whenever it fits multi-chunk budget
  if (
    directEstimate <= LIMITS.SPOTLIGHT_TOTAL_MAX &&
    (file.type === 'video/mp4' || file.type === 'video/webm') &&
    durationSec <= 45
  ) {
    return blobToBoundedDataUrl(file, 'Spotlight 720p video', LIMITS.SPOTLIGHT_TOTAL_MAX);
  }

  // Otherwise encode cleanly to 720p (shortSide = 720) with audio preserved
  return transcodeVideoSourceWithAudio({
    source: file,
    targetShortSide: 720,
    videoBitsPerSecond: 1_250_000,
    maxDurationMs: 14_000,
    maxOutputLength: LIMITS.SPOTLIGHT_TOTAL_MAX,
    errorLabel: 'Spotlight 720p video',
  });
}

/**
 * Compacts any video file or existing data URL into a single Firestore-document-safe Snap/Story
 * (< 650 KB) while preserving its audio/music track.
 */
export async function transcodeVideoFileToBoundedDataUrl(source: File | string): Promise<string> {
  if (source instanceof File) {
    if (!source.type.startsWith('video/')) {
      throw new Error('Please select a valid video file (MP4, WebM, or MOV).');
    }
    const directEstimate = Math.ceil((source.size * 4) / 3) + 128;
    if (directEstimate <= LIMITS.IMAGE_DATA_MAX) {
      return blobToBoundedDataUrl(source, 'Video Snap', LIMITS.IMAGE_DATA_MAX);
    }
  } else if (source.length <= LIMITS.IMAGE_DATA_MAX) {
    return source;
  }

  return transcodeVideoSourceWithAudio({
    source,
    targetShortSide: 480,
    videoBitsPerSecond: 520_000,
    maxDurationMs: 6500,
    maxOutputLength: LIMITS.IMAGE_DATA_MAX,
    errorLabel: 'Video Snap',
  });
}
