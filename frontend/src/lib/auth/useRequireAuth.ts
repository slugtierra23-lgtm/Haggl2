'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { useAuth } from '@/lib/auth/AuthProvider';
import { useToast } from '@/lib/hooks/useToast';

interface Options {
  /** Where to send the user if they're not logged in. Defaults to /auth. */
  redirectTo?: string;
  /** Toast message shown on the redirect. */
  message?: string;
}

/**
 * Gate a page behind login. While auth is resolving (`isLoading`) we
 * render nothing so the page doesn't flash then redirect. Once resolved
 * and unauthenticated, we emit a single toast explaining why they got
 * bounced and push them to /auth (NOT /auth/login which doesn't exist
 * and used to 404).
 *
 * Usage:
 *   const { isAuthenticated, isLoading } = useRequireAuth();
 *   if (isLoading || !isAuthenticated) return null;
 *   // render the protected content
 */
export function useRequireAuth({
  redirectTo = '/auth',
  message = 'Sign in or create an account to access this page.',
}: Options = {}) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const router = useRouter();
  const { addToast } = useToast();
  const notifiedRef = useRef(false);

  useEffect(() => {
    if (isLoading) return;
    if (isAuthenticated) return;
    if (notifiedRef.current) return;
    notifiedRef.current = true;
    try {
      addToast(message, 'info', 5000);
    } catch {
      /* no-op if toast provider missing */
    }
    // Preserve the attempted URL so we can hop back after login.
    const next =
      typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search}` : '';
    const target =
      next && next !== '/' ? `${redirectTo}?next=${encodeURIComponent(next)}` : redirectTo;
    router.replace(target);
  }, [isLoading, isAuthenticated, redirectTo, message, router, addToast]);

  return { isAuthenticated, isLoading, user };
}
