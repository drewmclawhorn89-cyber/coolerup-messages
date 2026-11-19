# Supabase video publishing setup

This migration creates a publicly readable Spotlight video feed and a public video bucket. Posting, editing, and deleting are restricted to authenticated Supabase users, and each user can only manage their own records and files. Published media is publicly accessible, so do not upload private or disappearing media to this bucket.

Apply the migration to the linked project with the Supabase CLI:

```sh
supabase db push
```

The repository's current frontend still uses Firebase Auth and Firestore. This migration provisions the Supabase database and storage policies only; it does not switch the frontend to Supabase or make Firebase-authenticated users authenticated in Supabase. The application must be migrated to Supabase Auth and use `spotlight_videos` plus the `spotlight-videos` bucket before users can post through the app. Do not put a database password or service-role key in the browser or commit either secret.
