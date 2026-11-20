import {
  Bell,
  Camera,
  CircleDot,
  Film,
  FolderHeart,
  MapPin,
  MessageCircle,
  Moon,
  Settings,
  Sun,
  Users,
} from 'lucide-react';
import type { NavTab, PublicProfile, SpotlightVideo, Story } from '../types/messenger';
import { Avatar } from './Avatar';
import { GhostLogo } from './GhostLogo';
import { PWAInstallButton } from './PWAInstallButton';
import { VideoFeed } from './VideoFeed';

interface NavRailProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  onOpenCamera: () => void;
  onPostVideo?: () => void;
  totalUnread: number;
  unviewedStoriesCount: number;
  pendingFriendRequestsCount?: number;
  unreadNotificationsCount?: number;
  archivedCount: number;
  stories?: Story[];
  spotlightVideos?: SpotlightVideo[];
  onToggleLikeSpotlight?: (video: SpotlightVideo) => Promise<void>;
  profile: PublicProfile;
  darkMode: boolean;
  onToggleTheme: () => void;
  onOpenProfile: () => void;
  onOpenMemories?: () => void;
  onOpenNotifications?: () => void;
  onOpenSettings?: () => void;
}

export function NavRail({
  activeTab,
  onSelectTab,
  onOpenCamera,
  onPostVideo,
  totalUnread,
  unviewedStoriesCount,
  pendingFriendRequestsCount = 0,
  unreadNotificationsCount = 0,
  archivedCount,
  stories,
  spotlightVideos,
  onToggleLikeSpotlight,
  profile,
  darkMode,
  onToggleTheme,
  onOpenProfile,
  onOpenMemories,
  onOpenNotifications,
  onOpenSettings,
}: NavRailProps) {
  const navItems: { id: NavTab; label: string; icon: typeof MessageCircle; badge?: number }[] = [
    { id: 'map', label: 'Map', icon: MapPin },
    { id: 'chats', label: 'Chat', icon: MessageCircle, badge: totalUnread },
    { id: 'stories', label: 'Stories', icon: CircleDot, badge: unviewedStoriesCount },
    { id: 'spotlight', label: 'Spotlight', icon: Film },
    { id: 'people', label: 'Friends', icon: Users, badge: pendingFriendRequestsCount },
  ];

  const railIconButton =
    'relative w-12 h-12 rounded-full flex items-center justify-center transition-colors snap-press cursor-pointer';

  return (
    <>
      <aside className="hidden md:flex flex-col items-center justify-between w-[84px] shrink-0 py-4 bg-[#0A0A0A] border-r border-black select-none">
        <div className="flex flex-col items-center gap-2.5 w-full">
          {/* Ghost home button */}
          <button
            type="button"
            onClick={() => onSelectTab('camera')}
            title="CoolerUp"
            aria-label="CoolerUp home"
            className="w-12 h-12 rounded-full flex items-center justify-center text-[#FFFC00] hover:bg-white/10 transition-colors cursor-pointer"
          >
            <GhostLogo className="w-9 h-9" />
          </button>

          {/* Big yellow camera button — the signature Snapchat action */}
          <button
            type="button"
            onClick={onOpenCamera}
            title="Open Camera"
            aria-label="Open Camera"
            className="w-14 h-14 rounded-full bg-[#FFFC00] hover:bg-[#F2EF00] text-black flex items-center justify-center snap-glow snap-press cursor-pointer mt-1 mb-2"
          >
            <Camera className="w-6 h-6" strokeWidth={2.4} />
          </button>

          <nav className="flex flex-col items-center gap-1 w-full" aria-label="Primary navigation">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectTab(item.id)}
                  title={item.label}
                  aria-label={item.label}
                  aria-current={isActive ? 'page' : undefined}
                  className={`${railIconButton} ${
                    isActive
                      ? 'bg-[#FFFC00] text-black'
                      : 'text-white/80 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <Icon className="w-[22px] h-[22px]" strokeWidth={isActive ? 2.6 : 2.1} />
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#FF3B5C] text-white text-[10px] font-bold font-mono-tabular flex items-center justify-center ring-2 ring-[#0A0A0A]">
                      {item.badge > 99 ? '99+' : item.badge}
                    </span>
                  )}
                </button>
              );
            })}

            {archivedCount > 0 && (
              <button
                type="button"
                onClick={() => onSelectTab('archived')}
                title="Archived"
                aria-label="Archived"
                className={`${railIconButton} ${
                  activeTab === 'archived'
                    ? 'bg-[#FFFC00] text-black'
                    : 'text-white/80 hover:bg-white/10 hover:text-white'
                }`}
              >
                <FolderHeart className="w-[22px] h-[22px]" strokeWidth={2.1} />
                <span className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-white/20 text-white text-[10px] font-bold flex items-center justify-center">
                  {archivedCount > 9 ? '9+' : archivedCount}
                </span>
              </button>
            )}
          </nav>
        </div>

        <div className="flex flex-col items-center gap-1">
          {onOpenMemories && (
            <button
              type="button"
              onClick={onOpenMemories}
              title="Memories"
              aria-label="Memories"
              className={`${railIconButton} text-white/70 hover:bg-white/10 hover:text-white`}
            >
              <FolderHeart className="w-5 h-5" />
            </button>
          )}
          {onOpenNotifications && (
            <button
              type="button"
              onClick={onOpenNotifications}
              title="Notifications"
              aria-label="Notifications"
              className={`${railIconButton} text-white/70 hover:bg-white/10 hover:text-white`}
            >
              <Bell className="w-5 h-5" />
              {unreadNotificationsCount > 0 && (
                <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-[#FF3B5C] text-white text-[9px] font-bold flex items-center justify-center">
                  {unreadNotificationsCount > 9 ? '9+' : unreadNotificationsCount}
                </span>
              )}
            </button>
          )}
          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              title="Settings"
              aria-label="Settings"
              className={`${railIconButton} text-white/70 hover:bg-white/10 hover:text-white`}
            >
              <Settings className="w-5 h-5" />
            </button>
          )}
          <PWAInstallButton variant="rail" />
          <button
            type="button"
            onClick={onToggleTheme}
            title={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
            className={`${railIconButton} text-white/70 hover:bg-white/10 hover:text-white`}
          >
            {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
          <button
            type="button"
            onClick={onOpenProfile}
            title={`${profile.displayName} · Snap Score ${profile.snapScore ?? 0}`}
            aria-label="Open profile"
            className="mt-1 p-[2px] rounded-full bg-[#FFFC00] hover:scale-105 transition-transform cursor-pointer"
          >
            <Avatar
              name={profile.displayName}
              photoURL={profile.photoURL}
              avatarSeed={profile.avatarSeed}
              size="sm"
              isOnline={profile.isOnline}
            />
          </button>
        </div>
      </aside>

      {activeTab === 'video' && (
        <VideoFeed
          stories={stories}
          spotlightVideos={spotlightVideos}
          currentUserUid={profile.uid}
          onPostVideo={onPostVideo}
          onToggleLikeSpotlight={onToggleLikeSpotlight}
          onClose={() => onSelectTab('chats')}
        />
      )}
    </>
  );
}
