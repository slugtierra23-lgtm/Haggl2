import React from 'react';

type IconProps = { className?: string; size?: number };

// MetaMask — official fox brand mark. Source: MetaMask public brand kit
// (metamask.io/brand). Recognizable at any size from 16px up. Uses the
// canonical orange "#F6851B" + warm browns palette.
export function MetaMaskIcon({ className, size = 24 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 256 240"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="MetaMask"
    >
      <path
        fill="#E17726"
        stroke="#E17726"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="m250.07 1-99.51 73.87 18.4-43.61z"
      />
      <path
        fill="#E27625"
        stroke="#E27625"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="m6.97 1 98.71 74.57-17.5-44.31zM214.13 173.1l-26.49 40.59 56.69 15.6 16.3-55.29zM4.36 174l16.21 55.29 56.7-15.6-26.5-40.59z"
      />
      <path
        fill="#E27625"
        stroke="#E27625"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="m74.07 104.45-15.81 23.93 56.3 2.51-2-60.5zM182.97 104.45l-39-34.66-1.3 61.1 56.2-2.51zM77.27 213.69l33.79-16.5-29.21-22.78zM145.9 197.19l33.79 16.5-4.6-39.28z"
      />
      <path
        fill="#D5BFB2"
        stroke="#D5BFB2"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="m179.69 213.69-33.79-16.5 2.69 22.04-.3 9.28zM77.27 213.69l31.4 14.82-.2-9.28 2.6-22.04z"
      />
      <path
        fill="#233447"
        stroke="#233447"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="m109.17 161.99-28.21-8.3 19.91-9.11zM147.86 161.99l8.31-17.41 20 9.11z"
      />
      <path
        fill="#CC6228"
        stroke="#CC6228"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="m77.27 213.69 4.8-40.59-31.3.9zM174.89 173.1l4.8 40.59 26.5-39.69zM198.78 128.38l-56.2 2.51 5.2 31.1 8.31-17.41 20 9.11zM80.97 153.69l19.91-9.11 8.3 17.41 5.2-31.1-56.3-2.51z"
      />
      <path
        fill="#E27525"
        stroke="#E27525"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="m58.26 128.38 23.61 46.05-.8-22.74zM175.7 151.69l-1 22.74 23.61-46.05zM114.57 130.89l-5.2 31.1 6.5 33.59 1.5-44.28zM142.58 130.89l-2.7 20.31 1.4 44.38 6.6-33.59z"
      />
      <path
        fill="#F5841F"
        stroke="#F5841F"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="m147.86 161.99-6.6 33.59 4.7 3.21 28.71-22.79 1-22.74zM80.97 153.26l.8 22.74 28.71 22.79 4.7-3.21-6.51-33.59z"
      />
      <path
        fill="#C0AC9D"
        stroke="#C0AC9D"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="m148.36 228.51.3-9.28-2.5-2.21h-37.32l-2.4 2.21.2 9.28-31.4-14.82 11 9 22.21 15.4h37.92l22.31-15.4 10.9-9z"
      />
      <path
        fill="#161616"
        stroke="#161616"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="m145.9 197.19-4.7-3.21h-26.4l-4.7 3.21-2.6 22.04 2.4-2.21h37.32l2.5 2.21z"
      />
      <path
        fill="#763D16"
        stroke="#763D16"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="m254.27 80.18 8.5-40.78L250.07 1l-101.71 75.47 39.18 33.06 55.4 16.2 12.1-14.1-5.3-3.81 8.5-7.7-6.5-5 8.5-6.5zM1.27 39.4l8.5 40.78-5.4 4 8.5 6.5-6.4 5 8.5 7.7-5.3 3.81 12 14.1 55.4-16.2 39.18-33.06L14.66 1z"
      />
      <path
        fill="#F5841F"
        stroke="#F5841F"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="m243.07 125.73-55.4-16.2 16.91 25.32-25.21 49.05 33.31-.4h49.74zM68.37 109.53l-55.41 16.2-18.4 57.77h49.61l33.3.4-25.2-49.05zM142.58 137.04l3.51-60.6 16-43.31H91.07l15.8 43.31 3.7 60.6 1.3 19.07.1 47.04h26.4l.2-47.04z"
      />
    </svg>
  );
}

// WalletConnect official blue
export function WalletConnectIcon({ className, size = 24 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="WalletConnect"
    >
      <rect width="32" height="32" rx="8" fill="#3B99FC" />
      <path
        d="M9.7 12.3a8.9 8.9 0 0 1 12.6 0l.4.4a.4.4 0 0 1 0 .6l-1.4 1.4a.2.2 0 0 1-.3 0l-.6-.6a6.2 6.2 0 0 0-8.8 0l-.6.6a.2.2 0 0 1-.3 0l-1.4-1.4a.4.4 0 0 1 0-.6l.4-.4Zm15.6 2.9 1.2 1.2a.4.4 0 0 1 0 .6L21.1 22.4a.4.4 0 0 1-.6 0l-3.8-3.8a.1.1 0 0 0-.1 0l-3.8 3.8a.4.4 0 0 1-.6 0l-5.4-5.4a.4.4 0 0 1 0-.6l1.2-1.2a.4.4 0 0 1 .6 0l3.8 3.8a.1.1 0 0 0 .1 0l3.8-3.8a.4.4 0 0 1 .6 0l3.8 3.8a.1.1 0 0 0 .1 0l3.8-3.8a.4.4 0 0 1 .6 0Z"
        fill="#fff"
      />
    </svg>
  );
}

// Uniswap unicorn (pink)
export function UniswapIcon({ className, size = 24 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Uniswap"
    >
      <rect width="32" height="32" rx="8" fill="#FF007A" />
      <path
        d="M12.7 9c-.3 0-.5.2-.5.5s0 .4.2.6c.1.1.2.2.3.3.6.5 1 1 1.1 1.7 0 .2.1.5.1.8 0 1.5-.9 2.8-2.3 3.3-.4.1-.7.2-1.1.2-.3 0-.6-.1-.8-.4a.8.8 0 0 1-.1-.6c0-.2.2-.5.4-.6.2-.1.4-.1.6.1.1.1.2.3.4.3.1 0 .3 0 .4-.2.1-.2 0-.4-.1-.6-.3-.3-.6-.5-.9-.6-.5-.2-.9-.4-1.2-.8-.4-.4-.6-1-.5-1.6 0-.5.3-1 .8-1.3.4-.3 1-.4 1.5-.4h1.7Zm6.6 4.2c1.8 1 3 2.7 3.3 4.7.2 1.3 0 2.6-.8 3.7-.6 1-1.6 1.7-2.8 2-.7.2-1.5.3-2.3.3-2.2 0-4.3-.7-6-2.1.4.4 1.2.8 2.2 1.2-1.7-.9-2.5-2.1-2.3-3.6.2-1.3.9-2.4 2.1-3.2-.5.7-.7 1.5-.5 2.4.3 1.5 1.4 2.5 3.1 2.8 1.3.2 2.5 0 3.5-.7.6-.4 1-1 1.2-1.7.2-.9-.1-1.7-.8-2.3-.3-.3-.7-.5-1.1-.6l-.2-.1c-.5-.2-.7-.6-.7-1.1 0-.5.4-.9.8-1 .5-.1.9 0 1.3.3Z"
        fill="#fff"
      />
    </svg>
  );
}

// Coinbase Wallet blue circle
export function CoinbaseIcon({ className, size = 24 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Coinbase"
    >
      <rect width="32" height="32" rx="8" fill="#0052FF" />
      <path
        d="M16 22.6a6.6 6.6 0 1 1 6.5-7.8h-3.3a3.4 3.4 0 1 0 0 2.4h3.3A6.6 6.6 0 0 1 16 22.6Z"
        fill="#fff"
      />
    </svg>
  );
}

// Rainbow wallet gradient
export function RainbowIcon({ className, size = 24 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Rainbow"
    >
      <defs>
        <linearGradient id="rbBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#174299" />
          <stop offset="1" stopColor="#001E59" />
        </linearGradient>
        <linearGradient id="rbArc1" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#FF4000" />
          <stop offset="1" stopColor="#8754C9" />
        </linearGradient>
        <linearGradient id="rbArc2" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#FFF700" />
          <stop offset="1" stopColor="#FF4000" />
        </linearGradient>
        <linearGradient id="rbArc3" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#00AAFF" />
          <stop offset="1" stopColor="#01DA40" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#rbBg)" />
      <path d="M6 26v-4a12 12 0 0 1 12 12h4a16 16 0 0 0-16-16v4Z" fill="url(#rbArc1)" />
      <path d="M6 20v-4a18 18 0 0 1 18 18h4a22 22 0 0 0-22-22v-4Z" fill="url(#rbArc2)" />
      <circle cx="8" cy="24" r="2.5" fill="url(#rbArc3)" />
    </svg>
  );
}

// Phantom — authentic brand mark from the Phantom brand kit
// (phantom.com/brand-assets). Solid lavender #AB9FF2 squircle with a
// solid white ghost. Previously used a fabricated dark-purple gradient
// (#534BB1 → #551BF9) that didn't match Phantom's actual identity.
export function PhantomIcon({ className, size = 24 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Phantom"
    >
      <rect width="128" height="128" rx="32" fill="#AB9FF2" />
      <path
        fill="#FFFFFF"
        d="M110.584 64.9142H99.142C99.142 41.7651 80.173 23 56.7724 23C33.6612 23 14.9078 41.3057 14.4291 64.0583C13.9354 87.5828 36.5258 108 60.1846 108H63.1909C84.0589 108 112.143 91.7716 116.515 71.8013C117.318 68.1351 114.252 64.9142 110.584 64.9142ZM39.7689 65.9858C39.7689 69.0727 37.2453 71.5963 34.1584 71.5963C31.0716 71.5963 28.5479 69.0727 28.5479 65.9858V57.0961C28.5479 54.0093 31.0716 51.4856 34.1584 51.4856C37.2453 51.4856 39.7689 54.0093 39.7689 57.0961V65.9858ZM58.6324 65.9858C58.6324 69.0727 56.1087 71.5963 53.0219 71.5963C49.935 71.5963 47.4114 69.0727 47.4114 65.9858V57.0961C47.4114 54.0093 49.935 51.4856 53.0219 51.4856C56.1087 51.4856 58.6324 54.0093 58.6324 57.0961V65.9858Z"
      />
    </svg>
  );
}

// Generic wallet fallback (Lucide-like)
export function GenericWalletIcon({ className, size = 24 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Wallet"
    >
      <path
        d="M4 7.5A2.5 2.5 0 0 1 6.5 5H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6.5A2.5 2.5 0 0 1 4 16.5v-9Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M4 9h15a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="17" cy="13" r="1.25" fill="currentColor" />
    </svg>
  );
}

export type WalletProvider =
  | 'METAMASK'
  | 'PHANTOM'
  | 'WALLETCONNECT'
  | 'COINBASE'
  | 'RAINBOW'
  | 'UNISWAP'
  | 'OTHER';

export function WalletProviderIcon({
  provider,
  className,
  size = 24,
}: {
  provider?: string | null;
  className?: string;
  size?: number;
}) {
  const p = (provider || '').toUpperCase();
  if (p === 'METAMASK') return <MetaMaskIcon className={className} size={size} />;
  if (p === 'PHANTOM') return <PhantomIcon className={className} size={size} />;
  if (p === 'WALLETCONNECT') return <WalletConnectIcon className={className} size={size} />;
  if (p === 'COINBASE') return <CoinbaseIcon className={className} size={size} />;
  if (p === 'RAINBOW') return <RainbowIcon className={className} size={size} />;
  if (p === 'UNISWAP') return <UniswapIcon className={className} size={size} />;
  return <GenericWalletIcon className={className} size={size} />;
}

export function walletProviderLabel(provider?: string | null): string {
  const p = (provider || '').toUpperCase();
  if (p === 'METAMASK') return 'MetaMask';
  if (p === 'PHANTOM') return 'Phantom';
  if (p === 'WALLETCONNECT') return 'WalletConnect';
  if (p === 'COINBASE') return 'Coinbase';
  if (p === 'RAINBOW') return 'Rainbow';
  if (p === 'UNISWAP') return 'Uniswap';
  return 'Wallet';
}
