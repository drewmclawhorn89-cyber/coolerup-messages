import { useState } from 'react';
import { Archive, Camera, CircleDot, Clapperboard, MessageCircle, Moon, Sun, Users } from 'lucide-react';
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
  archivedCount: number;
  stories?: Story[];
  spotlightVideos?: SpotlightVideo[];
  onToggleLikeSpotlight?: (video: SpotlightVideo) => Promise<void>;
  profile: PublicProfile;
  darkMode: boolean;
  onToggleTheme: () => void;
  onOpenProfile: () => void;
}

export function NavRail({
  activeTab,
  onSelectTab,
  onOpenCamera,
  onPostVideo,
  totalUnread,
  unviewedStoriesCount,
  pendingFriendRequestsCount = 0,
  archivedCount,
  stories,
  spotlightVideos,
  onToggleLikeSpotlight,
  profile,
  darkMode,
  onToggleTheme,
  onOpenProfile,
}: NavRailProps) {
  const [emblemError, setEmblemError] = useState(false);

  const navItems: { id: NavTab; label: string; icon: typeof MessageCircle; badge?: number }[] = [
    { id: 'chats', label: 'Chats', icon: MessageCircle, badge: totalUnread },
    { id: 'video', label: 'Videos', icon: Clapperboard },
    { id: 'stories', label: 'Stories', icon: CircleDot, badge: unviewedStoriesCount },
    { id: 'people', label: 'Friends', icon: Users, badge: pendingFriendRequestsCount },
    { id: 'archived', label: 'Archived', icon: Archive, badge: archivedCount },
  ];

  return (
    <>
      <aside className="hidden md:flex flex-col items-center justify-between w-[72px] shrink-0 py-4 bg-[#F4F6F9] dark:bg-[#0D131F] border-r border-slate-200 dark:border-slate-800/80 select-none">
        <div className="flex flex-col items-center gap-4 w-full">
          <button
            type="button"
            onClick={() => onSelectTab('chats')}
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
            title="Open Snap Camera"
            aria-label="Open Snap Camera"
            className="w-12 h-12 rounded-2xl bg-[#FFFC00] hover:bg-[#F5E600] text-slate-950 shadow-sm ring-1 ring-black/10 flex items-center justify-center transition-transform active:scale-95 cursor-pointer"
          >
            <Camera className="w-6 h-6" />
          </button>

          <nav className="flex flex-col items-center gap-2 w-full px-2" aria-label="Primary navigation">
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
                  className={`relative w-12 h-11 rounded-xl flex items-center justify-center transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-[#00A6FF]/14 dark:bg-[#0EA5E9]/20 text-[#0088E8] dark:text-[#38BDF8]'
                      : 'text-slate-500 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-800/70 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-[#F43F5E] text-white text-[10px] font-semibold font-mono-tabular flex items-center justify-center">
                      {item.badge > 99 ? '99+' : item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="flex flex-col items-center gap-3">
          <PWAInstallButton variant="rail" />
          <button
            type="button"
            onClick={onToggleTheme}
            title={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
            className="w-11 h-11 rounded-xl flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-800/70 hover:text-slate-900 dark:hover:text-slate-200 transition-colors cursor-pointer"
          >
            {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
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

      {activeTab !== 'video' && (
        <button
          type="button"
          onClick={() => onSelectTab('video')}
          aria-label="Open video feed"
          className="fixed bottom-[4.25rem] right-4 z-40 flex h-12 items-center gap-2 rounded-full bg-slate-950 px-4 text-white shadow-lg ring-1 ring-white/20 md:hidden"
        >
          <Clapperboard className="h-5 w-5" />
          <span className="text-sm font-semibold">Videos</span>
        </button>
      )}
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
