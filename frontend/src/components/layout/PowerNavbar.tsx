'use client';

import {
  Bell,
  Copy,
  Github,
  KeyRound,
  LogOut,
  Menu,
  Package,
  Search,
  Settings,
  ShoppingBag,
  User as UserIcon,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';

import { MarketTicker } from '@/components/layout/MarketTicker';
import { NAV, isItemActive } from '@/components/layout/StandardSidebar';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { API_URL, api } from '@/lib/api/client';
import { type User, useAuth } from '@/lib/auth/AuthProvider';
import { useNotificationsPoll } from '@/lib/hooks/useNotifications';
import { getMetaMaskProvider } from '@/lib/wallet/ethereum';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function humanizeSegment(seg: string): string {
  // Don't try to humanize IDs (uuid-ish) — keep them as-is but shortened
  if (seg.length > 20 && /^[a-z0-9-]+$/i.test(seg)) return `${seg.slice(0, 6)}…${seg.slice(-4)}`;
  if (/^[0-9a-f]{24,}$/i.test(seg)) return `${seg.slice(0, 6)}…${seg.slice(-4)}`;
  return seg
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

interface Crumb {
  label: string;
  href: string;
}

function buildCrumbs(pathname: string): Crumb[] {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 0) return [{ label: 'Overview', href: '/' }];
  const crumbs: Crumb[] = [];
  let acc = '';
  for (const p of parts) {
    acc += '/' + p;
    crumbs.push({ label: humanizeSegment(p), href: acc });
  }
  return crumbs;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main navbar
// ─────────────────────────────────────────────────────────────────────────────

export function PowerNavbar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, logout, isAuthenticated, refresh } = useAuth();
  const { count: unreadCount } = useNotificationsPoll(isAuthenticated);

  const crumbs = useMemo(() => buildCrumbs(pathname), [pathname]);

  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  // Mobile/tablet drawer — sidebar is hidden below lg, so this is the only
  // way to reach the main nav on smaller viewports.
  const [navDrawerOpen, setNavDrawerOpen] = useState(false);

  // Close drawer whenever the route changes so tapping a link feels right.
  useEffect(() => {
    setNavDrawerOpen(false);
  }, [pathname]);

  // Lock body scroll when drawer is open.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (navDrawerOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [navDrawerOpen]);

  useEffect(() => {
    if (!profileOpen) return;
    function onDocClick(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [profileOpen]);

  return (
    <div className="sticky top-0 z-50">
      <header
        className="flex items-center gap-3 px-[18px]"
        style={{
          position: 'relative',
          zIndex: 2,
          height: '56px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-card)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
        }}
      >
        {/* Mobile/tablet hamburger — sidebar is hidden below lg */}
        <button
          type="button"
          onClick={() => setNavDrawerOpen(true)}
          className="lg:hidden grid place-items-center rounded-lg transition-colors shrink-0"
          style={{
            width: '34px',
            height: '34px',
            color: 'var(--text-secondary)',
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid var(--border)',
          }}
          aria-label="Open menu"
          aria-expanded={navDrawerOpen}
        >
          <Menu className="w-[16px] h-[16px]" strokeWidth={1.75} />
        </button>

        {/* Breadcrumbs */}
        <nav className="flex items-center gap-2 text-[13px] min-w-0 shrink">
          {crumbs.map((c, i) => {
            const isLast = i === crumbs.length - 1;
            return (
              <React.Fragment key={c.href + i}>
                {i > 0 && (
                  <span className="font-mono shrink-0" style={{ color: 'var(--text-muted)' }}>
                    /
                  </span>
                )}
                <Link
                  href={c.href}
                  className="transition-colors truncate"
                  style={{
                    color: isLast ? 'var(--text)' : 'var(--text-muted)',
                    fontWeight: isLast ? 400 : 300,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text)')}
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.color = isLast ? 'var(--text)' : 'var(--text-muted)')
                  }
                >
                  {c.label}
                </Link>
              </React.Fragment>
            );
          })}
        </nav>

        <div className="flex-1" />

        {/* Command search — direct-typing input. Pressing Enter routes to
            /market with the query; ⌘K opens the legacy palette. The user
            wanted to type without an intermediate popup. */}
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget as HTMLFormElement);
            const q = String(fd.get('q') || '').trim();
            if (q) router.push(`/market?search=${encodeURIComponent(q)}`);
          }}
          className="hidden md:flex items-center gap-[10px] rounded-lg cursor-text relative"
          style={{
            width: '360px',
            maxWidth: '36vw',
            padding: '8px 12px',
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            transition: 'border-color 140ms ease',
          }}
          onFocusCapture={(e) => {
            (e.currentTarget as HTMLFormElement).style.borderColor = 'rgba(20, 241, 149, 0.55)';
          }}
          onBlurCapture={(e) => {
            (e.currentTarget as HTMLFormElement).style.borderColor = 'var(--border)';
          }}
        >
          <Search className="w-[14px] h-[14px] shrink-0 text-[var(--text-muted)]" strokeWidth={2} />
          <input
            name="q"
            type="search"
            placeholder="Search agents, repos, wallets…"
            className="flex-1 bg-transparent outline-none text-[13px] font-light text-[var(--text)] placeholder:text-[var(--text-muted)] min-w-0"
            aria-label="Search marketplace"
          />
          <kbd
            className="font-mono rounded shrink-0 hidden lg:inline-flex"
            style={{
              fontSize: '10px',
              padding: '1px 5px',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              color: 'var(--text-muted)',
            }}
            title="Press ⌘K to open the command palette"
          >
            ⌘K
          </kbd>
        </form>

        {/* Wallet + GitHub quick-connect chips */}
        {isAuthenticated && <NavConnectChips user={user} refresh={refresh} />}

        {/* Theme toggle (sun ↔ moon). Persistent on every authenticated
            page so the user can switch palette from anywhere. */}
        <ThemeToggle size={32} className="shrink-0" />

        {/* Notification bell (signed-in only) */}
        {isAuthenticated && (
          <button
            type="button"
            onClick={() => router.push('/notifications')}
            className="relative grid place-items-center rounded-lg transition-colors"
            style={{ width: '32px', height: '32px', color: 'var(--text-muted)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--text)';
              e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-muted)';
              e.currentTarget.style.background = 'transparent';
            }}
            title="Notifications"
            aria-label="Notifications"
          >
            <Bell className="w-[15px] h-[15px]" strokeWidth={1.6} />
            {isAuthenticated && unreadCount > 0 && (
              <span
                className="absolute inline-flex items-center justify-center"
                style={{
                  top: '2px',
                  right: '2px',
                  minWidth: '15px',
                  height: '15px',
                  padding: '0 4px',
                  borderRadius: '999px',
                  background: '#14F195',
                  color: 'white',
                  fontSize: '9.5px',
                  fontWeight: 600,
                  lineHeight: 1,
                  border: '1.5px solid var(--bg)',
                }}
              >
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>
        )}

        {/* Signed-out: show Sign in CTA — atlas-cta black/white pill. */}
        {!isAuthenticated && (
          <Link
            href="/auth"
            className="atlas-cta inline-flex items-center px-4 h-8 rounded-lg text-[13px] font-medium tracking-tight"
          >
            Sign in
          </Link>
        )}

        {/* Avatar (signed-in only) */}
        {isAuthenticated && (
          <div ref={profileRef} className="relative" style={{ overflow: 'visible' }}>
            <button
              type="button"
              onClick={() => setProfileOpen((v) => !v)}
              className="relative flex items-center gap-2 rounded-full transition-colors"
              style={{ padding: '5px', overflow: 'visible' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              aria-label="Account menu"
            >
              {/* Uniform brand-green ring around the avatar — replaces
                  the previous bottom-right dot + inset shine that looked
                  uneven and noisy. */}
              <span className="block rounded-full" style={{ boxShadow: '0 0 0 2px var(--brand)' }}>
                <UserAvatar
                  src={user?.avatarUrl}
                  name={user?.displayName || user?.username}
                  userId={user?.id}
                  size={28}
                />
              </span>
            </button>

            {profileOpen && (
              <div
                role="menu"
                aria-label="Account menu"
                className="absolute right-0 mt-2 rounded-xl overflow-hidden z-50 flex flex-col bg-[var(--bg-card)] border border-[var(--border)] shadow-[0_20px_48px_-8px_rgba(0,0,0,0.45)] motion-safe:animate-[atlas-menu-in_180ms_cubic-bezier(0.22,0.61,0.36,1)_both]"
                style={{
                  top: 'calc(100% + 8px)',
                  minWidth: '244px',
                  maxWidth: 'calc(100vw - 16px)',
                  maxHeight: 'calc(100vh - 80px)',
                }}
              >
                {/* Top brand hairline — same accent treatment as cards */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 top-0 h-px"
                  style={{
                    background:
                      'linear-gradient(90deg, transparent 0%, var(--brand) 50%, transparent 100%)',
                    opacity: 0.5,
                  }}
                />

                {/* Identity header */}
                <div className="px-3.5 py-3 flex items-center gap-3 shrink-0 border-b border-[var(--border)]">
                  <div className="flex-shrink-0">
                    <UserAvatar
                      src={user?.avatarUrl}
                      name={user?.displayName || user?.username}
                      userId={user?.id}
                      size={36}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold leading-tight truncate text-[var(--text)]">
                      {user?.displayName || user?.username || 'Account'}
                    </p>
                    {user?.username && (
                      <p className="text-[11.5px] leading-tight truncate mt-0.5 text-[var(--text-muted)]">
                        @{user.username}
                      </p>
                    )}
                  </div>
                </div>

                {/* Primary actions */}
                <div className="py-1 overflow-y-auto flex-1 min-h-0">
                  <DropdownLink
                    href="/profile"
                    label="Profile"
                    icon={UserIcon}
                    onSelect={() => setProfileOpen(false)}
                  />
                  <DropdownLink
                    href="/inventory"
                    label="Inventory"
                    icon={Package}
                    onSelect={() => setProfileOpen(false)}
                  />
                  <DropdownLink
                    href="/orders"
                    label="Orders"
                    icon={ShoppingBag}
                    onSelect={() => setProfileOpen(false)}
                  />
                  <DropdownLink
                    href="/api-keys"
                    label="API keys"
                    icon={KeyRound}
                    onSelect={() => setProfileOpen(false)}
                  />
                  <DropdownLink
                    href="/profile?tab=security"
                    label="Settings"
                    icon={Settings}
                    onSelect={() => setProfileOpen(false)}
                  />
                </div>

                {/* Sign out — destructive footer action */}
                <button
                  type="button"
                  onClick={async () => {
                    setProfileOpen(false);
                    await logout?.();
                    router.push('/');
                  }}
                  className="group w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] font-semibold text-red-400 hover:text-red-300 hover:bg-red-500/8 transition-colors shrink-0 border-t border-[var(--border)]"
                >
                  <LogOut
                    className="w-3.5 h-3.5 shrink-0 opacity-80 group-hover:opacity-100"
                    strokeWidth={1.75}
                  />
                  Sign out
                </button>
              </div>
            )}
          </div>
        )}
      </header>
      <MarketTicker />

      {/* Mobile/tablet navigation drawer */}
      {navDrawerOpen && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setNavDrawerOpen(false)}
            className="lg:hidden fixed inset-0 z-[60]"
            style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(2px)' }}
          />
          <aside
            className="lg:hidden fixed top-0 left-0 bottom-0 z-[61] flex flex-col"
            style={{
              width: '86%',
              maxWidth: '320px',
              height: '100dvh',
              background: 'var(--bg-card)',
              borderRight: '1px solid var(--border)',
              fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
            }}
          >
            <div
              className="flex items-center justify-between px-4 h-[56px] shrink-0"
              style={{ borderBottom: '1px solid var(--border)' }}
            >
              <Link
                href="/"
                onClick={() => setNavDrawerOpen(false)}
                className="flex items-center gap-2.5 min-w-0"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/haggl-logo.png"
                  alt="haggl"
                  width={28}
                  height={28}
                  className="rounded-md shrink-0"
                  style={{ display: 'block' }}
                />
                <span
                  className="text-[15px] font-semibold text-[var(--text)] truncate"
                  style={{ letterSpacing: '0.04em' }}
                >
                  HAGGL
                </span>
              </Link>
              <button
                type="button"
                onClick={() => setNavDrawerOpen(false)}
                aria-label="Close menu"
                className="grid place-items-center rounded-lg transition-colors"
                style={{
                  width: '32px',
                  height: '32px',
                  color: 'var(--text-secondary)',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid var(--border)',
                }}
              >
                <X className="w-[15px] h-[15px]" strokeWidth={1.75} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-2 py-3">
              {NAV.map((sect) => (
                <div key={sect.section} className="mt-4 first:mt-0">
                  <div
                    className="font-mono text-[10px] uppercase px-3 pb-1.5"
                    style={{ color: 'var(--text-muted)', letterSpacing: '0.12em' }}
                  >
                    {sect.section}
                  </div>
                  {sect.items.map((item) => {
                    const Icon = item.icon;
                    const params = searchParams ?? new URLSearchParams();
                    const active = isItemActive(pathname, params, item.href);
                    return (
                      <React.Fragment key={item.label}>
                        <Link
                          href={item.href}
                          onClick={() => setNavDrawerOpen(false)}
                          className="flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors"
                          style={{
                            color: active ? 'var(--text)' : 'var(--text-secondary)',
                            background: active ? 'rgba(20, 241, 149, 0.10)' : 'transparent',
                            fontSize: '14px',
                            fontWeight: 300,
                          }}
                        >
                          <Icon
                            className="w-[15px] h-[15px] shrink-0"
                            style={{ color: active ? '#6ee7b7' : 'var(--text-muted)' }}
                            strokeWidth={1.75}
                          />
                          <span className="flex-1 truncate">{item.label}</span>
                        </Link>
                        {item.children?.map((child) => {
                          const ChildIcon = child.icon;
                          const childActive = isItemActive(pathname, params, child.href);
                          return (
                            <Link
                              key={child.href}
                              href={child.href}
                              onClick={() => setNavDrawerOpen(false)}
                              className="flex items-center gap-3 ml-6 pl-3 pr-3 py-2 rounded-md transition-colors relative"
                              style={{
                                color: childActive ? 'var(--text)' : 'var(--text-secondary)',
                                background: childActive
                                  ? 'rgba(20, 241, 149, 0.10)'
                                  : 'transparent',
                                fontSize: '13px',
                                fontWeight: 300,
                                borderLeft: '1px solid var(--border)',
                              }}
                            >
                              {ChildIcon && (
                                <ChildIcon
                                  className="w-[14px] h-[14px] shrink-0"
                                  style={{ color: childActive ? '#6ee7b7' : 'var(--text-muted)' }}
                                  strokeWidth={1.75}
                                />
                              )}
                              <span className="flex-1 truncate">{child.label}</span>
                            </Link>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </div>
              ))}
            </div>

            {!isAuthenticated && (
              <div className="p-3" style={{ borderTop: '1px solid var(--border)' }}>
                <Link
                  href="/auth"
                  onClick={() => setNavDrawerOpen(false)}
                  className="atlas-cta flex items-center justify-center h-10 rounded-xl text-[13px] font-medium tracking-tight"
                >
                  Sign in
                </Link>
              </div>
            )}
          </aside>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Wallet + GitHub quick-connect chips shown in the navbar
// ─────────────────────────────────────────────────────────────────────────────

function NavConnectChips({ user, refresh }: { user: User | null; refresh: () => Promise<void> }) {
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletErr, setWalletErr] = useState('');
  const [copied, setCopied] = useState(false);
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const walletMenuRef = useRef<HTMLDivElement>(null);

  const walletAddress = user?.walletAddress ?? null;
  const githubLogin = user?.githubLogin ?? null;
  const githubAvatar = user?.avatarUrl ?? null;

  // Close wallet menu on outside click
  useEffect(() => {
    if (!walletMenuOpen) return;
    const close = (e: MouseEvent) => {
      if (walletMenuRef.current && !walletMenuRef.current.contains(e.target as Node)) {
        setWalletMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [walletMenuOpen]);

  const handleLinkWallet = useCallback(async () => {
    setWalletLoading(true);
    setWalletErr('');
    try {
      const eth = getMetaMaskProvider();
      if (!eth) {
        setWalletErr('MetaMask not detected');
        return;
      }
      const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
      const address = accounts[0];
      if (!address) return;
      const { nonce, message } = await api.post<{ nonce: string; message: string }>(
        '/auth/link/wallet/nonce',
        { address },
      );
      const signature = (await eth.request({
        method: 'personal_sign',
        params: [message, address],
      })) as string;
      await api.post('/auth/link/wallet', { address, signature, nonce });
      await refresh();
    } catch (err) {
      setWalletErr(err instanceof Error ? err.message : 'Connection failed');
      setTimeout(() => setWalletErr(''), 4000);
    } finally {
      setWalletLoading(false);
    }
  }, [refresh]);

  const handleLinkGitHub = useCallback(() => {
    window.location.href = `${API_URL}/auth/github`;
  }, []);

  const handleCopyAddress = useCallback(() => {
    if (!walletAddress) return;
    navigator.clipboard.writeText(walletAddress).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [walletAddress]);

  const handleDisconnectWallet = useCallback(async () => {
    if (!walletAddress || disconnecting) return;
    setDisconnecting(true);
    setWalletErr('');
    // Fire the disconnect and refresh, but swallow any noise that comes
    // after — the unlink itself persists on the backend even when
    // follow-up calls hiccup, and surfacing a 500 here confused users
    // ('disconnected fine but shows error'). Any real failure shows up
    // on the next page load when /auth/me is re-fetched.
    await api.delete('/auth/link/wallet').catch(() => void 0);
    await refresh().catch(() => void 0);
    setWalletMenuOpen(false);
    setDisconnecting(false);
  }, [walletAddress, disconnecting, refresh]);

  return (
    <div className="hidden lg:flex items-center gap-1.5">
      {/* ── Wallet chip ───────────────────────────────── */}
      {walletAddress ? (
        <div ref={walletMenuRef} className="relative">
          <button
            type="button"
            onClick={() => setWalletMenuOpen((v) => !v)}
            title={walletAddress}
            className="flex items-center gap-1.5 rounded-lg transition-colors"
            style={{
              padding: '5px 9px',
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              fontSize: '11.5px',
              color: 'var(--text-secondary)',
              fontFamily: 'monospace',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-hover)';
              e.currentTarget.style.color = 'var(--text)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.color = 'var(--text-secondary)';
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: '#22c55e',
                flexShrink: 0,
                display: 'inline-block',
              }}
            />
            {`${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`}
          </button>
          {walletMenuOpen && (
            <div
              className="absolute right-0 top-full mt-1.5 z-50 overflow-hidden"
              style={{
                minWidth: 220,
                background: 'var(--bg-card)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 10,
                boxShadow: '0 10px 30px -10px rgba(0,0,0,0.6)',
              }}
            >
              <div
                className="px-3 py-2 text-[11px] font-mono"
                style={{
                  color: 'var(--text-secondary)',
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                {walletAddress.slice(0, 10)}…{walletAddress.slice(-8)}
              </div>
              <button
                type="button"
                onClick={handleCopyAddress}
                className="w-full flex items-center gap-2 px-3 py-2 text-[12.5px] text-zinc-300 hover:bg-white/[0.04] hover:text-white transition-colors"
              >
                <Copy className="w-3.5 h-3.5" strokeWidth={2} />
                {copied ? 'Copied!' : 'Copy address'}
              </button>
              <button
                type="button"
                onClick={handleDisconnectWallet}
                disabled={disconnecting}
                className="w-full flex items-center gap-2 px-3 py-2 text-[12.5px] transition-colors disabled:opacity-50"
                style={{
                  color: '#fca5a5',
                  borderTop: '1px solid rgba(255,255,255,0.06)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(244,63,94,0.08)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <LogOut className="w-3.5 h-3.5" strokeWidth={2} />
                {disconnecting ? 'Disconnecting…' : 'Disconnect wallet'}
              </button>
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={handleLinkWallet}
          disabled={walletLoading}
          title={walletErr || 'Connect MetaMask wallet'}
          className="flex items-center gap-1.5 rounded-lg transition-colors"
          style={{
            padding: '5px 9px',
            background: 'rgba(20, 241, 149, 0.07)',
            border: `1px solid ${walletErr ? 'rgba(239,68,68,0.4)' : 'rgba(20, 241, 149, 0.22)'}`,
            fontSize: '11.5px',
            color: walletErr ? '#f87171' : '#6ee7b7',
            opacity: walletLoading ? 0.7 : 1,
          }}
          onMouseEnter={(e) => {
            if (!walletErr) e.currentTarget.style.background = 'rgba(20, 241, 149, 0.14)';
          }}
          onMouseLeave={(e) => {
            if (!walletErr) e.currentTarget.style.background = 'rgba(20, 241, 149, 0.07)';
          }}
        >
          <Wallet className="w-[12px] h-[12px] shrink-0" strokeWidth={1.75} />
          {walletLoading ? 'Connecting…' : walletErr ? walletErr : 'Connect Wallet'}
        </button>
      )}

      {/* ── GitHub chip ───────────────────────────────── */}
      {githubLogin ? (
        <div
          className="flex items-center gap-1.5 rounded-lg"
          style={{
            padding: '5px 9px',
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            fontSize: '11.5px',
            color: 'var(--text-secondary)',
          }}
        >
          {githubAvatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={githubAvatar}
              alt={githubLogin}
              style={{ width: 14, height: 14, borderRadius: '50%', flexShrink: 0 }}
            />
          ) : (
            <Github className="w-[12px] h-[12px] shrink-0" strokeWidth={1.75} />
          )}
          <span>@{githubLogin}</span>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleLinkGitHub}
          className="flex items-center gap-1.5 rounded-lg transition-colors"
          style={{
            padding: '5px 9px',
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid var(--border)',
            fontSize: '11.5px',
            color: 'var(--text-muted)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--text)';
            e.currentTarget.style.borderColor = 'var(--border-hover)';
            e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--text-muted)';
            e.currentTarget.style.borderColor = 'var(--border)';
            e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
          }}
        >
          <Github className="w-[12px] h-[12px] shrink-0" strokeWidth={1.75} />
          Link GitHub
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function DropdownLink({
  href,
  label,
  icon: Icon,
  onSelect,
}: {
  href: string;
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onSelect}
      role="menuitem"
      className="group flex items-center gap-2.5 px-3.5 py-2 text-[13px] font-semibold text-[var(--text-secondary)] hover:text-[var(--text)] hover:bg-[var(--bg-card2)] transition-colors"
    >
      {Icon && (
        <Icon
          className="w-3.5 h-3.5 shrink-0 text-[var(--text-muted)] group-hover:text-[var(--brand)] transition-colors"
          strokeWidth={1.75}
        />
      )}
      <span className="truncate">{label}</span>
    </Link>
  );
}
