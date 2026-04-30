'use client';

import { AnimatePresence, motion } from 'framer-motion';
import {
  Bell,
  Bot,
  ChevronRight,
  FileText,
  Flame,
  GitBranch,
  LayoutGrid,
  Package,
  Search,
  Settings,
  ShoppingBag,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import React, { useEffect, useRef, useState } from 'react';

import { api } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/AuthProvider';
import { prefetch } from '@/lib/cache/pageCache';

// Kick off API fetches for the most likely-visited pages the moment
// the user's cursor touches the sidebar row. The prefetch module
// dedupes in-flight calls and skips if fresh (<30s), so repeated
// hover doesn't spam the network.
function prefetchForHref(href: string) {
  const base = href.split('?')[0];
  switch (base) {
    case '/market':
      void prefetch('market:listings', () =>
        api.get<{ data: unknown[] }>('/market?page=1&sortBy=recent').then((r) => r?.data ?? []),
      );
      void prefetch('market:pulse', () => api.get('/market/pulse?limit=20'));
      break;
    case '/market/agents':
      void prefetch('market:agents:type=AI_AGENT&sortBy=recent', () =>
        api
          .get<{ data: unknown[] }>('/market?type=AI_AGENT&sortBy=recent')
          .then((r) => r?.data ?? []),
      );
      break;
    case '/market/repos':
      void prefetch('market:repos:sortBy=recent', () =>
        api.get<{ data: unknown[] }>('/market?type=REPO&sortBy=recent').then((r) => r?.data ?? []),
      );
      break;
    case '/market/sellers':
      void prefetch('market:top-sellers:48', () => api.get('/market/top-sellers?limit=48'));
      break;
    case '/orders':
      void prefetch('orders:buyer', () => api.get('/orders'));
      void prefetch('orders:seller', () => api.get('/orders/selling'));
      void prefetch('orders:stats', () => api.get('/orders/seller/stats'));
      break;
    case '/inventory':
      void prefetch('inventory:data', () => api.get('/market/my-inventory'));
      break;
    case '/notifications':
      void prefetch('notifications:list', () => api.get('/notifications'));
      break;
    default:
      break;
  }
}

interface NavChild {
  label: string;
  icon?: LucideIcon;
  href: string;
}

interface NavItem {
  label: string;
  icon: LucideIcon;
  href: string;
  count?: number;
  badge?: string;
  hot?: boolean;
  dot?: boolean;
  kbd?: string;
  children?: NavChild[];
}

interface NavSection {
  section: string;
  items: NavItem[];
}

export const NAV: NavSection[] = [
  {
    section: 'Discover',
    items: [
      {
        label: 'Marketplace',
        icon: LayoutGrid,
        href: '/market',
        children: [
          { label: 'Agents', icon: Bot, href: '/market/agents' },
          { label: 'Repos', icon: GitBranch, href: '/market/repos' },
        ],
      },
    ],
  },
  {
    section: 'My work',
    items: [
      { label: 'Inventory', icon: Package, href: '/inventory' },
      { label: 'Orders', icon: ShoppingBag, href: '/orders' },
    ],
  },
  {
    section: 'Community',
    items: [{ label: 'Notifications', icon: Bell, href: '/notifications' }],
  },
  {
    section: 'Account',
    items: [
      { label: 'Settings', icon: Settings, href: '/profile' },
      { label: 'How it works', icon: FileText, href: '/how-it-works' },
    ],
  },
];

export function isItemActive(
  pathname: string | null,
  searchParams: URLSearchParams | null,
  href: string,
): boolean {
  const path = pathname ?? '';
  const tab = searchParams?.get('tab') ?? null;
  const [cleanHref, query] = href.split('?');
  if (cleanHref === '/market') return path === '/market';
  if (cleanHref === '/profile') {
    if (!(path === '/profile' || path.startsWith('/profile/'))) return false;
    if (query) {
      const expected = new URLSearchParams(query);
      return expected.get('tab') === tab;
    }
    return !tab || tab === 'profile';
  }
  if (cleanHref === '/inventory') {
    if (path !== '/inventory') return false;
    if (query) {
      const expected = new URLSearchParams(query);
      return expected.get('tab') === tab;
    }
    return !tab;
  }
  return path === cleanHref || path.startsWith(cleanHref + '/');
}

function shortenAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr || '';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function StandardSidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user, logout } = useAuth();

  const walletAddress = user?.walletAddress ?? '0x4f2a0000000000000000000000000000000000E91c';
  const isAuthenticated = !!user;

  return (
    <aside
      className="mk-app-sidebar hidden lg:flex lg:sticky lg:top-0 lg:h-screen flex-col overflow-hidden w-[264px] shrink-0"
      style={{
        background: 'var(--bg-card)',
        borderRight: '1px solid var(--border)',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Brand: CSS wordmark + tagline. Replace with image asset later. */}
      <Link
        href="/"
        className="flex items-center justify-center gap-2.5 h-16 px-[14px] transition-colors hover:bg-[var(--bg-card2)]"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/haggl-logo.png"
          alt="HAGGL"
          width={32}
          height={32}
          className="rounded-md shrink-0"
          style={{ display: 'block' }}
        />
        <span
          className="text-[18px] font-semibold text-[var(--text)]"
          style={{ letterSpacing: '0.04em' }}
        >
          HAGGL
        </span>
      </Link>

      {/* Search trigger — click or ⌘K to open the palette */}
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent('haggl:open-command'))}
        className="mx-3 mt-3 mb-2 flex items-center gap-2 px-[10px] py-[7px] rounded-lg text-[12.5px] transition-colors cursor-text"
        style={{
          background: 'var(--bg)',
          border: '1px solid rgba(255,255,255,0.08)',
          color: 'var(--text-secondary)',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.16)')}
        onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)')}
      >
        <Search className="w-3 h-3 shrink-0" strokeWidth={2} />
        <span className="flex-1 text-left">Jump to…</span>
        <kbd
          className="font-mono text-[10px] px-[5px] py-[2px] rounded"
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: 'var(--text-secondary)',
          }}
        >
          ⌘K
        </kbd>
      </button>

      {/* Scroll area with sections */}
      <div className="flex-1 overflow-y-auto px-2 pt-1 pb-3">
        {NAV.map((sect) => (
          <div key={sect.section} className="mt-4 first:mt-0">
            <div
              className="font-mono text-[10px] uppercase px-[10px] pb-[6px]"
              style={{ color: 'var(--text)', letterSpacing: '0.16em', fontWeight: 600 }}
            >
              {sect.section.toUpperCase()}
            </div>
            {sect.items.map((item) => {
              const Icon = item.icon;
              const active = isItemActive(pathname, searchParams, item.href);
              return <SidebarItem key={item.label} item={item} Icon={Icon} active={active} />;
            })}
          </div>
        ))}
      </div>

      {/* Footer: wallet chip + disconnect when signed in, Sign-in CTA when signed out */}
      <div
        className="p-3"
        style={{
          background: 'linear-gradient(180deg, transparent, rgba(20, 241, 149, 0.04))',
        }}
      >
        {isAuthenticated ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-[6px]">
              <span
                className="w-[6px] h-[6px] rounded-full"
                style={{
                  background: '#22c55e',
                  boxShadow: '0 0 8px rgba(34,197,94,0.6)',
                }}
              />
              <span className="font-mono text-[11px]" style={{ color: 'var(--text)' }}>
                {shortenAddress(walletAddress)}
              </span>
            </div>
            <button
              type="button"
              onClick={() => logout?.()}
              className="font-mono text-[10px] transition-colors"
              style={{ color: 'var(--text)' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#ef4444')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text)')}
            >
              disconnect
            </button>
          </div>
        ) : (
          <Link
            href="/auth"
            className="block text-center rounded-md py-2 text-[12px] transition-colors"
            style={{
              background: 'rgba(20, 241, 149, 0.15)',
              border: '1px solid rgba(20, 241, 149, 0.3)',
              color: 'var(--text)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(20, 241, 149, 0.25)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(20, 241, 149, 0.15)')}
          >
            Sign in
          </Link>
        )}
      </div>
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function SidebarItem({ item, Icon, active }: { item: NavItem; Icon: LucideIcon; active: boolean }) {
  const pathname = usePathname();
  const hasChildren = !!item.children && item.children.length > 0;

  // Child is considered active if its exact href matches the current route
  const childActiveHref = hasChildren
    ? item.children!.find(
        (c) => pathname === c.href.split('?')[0] || pathname.startsWith(c.href.split('?')[0] + '/'),
      )?.href
    : undefined;

  // Auto-open when a child is active (e.g. landing on /market/agents)
  const [open, setOpen] = useState<boolean>(!!childActiveHref || active);
  useEffect(() => {
    if (childActiveHref) setOpen(true);
  }, [childActiveHref]);

  // Hover-to-open with a short close delay so crossing the parent↔children
  // gap doesn't snap it shut.
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimerRef.current = setTimeout(() => {
      // Only close if nothing inside keeps it pinned open
      if (!childActiveHref) setOpen(false);
    }, 120);
  };
  useEffect(() => () => cancelClose(), []);

  const handleGroupEnter = () => {
    if (!hasChildren) return;
    cancelClose();
    setOpen(true);
  };
  const handleGroupLeave = () => {
    if (!hasChildren) return;
    scheduleClose();
  };

  const iconColor = active ? '#6ee7b7' : 'var(--text)';

  const rowStyle: React.CSSProperties = {
    gridTemplateColumns: '10px 16px 1fr auto',
    color: active ? 'var(--text)' : 'var(--text)',
    background: active ? 'rgba(20, 241, 149, 0.08)' : 'transparent',
    fontSize: '13px',
    fontWeight: 300,
  };

  const rowClassName =
    'grid items-center gap-[10px] px-[10px] py-[7px] rounded-md transition-colors group relative w-full text-left';

  const handleMouseEnter = (e: React.MouseEvent<HTMLElement>) => {
    if (!active) {
      e.currentTarget.style.color = 'var(--text)';
      e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
    }
    const iconEl = e.currentTarget.querySelector<HTMLElement>('[data-side-icon]');
    if (iconEl) iconEl.style.color = '#6ee7b7';
    const kbdEl = e.currentTarget.querySelector<HTMLElement>('[data-side-kbd]');
    if (kbdEl) kbdEl.style.opacity = '1';
    // Prefetch API data for the most common destinations so by the time
    // the user actually clicks, the page renders from cache instantly.
    prefetchForHref(item.href);
  };

  const handleMouseLeave = (e: React.MouseEvent<HTMLElement>) => {
    if (!active) {
      e.currentTarget.style.color = 'var(--text)';
      e.currentTarget.style.background = 'transparent';
    }
    const iconEl = e.currentTarget.querySelector<HTMLElement>('[data-side-icon]');
    if (iconEl) iconEl.style.color = iconColor;
    const kbdEl = e.currentTarget.querySelector<HTMLElement>('[data-side-kbd]');
    if (kbdEl) kbdEl.style.opacity = '0';
  };

  const body = (
    <>
      <span
        className="font-mono leading-none"
        style={{ fontSize: '13px', color: '#14F195', width: '10px' }}
      >
        {active ? '›' : ''}
      </span>
      <span className="flex" style={{ color: iconColor }} data-side-icon>
        <Icon className="w-4 h-4" strokeWidth={1.5} />
      </span>
      <span className="truncate whitespace-nowrap">{item.label}</span>
      <SidebarItemMeta item={item} open={open} />
    </>
  );

  if (!hasChildren) {
    return (
      <Link
        href={item.href}
        className={rowClassName}
        style={rowStyle}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {body}
      </Link>
    );
  }

  return (
    <div onMouseEnter={handleGroupEnter} onMouseLeave={handleGroupLeave}>
      <Link
        href={item.href}
        aria-expanded={open}
        className={rowClassName}
        style={rowStyle}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {body}
      </Link>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="children"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 0.61, 0.36, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div className="mt-0.5 mb-1 pl-[22px] relative">
              {/* left rail */}
              <span
                className="absolute top-1 bottom-1 w-px"
                style={{ left: '15px', background: 'var(--border)' }}
              />
              {item.children!.map((c) => {
                const ChildIcon = c.icon;
                const isActive =
                  pathname === c.href.split('?')[0] ||
                  pathname.startsWith(c.href.split('?')[0] + '/');
                return (
                  <Link
                    key={c.href}
                    href={c.href}
                    className="flex items-center gap-[10px] px-[10px] py-[6px] rounded-md transition-colors"
                    style={{
                      color: 'var(--text)',
                      background: isActive ? 'rgba(20, 241, 149, 0.08)' : 'transparent',
                      fontSize: '12.5px',
                      fontWeight: 300,
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                      }
                      // Same prefetch story as parent rows — child rows
                      // (Agents, Repos under Marketplace) are clicked the
                      // most, so warming pageCache on hover means the
                      // landing render is instant.
                      prefetchForHref(c.href);
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.background = 'transparent';
                      }
                    }}
                  >
                    {ChildIcon && (
                      <ChildIcon
                        className="w-[14px] h-[14px] shrink-0"
                        strokeWidth={1.5}
                        style={{ color: isActive ? '#6ee7b7' : 'var(--text)' }}
                      />
                    )}
                    <span className="truncate">{c.label}</span>
                  </Link>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SidebarItemMeta({ item, open }: { item: NavItem; open?: boolean }) {
  if (item.children && item.children.length > 0) {
    return (
      <ChevronRight
        className="w-[14px] h-[14px] transition-transform"
        strokeWidth={1.75}
        style={{
          color: 'var(--text-muted)',
          transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
        }}
      />
    );
  }
  if (item.badge) {
    return (
      <span
        className="inline-flex items-center gap-[5px] font-mono"
        style={{
          fontSize: '10px',
          padding: '1px 6px',
          borderRadius: '4px',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          color: 'var(--text-secondary)',
        }}
      >
        <span
          className="w-[5px] h-[5px] rounded-full animate-pulse"
          style={{ background: '#22c55e' }}
        />
        {item.badge}
      </span>
    );
  }
  if (item.count != null) {
    return (
      <span
        className="font-mono"
        style={{
          fontSize: '10.5px',
          padding: '1px 6px',
          borderRadius: '999px',
          background: item.dot ? '#14F195' : 'var(--bg-elevated)',
          border: item.dot ? 'none' : '1px solid var(--border)',
          color: item.dot ? 'white' : 'var(--text-muted)',
        }}
      >
        {item.count}
      </span>
    );
  }
  if (item.hot) {
    return <Flame className="w-[14px] h-[14px]" strokeWidth={1.75} style={{ color: '#f59e0b' }} />;
  }
  if (item.kbd) {
    return (
      <span
        className="font-mono"
        style={{
          fontSize: '10px',
          color: 'var(--text-muted)',
          letterSpacing: '0.05em',
          opacity: 0,
          transition: 'opacity 120ms',
        }}
        data-side-kbd
      >
        {item.kbd}
      </span>
    );
  }
  return null;
}
