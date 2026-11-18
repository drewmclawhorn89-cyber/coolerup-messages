import { useState } from 'react';
import {
  Archive,
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
  const [emblemError, setEmblemError] = useState(false);

  const navItems: { id: NavTab; label: string; icon: typeof MessageCircle; badge?: number }[] = [
    { id: 'map', label: 'Map', icon: MapPin },
    { id: 'chats', label: 'Chat', icon: MessageCircle, badge: totalUnread },
    { id: 'camera', label: 'Camera', icon: Camera },
    { id: 'stories', label: 'Stories', icon: CircleDot, badge: unviewedStoriesCount },
    { id: 'spotlight', label: 'Spotlight', icon: Film },
    { id: 'people', label: 'Friends', icon: Users, badge: pendingFriendRequestsCount },
    { id: 'archived', label: 'Archived', icon: Archive, badge: archivedCount },
  ];

  return (
    <>
      <aside className="hidden md:flex flex-col items-center justify-between w-[72px] shrink-0 py-3 bg-[#F4F6F9] dark:bg-[#0D131F] border-r border-slate-200 dark:border-slate-800/80 select-none">
        <div className="flex flex-col items-center gap-3 w-full">
          <button
            type="button"
            onClick={() => onSelectTab('camera')}
            title="CoolerUp Messages"
            className="w-10 h-10 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 cursor-pointer shrink-0"
          >
            {!emblemError ? (
              <img
                src="/src/assets/images/coolerup_emblem_1794968388923.jpg"
                alt="CoolerUp Messages"
                referrerPolicy="no-referrer"
                onError={() => setEmblemError(true)}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-[#FFFC00] text-slate-950 font-display font-bold text-xs flex items-center justify-center">
                CU
              </div>
            )}
          </button>

          <button
            type="button"
            onClick={onOpenCamera}
            title="Snap Camera Modal"
            aria-label="Open Snap Camera"
            className="w-11 h-11 rounded-2xl bg-[#FFFC00] hover:bg-[#F5E600] text-slate-950 shadow-sm ring-1 ring-black/10 flex items-center justify-center transition-transform active:scale-95 cursor-pointer"
          >
            <Camera className="w-5 h-5" />
          </button>

          <nav className="flex flex-col items-center gap-1 w-full px-2" aria-label="Primary navigation">
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
                  className={`relative w-12 h-10 rounded-xl flex items-center justify-center transition-colors cursor-pointer ${
                    isActive
                      ? item.id === 'camera'
                        ? 'bg-[#FFFC00] text-slate-950 font-bold shadow-xs'
                        : 'bg-[#00A6FF]/14 dark:bg-[#0EA5E9]/20 text-[#0088E8] dark:text-[#38BDF8]'
                      : 'text-slate-500 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-800/70 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-[#F43F5E] text-white text-[10px] font-semibold font-mono-tabular flex items-center justify-center">
                      {item.badge > 99 ? '99+' : item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="flex flex-col items-center gap-1.5">
          {onOpenMemories && (
            <button
              type="button"
              onClick={onOpenMemories}
              title="Memories & My Eyes Only"
              aria-label="Memories"
              className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-800/70 hover:text-slate-900 dark:hover:text-slate-200 transition-colors cursor-pointer"
            >
              <FolderHeart className="w-4.5 h-4.5" />
            </button>
          )}
          {onOpenNotifications && (
            <button
              type="button"
              onClick={onOpenNotifications}
              title="Notifications"
              aria-label="Notifications"
              className="relative w-10 h-10 rounded-xl flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-800/70 hover:text-slate-900 dark:hover:text-slate-200 transition-colors cursor-pointer"
            >
              <Bell className="w-4.5 h-4.5" />
              {unreadNotificationsCount > 0 && (
                <span className="absolute top-1 right-1 min-w-[15px] h-3.5 px-1 rounded-full bg-[#F43F5E] text-white text-[9px] font-bold flex items-center justify-center">
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
              className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-800/70 hover:text-slate-900 dark:hover:text-slate-200 transition-colors cursor-pointer"
            >
              <Settings className="w-4.5 h-4.5" />
            </button>
          )}
          <PWAInstallButton variant="rail" />
          <button
            type="button"
            onClick={onToggleTheme}
            title={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-800/70 hover:text-slate-900 dark:hover:text-slate-200 transition-colors cursor-pointer"
          >
            {darkMode ? <Sun className="w-4.5 h-4.5" /> : <Moon className="w-4.5 h-4.5" />}
          </button>
          <button
            type="button"
            onClick={onOpenProfile}
            title={`${profile.displayName} · Snap Score ${profile.snapScore ?? 0}`}
            className="p-0.5 rounded-full hover:ring-2 hover:ring-[#FFFC00] transition-all cursor-pointer"
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
