import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  Bookmark,
  Camera,
  Check,
  CheckCheck,
  Flame,
  Hourglass,
  Image as ImageIcon,
  Info,
  Mic,
  Pencil,
  Reply,
  Search,
  Send,
  Smile,
  Square,
  Timer,
  Trash2,
  Volume2,
  X,
} from 'lucide-react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import {
  formatDayDivider,
  formatLastSeen,
  formatMessageTime,
  timestampToDate,
} from '../lib/dateFormat';
import { db, handleFirestoreError, isQuotaExceededError, OperationType } from '../lib/firebase';
import {
  bootstrapLocalSavedChat,
  cacheGet,
  cacheSet,
  subscribeLocalCacheKey,
} from '../lib/localFallbackStore';
import { getStreakStatus } from '../lib/snapUtils';
import { blobToBoundedDataUrl, compressImageToDataUrl, LIMITS } from '../lib/validation';
import {
  editMessage,
  markConversationRead,
  markSnapViewed,
  sendMessage,
  setTypingStatus,
  toggleMessageReaction,
  toggleSaveMessage,
  unsendMessage,
} from '../services/messengerService';
import {
  CHAT_THEMES,
  type Conversation,
  type ConversationMember,
  type Message,
  type PublicProfile,
  type UserChatIndex,
} from '../types/messenger';
import { Avatar } from './Avatar';

const REACTION_PALETTE = ['👍', '❤️', '😂', '😮', '😢', '🔥'];
const EMOJI_PICKER_GRID = [
  '😀', '😂', '🥹', '😍', '🤩', '😎', '🤔', '🙌',
  '👏', '👍', '❤️', '🔥', '✨', '🎉', '⚡', '💯',
  '👀', '🙏', '☕', '🚀', '💬', '📸', '👻', '✅',
];
const SNAP_STICKER_GRID = [
  '👻', '🔥', '💯', '👑', '⚡', '🥳', '🫶', '🚀',
  '📸', '💔', '🎉', '😎', '💥', '🌟', '🤙', '✨',
];

interface ChatWindowProps {
  conversationId: string;
  chatIndex: UserChatIndex | undefined;
  currentUser: PublicProfile;
  profilesByUid: Record<string, PublicProfile>;
  showDetails: boolean;
  onToggleDetails: () => void;
  onBackMobile: () => void;
  onOpenCameraForChat: (conversationId: string) => void;
  onOpenSnapViewer: (message: Message, conversation: Conversation) => void;
  onConversationLoaded: (conv: Conversation, members: ConversationMember[], messages: Message[]) => void;
  onOpenImageLightbox: (imageData: string) => void;
}

export function ChatWindow({
  conversationId,
  chatIndex,
  currentUser,
  profilesByUid,
  showDetails,
  onToggleDetails,
  onBackMobile,
  onOpenCameraForChat,
  onOpenSnapViewer,
  onConversationLoaded,
  onOpenImageLightbox,
}: ChatWindowProps) {
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [members, setMembers] = useState<ConversationMember[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  const [draftText, setDraftText] = useState('');
  const [pendingImage, setPendingImage] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [sending, setSending] = useState(false);

  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editingMsg, setEditingMsg] = useState<Message | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [pickerTab, setPickerTab] = useState<'emoji' | 'stickers'>('emoji');
  const [activeReactionTarget, setActiveReactionTarget] = useState<string | null>(null);
  const [tappedMsgId, setTappedMsgId] = useState<string | null>(null);

  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [voiceSeconds, setVoiceSeconds] = useState(0);

  const [showSearchBar, setShowSearchBar] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingSentRef = useRef(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    setDraftText('');
    setPendingImage('');
    setUploadError('');
    setReplyTo(null);
    setEditingMsg(null);
    setShowEmojiPicker(false);
    setActiveReactionTarget(null);
    setTappedMsgId(null);
    setShowSearchBar(false);
    setChatSearchQuery('');
    setIsAtBottom(true);
    setLoading(true);
    isTypingSentRef.current = false;
  }, [conversationId]);

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 4000);
    return () => clearInterval(id);
  }, []);

  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;

  useEffect(() => {
    const convPath = `conversations/${conversationId}`;
    const membersPath = `conversations/${conversationId}/members`;
    const messagesPath = `conversations/${conversationId}/messages`;

    let latestConv: Conversation | null = null;
    let latestMembers: ConversationMember[] = [];
    let latestMessages: Message[] = [];

    const syncParent = () => {
      if (latestConv) {
        onConversationLoaded(latestConv, latestMembers, latestMessages);
      }
    };

    let unsubLocalConv: (() => void) | null = null;
    let unsubLocalMembers: (() => void) | null = null;
    let unsubLocalMessages: (() => void) | null = null;

    const unsubConv = onSnapshot(
      doc(db, 'conversations', conversationId),
      (snap) => {
        if (snap.exists()) {
          latestConv = snap.data() as Conversation;
          setConversation(latestConv);
          void cacheSet(`conv_${conversationId}`, latestConv);
          syncParent();
        } else {
          setConversation(null);
        }
        setLoading(false);
      },
      (error) => {
        if (isQuotaExceededError(error)) {
          void (async () => {
            if (conversationId === `saved_${currentUserRef.current.uid}`) {
              await bootstrapLocalSavedChat(currentUserRef.current);
            }
            const cached = await cacheGet<Conversation>(`conv_${conversationId}`);
            if (cached) {
              latestConv = cached;
              setConversation(cached);
              syncParent();
            }
            setLoading(false);
          })();
          unsubLocalConv = subscribeLocalCacheKey<Conversation>(`conv_${conversationId}`, (cached) => {
            if (cached) {
              latestConv = cached;
              setConversation(cached);
              syncParent();
              setLoading(false);
            }
          });
          return;
        }
        handleFirestoreError(error, OperationType.GET, convPath);
      }
    );

    const membersQuery = query(
      collection(db, 'conversations', conversationId, 'members'),
      where('memberIds', 'array-contains', currentUser.uid)
    );
    const unsubMembers = onSnapshot(
      membersQuery,
      (snap) => {
        latestMembers = snap.docs.map((d) => d.data() as ConversationMember);
        setMembers(latestMembers);
        void cacheSet(`members_${conversationId}`, latestMembers);
        syncParent();
      },
      (error) => {
        if (isQuotaExceededError(error)) {
          unsubLocalMembers = subscribeLocalCacheKey<ConversationMember[]>(
            `members_${conversationId}`,
            (cached) => {
              if (cached) {
                latestMembers = cached;
                setMembers(cached);
                syncParent();
              }
            }
          );
          return;
        }
        handleFirestoreError(error, OperationType.LIST, membersPath);
      }
    );

    const messagesQuery = query(
      collection(db, 'conversations', conversationId, 'messages'),
      where('memberIds', 'array-contains', currentUser.uid)
    );
    const unsubMessages = onSnapshot(
      messagesQuery,
      (snap) => {
        const list = snap.docs
          .map((d) => d.data() as Message)
          .sort((a, b) => {
            const aMs = a.createdAt?.toMillis?.() ?? Date.now();
            const bMs = b.createdAt?.toMillis?.() ?? Date.now();
            return aMs - bMs;
          });
        latestMessages = list;
        setMessages(list);
        void cacheSet(`messages_${conversationId}`, list);
        syncParent();
      },
      (error) => {
        if (isQuotaExceededError(error)) {
          unsubLocalMessages = subscribeLocalCacheKey<Message[]>(
            `messages_${conversationId}`,
            (cached) => {
              if (cached) {
                const sorted = [...cached].sort((a, b) => {
                  const aMs = a.createdAt?.toMillis?.() ?? Date.now();
                  const bMs = b.createdAt?.toMillis?.() ?? Date.now();
                  return aMs - bMs;
                });
                latestMessages = sorted;
                setMessages(sorted);
                syncParent();
              }
            }
          );
          return;
        }
        handleFirestoreError(error, OperationType.LIST, messagesPath);
      }
    );

    return () => {
      unsubConv();
      unsubMembers();
      unsubMessages();
      unsubLocalConv?.();
      unsubLocalMembers?.();
      unsubLocalMessages?.();
    };
  }, [conversationId, currentUser.uid, onConversationLoaded]);

  const lastMarkedReadKeyRef = useRef<string>('');

  useEffect(() => {
    if (!conversation) return;
    if (chatIndex && chatIndex.unreadCount > 0) {
      const key = `${conversationId}:${chatIndex.unreadCount}:${messages.length}`;
      if (lastMarkedReadKeyRef.current === key) return;
      lastMarkedReadKeyRef.current = key;
      void markConversationRead(conversationId, currentUser.uid);
    }
  }, [conversationId, currentUser.uid, conversation, chatIndex, messages.length]);

  useEffect(() => {
    if (isAtBottom && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [messages.length, isAtBottom]);

  useEffect(() => {
    return () => {
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
      }
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
      }
      voiceStreamRef.current?.getTracks().forEach((t) => t.stop());
      if (isTypingSentRef.current) {
        void setTypingStatus(conversationId, currentUser.uid, false);
      }
    };
  }, [conversationId, currentUser.uid]);

  useEffect(() => {
    if (!isRecordingVoice) {
      setVoiceSeconds(0);
      return;
    }
    const id = setInterval(() => {
      setVoiceSeconds((s) => {
        if (s >= 29) {
          voiceRecorderRef.current?.stop();
          return 30;
        }
        return s + 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [isRecordingVoice]);

  const theme = CHAT_THEMES[conversation?.themeId || chatIndex?.themeId || 'azure'];
  const isSaved = conversationId === `saved_${currentUser.uid}`;
  const peerUid =
    chatIndex?.peerUid ||
    conversation?.memberIds.find((id) => id !== currentUser.uid) ||
    '';
  const peerProfile = peerUid ? profilesByUid[peerUid] : undefined;

  const headerTitle = isSaved
    ? 'Saved Snaps'
    : conversation?.type === 'group'
    ? conversation.title
    : peerProfile?.displayName || chatIndex?.title || conversation?.title || 'Chat';

  const typingMembers = useMemo(() => {
    return members.filter((m) => {
      if (m.uid === currentUser.uid) return false;
      if (!m.isTyping) return false;
      const typedAt = timestampToDate(m.typingAt);
      if (!typedAt) return false;
      return nowTick - typedAt.getTime() < 12000;
    });
  }, [members, currentUser.uid, nowTick]);

  const headerSubtitle = useMemo(() => {
    if (typingMembers.length > 0) {
      const names = typingMembers.map((m) => m.displayName.split(' ')[0]);
      return names.length === 1 ? `${names[0]} is typing...` : `${names.join(', ')} are typing...`;
    }
    if (isSaved) return 'Private Snaps, notes, and media';
    if (conversation?.type === 'group') {
      return `${conversation.memberIds.length} members`;
    }
    if (peerProfile) {
      return formatLastSeen(peerProfile.isOnline, peerProfile.lastSeenAt);
    }
    return 'Direct chat';
  }, [typingMembers, isSaved, conversation, peerProfile]);

  const visibleMessages = useMemo(() => {
    const q = chatSearchQuery.trim().toLowerCase();
    const dayMs = 24 * 60 * 60 * 1000;
    return messages.filter((m) => {
      // Unsaved messages in non-Saved chats disappear after 24 hours
      if (!isSaved && (m.savedBy || []).length === 0) {
        const createdMs = m.createdAt?.toMillis?.();
        if (createdMs && nowTick - createdMs > dayMs) {
          return false;
        }
      }
      if (!q) return true;
      return !m.deleted && m.text.toLowerCase().includes(q);
    });
  }, [messages, chatSearchQuery, isSaved, nowTick]);

  const latestOwnMsgId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].senderId === currentUser.uid && !messages[i].deleted) {
        return messages[i].id;
      }
    }
    return null;
  }, [messages, currentUser.uid]);

  const readersOfLatestOwn = useMemo(() => {
    if (!latestOwnMsgId) return [];
    const latestMsg = messages.find((m) => m.id === latestOwnMsgId);
    const msgMs = latestMsg?.createdAt?.toMillis?.() ?? 0;
    if (!msgMs) return [];

    return members.filter((m) => {
      if (m.uid === currentUser.uid) return false;
      const readMs = m.lastReadAt?.toMillis?.() ?? 0;
      return readMs >= msgMs;
    });
  }, [latestOwnMsgId, messages, members, currentUser.uid]);

  const handleDraftChange = (value: string) => {
    setDraftText(value);
    if (!conversation || editingMsg || isSaved) return;

    const hasContent = value.trim().length > 0;
    if (hasContent && !isTypingSentRef.current) {
      isTypingSentRef.current = true;
      void setTypingStatus(conversationId, currentUser.uid, true);
    }
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
    }
    if (hasContent) {
      typingTimerRef.current = setTimeout(() => {
        isTypingSentRef.current = false;
        void setTypingStatus(conversationId, currentUser.uid, false);
      }, 4500);
    } else if (isTypingSentRef.current) {
      isTypingSentRef.current = false;
      void setTypingStatus(conversationId, currentUser.uid, false);
    }
  };

  const handleSelectImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadError('');
    try {
      const compressed = await compressImageToDataUrl(file);
      setPendingImage(compressed);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Unable to attach image.');
    }
  };

  const handleSend = async () => {
    if (!conversation || sending) return;
    const trimmed = draftText.trim();

    if (editingMsg) {
      if (!trimmed) return;
      setSending(true);
      try {
        const isLatest = messages[messages.length - 1]?.id === editingMsg.id;
        await editMessage(conversation, editingMsg.id, trimmed, isLatest);
        setEditingMsg(null);
        setDraftText('');
      } finally {
        setSending(false);
      }
      return;
    }

    if (!trimmed && !pendingImage) return;

    setSending(true);
    isTypingSentRef.current = false;
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);

    try {
      await sendMessage({
        conversation,
        sender: currentUser,
        kind: pendingImage ? 'image' : 'text',
        text: trimmed,
        imageData: pendingImage,
        replyTo: replyTo
          ? {
              id: replyTo.id,
              senderName: replyTo.senderName,
              text: replyTo.text || (replyTo.imageData ? 'Photo' : ''),
            }
          : null,
      });
      setDraftText('');
      setPendingImage('');
      setReplyTo(null);
      setShowEmojiPicker(false);
      setIsAtBottom(true);
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  };

  const handleSendQuickEmoji = async () => {
    if (!conversation || sending) return;
    setSending(true);
    try {
      await sendMessage({
        conversation,
        sender: currentUser,
        kind: 'sticker',
        text: conversation.quickEmoji || '👻',
      });
      setIsAtBottom(true);
    } finally {
      setSending(false);
    }
  };

  const handleSendSticker = async (sticker: string) => {
    if (!conversation || sending) return;
    setSending(true);
    try {
      await sendMessage({
        conversation,
        sender: currentUser,
        kind: 'sticker',
        text: sticker,
      });
      setShowEmojiPicker(false);
      setIsAtBottom(true);
    } finally {
      setSending(false);
    }
  };

  const handleToggleVoiceNote = async () => {
    if (!conversation) return;
    if (isRecordingVoice) {
      voiceRecorderRef.current?.stop();
      return;
    }

    setUploadError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        setUploadError('Voice notes are not supported in this browser.');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceStreamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : '';
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32000 })
        : new MediaRecorder(stream, { audioBitsPerSecond: 32000 });
      voiceRecorderRef.current = recorder;

      const chunks: BlobPart[] = [];
      const startedAt = Date.now();
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunks.push(ev.data);
      };
      recorder.onstop = async () => {
        setIsRecordingVoice(false);
        stream.getTracks().forEach((t) => t.stop());
        voiceStreamRef.current = null;
        const durationSec = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size < 400) return;
        try {
          const dataUrl = await blobToBoundedDataUrl(blob);
          setSending(true);
          await sendMessage({
            conversation,
            sender: currentUser,
            kind: 'voice',
            mediaType: 'audio',
            text: `${durationSec}s voice note`,
            imageData: dataUrl,
          });
          setIsAtBottom(true);
        } catch (err) {
          setUploadError(err instanceof Error ? err.message : 'Unable to send voice note.');
        } finally {
          setSending(false);
        }
      };

      setIsRecordingVoice(true);
      recorder.start(250);
    } catch {
      setUploadError('Microphone permission is needed for voice notes.');
      setIsRecordingVoice(false);
    }
  };

  const handleOpenSnap = async (msg: Message) => {
    if (!conversation) return;
    if (!msg.imageData) {
      setUploadError('This Snap has already been viewed and deleted.');
      setTimeout(() => setUploadError(''), 2400);
      return;
    }
    onOpenSnapViewer(msg, conversation);
    if (!msg.snapViewedBy?.includes(currentUser.uid)) {
      await markSnapViewed(conversation, msg, currentUser.uid);
    }
  };

  const startLongPress = (msg: Message) => {
    if (msg.deleted || msg.kind === 'snap') return;
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      void toggleSaveMessage(
        conversationId,
        msg.id,
        currentUser.uid,
        msg.savedBy || []
      );
    }, 450);
  };

  const cancelLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setIsAtBottom(distanceFromBottom < 80);
  };

  const scrollToBottom = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior: 'smooth',
      });
      setIsAtBottom(true);
    }
  };

  const streak = getStreakStatus(conversation?.streakCount, conversation?.lastSnapAt);

  if (loading && !conversation) {
    return (
      <div className="flex-1 flex flex-col h-full bg-white dark:bg-[#0B0F17]">
        <div className="h-16 px-5 border-b border-slate-200 dark:border-slate-800 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-800 animate-pulse" />
          <div className="space-y-1.5">
            <div className="w-32 h-3.5 rounded bg-slate-200 dark:bg-slate-800 animate-pulse" />
            <div className="w-20 h-2.5 rounded bg-slate-100 dark:bg-slate-800/60 animate-pulse" />
          </div>
        </div>
        <div className="flex-1 p-6 space-y-4">
          <div className="w-48 h-10 rounded-2xl bg-slate-100 dark:bg-slate-800/60 animate-pulse" />
          <div className="w-64 h-12 rounded-2xl bg-slate-200/70 dark:bg-slate-800 animate-pulse ml-auto" />
        </div>
      </div>
    );
  }

  return (
    <main className="flex-1 flex flex-col h-full min-w-0 bg-white dark:bg-[#0B0F17] relative">
      {/* Top Chat Header */}
      <header className="h-16 px-4 sm:px-5 border-b border-slate-200 dark:border-slate-800/80 flex items-center justify-between gap-3 shrink-0 bg-white/95 dark:bg-[#0B0F17]/95 backdrop-blur-sm">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBackMobile}
            aria-label="Back to chats"
            className="md:hidden min-w-[40px] min-h-[40px] -ml-1 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <Avatar
            name={headerTitle}
            photoURL={peerProfile?.photoURL || chatIndex?.photoURL}
            avatarSeed={peerProfile?.avatarSeed}
            size="md"
            isOnline={Boolean(peerProfile?.isOnline)}
            isGroup={conversation?.type === 'group'}
            isSaved={isSaved}
          />

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate">
                {headerTitle}
              </h2>
              {streak.active && (
                <span
                  title={
                    streak.hourglass
                      ? 'Snap soon before your streak expires!'
                      : `${streak.count}-day Snapstreak`
                  }
                  className="inline-flex items-center gap-0.5 text-xs font-semibold font-mono-tabular text-amber-500 shrink-0"
                >
                  <Flame className="w-3.5 h-3.5 fill-amber-500" />
                  <span>{streak.count}</span>
                  {streak.hourglass && (
                    <Hourglass className="w-3.5 h-3.5 text-orange-500 animate-pulse" />
                  )}
                </span>
              )}
            </div>
            <p
              className={`text-xs truncate ${
                typingMembers.length > 0
                  ? theme.accentText + ' font-medium'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              {headerSubtitle}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              setShowSearchBar((v) => !v);
              setChatSearchQuery('');
            }}
            title="Search in chat"
            aria-label="Search in chat"
            className={`min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center transition-colors cursor-pointer ${
              showSearchBar
                ? theme.accentBgSoft + ' ' + theme.accentText
                : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Search className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={onToggleDetails}
            title="Chat details"
            aria-label="Toggle chat details"
            className={`min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center transition-colors cursor-pointer ${
              showDetails
                ? theme.accentBgSoft + ' ' + theme.accentText
                : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Info className="w-4 h-4" />
          </button>
        </div>
      </header>

      {showSearchBar && (
        <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-800 bg-[#F4F6F9] dark:bg-[#121824] flex items-center gap-2 shrink-0">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            type="text"
            value={chatSearchQuery}
            onChange={(e) => setChatSearchQuery(e.target.value)}
            placeholder="Search saved messages in this chat..."
            autoFocus
            className="flex-1 bg-transparent text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 outline-none"
          />
          {chatSearchQuery && (
            <span className="text-xs font-mono-tabular text-slate-500 dark:text-slate-400 shrink-0">
              {visibleMessages.length} found
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              setShowSearchBar(false);
              setChatSearchQuery('');
            }}
            className="text-xs font-medium text-slate-500 hover:text-slate-900 dark:hover:text-white px-2 py-1 cursor-pointer"
          >
            Done
          </button>
        </div>
      )}

      {/* Message Stream */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto chat-scroll px-4 sm:px-6 py-5 space-y-1"
      >
        {!isSaved && visibleMessages.length > 0 && (
          <div className="flex justify-center pb-2">
            <span className="text-[11px] text-slate-400 dark:text-slate-500 text-center">
              Chats disappear after 24 hours · Long-press a message to Save in Chat
            </span>
          </div>
        )}
        {visibleMessages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-sm mx-auto py-12">
            <Avatar
              name={headerTitle}
              photoURL={peerProfile?.photoURL || chatIndex?.photoURL}
              avatarSeed={peerProfile?.avatarSeed}
              size="xl"
              isOnline={Boolean(peerProfile?.isOnline)}
              isGroup={conversation?.type === 'group'}
              isSaved={isSaved}
            />
            <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white mt-4">
              {headerTitle}
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 mb-5 leading-relaxed">
              {chatSearchQuery
                ? 'No messages match your search.'
                : isSaved
                ? 'Keep Snaps, notes, photos, and reminders here forever.'
                : 'Snaps delete after viewing and unsaved chats disappear after 24 hours.'}
            </p>
            {!chatSearchQuery && (
              <button
                type="button"
                onClick={() => onOpenCameraForChat(conversationId)}
                className="h-10 px-5 rounded-xl bg-[#FFFC00] hover:bg-[#F5E600] text-slate-950 text-xs font-bold flex items-center gap-2 cursor-pointer"
              >
                <Camera className="w-4 h-4" />
                <span>Send a Snap</span>
              </button>
            )}
          </div>
        ) : (
          visibleMessages.map((msg, idx) => {
            const prev = idx > 0 ? visibleMessages[idx - 1] : null;
            const next = idx < visibleMessages.length - 1 ? visibleMessages[idx + 1] : null;

            const isOwn = msg.senderId === currentUser.uid;
            const prevDay = formatDayDivider(prev?.createdAt);
            const currDay = formatDayDivider(msg.createdAt);
            const showDayDivider = currDay && currDay !== prevDay;

            const sameSenderAsPrev =
              !showDayDivider &&
              prev &&
              prev.senderId === msg.senderId &&
              (msg.createdAt?.toMillis?.() ?? 0) - (prev.createdAt?.toMillis?.() ?? 0) < 180000;

            const sameSenderAsNext =
              next &&
              formatDayDivider(next.createdAt) === currDay &&
              next.senderId === msg.senderId &&
              (next.createdAt?.toMillis?.() ?? 0) - (msg.createdAt?.toMillis?.() ?? 0) < 180000;

            const isSticker =
              !msg.deleted &&
              msg.kind === 'sticker' &&
              !msg.imageData &&
              msg.text.trim().length <= 4;

            const isSnap = !msg.deleted && msg.kind === 'snap';
            const isVideoSnap = msg.mediaType === 'video';
            const isVoice = !msg.deleted && msg.kind === 'voice';
            const viewedByMe = msg.snapViewedBy?.includes(currentUser.uid) ?? false;
            const viewedByOther = (msg.snapViewedBy || []).some((id) => id !== currentUser.uid);
            const snapExpiredMedia = isSnap && !msg.imageData;
            const isSavedInChat = (msg.savedBy || []).length > 0;

            const reactionEntries = Object.entries(msg.reactions || {});
            const reactionCounts = reactionEntries.reduce<Record<string, number>>(
              (acc, [, emoji]) => {
                acc[emoji] = (acc[emoji] || 0) + 1;
                return acc;
              },
              {}
            );
            const myReaction = msg.reactions?.[currentUser.uid];

            const ownRounding = sameSenderAsPrev
              ? sameSenderAsNext
                ? 'rounded-2xl rounded-r-md'
                : 'rounded-2xl rounded-tr-md'
              : sameSenderAsNext
              ? 'rounded-2xl rounded-br-md'
              : 'rounded-2xl';

            const peerRounding = sameSenderAsPrev
              ? sameSenderAsNext
                ? 'rounded-2xl rounded-l-md'
                : 'rounded-2xl rounded-tl-md'
              : sameSenderAsNext
              ? 'rounded-2xl rounded-bl-md'
              : 'rounded-2xl';

            const senderProfile = profilesByUid[msg.senderId];

            return (
              <div key={msg.id}>
                {showDayDivider && (
                  <div className="flex items-center justify-center my-5">
                    <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
                      {currDay}
                    </span>
                  </div>
                )}

                <div
                  className={`group flex items-end gap-2 ${
                    isOwn ? 'justify-end' : 'justify-start'
                  } ${sameSenderAsPrev ? 'mt-0.5' : 'mt-3'}`}
                >
                  {!isOwn && (
                    <div className="w-7 shrink-0">
                      {!sameSenderAsNext && (
                        <Avatar
                          name={senderProfile?.displayName || msg.senderName}
                          photoURL={senderProfile?.photoURL || msg.senderPhotoURL}
                          avatarSeed={senderProfile?.avatarSeed}
                          size="xs"
                        />
                      )}
                    </div>
                  )}

                  {/* Own hover action controls */}
                  {isOwn && !msg.deleted && !isSnap && (
                    <div className="hidden sm:flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0 mb-1">
                      <button
                        type="button"
                        title="Save in chat"
                        onClick={() =>
                          void toggleSaveMessage(
                            conversationId,
                            msg.id,
                            currentUser.uid,
                            msg.savedBy || []
                          )
                        }
                        className={`w-7 h-7 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center cursor-pointer ${
                          isSavedInChat
                            ? 'text-amber-500'
                            : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                        }`}
                      >
                        <Bookmark className={`w-3.5 h-3.5 ${isSavedInChat ? 'fill-amber-500' : ''}`} />
                      </button>
                      <button
                        type="button"
                        title="React"
                        onClick={() =>
                          setActiveReactionTarget((prevId) =>
                            prevId === msg.id ? null : msg.id
                          )
                        }
                        className="w-7 h-7 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 flex items-center justify-center cursor-pointer"
                      >
                        <Smile className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Reply"
                        onClick={() => {
                          setEditingMsg(null);
                          setReplyTo(msg);
                          textareaRef.current?.focus();
                        }}
                        className="w-7 h-7 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 flex items-center justify-center cursor-pointer"
                      >
                        <Reply className="w-3.5 h-3.5" />
                      </button>
                      {msg.kind === 'text' && (
                        <button
                          type="button"
                          title="Edit"
                          onClick={() => {
                            setReplyTo(null);
                            setEditingMsg(msg);
                            setDraftText(msg.text);
                            textareaRef.current?.focus();
                          }}
                          className="w-7 h-7 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 flex items-center justify-center cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        title="Unsend"
                        onClick={() => {
                          if (!conversation) return;
                          const isLatest = messages[messages.length - 1]?.id === msg.id;
                          void unsendMessage(conversation, msg.id, isLatest);
                        }}
                        className="w-7 h-7 rounded-full hover:bg-rose-50 dark:hover:bg-rose-950/50 text-slate-400 hover:text-rose-600 flex items-center justify-center cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  {/* Message Column */}
                  <div
                    className={`relative max-w-[76%] sm:max-w-[65%] flex flex-col ${
                      isOwn ? 'items-end' : 'items-start'
                    }`}
                  >
                    {!isOwn && conversation?.type === 'group' && !sameSenderAsPrev && (
                      <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 ml-3 mb-1">
                        {senderProfile?.displayName || msg.senderName}
                      </span>
                    )}

                    {activeReactionTarget === msg.id && !msg.deleted && (
                      <div
                        className={`absolute -top-11 z-20 flex items-center gap-1 px-2 py-1 rounded-full bg-white dark:bg-[#1A2232] border border-slate-200 dark:border-slate-700 shadow-lg ${
                          isOwn ? 'right-0' : 'left-0'
                        }`}
                      >
                        {REACTION_PALETTE.map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => {
                              void toggleMessageReaction(
                                conversationId,
                                msg.id,
                                currentUser.uid,
                                emoji,
                                msg.reactions || {}
                              );
                              setActiveReactionTarget(null);
                            }}
                            className={`w-7 h-7 rounded-full text-base flex items-center justify-center hover:scale-125 transition-transform cursor-pointer ${
                              myReaction === emoji ? 'bg-[#00A6FF]/15' : ''
                            }`}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    )}

                    {msg.replyToId && !msg.deleted && (
                      <div className="mb-1 px-3 py-1.5 rounded-xl text-xs max-w-full bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300">
                        <p className="font-semibold text-[11px] text-slate-700 dark:text-slate-200 truncate">
                          Replying to {msg.replyToSenderName}
                        </p>
                        <p className="truncate opacity-80">{msg.replyToText}</p>
                      </div>
                    )}

                    {/* Bubble Body */}
                    {msg.deleted ? (
                      <div className="px-3.5 py-2 rounded-2xl border border-slate-200 dark:border-slate-800 text-xs italic text-slate-400 dark:text-slate-500">
                        {isOwn ? 'You unsent a message' : `${msg.senderName.split(' ')[0]} unsent a message`}
                      </div>
                    ) : isSnap ? (
                      /* Interactive Disappearing Snap Card (Red = photo, Purple = video) */
                      <button
                        type="button"
                        onClick={() => void handleOpenSnap(msg)}
                        className={`px-4 py-2.5 rounded-2xl flex items-center gap-2.5 text-left transition-transform active:scale-98 cursor-pointer ${
                          isOwn
                            ? isVideoSnap
                              ? 'border border-violet-300 dark:border-violet-800 bg-violet-50/70 dark:bg-violet-950/25 text-violet-700 dark:text-violet-300'
                              : 'border border-rose-300 dark:border-rose-800 bg-rose-50/70 dark:bg-rose-950/25 text-rose-700 dark:text-rose-300'
                            : !viewedByMe && !snapExpiredMedia
                            ? isVideoSnap
                              ? 'bg-[#8B5CF6] hover:bg-[#7C3AED] text-white shadow-xs'
                              : 'bg-[#F43F5E] hover:bg-[#E11D48] text-white shadow-xs'
                            : isVideoSnap
                            ? 'border border-violet-200 dark:border-violet-900 bg-white dark:bg-[#121824] text-slate-600 dark:text-slate-300'
                            : 'border border-rose-200 dark:border-rose-900 bg-white dark:bg-[#121824] text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {isOwn ? (
                          <Send
                            className={`w-4 h-4 shrink-0 ${
                              isVideoSnap
                                ? viewedByOther
                                  ? 'text-violet-400'
                                  : 'text-violet-500 fill-violet-500'
                                : viewedByOther
                                ? 'text-rose-400'
                                : 'text-rose-500 fill-rose-500'
                            }`}
                          />
                        ) : (
                          <Square
                            className={`w-4 h-4 shrink-0 ${
                              !viewedByMe && !snapExpiredMedia
                                ? 'text-white fill-white'
                                : isVideoSnap
                                ? 'text-violet-500'
                                : 'text-rose-500'
                            }`}
                          />
                        )}
                        <div className="min-w-0">
                          <p className="text-xs font-bold leading-tight">
                            {isOwn
                              ? msg.snapStatus === 'screenshotted'
                                ? 'Screenshotted!'
                                : msg.snapStatus === 'replayed'
                                ? 'Replayed'
                                : viewedByOther
                                ? 'Opened'
                                : 'Delivered'
                              : !viewedByMe && !snapExpiredMedia
                              ? isVideoSnap
                                ? 'New Video Snap · Tap to view'
                                : 'New Snap · Tap to view'
                              : msg.snapStatus === 'screenshotted'
                              ? 'Screenshotted · Deleted'
                              : msg.snapStatus === 'replayed'
                              ? 'Replayed · Deleted'
                              : snapExpiredMedia
                              ? 'Opened · Deleted'
                              : 'Opened Snap · Tap to view'}
                          </p>
                          {msg.snapDurationSec && msg.snapDurationSec < 90 ? (
                            <p
                              className={`text-[10px] font-mono-tabular mt-0.5 flex items-center gap-1 ${
                                !isOwn && !viewedByMe && !snapExpiredMedia
                                  ? 'text-white/85'
                                  : 'text-slate-400 dark:text-slate-500'
                              }`}
                            >
                              <Timer className="w-2.5 h-2.5" />
                              <span>{msg.snapDurationSec}s</span>
                            </p>
                          ) : null}
                        </div>
                      </button>
                    ) : isVoice ? (
                      <div
                        onPointerDown={() => startLongPress(msg)}
                        onPointerUp={cancelLongPress}
                        onPointerLeave={cancelLongPress}
                        onPointerCancel={cancelLongPress}
                        onClick={() =>
                          setTappedMsgId((prevId) => (prevId === msg.id ? null : msg.id))
                        }
                        className={`px-3.5 py-2.5 ${
                          isOwn
                            ? `${theme.bubbleBg} ${theme.bubbleText} ${ownRounding}`
                            : `bg-[#F1F3F7] dark:bg-[#192231] text-slate-900 dark:text-slate-100 ${peerRounding}`
                        } ${
                          isSavedInChat
                            ? 'ring-2 ring-amber-400/70 dark:ring-amber-500/60'
                            : ''
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <Volume2 className="w-4 h-4 shrink-0" />
                          <span className="text-xs font-semibold">
                            {msg.text || 'Voice Note'}
                          </span>
                        </div>
                        {msg.imageData && (
                          <audio
                            controls
                            src={msg.imageData}
                            onClick={(e) => e.stopPropagation()}
                            className="h-8 max-w-[220px]"
                          />
                        )}
                      </div>
                    ) : isSticker ? (
                      <button
                        type="button"
                        onPointerDown={() => startLongPress(msg)}
                        onPointerUp={cancelLongPress}
                        onPointerLeave={cancelLongPress}
                        onPointerCancel={cancelLongPress}
                        onDoubleClick={() =>
                          void toggleMessageReaction(
                            conversationId,
                            msg.id,
                            currentUser.uid,
                            '❤️',
                            msg.reactions || {}
                          )
                        }
                        className="text-4xl leading-none py-1 px-1 select-none cursor-default"
                        title={formatMessageTime(msg.createdAt)}
                      >
                        {msg.text}
                      </button>
                    ) : (
                      <div
                        onPointerDown={() => startLongPress(msg)}
                        onPointerUp={cancelLongPress}
                        onPointerLeave={cancelLongPress}
                        onPointerCancel={cancelLongPress}
                        onClick={() =>
                          setTappedMsgId((prevId) => (prevId === msg.id ? null : msg.id))
                        }
                        onDoubleClick={() =>
                          void toggleMessageReaction(
                            conversationId,
                            msg.id,
                            currentUser.uid,
                            '❤️',
                            msg.reactions || {}
                          )
                        }
                        className={`overflow-hidden select-none sm:select-text ${
                          isOwn
                            ? `${theme.bubbleBg} ${theme.bubbleText} ${ownRounding}`
                            : `bg-[#F1F3F7] dark:bg-[#192231] text-slate-900 dark:text-slate-100 ${peerRounding}`
                        } ${
                          isSavedInChat
                            ? 'ring-2 ring-amber-400/70 dark:ring-amber-500/60'
                            : ''
                        }`}
                      >
                        {msg.imageData && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenImageLightbox(msg.imageData);
                            }}
                            className="block max-w-[280px] sm:max-w-[320px] cursor-pointer"
                          >
                            <img
                              src={msg.imageData}
                              alt="Shared attachment"
                              referrerPolicy="no-referrer"
                              className="w-full max-h-[320px] object-cover block"
                            />
                          </button>
                        )}

                        {msg.text && (
                          <p className="px-3.5 py-2 text-[14.5px] leading-relaxed whitespace-pre-wrap break-words">
                            {msg.text}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Mobile Tap Action Strip */}
                    {tappedMsgId === msg.id && !msg.deleted && !isSnap && (
                      <div className="sm:hidden flex items-center gap-1 mt-1.5 px-2 py-1 rounded-xl bg-white dark:bg-[#1A2232] border border-slate-200 dark:border-slate-700 shadow-xs">
                        <button
                          type="button"
                          onClick={() => {
                            setTappedMsgId(null);
                            void toggleSaveMessage(
                              conversationId,
                              msg.id,
                              currentUser.uid,
                              msg.savedBy || []
                            );
                          }}
                          className="h-8 px-2 rounded-lg text-xs text-slate-600 dark:text-slate-300 flex items-center gap-1 cursor-pointer"
                        >
                          <Bookmark className={`w-3.5 h-3.5 ${isSavedInChat ? 'fill-amber-500 text-amber-500' : ''}`} />
                          <span>{isSavedInChat ? 'Saved' : 'Save'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setActiveReactionTarget((prevId) =>
                              prevId === msg.id ? null : msg.id
                            )
                          }
                          className="h-8 px-2 rounded-lg text-xs text-slate-600 dark:text-slate-300 flex items-center gap-1 cursor-pointer"
                        >
                          <Smile className="w-3.5 h-3.5" />
                          <span>React</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingMsg(null);
                            setReplyTo(msg);
                            setTappedMsgId(null);
                            textareaRef.current?.focus();
                          }}
                          className="h-8 px-2 rounded-lg text-xs text-slate-600 dark:text-slate-300 flex items-center gap-1 cursor-pointer"
                        >
                          <Reply className="w-3.5 h-3.5" />
                          <span>Reply</span>
                        </button>
                        {isOwn && msg.kind === 'text' && (
                          <button
                            type="button"
                            onClick={() => {
                              setReplyTo(null);
                              setEditingMsg(msg);
                              setDraftText(msg.text);
                              setTappedMsgId(null);
                              textareaRef.current?.focus();
                            }}
                            className="h-8 px-2 rounded-lg text-xs text-slate-600 dark:text-slate-300 flex items-center gap-1 cursor-pointer"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            <span>Edit</span>
                          </button>
                        )}
                        {isOwn && (
                          <button
                            type="button"
                            onClick={() => {
                              if (!conversation) return;
                              const isLatest = messages[messages.length - 1]?.id === msg.id;
                              setTappedMsgId(null);
                              void unsendMessage(conversation, msg.id, isLatest);
                            }}
                            className="h-8 px-2 rounded-lg text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Unsend</span>
                          </button>
                        )}
                      </div>
                    )}

                    {/* Reactions, Saved & Timestamp Row */}
                    {(reactionEntries.length > 0 || isSavedInChat || msg.edited || !sameSenderAsNext) &&
                      !msg.deleted && (
                        <div
                          className={`flex items-center gap-2 mt-1 px-1 ${
                            isOwn ? 'flex-row-reverse' : 'flex-row'
                          }`}
                        >
                          {reactionEntries.length > 0 && (
                            <div className="flex items-center gap-1 bg-white dark:bg-[#1A2232] border border-slate-200 dark:border-slate-700 rounded-full px-1.5 py-0.5 shadow-2xs">
                              {Object.entries(reactionCounts).map(([emoji, count]) => (
                                <button
                                  key={emoji}
                                  type="button"
                                  onClick={() =>
                                    void toggleMessageReaction(
                                      conversationId,
                                      msg.id,
                                      currentUser.uid,
                                      emoji,
                                      msg.reactions || {}
                                    )
                                  }
                                  className="text-xs flex items-center gap-0.5 cursor-pointer hover:scale-110 transition-transform"
                                >
                                  <span>{emoji}</span>
                                  {count > 1 && (
                                    <span className="text-[10px] font-mono-tabular text-slate-500 dark:text-slate-300">
                                      {count}
                                    </span>
                                  )}
                                </button>
                              ))}
                            </div>
                          )}

                          {(!sameSenderAsNext || msg.edited || isSavedInChat) && (
                            <span className="text-[10px] font-mono-tabular text-slate-400 dark:text-slate-500">
                              {isSavedInChat ? 'Saved · ' : ''}
                              {msg.edited ? 'Edited · ' : ''}
                              {formatMessageTime(msg.createdAt)}
                            </span>
                          )}
                        </div>
                      )}

                    {isOwn && msg.id === latestOwnMsgId && !isSaved && !isSnap && (
                      <div className="mt-1 flex items-center gap-1 text-[11px] text-slate-400 dark:text-slate-500 px-1">
                        {readersOfLatestOwn.length > 0 ? (
                          <>
                            <CheckCheck className={`w-3.5 h-3.5 ${theme.accentText}`} />
                            <span>
                              Seen
                              {conversation?.type === 'group' &&
                                ` by ${readersOfLatestOwn.map((r) => r.displayName.split(' ')[0]).join(', ')}`}
                            </span>
                          </>
                        ) : (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            <span>Delivered</span>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Peer hover action controls */}
                  {!isOwn && !msg.deleted && !isSnap && (
                    <div className="hidden sm:flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0 mb-1">
                      <button
                        type="button"
                        title="Save in chat"
                        onClick={() =>
                          void toggleSaveMessage(
                            conversationId,
                            msg.id,
                            currentUser.uid,
                            msg.savedBy || []
                          )
                        }
                        className={`w-7 h-7 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center cursor-pointer ${
                          isSavedInChat
                            ? 'text-amber-500'
                            : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                        }`}
                      >
                        <Bookmark className={`w-3.5 h-3.5 ${isSavedInChat ? 'fill-amber-500' : ''}`} />
                      </button>
                      <button
                        type="button"
                        title="React"
                        onClick={() =>
                          setActiveReactionTarget((prevId) =>
                            prevId === msg.id ? null : msg.id
                          )
                        }
                        className="w-7 h-7 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 flex items-center justify-center cursor-pointer"
                      >
                        <Smile className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Reply"
                        onClick={() => {
                          setEditingMsg(null);
                          setReplyTo(msg);
                          textareaRef.current?.focus();
                        }}
                        className="w-7 h-7 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 flex items-center justify-center cursor-pointer"
                      >
                        <Reply className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}

        {typingMembers.length > 0 && (
          <div className="flex items-end gap-2 mt-3">
            <Avatar
              name={typingMembers[0].displayName}
              photoURL={typingMembers[0].photoURL}
              avatarSeed={profilesByUid[typingMembers[0].uid]?.avatarSeed}
              size="xs"
            />
            <div className="px-3.5 py-2.5 rounded-2xl bg-[#F1F3F7] dark:bg-[#192231] flex items-center gap-1.5">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                {typingMembers[0].displayName.split(' ')[0]} is typing
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.2s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.1s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" />
            </div>
          </div>
        )}
      </div>

      {!isAtBottom && (
        <button
          type="button"
          onClick={scrollToBottom}
          aria-label="Scroll to latest messages"
          className="absolute bottom-24 right-6 z-10 w-10 h-10 rounded-full bg-white dark:bg-[#1A2232] border border-slate-200 dark:border-slate-700 shadow-md text-slate-700 dark:text-slate-200 hover:text-[#00A6FF] flex items-center justify-center transition-colors cursor-pointer"
        >
          <ArrowDown className="w-4 h-4" />
        </button>
      )}

      {/* Composer Footer */}
      <footer className="px-4 sm:px-5 py-3 border-t border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B0F17] shrink-0">
        {(replyTo || editingMsg) && (
          <div className="mb-2.5 px-3.5 py-2 rounded-xl bg-[#F4F6F9] dark:bg-[#121824] flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                {editingMsg
                  ? 'Editing message'
                  : `Replying to ${replyTo?.senderName}`}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {editingMsg
                  ? editingMsg.text
                  : replyTo?.text || 'Photo attachment'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setReplyTo(null);
                setEditingMsg(null);
                setDraftText('');
              }}
              aria-label="Cancel reply or edit"
              className="w-7 h-7 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 flex items-center justify-center cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {pendingImage && (
          <div className="mb-2.5 relative inline-block">
            <img
              src={pendingImage}
              alt="Pending attachment"
              className="h-24 w-auto rounded-xl border border-slate-200 dark:border-slate-700 object-cover"
            />
            <button
              type="button"
              onClick={() => setPendingImage('')}
              aria-label="Remove image"
              className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-slate-900 text-white flex items-center justify-center shadow cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {uploadError && (
          <p className="text-xs text-rose-600 dark:text-rose-400 mb-2">{uploadError}</p>
        )}

        {showEmojiPicker && (
          <div className="mb-2.5 p-2.5 rounded-2xl bg-white dark:bg-[#121824] border border-slate-200 dark:border-slate-800 shadow-lg max-w-xs">
            <div className="grid grid-cols-2 gap-1 p-1 mb-2 rounded-xl bg-[#F4F6F9] dark:bg-[#0B0F17]">
              <button
                type="button"
                onClick={() => setPickerTab('emoji')}
                className={`h-7 text-xs font-semibold rounded-lg cursor-pointer ${
                  pickerTab === 'emoji'
                    ? 'bg-white dark:bg-[#1A2232] text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-500'
                }`}
              >
                Emoji
              </button>
              <button
                type="button"
                onClick={() => setPickerTab('stickers')}
                className={`h-7 text-xs font-semibold rounded-lg cursor-pointer ${
                  pickerTab === 'stickers'
                    ? 'bg-[#FFFC00] text-slate-950 shadow-xs'
                    : 'text-slate-500'
                }`}
              >
                Stickers
              </button>
            </div>
            <div className="grid grid-cols-8 gap-1">
              {(pickerTab === 'emoji' ? EMOJI_PICKER_GRID : SNAP_STICKER_GRID).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => {
                    if (pickerTab === 'stickers') {
                      void handleSendSticker(item);
                    } else {
                      handleDraftChange(draftText + item);
                      textareaRef.current?.focus();
                    }
                  }}
                  className="h-9 rounded-lg hover:bg-[#F4F6F9] dark:hover:bg-slate-800 text-lg flex items-center justify-center cursor-pointer"
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleSelectImage}
            className="hidden"
          />

          {!editingMsg && (
            <>
              <button
                type="button"
                onClick={() => onOpenCameraForChat(conversationId)}
                title="Send disappearing Snap"
                aria-label="Send disappearing Snap"
                className="min-w-[40px] min-h-[40px] rounded-xl bg-[#FFFC00] hover:bg-[#F5E600] text-slate-950 flex items-center justify-center transition-colors cursor-pointer shrink-0"
              >
                <Camera className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="Send saved photo"
                aria-label="Send saved photo"
                className={`min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center transition-colors cursor-pointer shrink-0 ${theme.accentText} hover:bg-[#F4F6F9] dark:hover:bg-slate-800`}
              >
                <ImageIcon className="w-5 h-5" />
              </button>

              <button
                type="button"
                onClick={() => void handleToggleVoiceNote()}
                title={isRecordingVoice ? 'Stop & send voice note' : 'Record voice note'}
                aria-label={isRecordingVoice ? 'Stop & send voice note' : 'Record voice note'}
                className={`min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center gap-1 transition-colors cursor-pointer shrink-0 ${
                  isRecordingVoice
                    ? 'bg-rose-600 text-white px-2.5 animate-pulse'
                    : 'text-slate-500 dark:text-slate-400 hover:bg-[#F4F6F9] dark:hover:bg-slate-800'
                }`}
              >
                <Mic className="w-4 h-4" />
                {isRecordingVoice && (
                  <span className="text-[11px] font-mono-tabular font-bold">
                    {voiceSeconds}s
                  </span>
                )}
              </button>
            </>
          )}

          <div className="flex-1 flex items-end gap-2 bg-[#F4F6F9] dark:bg-[#121824] border border-slate-200/70 dark:border-slate-800 rounded-2xl px-3.5 py-2 focus-within:border-[#00A6FF]/50">
            <textarea
              ref={textareaRef}
              rows={1}
              value={draftText}
              maxLength={LIMITS.MESSAGE_TEXT_MAX}
              onChange={(e) => handleDraftChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder={isRecordingVoice ? 'Recording voice note...' : 'Send a chat...'}
              className="flex-1 bg-transparent text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 outline-none resize-none max-h-32 leading-6"
            />
            <button
              type="button"
              onClick={() => setShowEmojiPicker((v) => !v)}
              title="Emoji & Stickers"
              aria-label="Emoji & Stickers"
              className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
                showEmojiPicker
                  ? theme.accentText
                  : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              <Smile className="w-5 h-5" />
            </button>
          </div>

          {draftText.trim() || pendingImage || editingMsg ? (
            <button
              type="button"
              disabled={sending}
              onClick={handleSend}
              title="Send message"
              aria-label="Send message"
              className={`min-w-[42px] min-h-[42px] rounded-xl ${theme.bubbleBg} ${theme.bubbleText} hover:opacity-95 disabled:opacity-50 flex items-center justify-center transition-opacity cursor-pointer shrink-0`}
            >
              <Send className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              disabled={sending}
              onClick={handleSendQuickEmoji}
              title={`Send ${conversation?.quickEmoji || '👻'}`}
              aria-label="Send quick reaction"
              className="min-w-[42px] min-h-[42px] rounded-xl hover:bg-[#F4F6F9] dark:hover:bg-slate-800 text-xl flex items-center justify-center transition-colors cursor-pointer shrink-0"
            >
              {conversation?.quickEmoji || '👻'}
            </button>
          )}
        </div>
      </footer>
    </main>
  );
}
