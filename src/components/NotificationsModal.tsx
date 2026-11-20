import { Bell, CheckCheck, Trash2, X } from 'lucide-react';
import { formatConversationTime } from '../lib/dateFormat';
import type { AppNotification } from '../types/messenger';
import { Avatar } from './Avatar';

interface NotificationsModalProps {
  notifications: AppNotification[];
  onMarkRead: (id: string) => Promise<void>;
  onMarkAllRead: () => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}

export function NotificationsModal({
  notifications,
  onMarkRead,
  onMarkAllRead,
  onDelete,
  onClose,
}: NotificationsModalProps) {
  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[82vh] rounded-3xl bg-white dark:bg-[#141414] border border-slate-100 dark:border-white/10 shadow-xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-100 dark:border-white/10 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-[#FFFC00] text-slate-950 flex items-center justify-center">
              <Bell className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-display text-lg font-extrabold tracking-[-0.03em] text-slate-900 dark:text-white">
                Activity &amp; Alerts
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => void onMarkAllRead()}
                className="h-8 px-2.5 rounded-xl bg-[#F2F2F2] dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/10 text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1 cursor-pointer"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span>Read all</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close notifications"
              className="w-8 h-8 rounded-2xl hover:bg-[#F7F7F7] dark:hover:bg-white/5 text-slate-500 flex items-center justify-center cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto chat-scroll p-3 space-y-2">
          {notifications.length === 0 ? (
            <div className="py-14 text-center">
              <Bell className="w-8 h-8 text-slate-300 dark:text-slate-700 mx-auto mb-2" />
              <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                No notifications yet
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Friend requests, Story hearts, and Spotlight comments appear here.
              </p>
            </div>
          ) : (
            notifications.map((n) => (
              <div
                key={n.id}
                onClick={() => {
                  if (!n.read) void onMarkRead(n.id);
                }}
                className={`p-3 rounded-2xl flex items-start gap-3 transition-colors cursor-pointer ${
                  n.read
                    ? 'bg-[#F2F2F2]/70 dark:bg-[#0A0A0A]/60'
                    : 'bg-[#FFFC00]/20 dark:bg-[#FFFC00]/10 border border-[#FFFC00]/60'
                }`}
              >
                <Avatar name={n.fromUserName} photoURL={n.fromPhotoURL} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-900 dark:text-white leading-snug">
                    <span className="font-bold">{n.fromUserName}</span> {n.message}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {formatConversationTime(n.createdAt)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void onDelete(n.id);
                  }}
                  aria-label="Remove notification"
                  className="w-7 h-7 rounded-xl text-slate-400 hover:text-rose-500 flex items-center justify-center cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
