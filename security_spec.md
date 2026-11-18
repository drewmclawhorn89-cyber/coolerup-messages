# CoolerUp Messages — Firestore Security Specification

## 1. Data Invariants
1. **Profile Isolation & Zero PII Leakage**: `/profiles/{profileId}` contains strictly non-PII public directory fields (`uid`, `displayName`, `handle`, `photoURL`, `statusText`, `isOnline`, `isDiscoverable`). Sensitive PII (`email`) is isolated in `/users/{userId}/private/info`, readable and writable solely by `request.auth.uid == userId`.
2. **Identity Integrity**: A user can only create or modify their own profile (`profileId == request.auth.uid`), their own private info (`userId == request.auth.uid`), and messages where `senderId == request.auth.uid`.
3. **Conversation Membership Gate**: Only verified users (`email_verified == true`) listed in `conversations/{conversationId}.memberIds` (bounded `1..20`) may read conversation metadata, list messages, update typing/read state in `members/{memberId}`, or react to messages.
4. **Atomic Inbox Sync (`existsAfter`)**: Creating a `/users/{userId}/chats/{conversationId}` entry for another user is permitted only when `userId` and `request.auth.uid` both exist in `/conversations/{conversationId}/members` via `existsAfter` or `exists`.
5. **Immutable Audit Fields & Server Time**: `id`, `conversationId`, `senderId`, `createdBy`, and `createdAt` are immutable after creation; `createdAt` and `updatedAt` must equal `request.time`.
6. **Reaction Isolation**: Any conversation member may update `reactions` on a message, but `incoming().reactions.diff(existing().reactions).affectedKeys().hasOnly([request.auth.uid])` restricts mutations strictly to the caller's own UID key.

## 2. "Dirty Dozen" Adversarial Payloads
1. **Shadow Field Injection on Profile**: Creating `/profiles/{uid}` with extra field `isAdmin: true` -> Rejected by `keys().hasOnly(...)`.
2. **PII Cross-User Read**: User B attempting `get` on `/users/{userA}/private/info` -> Rejected (`request.auth.uid == userId`).
3. **Unverified Email Write**: Unauthenticated or `email_verified: false` token creating a message -> Rejected (`isVerifiedUser()`).
4. **Sender Spoofing**: User A creating a message with `senderId: userB` -> Rejected (`incoming().senderId == request.auth.uid`).
5. **ID Poisoning**: Creating a document with a 2KB ID or `/` characters in `{conversationId}` -> Rejected (`isValidId()`).
6. **Unbounded Member Array (Denial of Wallet)**: Creating a conversation with 50 members in `memberIds` -> Rejected (`memberIds.size() <= 20`).
7. **Orphaned Message Creation**: Creating a message under a non-existent `conversationId` -> Rejected (`exists(...)` parent check).
8. **Cross-Member Reaction Forgery**: User B modifying User A's reaction key in `message.reactions` -> Rejected (`reactions.diff(...).affectedKeys().hasOnly([request.auth.uid])`).
9. **Unauthorized Message Edit**: User B editing `text` on User A's message -> Rejected (`existing().senderId == request.auth.uid`).
10. **Inbox Injection by Non-Member**: User C writing `/users/{userA}/chats/{convAB}` without being a member of `convAB` -> Rejected (`existsAfter(...)` / `isConversationMember`).
11. **Timestamp Forgery**: Creating a message with backdated `createdAt` != `request.time` -> Rejected.
12. **Blanket Directory Scraping on Private Docs**: Querying `/users/{userA}/chats` as User B -> Rejected (`allow list` requires `request.auth.uid == userId`).
