# CoolerUp Messages — Firestore Security Specification

## 1. Data Invariants
1. **Profile Isolation & Zero PII Leakage**: `/profiles/{profileId}` contains strictly non-PII public directory fields (`uid`, `displayName`, `handle`, `photoURL`, `statusText`, `snapScore`, `trophies`, `ghostMode`, `lat`, `lng`, `locationLabel`, `followers`, `following`, `isOnline`, `isDiscoverable`). Sensitive PII (`email`, `birthday`, `phoneNumber`, `myEyesOnlyPinHash`, `blockedUids`, privacy preferences) is isolated strictly in `/users/{userId}/private/info`, readable and writable solely by `request.auth.uid == userId`.
2. **Identity Integrity**: A user can only create or modify their own profile (`profileId == request.auth.uid`), their own private info (`userId == request.auth.uid`), their own `/memories`, and messages where `senderId == request.auth.uid`. Spotlight follow updates by another user can only touch `followers` with strictly caller UID membership changes.
3. **Conversation Membership Gate**: Only verified users (`email_verified == true`) listed in `conversations/{conversationId}.memberIds` (bounded `1..20`) may read conversation metadata, list messages, update typing/read state in `members/{memberId}`, or react to messages.
4. **Atomic Inbox Sync (`existsAfter`)**: Creating a `/users/{userId}/chats/{conversationId}` entry for another user is permitted only when `userId` and `request.auth.uid` both exist in `/conversations/{conversationId}/members` via `existsAfter` or `exists`.
5. **Immutable Audit Fields & Server Time**: `id`, `conversationId`, `senderId`, `createdBy`, and `createdAt` are immutable after creation; `createdAt` and `updatedAt` must equal `request.time`.
6. **Memories & Notifications Isolation**: `/users/{userId}/memories/{memoryId}` is strictly owner-only (`isOwner(userId)`). `/users/{userId}/notifications/{notificationId}` is readable/updatable/deletable strictly by `isOwner(userId)`, while verified peers may create notifications only when `fromUserId == request.auth.uid`.
7. **Spotlight Comments & Safety Reports**: Spotlight comments live under `/spotlightVideos/{videoId}/comments/{commentId}` gated by parent existence (`exists(...)`) and immutable `authorId == request.auth.uid`. Safety reports in `/reports/{reportId}` are write-only (`allow read: if false`) with `reporterId == request.auth.uid`.

## 2. "Dirty Dozen" Adversarial Payloads
1. **Shadow Field Injection on Profile**: Creating `/profiles/{uid}` with extra field `isAdmin: true` -> Rejected by `keys().hasOnly(...)`.
2. **PII Cross-User Read**: User B attempting `get` on `/users/{userA}/private/info` -> Rejected (`request.auth.uid == userId`).
3. **Cross-User Memory Snooping**: User B attempting `get`/`list` on `/users/{userA}/memories` -> Rejected (`isOwner(userId)`).
4. **Notification Sender Spoofing**: User B creating a notification under `/users/{userA}/notifications` with `fromUserId: userC` -> Rejected (`incoming().fromUserId == request.auth.uid`).
5. **Follower Array Hijacking**: User B adding/removing arbitrary UIDs in User A's `profiles/{userA}.followers` -> Rejected (diff must only affect `followers` and only toggle caller UID).
6. **Unverified Email Write**: Unauthenticated or `email_verified: false` token creating a message or story -> Rejected (`isVerifiedUser()`).
7. **Sender Spoofing**: User A creating a message or Spotlight comment with `senderId`/`authorId: userB` -> Rejected (`== request.auth.uid`).
8. **ID Poisoning**: Creating a document with a 2KB ID or `/` characters -> Rejected (`isValidId()`).
9. **Unbounded Array (Denial of Wallet)**: Creating a conversation with 50 members or profile with 1000 followers -> Rejected (`size() <= MAX`).
10. **Orphaned Comment/Message Creation**: Creating a comment under a non-existent Spotlight video -> Rejected (`exists(...)` parent check).
11. **Report Reading / Tampering**: Any client attempting to read/update/delete `/reports/{reportId}` -> Rejected (`allow read, update, delete: if false`).
12. **Timestamp Forgery**: Creating a memory, notification, or message with backdated `createdAt != request.time` -> Rejected.
