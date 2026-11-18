import { getDownloadURL, ref, uploadBytes, uploadString } from 'firebase/storage';
import { auth, storage } from './firebase';

export type StorageFolder = 'snaps' | 'stories' | 'spotlight' | 'memories' | 'voice' | 'chat';

/**
 * Uploads media (data URL or Blob) to Firebase Storage and returns its HTTPS download URL.
 * If Firebase Storage is temporarily unavailable, blocked by CORS/network, or times out,
 * gracefully returns the compact data URL so the caller can persist via Firestore/chunks/local cache.
 */
export async function uploadMediaWithFallback(params: {
  uid: string;
  folder: StorageFolder;
  media: string | Blob;
  ext?: string;
}): Promise<{ url: string; fromStorage: boolean }> {
  const { uid, folder, media, ext = 'bin' } = params;

  if (typeof media === 'string') {
    if (!media) return { url: '', fromStorage: false };
    if (media.startsWith('https://') || media.startsWith('http://')) {
      return { url: media, fromStorage: true };
    }
  }

  // Only attempt cloud Storage upload if we have an authenticated user
  if (!auth.currentUser) {
    return {
      url: typeof media === 'string' ? media : await blobToDataUrlFallback(media),
      fromStorage: false,
    };
  }

  const cleanExt = ext.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
  const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${cleanExt}`;
  const storageRef = ref(storage, `users/${uid}/${folder}/${fileName}`);

  const uploadTask = async (): Promise<string> => {
    if (typeof media === 'string') {
      await uploadString(storageRef, media, 'data_url');
    } else {
      await uploadBytes(storageRef, media);
    }
    return await getDownloadURL(storageRef);
  };

  try {
    const downloadUrl = await Promise.race([
      uploadTask(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Storage upload timed out')), 12000)
      ),
    ]);
    return { url: downloadUrl, fromStorage: true };
  } catch {
    return {
      url: typeof media === 'string' ? media : await blobToDataUrlFallback(media),
      fromStorage: false,
    };
  }
}

async function blobToDataUrlFallback(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Could not encode media blob.'));
      }
    };
    reader.onerror = () => reject(new Error('Could not read media blob.'));
    reader.readAsDataURL(blob);
  });
}
