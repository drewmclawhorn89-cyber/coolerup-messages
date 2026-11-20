import { useMemo, useState } from 'react';
import { APIProvider, AdvancedMarker, Map as GoogleMap } from '@vis.gl/react-google-maps';
import {
  Camera,
  EyeOff,
  Flame,
  MapPin,
  MessageCircle,
  Navigation,
  Sparkles,
  X,
} from 'lucide-react';
import type { PublicProfile, Story } from '../types/messenger';
import { Avatar } from './Avatar';

interface SnapMapScreenProps {
  currentUser: PublicProfile;
  profiles: PublicProfile[];
  stories: Story[];
  friendUids: Set<string>;
  onToggleGhostMode: (nextGhost: boolean) => Promise<void>;
  onUpdateMyLocation: (lat: number, lng: number, label: string) => Promise<void>;
  onSendSnapToPeer: (peer: PublicProfile) => void;
  onChatWithPeer: (peer: PublicProfile) => void;
  onViewStoryAuthor: (authorId: string) => void;
}

const DEFAULT_CENTER = { lat: 37.7749, lng: -122.4194 };

function hashOffset(uid: string, idx: number): { dLat: number; dLng: number } {
  let h = 2166136261 + idx * 97;
  for (let i = 0; i < uid.length; i++) {
    h ^= uid.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const latNorm = ((h & 0xff) / 255 - 0.5) * 0.055;
  const lngNorm = (((h >> 8) & 0xff) / 255 - 0.5) * 0.075;
  return { dLat: latNorm, dLng: lngNorm };
}

const POPULAR_HEAT_SPOTS = [
  { id: 'heat_downtown', label: 'Downtown Plaza', dLat: 0.012, dLng: -0.015, intensity: 'high' as const },
  { id: 'heat_park', label: 'Sunset Park', dLat: -0.014, dLng: 0.018, intensity: 'medium' as const },
  { id: 'heat_waterfront', label: 'Pier & Boardwalk', dLat: 0.022, dLng: 0.014, intensity: 'high' as const },
];

export function SnapMapScreen({
  currentUser,
  profiles,
  stories,
  friendUids,
  onToggleGhostMode,
  onUpdateMyLocation,
  onSendSnapToPeer,
  onChatWithPeer,
  onViewStoryAuthor,
}: SnapMapScreenProps) {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
  const [selectedPeer, setSelectedPeer] = useState<PublicProfile | null>(null);
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [locating, setLocating] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  const myGhostMode = Boolean(currentUser.ghostMode);
  const baseCenter = useMemo(
    () =>
      typeof currentUser.lat === 'number' && typeof currentUser.lng === 'number'
        ? { lat: currentUser.lat, lng: currentUser.lng }
        : DEFAULT_CENTER,
    [currentUser.lat, currentUser.lng]
  );

  const visibleFriends = useMemo(() => {
    return profiles
      .filter((p) => p.uid !== currentUser.uid && !p.ghostMode)
      .slice(0, 24)
      .map((p, idx) => {
        const hasCoords = typeof p.lat === 'number' && typeof p.lng === 'number';
        const offset = hashOffset(p.uid, idx);
        return {
          profile: p,
          isFriend: friendUids.has(p.uid),
          lat: hasCoords ? (p.lat as number) : baseCenter.lat + offset.dLat,
          lng: hasCoords ? (p.lng as number) : baseCenter.lng + offset.dLng,
          label: p.locationLabel || (hasCoords ? 'Live location' : 'Nearby on Snap Map'),
        };
      });
  }, [profiles, currentUser.uid, friendUids, baseCenter]);

  const happeningStories = useMemo(() => {
    const now = Date.now();
    const seenAuthors: Record<string, boolean> = {};
    const list: { story: Story; lat: number; lng: number; label: string }[] = [];
    stories.forEach((st, idx) => {
      if ((st.expiresAt?.toMillis?.() ?? now + 1000) <= now) return;
      if (!st.isPublicStory || seenAuthors[st.authorId]) return;
      seenAuthors[st.authorId] = true;
      const offset = hashOffset(st.id, idx + 31);
      list.push({
        story: st,
        lat: typeof st.lat === 'number' ? st.lat : baseCenter.lat + offset.dLat,
        lng: typeof st.lng === 'number' ? st.lng : baseCenter.lng + offset.dLng,
        label: st.locationLabel || `${st.authorName.split(' ')[0]}'s Story`,
      });
    });
    return list.slice(0, 10);
  }, [stories, baseCenter]);

  const handleShareLocation = () => {
    if (!navigator.geolocation) {
      setStatusMsg('Location services unavailable in this browser.');
      return;
    }
    setLocating(true);
    setStatusMsg('');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await onUpdateMyLocation(
            pos.coords.latitude,
            pos.coords.longitude,
            'Live GPS Location'
          );
          if (myGhostMode) {
            await onToggleGhostMode(false);
          }
          setStatusMsg('Location updated on Snap Map.');
        } catch (err) {
          setStatusMsg(err instanceof Error ? err.message : 'Unable to update location.');
        } finally {
          setLocating(false);
        }
      },
      () => {
        setLocating(false);
        setStatusMsg('Location permission denied. Using approximate area.');
      },
      { enableHighAccuracy: false, timeout: 8000 }
    );
  };

  return (
    <div className="relative flex-1 w-full h-full min-h-[420px] bg-slate-100 dark:bg-[#0A0A0A] overflow-hidden pb-14 md:pb-0">
      {/* Top Map Controls */}
      <div className="absolute top-3 left-3 right-3 z-20 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        <div className="flex items-center gap-2 pointer-events-auto">
          <div className="h-10 px-3.5 rounded-full bg-white/95 dark:bg-[#141414]/95 shadow-md border border-slate-100 dark:border-white/10 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-[#0E8CFF]" />
            <span className="text-xs font-bold text-slate-900 dark:text-white">Snap Map</span>
          </div>

          <button
            type="button"
            onClick={() => setShowHeatmap((v) => !v)}
            className={`h-10 px-3.5 rounded-full shadow-md border text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors ${
              showHeatmap
                ? 'bg-[#FFFC00] border-amber-300 text-slate-950'
                : 'bg-white/95 dark:bg-[#141414]/95 border-slate-100 dark:border-white/10 text-slate-700 dark:text-slate-200'
            }`}
          >
            <Flame className="w-3.5 h-3.5" />
            <span>Heatmap</span>
          </button>
        </div>

        <div className="flex items-center gap-2 pointer-events-auto">
          <button
            type="button"
            onClick={handleShareLocation}
            disabled={locating}
            className="h-10 px-3.5 rounded-full bg-[#0E8CFF] hover:bg-[#0B7BE0] text-white text-xs font-bold shadow-md flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
          >
            <Navigation className="w-3.5 h-3.5" />
            <span>{locating ? 'Locating...' : 'Update Location'}</span>
          </button>

          <button
            type="button"
            onClick={() => void onToggleGhostMode(!myGhostMode)}
            className={`h-10 px-3.5 rounded-full shadow-md border text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors ${
              myGhostMode
                ? 'bg-slate-900 text-[#FFFC00] border-slate-700'
                : 'bg-white/95 dark:bg-[#141414]/95 border-slate-100 dark:border-white/10 text-slate-800 dark:text-slate-100'
            }`}
          >
            <EyeOff className="w-3.5 h-3.5" />
            <span>{myGhostMode ? 'Ghost Mode ON' : 'Ghost Mode'}</span>
          </button>
        </div>
      </div>

      {statusMsg && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 px-4 py-1.5 rounded-full bg-slate-950/85 text-white text-xs font-medium shadow-md">
          {statusMsg}
        </div>
      )}

      {/* Map Canvas */}
      {apiKey ? (
        <div className="w-full h-full">
          <APIProvider apiKey={apiKey}>
            <GoogleMap
              mapId="DEMO_MAP_ID"
              internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
              defaultCenter={baseCenter}
              defaultZoom={12}
              gestureHandling="greedy"
              disableDefaultUI={true}
              className="w-full h-full"
            >
              {/* Non-WebGL Heatmap Glow Circles */}
              {showHeatmap &&
                POPULAR_HEAT_SPOTS.map((spot) => (
                  <AdvancedMarker
                    key={spot.id}
                    position={{ lat: baseCenter.lat + spot.dLat, lng: baseCenter.lng + spot.dLng }}
                    title={spot.label}
                  >
                    <div
                      className="pointer-events-none flex items-center justify-center rounded-full"
                      style={{
                        width: spot.intensity === 'high' ? 116 : 86,
                        height: spot.intensity === 'high' ? 116 : 86,
                        background:
                          spot.intensity === 'high'
                            ? 'radial-gradient(circle, rgba(244,63,94,0.52) 0%, rgba(250,204,21,0.34) 48%, rgba(250,204,21,0) 75%)'
                            : 'radial-gradient(circle, rgba(250,204,21,0.5) 0%, rgba(56,189,248,0.22) 55%, rgba(56,189,248,0) 75%)',
                      }}
                    >
                      <span className="px-2 py-0.5 rounded-full bg-black/60 text-[10px] font-bold text-[#FFFC00] whitespace-nowrap">
                        🔥 {spot.label}
                      </span>
                    </div>
                  </AdvancedMarker>
                ))}

              {/* My Bitmoji Marker */}
              {!myGhostMode && (
                <AdvancedMarker
                  position={baseCenter}
                  title="You"
                  zIndex={30}
                >
                  <div className="flex flex-col items-center">
                    <div className="p-1 rounded-full bg-[#FFFC00] shadow-lg ring-2 ring-slate-950">
                      <Avatar
                        name={currentUser.displayName}
                        photoURL={currentUser.photoURL}
                        avatarSeed={currentUser.avatarSeed}
                        size="md"
                      />
                    </div>
                    <span className="mt-1 px-2 py-0.5 rounded-full bg-slate-950 text-[#FFFC00] text-[10px] font-bold shadow">
                      Me
                    </span>
                  </div>
                </AdvancedMarker>
              )}

              {/* Friends' Bitmoji Markers */}
              {visibleFriends.map((item) => (
                <AdvancedMarker
                  key={item.profile.uid}
                  position={{ lat: item.lat, lng: item.lng }}
                  onClick={() => setSelectedPeer(item.profile)}
                  zIndex={item.isFriend ? 25 : 15}
                >
                  <div className="flex flex-col items-center cursor-pointer transition-transform hover:scale-110">
                    <div
                      className={`p-0.5 rounded-full shadow-lg ${
                        item.isFriend ? 'bg-[#0E8CFF] ring-2 ring-white' : 'bg-white ring-1 ring-slate-300'
                      }`}
                    >
                      <Avatar
                        name={item.profile.displayName}
                        photoURL={item.profile.photoURL}
                        avatarSeed={item.profile.avatarSeed}
                        size="sm"
                        isOnline={item.profile.isOnline}
                      />
                    </div>
                    <span className="mt-0.5 px-2 py-0.5 rounded-full bg-white/95 text-slate-950 text-[10px] font-bold shadow max-w-[96px] truncate">
                      {item.profile.displayName.split(' ')[0]}
                    </span>
                  </div>
                </AdvancedMarker>
              ))}

              {/* See What's Happening Pinned Public Stories */}
              {happeningStories.map((item) => (
                <AdvancedMarker
                  key={`story_${item.story.id}`}
                  position={{ lat: item.lat, lng: item.lng }}
                  onClick={() => onViewStoryAuthor(item.story.authorId)}
                  zIndex={20}
                >
                  <div className="flex flex-col items-center cursor-pointer group">
                    <div className="w-10 h-10 rounded-2xl overflow-hidden border-2 border-[#8B5CF6] bg-black shadow-lg group-hover:scale-110 transition-transform">
                      {item.story.mediaType === 'video' ? (
                        <div className="w-full h-full bg-[#8B5CF6] text-white flex items-center justify-center">
                          <Sparkles className="w-4 h-4" />
                        </div>
                      ) : (
                        <img
                          src={item.story.imageData}
                          alt={item.label}
                          className="w-full h-full object-cover"
                        />
                      )}
                    </div>
                    <span className="mt-0.5 px-1.5 py-0.5 rounded-full bg-[#8B5CF6] text-white text-[9px] font-bold shadow whitespace-nowrap">
                      {item.label}
                    </span>
                  </div>
                </AdvancedMarker>
              ))}
            </GoogleMap>
          </APIProvider>
        </div>
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center">
          <MapPin className="w-10 h-10 text-[#0E8CFF] mb-3" />
          <p className="text-sm font-bold text-slate-900 dark:text-white mb-1">
            Google Maps API Key Not Configured
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs">
            Set VITE_GOOGLE_MAPS_API_KEY in your environment to display interactive Snap Map pins and hotspots.
          </p>
        </div>
      )}

      {/* Selected Friend Floating Card */}
      {selectedPeer && (
        <div className="absolute bottom-20 md:bottom-5 left-4 right-4 sm:left-auto sm:right-5 sm:w-80 z-30 p-4 rounded-3xl bg-white dark:bg-[#141414] border border-slate-100 dark:border-white/10 shadow-xl">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex items-center gap-3 min-w-0">
              <Avatar
                name={selectedPeer.displayName}
                photoURL={selectedPeer.photoURL}
                avatarSeed={selectedPeer.avatarSeed}
                size="md"
                isOnline={selectedPeer.isOnline}
              />
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
                  {selectedPeer.displayName}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  @{selectedPeer.handle} · {selectedPeer.locationLabel || 'Nearby'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSelectedPeer(null)}
              aria-label="Close friend card"
              className="w-8 h-8 rounded-full hover:bg-[#F7F7F7] dark:hover:bg-white/5 flex items-center justify-center text-slate-400 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                const target = selectedPeer;
                setSelectedPeer(null);
                onSendSnapToPeer(target);
              }}
              className="h-10 rounded-full bg-[#FFFC00] hover:bg-[#F5E600] text-black text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Camera className="w-4 h-4" />
              <span>Send Snap</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const target = selectedPeer;
                setSelectedPeer(null);
                onChatWithPeer(target);
              }}
              className="h-10 rounded-full bg-[#0E8CFF] hover:bg-[#0B7BE0] text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <MessageCircle className="w-4 h-4" />
              <span>Chat</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
