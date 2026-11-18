import { useState } from 'react';
import { CheckCircle2, Download, ExternalLink, Monitor, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'cta' | 'rail' | 'compact' | 'row';
}

export function PWAInstallButton({ variant = 'cta' }: PWAInstallButtonProps) {
  const { isInstallable, isInstalled, isIOS, isAndroid, isInIframe, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);
  const [installing, setInstalling] = useState(false);

  if (isInstalled) {
    if (variant === 'row') {
      return (
        <div className="flex items-center justify-between py-2 px-3 rounded-xl bg-[#F4F6F9] dark:bg-[#0B0F17]">
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              CoolerUp App
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Running in installed app mode
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="w-4 h-4" />
            <span>Installed</span>
          </span>
        </div>
      );
    }
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      setInstalling(true);
      try {
        const accepted = await install();
        if (!accepted) {
          setShowGuide(false);
        }
      } finally {
        setInstalling(false);
      }
      return;
    }
    setShowGuide(true);
  };

  const buttonNode = (() => {
    if (variant === 'rail') {
      return (
        <button
          type="button"
          onClick={handleClick}
          disabled={installing}
          title="Download CoolerUp Messages app"
          aria-label="Download CoolerUp Messages app"
          className="w-11 h-11 rounded-xl flex items-center justify-center text-[#0066FF] dark:text-[#60A5FA] bg-[#0066FF]/10 dark:bg-[#1D6FFF]/20 hover:bg-[#0066FF]/20 transition-colors cursor-pointer"
        >
          <Download className="w-5 h-5" />
        </button>
      );
    }

    if (variant === 'compact') {
      return (
        <button
          type="button"
          onClick={handleClick}
          disabled={installing}
          title="Install CoolerUp Messages"
          aria-label="Install CoolerUp Messages"
          className="min-w-[40px] min-h-[40px] rounded-xl bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700 text-[#0066FF] dark:text-[#60A5FA] flex items-center justify-center transition-colors cursor-pointer"
        >
          <Download className="w-4 h-4" />
        </button>
      );
    }

    if (variant === 'row') {
      return (
        <div className="flex items-center justify-between py-2 px-3 rounded-xl bg-[#F4F6F9] dark:bg-[#0B0F17]">
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              Install App
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Download for Google Chrome, Android, or iOS
            </p>
          </div>
          <button
            type="button"
            onClick={handleClick}
            disabled={installing}
            className="h-9 px-3 rounded-lg bg-[#0066FF] hover:bg-[#0052CC] text-white text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{installing ? 'Installing...' : 'Download'}</span>
          </button>
        </div>
      );
    }

    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={installing}
        className="h-12 px-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#121824] hover:bg-slate-50 dark:hover:bg-slate-800/70 text-slate-800 dark:text-slate-100 text-sm font-medium flex items-center gap-2.5 transition-colors cursor-pointer whitespace-nowrap"
      >
        <Download className="w-4 h-4 text-[#0066FF] dark:text-[#60A5FA]" />
        <span>{installing ? 'Installing...' : 'Download App'}</span>
      </button>
    );
  })();

  return (
    <>
      {buttonNode}

      {showGuide && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setShowGuide(false)}
        >
          <div
            className="w-full max-w-md bg-white dark:bg-[#121824] border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <img
                  src="/pwa-192x192.png"
                  alt="CoolerUp Messages icon"
                  className="w-8 h-8 rounded-lg object-cover border border-slate-200 dark:border-slate-700"
                />
                <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                  Download CoolerUp Messages
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="Close install instructions"
                className="w-9 h-9 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-sm text-slate-700 dark:text-slate-300">
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                CoolerUp Messages is an installable app with offline support and a standalone window for Android, ChromeOS, Windows, macOS, and iOS.
              </p>

              {isInIframe && (
                <div className="p-3.5 rounded-xl bg-[#0066FF]/8 dark:bg-[#1D6FFF]/15 border border-[#0066FF]/20">
                  <p className="text-xs font-semibold text-slate-900 dark:text-white mb-1">
                    Open in Google Chrome to trigger 1-click install
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mb-2.5">
                    Browser app installation works directly in a standalone Chrome tab rather than an embedded preview frame.
                  </p>
                  <a
                    href={window.location.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="h-9 px-3.5 rounded-lg bg-[#0066FF] hover:bg-[#0052CC] text-white text-xs font-medium inline-flex items-center gap-1.5 transition-colors"
                  >
                    <span>Open in New Tab</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              )}

              {!isIOS && (
                <div className="p-3.5 rounded-xl bg-[#F4F6F9] dark:bg-[#0B0F17] border border-slate-200/70 dark:border-slate-800 space-y-2">
                  <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white text-xs">
                    {isAndroid ? (
                      <Smartphone className="w-4 h-4 text-[#0066FF]" />
                    ) : (
                      <Monitor className="w-4 h-4 text-[#0066FF]" />
                    )}
                    <span>
                      {isAndroid
                        ? 'Google Android (Chrome)'
                        : 'Google Chrome (Desktop & Chromebook)'}
                    </span>
                  </div>
                  {isAndroid ? (
                    <ol className="text-xs text-slate-600 dark:text-slate-400 space-y-1 list-decimal list-inside">
                      <li>Open this page in Google Chrome.</li>
                      <li>Tap the three-dot menu in the top-right corner.</li>
                      <li>
                        Tap <strong>Add to Home screen</strong> or <strong>Install app</strong>.
                      </li>
                    </ol>
                  ) : (
                    <ol className="text-xs text-slate-600 dark:text-slate-400 space-y-1 list-decimal list-inside">
                      <li>Open this app in a Google Chrome tab.</li>
                      <li>
                        Click the <strong>Install</strong> icon in the right side of the Chrome address bar, or open Chrome Menu → <strong>Cast, save, and share</strong> → <strong>Install CoolerUp Messages</strong>.
                      </li>
                    </ol>
                  )}
                </div>
              )}

              <div className="p-3.5 rounded-xl bg-[#F4F6F9] dark:bg-[#0B0F17] border border-slate-200/70 dark:border-slate-800 space-y-2">
                <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white text-xs">
                  <Smartphone className="w-4 h-4 text-[#0066FF]" />
                  <span>iPhone &amp; iPad (Safari)</span>
                </div>
                <ol className="text-xs text-slate-600 dark:text-slate-400 space-y-1 list-decimal list-inside">
                  <li>Open CoolerUp Messages in Safari.</li>
                  <li>
                    Tap the <strong>Share</strong> icon in the Safari toolbar.
                  </li>
                  <li>
                    Scroll down and tap <strong>Add to Home Screen</strong>.
                  </li>
                </ol>
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-slate-100 dark:border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="h-9 px-4 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-medium text-slate-800 dark:text-slate-200 cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
