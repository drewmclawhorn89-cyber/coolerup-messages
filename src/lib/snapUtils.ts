import type { Timestamp } from 'firebase/firestore';
import { timestampToDate } from './dateFormat';

export interface BitmojiAvatarConfig {
  bg: string;
  skin: string;
  hair: string;
  hairStyle: 'short' | 'wavy' | 'curls' | 'cap';
  glasses: 'none' | 'shades' | 'round';
  expression: 'smile' | 'wink' | 'cool';
}

export const BITMOJI_BG_PALETTE = ['#FFFC00', '#00A6FF', '#8B5CF6', '#10B981', '#F43F5E', '#F97316'];
export const BITMOJI_SKIN_TONES = ['#FDE2C8', '#F2C19E', '#D99B72', '#A66D49', '#6B4226'];
export const BITMOJI_HAIR_COLORS = ['#1E293B', '#7C2D12', '#D97706', '#94A3B8', '#EC4899'];

export function parseAvatarSeed(seed?: string): BitmojiAvatarConfig | null {
  if (!seed || !seed.startsWith('bitmoji:')) return null;
  const parts = seed.split(':');
  if (parts.length < 7) return null;
  return {
    bg: parts[1] || '#FFFC00',
    skin: parts[2] || '#F2C19E',
    hair: parts[3] || '#1E293B',
    hairStyle: (parts[4] as BitmojiAvatarConfig['hairStyle']) || 'short',
    glasses: (parts[5] as BitmojiAvatarConfig['glasses']) || 'none',
    expression: (parts[6] as BitmojiAvatarConfig['expression']) || 'smile',
  };
}

export function serializeAvatarSeed(cfg: BitmojiAvatarConfig): string {
  return `bitmoji:${cfg.bg}:${cfg.skin}:${cfg.hair}:${cfg.hairStyle}:${cfg.glasses}:${cfg.expression}`.slice(0, 120);
}

export function getDefaultBitmojiConfig(): BitmojiAvatarConfig {
  return {
    bg: '#FFFC00',
    skin: '#F2C19E',
    hair: '#1E293B',
    hairStyle: 'short',
    glasses: 'shades',
    expression: 'smile',
  };
}

export function buildSnapcodeString(handle: string): string {
  return `coolerup://add/@${handle.replace(/^@/, '').toLowerCase()}`;
}

export function extractHandleFromSnapcodeInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const urlMatch = trimmed.match(/[?&]chat=([^&\s]+)/i);
  if (urlMatch?.[1]) {
    return decodeURIComponent(urlMatch[1]).replace(/^@/, '').toLowerCase();
  }
  const snapMatch = trimmed.match(/coolerup:\/\/add\/@?([a-z0-9_.-]+)/i);
  if (snapMatch?.[1]) {
    return snapMatch[1].toLowerCase();
  }
  return trimmed.replace(/^@/, '').toLowerCase();
}

export function generateSnapcodeMatrix(seed: string): boolean[][] {
  const size = 9;
  const grid: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  for (let r = 0; r < size; r++) {
    for (let c = 0; c <= Math.floor(size / 2); c++) {
      // Leave center ghost silhouette clear
      const inCenter = r >= 2 && r <= 6 && c >= 2 && c <= 6;
      if (inCenter) {
        grid[r][c] = false;
        grid[r][size - 1 - c] = false;
        continue;
      }
      hash ^= (r * 31 + c * 17) + 0x9e3779b9;
      hash = Math.imul(hash, 0x85ebca6b);
      const bit = ((hash >>> 15) & 1) === 1;
      grid[r][c] = bit;
      grid[r][size - 1 - c] = bit;
    }
  }
  return grid;
}

export function getStreakStatus(streakCount = 0, lastSnapAt?: Timestamp | null): {
  active: boolean;
  count: number;
  hourglass: boolean;
} {
  if (!streakCount || streakCount < 2) {
    return { active: false, count: streakCount || 0, hourglass: false };
  }
  const dt = timestampToDate(lastSnapAt);
  if (!dt) {
    return { active: true, count: streakCount, hourglass: false };
  }
  const hoursSince = (Date.now() - dt.getTime()) / (1000 * 60 * 60);
  if (hoursSince >= 28) {
    return { active: false, count: 0, hourglass: false };
  }
  return {
    active: true,
    count: streakCount,
    hourglass: hoursSince >= 20,
  };
}
