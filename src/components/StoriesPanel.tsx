import { useMemo } from 'react';
import { Camera, Eye, Plus, Trash2, Video } from 'lucide-react';
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
  const { activeStories, videoPosts, myStories, friendGroups } = useMemo(() => {
    const now = Date.now();
    const active = stories.filter((story) => {
      const expiresAt = story.expiresAt?.toMillis?.() ?? now + 1000;
      return expiresAt > now;
    });

    const mine = active
      .filter((story) => story.authorId === currentUser.uid)
      .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));

    const videos = active
      .filter((story) => story.mediaType === 'video' || story.imageData.startsWith('data:video'))
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
        latestStory,
        count: items.length,
        hasUnviewed: items.some((story) => !story.viewerIds.includes(currentUser.uid)),
      };
    });

    groups.sort((a, b) => {
      if (a.hasUnviewed !== b.hasUnviewed) return a.hasUnviewed ? -1 : 1;
      return (b.latestStory.createdAt?.toMillis?.() ?? 0) - (a.latestStory.createdAt?.toMillis?.() ?? 0);
    });

    return { activeStories: active, videoPosts: videos, myStories: mine, friendGroups: groups };
  }, [stories, currentUser.uid]);

  return (
    <section className="flex flex-col h-full w-full md:w-[380px] lg:w-[420px] shrink-0 bg-white dark:bg-[#121824] border-r border-slate-200 dark:border-slate-800/80">
      <div className="px-4 pt-4 pb-3 flex items-center justify-between gap-2 shrink-0">
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight text-slate-900 dark:text-white">
            Video Feed
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Short videos from the CoolerUp community
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenCameraForVideo || onOpenCameraForStory}
          className="h-9 px-3.5 rounded-xl bg-[#FFFC00] hover:bg-[#F5E600] text-slate-950 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
        >
          <Camera className="w-3.5 h-3.5" />
          <span>Post video</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto chat-scroll px-3 pb-5 space-y-5">
        <div className="space-y-3" aria-label="Community video feed">
          {videoPosts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 px-5 py-9 text-center">
              <div className="mx-auto mb-3 w-12 h-12 rounded-2xl bg-[#8B5CF6]/10 text-[#8B5CF6] flex items-center justify-center">
                <Video className="w-6 h-6" />
              </div>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">The feed is ready for its first video</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Record a short video Snap and share it to your 24-hour Story.</p>
              <button
                type="button"
                onClick={onOpenCameraForVideo || onOpenCameraForStory}
                className="mt-4 h-9 px-4 rounded-xl bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-bold inline-flex items-center gap-2 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Create a video
              </button>
            </div>
          ) : (
            videoPosts.map((post) => (
              <article key={post.id} className="overflow-hidden rounded-2xl bg-slate-950 text-white border border-slate-200 dark:border-slate-800">
                <div className="w-full aspect-[9/12] max-h-[560px] bg-black flex items-center justify-center">
                  <video
                    src={post.imageData}
                    playsInline
                    controls
                    preload="metadata"
                    className="w-full h-full object-contain"
                  />
                </div>
                <div className="p-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => onViewAuthorStories(post.authorId)}
                      className="flex items-center gap-2.5 min-w-0 text-left cursor-pointer"
                    >
                      <Avatar name={post.authorName} photoURL={post.authorPhotoURL} size="sm" />
                      <span className="text-sm font-semibold truncate">{post.authorName}</span>
                      <span className="text-xs text-white/55 shrink-0">@{post.authorHandle}</span>
                    </button>
                    <span className="text-[11px] text-white/60 shrink-0">{formatConversationTime(post.createdAt)}</span>
                  </div>
                  {post.caption && <p className="mt-2 text-sm text-white/90 whitespace-pre-wrap break-words">{post.caption}</p>}
                  <div className="mt-2 flex items-center justify-between text-[11px] text-white/55">
                    <span className="inline-flex items-center gap-1"><Eye className="w-3 h-3" />{post.viewerIds.length} views</span>
                    <span>Expires after 24 hours</span>
                  </div>
                </div>
              </article>
            ))
          )}
        </div>

        <div className="border-t border-slate-200 dark:border-slate-800 pt-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">Stories</h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Photos and videos disappear after 24 hours</p>
            </div>
            <button
              type="button"
              onClick={onOpenCameraForStory}
              className="h-8 px-3 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> Add Story
            </button>
          </div>

          <div className="p-3 rounded-2xl bg-[#F4F6F9] dark:bg-[#0B0F17] border border-slate-200/70 dark:border-slate-800">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => myStories.length > 0 ? onViewAuthorStories(currentUser.uid) : onOpenCameraForStory()}
                className="flex items-center gap-3 min-w-0 text-left cursor-pointer"
              >
                <div className={`p-0.5 rounded-full ${myStories.length > 0 ? 'ring-2 ring-[#8B5CF6]' : ''}`}>
                  <Avatar name={currentUser.displayName} photoURL={currentUser.photoURL} avatarSeed={currentUser.avatarSeed} size="md" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">My Story</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {myStories.length > 0 ? `${myStories.length} active · Tap to view` : 'Share a 24-hour Snap'}
                  </p>
                </div>
              </button>
              <button type="button" onClick={onOpenCameraForStory} aria-label="Add to My Story" className="w-9 h-9 rounded-xl bg-white dark:bg-[#1A2232] border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-[#8B5CF6] flex items-center justify-center cursor-pointer">
                <Plus className="w-4 h-4" />
              </button>
            </div>

            {myStories.length > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-200/80 dark:border-slate-800 space-y-2">
                {myStories.map((story) => {
                  const viewerNames = story.viewerIds.map((uid) => profilesByUid[uid]?.displayName.split(' ')[0]).filter(Boolean).slice(0, 3);
                  const isVideo = story.mediaType === 'video' || story.imageData.startsWith('data:video');
                  return (
                    <div key={story.id} className="flex items-center justify-between gap-2 text-xs">
                      <button type="button" onClick={() => onViewAuthorStories(currentUser.uid)} className="flex items-center gap-2 min-w-0 text-left cursor-pointer">
                        <div className="w-8 h-10 rounded-lg overflow-hidden bg-slate-200 dark:bg-slate-800 shrink-0 flex items-center justify-center">
                          {isVideo ? <Video className="w-4 h-4 text-[#8B5CF6]" /> : <img src={story.imageData} alt="My story thumbnail" className="w-full h-full object-cover" />}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-slate-800 dark:text-slate-200 truncate">{story.caption || (isVideo ? 'Video Story' : 'Photo Story')}</p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1 font-mono-tabular truncate">
                            <Eye className="w-3 h-3 shrink-0" />
                            <span>{story.viewerIds.length}{viewerNames.length > 0 ? ` (${viewerNames.join(', ')})` : ''}</span>
                            <span>·</span><span>{formatConversationTime(story.createdAt)}</span>
                          </p>
                        </div>
                      </button>
                      <button type="button" onClick={() => void onDeleteStory(story.id)} aria-label="Delete story" className="w-8 h-8 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 text-slate-400 hover:text-rose-600 flex items-center justify-center cursor-pointer shrink-0">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="mt-4">
            <p className="px-1 pb-2 text-xs font-medium text-slate-400 dark:text-slate-500">Friends · 24h Stories</p>
            {friendGroups.length === 0 ? (
              <div className="px-4 py-7 text-center">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">No friend stories yet</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">When friends post to their Story, they appear here.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                {friendGroups.map((group) => {
                  const isVideo = group.latestStory.mediaType === 'video' || group.latestStory.imageData.startsWith('data:video');
                  return (
                    <button key={group.authorId} type="button" onClick={() => onViewAuthorStories(group.authorId)} className="group relative aspect-[3/4] rounded-2xl overflow-hidden bg-slate-900 border border-slate-200 dark:border-slate-800 text-left cursor-pointer">
                      {isVideo ? <video src={group.latestStory.imageData} muted playsInline className="w-full h-full object-cover" /> : <img src={group.latestStory.imageData} alt={group.authorName} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-transparent" />
                      <div className="absolute top-2.5 left-2.5">
                        <div className={`p-0.5 rounded-full ${group.hasUnviewed ? 'ring-2 ring-[#8B5CF6]' : 'ring-1 ring-white/40'}`}>
                          <Avatar name={group.authorName} photoURL={group.authorPhotoURL} size="sm" />
                        </div>
                      </div>
                      <div className="absolute bottom-2.5 left-2.5 right-2.5">
                        <p className="text-xs font-bold text-white truncate">{group.authorName}</p>
                        <p className="text-[11px] text-white/75 font-mono-tabular">{formatConversationTime(group.latestStory.createdAt)}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
