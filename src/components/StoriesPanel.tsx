import { useMemo } from 'react';
import { Camera, Eye, Heart, Plus, Trash2, Video } from 'lucide-react';
import { formatConversationTime } from '../lib/dateFormat';
import type { PublicProfile, Story } from '../types/messenger';
import { Avatar } from './Avatar';

interface StoriesPanelProps {
  currentUser: PublicProfile;
  stories: Story[];
  profilesByUid: Record<string, PublicProfile>;
  onOpenCameraForStory: () => void;
  onOpenCameraForVideo?: () => void;
  onViewAuthorStories: (authorId: string) => void;
  onDeleteStory: (storyId: string) => Promise<void>;
}

export function StoriesPanel({
  currentUser,
  stories,
  profilesByUid,
  onOpenCameraForStory,
  onOpenCameraForVideo,
  onViewAuthorStories,
  onDeleteStory,
}: StoriesPanelProps) {
  const { myStories, friendGroups, discoverStories } = useMemo(() => {
    const now = Date.now();
    const active = stories.filter((story) => {
      const expiresAt = story.expiresAt?.toMillis?.() ?? now + 1000;
      return expiresAt > now;
    });

    const mine = active
      .filter((story) => story.authorId === currentUser.uid)
      .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));

    const byAuthor = new Map<string, Story[]>();
    for (const story of active) {
      if (story.authorId === currentUser.uid) continue;
      const list = byAuthor.get(story.authorId) || [];
      list.push(story);
      byAuthor.set(story.authorId, list);
    }

    const groups = Array.from(byAuthor.entries()).map(([authorId, items]) => {
      items.sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));
      const latestStory = items[items.length - 1];
      return {
        authorId,
        authorName: latestStory.authorName,
        authorHandle: latestStory.authorHandle,
        authorPhotoURL: latestStory.authorPhotoURL,
        avatarSeed: profilesByUid[authorId]?.avatarSeed,
        latestStory,
        count: items.length,
        hasUnviewed: items.some((story) => !story.viewerIds.includes(currentUser.uid)),
      };
    });

    groups.sort((a, b) => {
      if (a.hasUnviewed !== b.hasUnviewed) return a.hasUnviewed ? -1 : 1;
      return (b.latestStory.createdAt?.toMillis?.() ?? 0) - (a.latestStory.createdAt?.toMillis?.() ?? 0);
    });

    const discover = active
      .filter((s) => s.isPublicStory)
      .sort((a, b) => (b.viewerIds.length - a.viewerIds.length) || ((b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0)));

    return { myStories: mine, friendGroups: groups, discoverStories: discover };
  }, [stories, currentUser.uid, profilesByUid]);

  return (
    <section className="flex flex-col h-full w-full md:w-[380px] lg:w-[420px] shrink-0 bg-white dark:bg-[#0F0F0F] border-r border-slate-100 dark:border-white/10">
      <div className="px-4 pt-4 pb-3 flex items-center justify-between gap-2 shrink-0 border-b border-slate-100 dark:border-white/10/80">
        <div>
          <h1 className="font-display text-[28px] leading-none font-extrabold tracking-[-0.05em] text-slate-900 dark:text-white">
            Stories
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            24-hour Snaps &amp; Discover
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onOpenCameraForStory}
            className="h-9 px-3.5 rounded-full bg-[#FFFC00] hover:bg-[#F5E600] text-black text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>+ My Story</span>
          </button>
          {onOpenCameraForVideo && (
            <button
              type="button"
              onClick={onOpenCameraForVideo}
              title="Record Video Story"
              className="w-9 h-9 rounded-2xl bg-[#8B5CF6] hover:bg-[#7C3AED] text-white flex items-center justify-center cursor-pointer"
            >
              <Video className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto chat-scroll px-3.5 py-4 space-y-5">
        {/* 1. Top: My Story Row */}
        <div className="p-3 rounded-2xl bg-[#F2F2F2] dark:bg-[#0A0A0A] border border-slate-200/70 dark:border-white/10">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() =>
                myStories.length > 0
                  ? onViewAuthorStories(currentUser.uid)
                  : onOpenCameraForStory()
              }
              className="flex items-center gap-3 min-w-0 text-left cursor-pointer"
            >
              <div
                className={`relative p-[2.5px] rounded-full ${
                  myStories.length > 0 ? 'snap-story-ring' : 'snap-story-ring-seen'
                }`}
              >
                <Avatar
                  name={currentUser.displayName}
                  photoURL={currentUser.photoURL}
                  avatarSeed={currentUser.avatarSeed}
                  size="md"
                />
                {myStories.length === 0 && (
                  <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-[#FFFC00] text-slate-950 flex items-center justify-center ring-2 ring-white dark:ring-[#0A0A0A]">
                    <Plus className="w-2.5 h-2.5" />
                  </span>
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
                  My Story
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {myStories.length > 0
                    ? `${myStories.length} active · Tap to view`
                    : 'Add to My Story (24h auto-expire)'}
                </p>
              </div>
            </button>
            <button
              type="button"
              onClick={onOpenCameraForStory}
              aria-label="Add to My Story"
              className="h-8 px-3 rounded-full bg-[#FFFC00] hover:bg-[#F5E600] text-black text-xs font-bold flex items-center gap-1 cursor-pointer shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add</span>
            </button>
          </div>

          {myStories.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-200/80 dark:border-white/10 space-y-2">
              {myStories.map((story) => {
                const viewerNames = story.viewerIds
                  .map((uid) => profilesByUid[uid]?.displayName.split(' ')[0])
                  .filter(Boolean)
                  .slice(0, 3);
                const isVideo = story.mediaType === 'video' || story.imageData.startsWith('data:video');
                return (
                  <div key={story.id} className="flex items-center justify-between gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => onViewAuthorStories(currentUser.uid)}
                      className="flex items-center gap-2 min-w-0 text-left cursor-pointer"
                    >
                      <div className="w-8 h-10 rounded-xl overflow-hidden bg-[#EDEDED] dark:bg-white/10 shrink-0 flex items-center justify-center">
                        {isVideo ? (
                          <Video className="w-4 h-4 text-[#8B5CF6]" />
                        ) : (
                          <img src={story.imageData} alt="My story thumbnail" className="w-full h-full object-cover" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-slate-800 dark:text-slate-200 truncate">
                          {story.caption || (isVideo ? 'Video Story' : 'Photo Story')}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1 font-mono-tabular truncate">
                          <Eye className="w-3 h-3 shrink-0" />
                          <span>
                            {story.viewerIds.length}
                            {viewerNames.length > 0 ? ` (${viewerNames.join(', ')})` : ''}
                          </span>
                          <span>·</span>
                          <span>{formatConversationTime(story.createdAt)}</span>
                        </p>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDeleteStory(story.id)}
                      aria-label="Delete story"
                      className="w-8 h-8 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-950/40 text-slate-400 hover:text-rose-600 flex items-center justify-center cursor-pointer shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 2. Friends Stories Horizontal Row */}
        <div>
          <p className="px-1 pb-2 text-[11px] font-extrabold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
            Friends Stories
          </p>
          {friendGroups.length === 0 ? (
            <p className="px-2 py-3 text-xs text-slate-500 dark:text-slate-400">
              No active friend stories yet.
            </p>
          ) : (
            <div className="flex items-center gap-3.5 overflow-x-auto chat-scroll pb-1 px-1">
              {friendGroups.map((group) => (
                <button
                  key={group.authorId}
                  type="button"
                  onClick={() => onViewAuthorStories(group.authorId)}
                  className="flex flex-col items-center gap-1.5 w-16 shrink-0 group cursor-pointer"
                >
                  <div
                    className={`p-[2.5px] rounded-full ${
                      group.hasUnviewed
                        ? 'snap-story-ring'
                        : 'snap-story-ring-seen'
                    }`}
                  >
                    <Avatar
                      name={group.authorName}
                      photoURL={group.authorPhotoURL}
                      avatarSeed={group.avatarSeed}
                      size="lg"
                    />
                  </div>
                  <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300 truncate w-full text-center">
                    {group.authorName.split(' ')[0]}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 3. Discover / Public Stories Vertical Feed */}
        <div>
          <p className="px-1 pb-2 text-[11px] font-extrabold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
            Discover &amp; Public Stories
          </p>
          {discoverStories.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 dark:border-white/10 px-5 py-9 text-center">
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                No Discover stories right now
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Post a photo or video Snap to My Story to appear in Discover for 24 hours.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              {discoverStories.map((story) => {
                const isVideo = story.mediaType === 'video' || story.imageData.startsWith('data:video');
                const likesCount = story.likedBy?.length || 0;
                return (
                  <button
                    key={story.id}
                    type="button"
                    onClick={() => onViewAuthorStories(story.authorId)}
                    className="group relative aspect-[3/4] rounded-2xl overflow-hidden bg-slate-950 border border-slate-100 dark:border-white/10 text-left cursor-pointer"
                  >
                    {isVideo ? (
                      <video
                        src={story.imageData}
                        muted
                        playsInline
                        preload="metadata"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <img
                        src={story.imageData}
                        alt={story.caption || story.authorName}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                      />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/15 to-transparent" />
                    <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between gap-1">
                      <div className="p-0.5 rounded-full ring-2 ring-[#FFFC00]">
                        <Avatar name={story.authorName} photoURL={story.authorPhotoURL} size="xs" />
                      </div>
                      {isVideo && (
                        <span className="px-1.5 py-0.5 rounded-md bg-black/60 text-white text-[10px] font-bold">
                          VIDEO
                        </span>
                      )}
                    </div>
                    <div className="absolute bottom-2.5 left-2.5 right-2.5">
                      {story.caption && (
                        <p className="text-xs font-semibold text-white line-clamp-2 mb-1">
                          {story.caption}
                        </p>
                      )}
                      <p className="text-[11px] font-bold text-[#FFFC00] truncate">
                        {story.authorName}
                      </p>
                      <div className="mt-0.5 flex items-center gap-2.5 text-[10px] text-white/80 font-mono-tabular">
                        <span className="inline-flex items-center gap-1">
                          <Eye className="w-3 h-3" /> {story.viewerIds.length}
                        </span>
                        {likesCount > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <Heart className="w-3 h-3 fill-rose-500 text-rose-500" /> {likesCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
