import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';

// Google Maps Demo Key quota & auth-failure circuit listener
if (typeof window !== 'undefined') {
  const triggerQuotaBanner = () => {
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
  };

  (window as unknown as { gm_authFailure?: () => void }).gm_authFailure = triggerQuotaBanner;

  const origConsoleError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    origConsoleError(...args);
    const joined = args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ');
    if (
      joined.includes('OverQuotaMapError') ||
      joined.includes('BillingNotEnabledMapError') ||
      joined.includes('ApiProjectMapError')
    ) {
      triggerQuotaBanner();
    }
  };
}

registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
