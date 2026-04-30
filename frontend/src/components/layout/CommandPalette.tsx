'use client';

import { AnimatePresence, motion } from 'framer-motion';
import {
  BarChart3,
  Bell,
  Bot,
  GitBranch,
  Hash,
  Heart,
  Home,
  Library,
  Package,
  Search,
  ShoppingBag,
  Sparkles,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '@/lib/api/client';
import { useRecentlyViewed } from '@/lib/hooks/useRecentlyViewed';
import { listingIcon } from '@/lib/listing/types';

interface NavCommand {
  kind: 'nav';
  id: string;
  title: string;
  hint: string;
  href: string;
  icon: LucideIcon;
  keywords: string;
}

interface ListingCommand {
  kind: 'listing';
  id: string;
  title: string;
  hint: string;
  href: string;
  group: 'recent' | 'search';
  icon: LucideIcon;
}

type Command = NavCommand | ListingCommand;

const iconForType = listingIcon;

const NAV_COMMANDS: NavCommand[] = [
  {
    kind: 'nav',
    id: 'nav:home',
    title: 'Home',
    hint: 'Go to the landing page',
    href: '/',
    icon: Home,
    keywords: 'home landing start',
  },
  {
    kind: 'nav',
    id: 'nav:market',
    title: 'Marketplace',
    hint: 'Browse all listings',
    href: '/market',
    icon: Package,
    keywords: 'market marketplace listings browse explore',
  },
  {
    kind: 'nav',
    id: 'nav:agents',
    title: 'Agents',
    hint: 'AI agents & bots',
    href: '/market/agents',
    icon: Bot,
    keywords: 'agents bots ai',
  },
  {
    kind: 'nav',
    id: 'nav:repos',
    title: 'Repositories',
    hint: 'Source repos for sale',
    href: '/market/repos',
    icon: GitBranch,
    keywords: 'repos repositories source code',
  },
  {
    kind: 'nav',
    id: 'nav:top-sellers',
    title: 'Top sellers',
    hint: 'Top creators',
    href: '/market/sellers',
    icon: Users,
    keywords: 'sellers top creators',
  },
  {
    kind: 'nav',
    id: 'nav:tags',
    title: 'Browse by tag',
    hint: 'Tag explorer',
    href: '/market/tags',
    icon: Hash,
    keywords: 'tags topics categories',
  },
  {
    kind: 'nav',
    id: 'nav:saved',
    title: 'Saved listings',
    hint: 'Inventory → Saved',
    href: '/inventory?tab=saved',
    icon: Heart,
    keywords: 'saved favorites wishlist hearts',
  },
  {
    kind: 'nav',
    id: 'nav:inventory',
    title: 'Inventory',
    hint: 'Published, purchased, saved',
    href: '/inventory',
    icon: Library,
    keywords: 'inventory library purchased bought downloads published',
  },
  {
    kind: 'nav',
    id: 'nav:seller',
    title: 'Seller dashboard',
    hint: 'Your sales & analytics',
    href: '/market/seller',
    icon: BarChart3,
    keywords: 'seller dashboard analytics sales revenue',
  },
  {
    kind: 'nav',
    id: 'nav:orders',
    title: 'Orders',
    hint: 'Buying & selling activity',
    href: '/orders',
    icon: ShoppingBag,
    keywords: 'orders purchases sales transactions',
  },
  {
    kind: 'nav',
    id: 'nav:notifications',
    title: 'Notifications',
    hint: 'Your inbox',
    href: '/notifications',
    icon: Bell,
    keywords: 'notifications inbox alerts',
  },
];

interface ListingHit {
  id: string;
  title: string;
  type: string;
  seller: { username: string | null };
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [listings, setListings] = useState<ListingHit[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const { items: recent, clear: clearRecent } = useRecentlyViewed();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isModK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
      if (isModK) {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    // Custom event so search buttons (navbar + sidebar triggers) can
    // open the palette without relying on the keyboard shortcut.
    const openHandler = () => setOpen(true);
    window.addEventListener('keydown', handler);
    window.addEventListener('haggl:open-command', openHandler);
    return () => {
      window.removeEventListener('keydown', handler);
      window.removeEventListener('haggl:open-command', openHandler);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
      setQuery('');
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 20);
      return () => {
        previouslyFocusedRef.current?.focus?.();
      };
    }
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setListings([]);
      return;
    }
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    const t = setTimeout(async () => {
      try {
        const res = await api.get<{ data: ListingHit[] }>(
          `/market?search=${encodeURIComponent(q)}&page=1`,
          { signal: ctl.signal },
        );
        setListings((res.data || []).slice(0, 6));
      } catch {
        /* ignore */
      }
    }, 180);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [query]);

  const commands = useMemo<Command[]>(() => {
    const q = query.trim().toLowerCase();
    const navs = q
      ? NAV_COMMANDS.filter(
          (c) =>
            c.title.toLowerCase().includes(q) ||
            c.hint.toLowerCase().includes(q) ||
            c.keywords.includes(q),
        )
      : NAV_COMMANDS;
    const listingCmds: ListingCommand[] = listings.map((l) => ({
      kind: 'listing',
      id: `listing:${l.id}`,
      title: l.title,
      hint: `@${l.seller?.username || 'anonymous'} · ${l.type.toLowerCase().replace('_', ' ')}`,
      href: `/market/agents/${l.id}`,
      group: 'search',
      icon: iconForType(l.type),
    }));
    if (!q) {
      const recentCmds: ListingCommand[] = recent.slice(0, 5).map((r) => ({
        kind: 'listing',
        id: `recent:${r.id}`,
        title: r.title,
        hint: `@${r.seller || 'anonymous'}`,
        href: `/market/agents/${r.id}`,
        group: 'recent',
        icon: iconForType(r.type),
      }));
      return [...recentCmds, ...navs, ...listingCmds];
    }
    return [...navs, ...listingCmds];
  }, [query, listings, recent]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, listings]);

  const runCommand = useCallback(
    (cmd: Command) => {
      setOpen(false);
      router.push(cmd.href);
    },
    [router],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, commands.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      const cmd = commands[activeIndex];
      if (cmd) runCommand(cmd);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[100] flex items-start justify-center pt-[14vh] px-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="absolute inset-0 backdrop-blur-md"
            style={{ background: 'rgba(3, 3, 8, 0.72)' }}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ type: 'spring', stiffness: 340, damping: 28 }}
            className="relative w-full max-w-xl rounded-2xl overflow-hidden"
            style={{
              background: 'var(--bg-card)',
              boxShadow:
                '0 30px 80px -20px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.05)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 h-px"
              style={{
                background:
                  'linear-gradient(90deg, transparent 0%, rgba(20, 241, 149, 0.5) 50%, transparent 100%)',
              }}
            />
            <div className="flex items-center gap-3 px-4 py-3.5 border-b border-white/[0.06]">
              <Search className="w-4 h-4 text-white shrink-0" strokeWidth={1.75} />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search listings, jump to pages…"
                className="flex-1 bg-transparent text-[13px] text-white placeholder-white/70 focus:outline-none tracking-[0.005em]"
              />
              <kbd className="text-[10px] font-medium text-white border border-white/10 bg-white/[0.03] rounded px-1.5 py-0.5 leading-none">
                Esc
              </kbd>
            </div>

            <div className="max-h-[380px] overflow-y-auto py-2">
              {commands.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <Sparkles className="w-5 h-5 text-zinc-700 mx-auto mb-2" />
                  <p className="text-xs text-zinc-500">No matches — try a different term</p>
                </div>
              ) : (
                commands.map((cmd, idx) => {
                  const active = idx === activeIndex;
                  const Icon = cmd.icon;
                  const prev = commands[idx - 1];
                  const groupOf = (c: Command) =>
                    c.kind === 'nav' ? 'nav' : c.group === 'recent' ? 'recent' : 'search';
                  const currentGroup = groupOf(cmd);
                  const showHeader = !prev || groupOf(prev) !== currentGroup;
                  const headerLabel =
                    currentGroup === 'recent'
                      ? 'Recently viewed'
                      : currentGroup === 'nav'
                        ? 'Jump to'
                        : 'Listings';
                  return (
                    <React.Fragment key={cmd.id}>
                      {showHeader && (
                        <div className="flex items-center justify-between px-4 pt-2 pb-1">
                          <span className="text-[10px] uppercase tracking-[0.2em] text-zinc-600">
                            {headerLabel}
                          </span>
                          {currentGroup === 'recent' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                clearRecent();
                              }}
                              className="text-[10px] uppercase tracking-[0.18em] text-zinc-600 hover:text-zinc-300 transition-colors"
                            >
                              Clear
                            </button>
                          )}
                        </div>
                      )}
                      <button
                        onMouseEnter={() => setActiveIndex(idx)}
                        onClick={() => runCommand(cmd)}
                        className="relative w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-white/[0.03]"
                      >
                        {active && (
                          <motion.span
                            layoutId="command-palette-active-row"
                            transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                            aria-hidden="true"
                            className="absolute inset-0"
                            style={{ background: 'rgba(255,255,255,0.06)' }}
                          />
                        )}
                        <div
                          className="relative shrink-0 w-7 h-7 rounded-md flex items-center justify-center border"
                          style={{
                            borderColor: 'rgba(255,255,255,0.08)',
                            background:
                              cmd.kind === 'listing'
                                ? 'rgba(20, 241, 149, 0.08)'
                                : 'rgba(255,255,255,0.03)',
                          }}
                        >
                          <Icon
                            className={`w-3.5 h-3.5 ${cmd.kind === 'listing' ? 'text-[#14F195]' : 'text-zinc-300'}`}
                          />
                        </div>
                        <div className="relative flex-1 min-w-0">
                          <p className="text-sm font-light text-white truncate">{cmd.title}</p>
                          <p className="text-[11px] text-zinc-500 truncate">{cmd.hint}</p>
                        </div>
                        {cmd.kind === 'listing' && (
                          <span className="relative text-[10px] text-zinc-600 uppercase tracking-wider">
                            {cmd.group === 'recent' ? 'Recent' : 'Listing'}
                          </span>
                        )}
                      </button>
                    </React.Fragment>
                  );
                })
              )}
            </div>

            <div className="flex items-center justify-between px-4 py-2 border-t border-white/10 text-[10px] text-zinc-500">
              <span className="flex items-center gap-2">
                <kbd className="border border-zinc-700/60 rounded px-1.5 py-0.5">↑↓</kbd>
                navigate
                <kbd className="border border-zinc-700/60 rounded px-1.5 py-0.5 ml-2">↵</kbd>
                select
              </span>
              <span>
                {commands.length} result{commands.length === 1 ? '' : 's'}
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
