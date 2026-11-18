import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
  detail: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = {
      hasError: false,
      message: '',
      detail: '',
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let message = error.message || 'An unexpected error occurred.';
    let detail = '';

    try {
      const parsed = JSON.parse(error.message);
      if (parsed && typeof parsed.error === 'string') {
        message = parsed.error;
        detail = `${parsed.operationType?.toUpperCase() || 'OP'} ${parsed.path || ''}`.trim();
      }
    } catch {
      // Standard Error string
    }

    return {
      hasError: true,
      message,
      detail,
    };
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#F4F6F9] dark:bg-[#0B0F17] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white dark:bg-[#121824] border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm">
            <div className="w-11 h-11 rounded-xl bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 flex items-center justify-center mb-4">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">
              Something went wrong
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-3">
              {this.state.message}
            </p>
            {this.state.detail && (
              <p className="text-xs font-mono-tabular text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-900 rounded-lg px-3 py-2 mb-5 break-all">
                {this.state.detail}
              </p>
            )}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full h-11 rounded-xl bg-[#0066FF] hover:bg-[#0052CC] text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Reload CoolerUp Messages</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
