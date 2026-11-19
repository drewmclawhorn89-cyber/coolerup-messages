-- Public Spotlight video publishing on Supabase.
-- Public users can read published videos. Only authenticated users can create,
-- update, or delete their own records and storage objects.

create table if not exists public.spotlight_videos (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users (id) on delete cascade,
  author_name text not null check (char_length(author_name) between 1 and 80),
  author_handle text not null check (char_length(author_handle) between 2 and 40),
  author_photo_url text not null default '',
  video_path text not null,
  caption text not null default '' check (char_length(caption) <= 200),
  sound_title text not null default '',
  sound_track_id text not null default 'original',
  resolution text not null default '720p',
  view_count bigint not null default 0 check (view_count >= 0),
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint spotlight_videos_path_owned_by_author
    check (video_path like author_id::text || '/%')
);

create index if not exists spotlight_videos_public_created_idx
  on public.spotlight_videos (created_at desc)
  where is_public = true;

alter table public.spotlight_videos enable row level security;

drop policy if exists "Anyone can read published videos" on public.spotlight_videos;
create policy "Anyone can read published videos"
  on public.spotlight_videos for select
  using (is_public or (select auth.uid()) = author_id);

drop policy if exists "Authenticated users can publish their own videos" on public.spotlight_videos;
create policy "Authenticated users can publish their own videos"
  on public.spotlight_videos for insert
  to authenticated
  with check ((select auth.uid()) = author_id);

drop policy if exists "Authors can update their own videos" on public.spotlight_videos;
create policy "Authors can update their own videos"
  on public.spotlight_videos for update
  to authenticated
  using ((select auth.uid()) = author_id)
  with check ((select auth.uid()) = author_id);

drop policy if exists "Authors can delete their own videos" on public.spotlight_videos;
create policy "Authors can delete their own videos"
  on public.spotlight_videos for delete
  to authenticated
  using ((select auth.uid()) = author_id);

grant select on public.spotlight_videos to anon, authenticated;
grant insert, update, delete on public.spotlight_videos to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'spotlight-videos',
  'spotlight-videos',
  true,
  52428800,
  array['video/mp4', 'video/webm', 'video/quicktime']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Anyone can view published video files" on storage.objects;
create policy "Anyone can view published video files"
  on storage.objects for select
  using (bucket_id = 'spotlight-videos');

drop policy if exists "Users can upload videos to their own folder" on storage.objects;
create policy "Users can upload videos to their own folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'spotlight-videos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users can update videos in their own folder" on storage.objects;
create policy "Users can update videos in their own folder"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'spotlight-videos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'spotlight-videos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users can delete videos in their own folder" on storage.objects;
create policy "Users can delete videos in their own folder"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'spotlight-videos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'spotlight_videos'
  ) then
    alter publication supabase_realtime add table public.spotlight_videos;
  end if;
end
$$;
