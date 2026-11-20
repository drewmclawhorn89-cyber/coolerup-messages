interface GhostLogoProps {
  className?: string;
  filled?: boolean;
}

/**
 * Stylised ghost mark used throughout the Snapchat-style chrome.
 * Renders in `currentColor` so it works on yellow, black and white surfaces.
 */
export function GhostLogo({ className = 'w-8 h-8', filled = true }: GhostLogoProps) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      aria-hidden="true"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={filled ? 0 : 6}
      strokeLinejoin="round"
    >
      <path d="M50 6C31.2 6 19.5 20.4 19.5 38.5V56.2C19.5 62.6 14.6 65 11 67.2C15.4 71.4 20.2 73.2 20.2 79.4C20.2 85.6 24.6 92 31.2 92C37.8 92 39.6 87.4 43.8 87.4C48 87.4 48.6 94 50 94C51.4 94 52 87.4 56.2 87.4C60.4 87.4 62.2 92 68.8 92C75.4 92 79.8 85.6 79.8 79.4C79.8 73.2 84.6 71.4 89 67.2C85.4 65 80.5 62.6 80.5 56.2V38.5C80.5 20.4 68.8 6 50 6Z" />
    </svg>
  );
}
