'use client';

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';

import { api } from '@/lib/api/client';
import { prefetch, resetCache } from '@/lib/cache/pageCache';
import { resolveAssetUrl } from '@/lib/utils/asset-url';

// Demo-mode: when NEXT_PUBLIC_DEMO_MODE=1 the frontend skips every backend
// auth call, seeds a synthetic user, and lets the entire app be navigated
// offline. Useful while the backend isn't running. All API calls below
// short-circuit so a missing :3001 doesn't spam the console with errors.
const DEMO_MODE = typeof process !== 'undefined' && process.env.NEXT_PUBLIC_DEMO_MODE === '1';

const DEMO_USER: User = {
  id: 'demo-user',
  username: 'atlas_demo',
  displayName: 'Atlas Demo',
  avatarUrl: null,
  githubLogin: null,
  walletAddress: '0x000000000000000000000000000000000000dEaD',
  role: 'USER',
  profileSetup: true,
  twitterUrl: null,
  linkedinUrl: null,
  websiteUrl: null,
  email: 'demo@atlas.market',
  twoFactorEnabled: false,
  reputationPoints: 0,
  userTag: null,
};

export interface User {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  githubLogin: string | null;
  walletAddress: string | null;
  role: string;
  profileSetup: boolean;
  twitterUrl: string | null;
  linkedinUrl: string | null;
  websiteUrl: string | null;
  email: string | null;
  twoFactorEnabled: boolean;
  reputationPoints?: number;
  userTag?: string | null;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  refresh: async () => {},
  logout: async () => {},
});

// ── Optimistic hint cache ───────────────────────────────────────────────────
// When switching accounts, React state briefly becomes `null` between logout
// and the next `/auth/me` response. Previously this caused the avatar to
// visually "disappear" across the app. We persist the last good user snapshot
// in localStorage and seed state from it on mount + keep it across refresh so
// the avatar stays rendered through the transition. The cookie-authenticated
// `/auth/me` call still gets the final word.
const HINT_KEY = 'bolty:auth-hint';

function readHint(): User | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(HINT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as User;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.id !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeHint(user: User | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (user) window.localStorage.setItem(HINT_KEY, JSON.stringify(user));
    else window.localStorage.removeItem(HINT_KEY);
  } catch {
    /* storage quota / privacy mode — ignore */
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // Track whether an explicit logout happened so we DON'T reuse the hint if
  // the user explicitly signed out.
  const loggedOutRef = useRef(false);

  // Seed from the hint after mount to avoid SSR hydration mismatch. The hint
  // makes the avatar stay rendered during account-switch transitions instead
  // of briefly flashing to the gradient+initial placeholder.
  useEffect(() => {
    const hint = readHint();
    if (hint) setUser(hint);
  }, []);

  const fetchUser = useCallback(async () => {
    if (DEMO_MODE) {
      setUser(DEMO_USER);
      writeHint(DEMO_USER);
      loggedOutRef.current = false;
      setIsLoading(false);
      return;
    }
    try {
      const data = await api.get<User>('/auth/me');
      const normalised = { ...data, avatarUrl: resolveAssetUrl(data.avatarUrl) };
      setUser(normalised);
      writeHint(normalised);
      loggedOutRef.current = false;
    } catch {
      // Unauthenticated. Only clear state if we're not mid-logout (already
      // handled below) and don't have a valid hint to keep optimistic.
      if (loggedOutRef.current) {
        setUser(null);
        writeHint(null);
      } else {
        // No valid session at all — clear hint to avoid showing stale user.
        setUser(null);
        writeHint(null);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    loggedOutRef.current = true;
    if (!DEMO_MODE) {
      try {
        await api.post('/auth/logout', {});
      } catch {
        /* backend down — proceed with local clear anyway */
      }
    }
    setUser(null);
    writeHint(null);
    // Drop any cached per-user page data so the next account doesn't
    // flash the previous user's orders / inventory on first render.
    resetCache();
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  // Global 401 listener — ApiClient emits `bolty:auth-expired` when a
  // request still fails auth after the refresh attempt. Drops the user
  // and bounces to login ONLY if there was actually a signed-in user
  // to begin with. Anon visitors hitting protected endpoints should
  // stay on the public page they're browsing — no forced redirect.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (DEMO_MODE) return; // no real auth to expire — skip the redirect listener
    const handler = () => {
      const hadSession = Boolean(readHint());
      setUser(null);
      writeHint(null);
      resetCache();
      if (!hadSession) return;
      const here = window.location.pathname + window.location.search;
      const isAuthRoute = here.startsWith('/auth');
      const isLanding = here === '/' || here === '';
      if (!isAuthRoute && !isLanding) {
        window.location.href = `/auth/login?redirect=${encodeURIComponent(here)}`;
      }
    };
    window.addEventListener('bolty:auth-expired', handler);
    return () => window.removeEventListener('bolty:auth-expired', handler);
  }, []);

  // Warm-prefetch common landing pages in the background once we know
  // the user is authenticated. Runs on browser-idle so it never
  // competes with the current page's own fetches for CPU / network.
  // Result lands in the pageCache; next navigation hits it instantly.
  useEffect(() => {
    if (!user) return;
    if (typeof window === 'undefined') return;
    if (DEMO_MODE) return; // no backend to prefetch from
    type IdleRic = typeof window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    };
    const w = window as IdleRic;
    const idle = (fn: () => void) => {
      if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 2_500 });
      else setTimeout(fn, 800);
    };
    idle(() => {
      void prefetch('market:listings', () =>
        api.get<{ data: unknown[] }>('/market?page=1&sortBy=recent').then((r) => r?.data ?? []),
      );
      void prefetch('market:pulse', () => api.get('/market/pulse?limit=20'));
      // Most-clicked sub-routes from the marketplace section. Fired here
      // instead of waiting for the user's first sidebar hover so the
      // landing render → first nav transition is also instant.
      void prefetch('market:agents:type=AI_AGENT&sortBy=recent', () =>
        api
          .get<{ data: unknown[] }>('/market?type=AI_AGENT&sortBy=recent')
          .then((r) => r?.data ?? []),
      );
      // /market/repos consumes the standalone /repos endpoint (Repository
      // model, not MarketListing), so prefetch THAT — not /market?type=REPO,
      // which is a different page (the table view of REPO-typed listings).
      // Cache key must match `market:repos:${params.toString()}` from
      // /market/repos/page.tsx so the page lands instantly from cache.
      void prefetch('market:repos:sortBy=recent', () =>
        api.get<{ data: unknown[] }>('/repos?sortBy=recent'),
      );
      void prefetch('market:top-sellers:48', () => api.get('/market/top-sellers?limit=48'));
      void prefetch('orders:buyer', () => api.get('/orders'));
      void prefetch('orders:seller', () => api.get('/orders/selling'));
      // /orders also reads stats and negotiations on mount — warm both
      // so the seller-side dashboard lands fully populated. Safe again
      // now that #345 raised the Prisma pool from 1 → 5 connections.
      void prefetch('orders:stats', () => api.get('/orders/seller/stats'));
      void prefetch('orders:negotiations', () => api.get('/market/negotiations'));
      void prefetch('inventory:data', () => api.get('/market/my-inventory'));
      // Favorites live in localStorage; read the id lists and warm the
      // bulk-lookup endpoints under the same cache keys the saved tab
      // uses so navigating to inventory→saved is instant when the user
      // has saved anything. Empty lists skip — we only pay the network
      // cost when there's actually data to fetch. Keys must match
      // useFavorites.ts.
      try {
        const repoIds = JSON.parse(window.localStorage.getItem('bolty.repo.favorites.v1') || '[]');
        if (Array.isArray(repoIds) && repoIds.length > 0) {
          void prefetch(`favorites:repos:${repoIds.join(',')}`, () =>
            api.get(`/repos/by-ids?ids=${encodeURIComponent(repoIds.join(','))}`),
          );
        }
        const listingIds = JSON.parse(
          window.localStorage.getItem('bolty.market.favorites.v1') || '[]',
        );
        if (Array.isArray(listingIds) && listingIds.length > 0) {
          void prefetch(`favorites:listings:${listingIds.join(',')}`, () =>
            api.get(`/market/by-ids?ids=${encodeURIComponent(listingIds.join(','))}`),
          );
        }
      } catch {
        /* localStorage parse error — ignore, the saved tab will fetch on click */
      }
    });
  }, [user]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        refresh: fetchUser,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
