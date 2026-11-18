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
  REPLY_TEXT_MAX: 200,
  STORY_CAPTION_MAX: 200,
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
  let quality = 0.84;
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

    const maxDim = 960;
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

export async function blobToBoundedDataUrl(blob: Blob, errorLabel = 'Media recording'): Promise<string> {
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

  if (dataUrl.length > LIMITS.IMAGE_DATA_MAX) {
    throw new Error(`${errorLabel} is too long to save (keep clips brief).`);
  }
  return dataUrl;
}
