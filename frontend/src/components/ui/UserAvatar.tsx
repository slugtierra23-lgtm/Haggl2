'use client';

import React, { useEffect, useState } from 'react';

import { resolveAssetUrl } from '@/lib/utils/asset-url';

interface UserAvatarProps {
  src?: string | null;
  name?: string | null;
  userId?: string | null;
  size?: number;
  className?: string;
  ring?: boolean;
}

// Deterministic hue from a string — gives each fallback avatar its own
// subtle tint while staying inside the brand palette (indigo/violet/cyan).
function hashHue(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return ((h % 360) + 360) % 360;
}

function initials(name: string | null | undefined): string {
  if (!name) return '?';
  // Keep letters/digits (ASCII + common Latin extended) and spaces.
  const cleaned = name.replace(/[^A-Za-z0-9À-ſ ]/g, '').trim();
  if (!cleaned) return name.trim()[0]?.toUpperCase() || '?';
  const parts = cleaned.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || cleaned[0].toUpperCase();
}

/**
 * Canonical avatar component. Renders the user's uploaded picture when
 * available, otherwise a branded gradient disc with the user's initials.
 *
 * Design notes:
 *  - `src` is pushed through `resolveAssetUrl` so legacy relative paths
 *    like `/api/v1/users/avatars/<uuid>` resolve against the backend
 *    origin instead of 404-ing against the frontend origin.
 *  - An `onError` handler swaps in the initials fallback if the image
 *    fails to load (dead URL, CORS, wrong origin), so we never show the
 *    broken-image icon + alt text that users were complaining about.
 *  - `src` changes reset the error flag so retries after re-upload work.
 */
export function UserAvatar({
  src,
  name,
  userId,
  size = 32,
  className = '',
  ring = false,
}: UserAvatarProps) {
  const resolved = resolveAssetUrl(src);
  const [errored, setErrored] = useState(false);
  useEffect(() => {
    setErrored(false);
  }, [resolved]);

  const seed = userId || name || '';
  const hue = hashHue(seed || 'haggl');
  const letters = initials(name);
  const bg = `linear-gradient(135deg, hsl(${hue}, 72%, 62%) 0%, hsl(${(hue + 40) % 360}, 68%, 52%) 100%)`;
  const ringStyle = ring ? { boxShadow: '0 0 0 2px rgba(20, 241, 149, 0.35)' } : {};

  if (resolved && !errored) {
    return (
      <img
        src={resolved}
        alt={name || 'avatar'}
        width={size}
        height={size}
        onError={() => setErrored(true)}
        className={`rounded-full object-cover block ${className}`}
        style={{
          width: size,
          height: size,
          ...ringStyle,
        }}
      />
    );
  }

  return (
    <div
      className={`rounded-full flex items-center justify-center text-white font-light select-none ${className}`}
      style={{
        width: size,
        height: size,
        background: bg,
        fontSize: Math.max(10, Math.floor(size * 0.4)),
        letterSpacing: '0.02em',
        ...ringStyle,
      }}
      aria-label={name || 'avatar'}
    >
      {letters}
    </div>
  );
}
