'use client';

export const dynamic = 'force-dynamic';

import { motion } from 'framer-motion';
import {
  ArrowUpRight,
  Coins,
  Flame,
  LineChart,
  Package,
  Plus,
  ShoppingCart,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';

import {
  AtlasFilterBar,
  AtlasFilterChips,
  AtlasStatTile,
  AtlasTabs,
  AtlasButton,
  AtlasTableRowSkeleton,
  AtlasWelcomeBanner,
} from '@/components/atlas';
import { CountUp } from '@/components/ui/AnimatedCounter';
import { ScrollReveal } from '@/components/ui/ScrollReveal';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { api, WS_URL } from '@/lib/api/client';
import { getCached, getCachedWithStatus, setCached } from '@/lib/cache/pageCache';
import {
  LISTING_TYPE_ACCENT as TYPE_ACCENT,
  LISTING_TYPE_ICON as TYPE_ICON,
  LISTING_TYPE_LABEL as TYPE_LABEL,
  type ListingType,
} from '@/lib/listing/types';
import { io, type Socket } from '@/lib/realtime/io';

// ── Types ──────────────────────────────────────────────────────────────────

type TypeFilter = 'ALL' | ListingType;
type SortKey = 'trending' | 'recent' | 'volume' | 'price-low' | 'price-high';

interface MarketListing {
  id: string;
  createdAt: string;
  title: string;
  type: ListingType;
  price: number;
  currency: string;
  tags: string[];
  seller: { id: string; username: string | null; avatarUrl: string | null };
  reviewAverage?: number | null;
  reviewCount?: number;
  sales24h?: number;
  volumeEth24h?: number;
  sparkline7d?: number[];
}

interface Pulse {
  stats: {
    activeListings: number;
    totalListings: number;
    totalSales: number;
    sales24h: number;
    volumeEth24h: number;
    traders24h: number;
  };
  recentTrades: Array<{
    id: string;
    createdAt: string;
    priceEth: number | null;
    buyer: { id: string; username: string | null; avatarUrl: string | null };
    seller: { id: string; username: string | null };
    listing: { id: string; title: string; type: ListingType; currency: string; price: number };
  }>;
  recentListings: Array<{
    id: string;
    title: string;
    type: ListingType;
    price: number;
    currency: string;
    tags: string[];
    createdAt: string;
    seller: { id: string; username: string | null; avatarUrl: string | null };
  }>;
}

interface SaleEvent {
  listingId: string;
  listingTitle: string;
  listingType: ListingType;
  priceEth: number | null;
  currency: string;
  buyer: { id: string; username: string | null; avatarUrl: string | null };
  seller: { id: string; username: string | null };
  createdAt: string;
}

interface NewListingEvent {
  listingId: string;
  title: string;
  type: ListingType;
  price: number;
  currency: string;
  tags: string[];
  seller: { id: string; username: string | null; avatarUrl: string | null };
  createdAt: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function timeAgo(d: string | Date) {
  const diff = Date.now() - new Date(d).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 5) return 'now';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return n.toString();
}

function formatEth(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n === 0) return '0';
  if (n < 0.0001) return '<0.0001';
  if (n < 1) return n.toFixed(4);
  if (n < 100) return n.toFixed(3);
  return n.toFixed(2);
}

// ── Main ───────────────────────────────────────────────────────────────────

export default function MarketPage() {
  return (
    <Suspense fallback={<div className="min-h-[60vh]" />}>
      <MarketScreener />
    </Suspense>
  );
}

function MarketScreener() {
  const searchParams = useSearchParams();
  const initialSearch = searchParams?.get('search') || '';

  const [search, setSearch] = useState(initialSearch);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
  // Client-side price band filter — drops listings outside the chosen
  // bucket after the fetch. Cheap because the backend already paginates
  // to a manageable page size; switching feels instant.
  const [priceBand, setPriceBand] = useState<'free' | 'lt1' | '1to10' | 'gt10' | null>(null);
  // Default to 'recent' instead of 'trending'. Trending uses a 7-day
  // activity score path on the backend (purchases + negotiations) and
  // can return surprising results in low-volume windows; 'recent' is
  // also what the CacheWarmer cron pre-warms in Redis, so the landing
  // hit is reliably served from cache. Users can still pick "Hot" to
  // get the trending sort.
  const [sort, setSort] = useState<SortKey>('recent');
  const [listings, setListings] = useState<MarketListing[]>(
    () => getCached<MarketListing[]>('market:listings') ?? [],
  );
  const [pulse, setPulse] = useState<Pulse | null>(() => getCached<Pulse>('market:pulse') ?? null);
  const [loading, setLoading] = useState(true);

  // Rows that should flash green (listingId → timestamp)
  const [flash, setFlash] = useState<Map<string, number>>(new Map());
  // Rows added live via socket (pre-pended)
  const [liveListings, setLiveListings] = useState<MarketListing[]>([]);
  // Live trade feed (rolling)
  const [liveTrades, setLiveTrades] = useState<Pulse['recentTrades']>([]);
  // Stats that pulse on change
  const [statPulse, setStatPulse] = useState<Record<string, number>>({});

  // ── Fetch initial data ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const isDefaultView = !search && typeFilter === 'ALL' && sort === 'recent';
      // Cache key per filter so each filter gets its own fresh-cache
      // window. Previously we seeded from the default cache key for
      // EVERY filter, showing the wrong list on filter change.
      const cacheKey = isDefaultView
        ? 'market:listings'
        : `market:listings:${sort}:${typeFilter}:${search.trim().toLowerCase()}`;

      // If we have a fresh entry for THIS filter, use it + skip fetch.
      // Marketplace lists tolerate 2 min staleness — listings change
      // slowly and the user feels filter / nav latency far more than
      // minor staleness. Matches the window used on /market/agents
      // and /market/repos.
      const { data: cachedForFilter, fresh } = getCachedWithStatus<MarketListing[]>(
        cacheKey,
        120_000,
      );
      if (cachedForFilter) {
        setListings(cachedForFilter);
        setLoading(false);
        if (fresh) return;
      } else {
        // No cache for this filter → blank the list + show spinner so
        // the user doesn't stare at the previous filter's results.
        setListings([]);
        setLoading(true);
      }

      try {
        const qs = new URLSearchParams({ page: '1' });
        qs.set('sortBy', sort === 'volume' ? 'trending' : sort);
        if (search) qs.set('search', search);
        if (typeFilter !== 'ALL') qs.set('type', typeFilter);

        const [listRes, pulseRes] = await Promise.all([
          api.get<{ data: MarketListing[] } | MarketListing[]>(`/market?${qs.toString()}`),
          api.get<Pulse>('/market/pulse?limit=20'),
        ]);
        if (cancelled) return;

        // Tolerate both shapes — the controller wraps in `{ data: [] }`
        // but defensive in case a future endpoint returns a raw array
        // and the cache layer dehydrates differently.
        const data = Array.isArray(listRes) ? listRes : (listRes?.data ?? []);
        if (sort === 'volume') {
          data.sort((a, b) => (b.volumeEth24h || 0) - (a.volumeEth24h || 0));
        }
        setListings(data);
        setPulse(pulseRes);
        setLiveTrades(pulseRes?.recentTrades || []);
        setCached(cacheKey, data);
        setCached('market:pulse', pulseRes);
      } catch (err) {
        if (cancelled) return;
        // Don't blank the previous listings on a transient fetch failure.
        // Surface the issue in the console; the empty-state UI is reserved
        // for "nothing matches" not "request failed".
        // eslint-disable-next-line no-console
        console.error('[market] failed to load listings', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [search, typeFilter, sort]);

  // ── Websocket ──────────────────────────────────────────────────────────
  const socketRef = useRef<Socket | null>(null);
  useEffect(() => {
    const socket = io(`${WS_URL}/market`, {
      transports: ['websocket'],
      withCredentials: true,
      timeout: 8000,
      reconnectionAttempts: 5,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3000,
    });
    socketRef.current = socket;

    socket.on('sale', (ev: SaleEvent) => {
      // Flash the row
      setFlash((prev) => {
        const next = new Map(prev);
        next.set(ev.listingId, Date.now());
        return next;
      });
      // Bump 24h stats on the row locally (feels instant)
      setListings((prev) =>
        prev.map((l) =>
          l.id === ev.listingId
            ? {
                ...l,
                sales24h: (l.sales24h || 0) + 1,
                volumeEth24h: Number(((l.volumeEth24h || 0) + (ev.priceEth || 0)).toFixed(4)),
              }
            : l,
        ),
      );
      // Prepend to live trades
      setLiveTrades((prev) => {
        const next = [
          {
            id: `live-${ev.listingId}-${Date.now()}`,
            createdAt: ev.createdAt,
            priceEth: ev.priceEth,
            buyer: ev.buyer,
            seller: ev.seller,
            listing: {
              id: ev.listingId,
              title: ev.listingTitle,
              type: ev.listingType,
              currency: ev.currency,
              price: 0,
            },
          },
          ...prev,
        ];
        return next.slice(0, 40);
      });
      // Pulse the global stats
      setStatPulse({ sales24h: Date.now(), volumeEth24h: Date.now() });
      setPulse((p) =>
        p
          ? {
              ...p,
              stats: {
                ...p.stats,
                sales24h: p.stats.sales24h + 1,
                volumeEth24h: Number((p.stats.volumeEth24h + (ev.priceEth || 0)).toFixed(4)),
              },
            }
          : p,
      );
    });

    socket.on('new-listing', (ev: NewListingEvent) => {
      setLiveListings((prev) => {
        if (prev.some((l) => l.id === ev.listingId)) return prev;
        const entry: MarketListing = {
          id: ev.listingId,
          createdAt: ev.createdAt,
          title: ev.title,
          type: ev.type,
          price: ev.price,
          currency: ev.currency,
          tags: ev.tags,
          seller: ev.seller,
          reviewAverage: null,
          reviewCount: 0,
          sales24h: 0,
          volumeEth24h: 0,
          sparkline7d: new Array(7).fill(0),
        };
        return [entry, ...prev].slice(0, 10);
      });
      setStatPulse((p) => ({ ...p, activeListings: Date.now() }));
      setPulse((p) =>
        p
          ? {
              ...p,
              stats: {
                ...p.stats,
                activeListings: p.stats.activeListings + 1,
                totalListings: p.stats.totalListings + 1,
              },
              recentListings: [
                {
                  id: ev.listingId,
                  title: ev.title,
                  type: ev.type,
                  price: ev.price,
                  currency: ev.currency,
                  tags: ev.tags,
                  createdAt: ev.createdAt,
                  seller: ev.seller,
                },
                ...(p.recentListings || []),
              ].slice(0, 20),
            }
          : p,
      );
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  // Clear stale flashes
  useEffect(() => {
    if (flash.size === 0) return;
    // Check at 1600ms — just past the 1500ms flash duration — so we fire
    // only once per flash event instead of 3 times.
    const t = setInterval(() => {
      const now = Date.now();
      setFlash((prev) => {
        let changed = false;
        const next = new Map(prev);
        next.forEach((v, k) => {
          if (now - v > 1500) {
            next.delete(k);
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    }, 1600);
    return () => clearInterval(t);
  }, [flash.size]);

  // Merge live listings into the main table, then apply the client-side
  // price-band filter (free / <1 SOL / 1–10 SOL / >10 SOL).
  const mergedListings = useMemo(() => {
    const seen = new Set(listings.map((l) => l.id));
    const fresh = liveListings.filter((l) => !seen.has(l.id));
    let merged = [...fresh, ...listings];
    // Drop any legacy "haggl"-named listings that survive the rebrand
    // (seed data, third-party clones, etc). Defensive client-side
    // filter so the user never sees them.
    merged = merged.filter((l) => {
      const t = (l.title || '').toLowerCase();
      const u = (l.seller?.username || '').toLowerCase();
      const tags = (l.tags || []).map((x) => x.toLowerCase());
      return !t.includes('haggl') && !u.includes('haggl') && !tags.includes('haggl');
    });
    if (!priceBand) return merged;
    return merged.filter((l) => {
      const p = l.price ?? 0;
      switch (priceBand) {
        case 'free':
          return p === 0;
        case 'lt1':
          return p > 0 && p < 1;
        case '1to10':
          return p >= 1 && p <= 10;
        case 'gt10':
          return p > 10;
        default:
          return true;
      }
    });
  }, [listings, liveListings, priceBand]);

  // Merge realtime trades on top of the pulse batch the API gave us,
  // dedup by id, cap at 24 so the ticker doesn't grow unbounded over a
  // long session. `liveTrades` is already shaped like Pulse.recentTrades
  // so no remapping needed — both lists merge directly.
  const tickerTrades = useMemo(() => {
    const seen = new Set<string>();
    const out: Pulse['recentTrades'] = [];
    for (const t of [...liveTrades, ...(pulse?.recentTrades ?? [])]) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(t);
      if (out.length >= 24) break;
    }
    return out;
  }, [pulse?.recentTrades, liveTrades]);

  return (
    <div className="mk-app-page min-h-screen pb-20" style={{ maxWidth: 'none', padding: 0 }}>
      {/* Welcome banner for first-time visitors. Self-dismisses; persists
          via localStorage so returning users see nothing here. */}
      <AtlasWelcomeBanner />

      {/* Hero — 21st.dev-inspired ambient layer: radial spotlight + drifting
          blobs + dotted-grid mask. Same content rhythm as before (badge →
          XL title → sub → CTA) but with depth and motion that signal
          "live, fast, modern" the moment the page loads. Every layer is
          token-driven so light mode reuses the same composition with the
          appropriate palette. */}
      <header className="atlas-hero relative px-6 pt-12 pb-10 md:px-10 md:pt-20 md:pb-16 overflow-hidden">
        {/* Hairline gradient on the bottom border, mirroring the
            21st.dev "border light" pattern. Ambient blur layers were
            removed — they made the top of the page look lower-quality
            than the content below. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px"
          style={{
            background:
              'linear-gradient(90deg, transparent 0%, var(--brand) 50%, transparent 100%)',
            opacity: 0.35,
          }}
        />

        <div className="relative mx-auto max-w-[1400px]">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-card)]/60 backdrop-blur-md px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[var(--text-secondary)] font-medium"
          >
            <TrendingUp className="w-3 h-3 text-[var(--brand)]" strokeWidth={2} />
            Atlas Screener
            <LiveDot />
          </motion.div>

          <div className="mt-6 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
            <div>
              {/* Hero headline — Linear/Vercel-scale: large but not theatrical.
                  One subtle entrance animation, no per-word blur or gradient
                  text ticker. The product list below is the show, not the H1. */}
              <motion.h1
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: [0.22, 0.61, 0.36, 1] }}
                className="text-4xl md:text-5xl xl:text-6xl font-semibold tracking-[-0.025em] text-[var(--text)] leading-[1.05] max-w-3xl"
              >
                The on-chain marketplace
                <br className="hidden md:block" />
                <span className="text-[var(--brand)]"> for AI agents.</span>
              </motion.h1>
              <motion.p
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.1 }}
                className="mt-4 text-[15px] md:text-base text-[var(--text-secondary)] leading-relaxed max-w-2xl"
              >
                Everything for sale across Atlas — agents, repos, bots, scripts — priced live and
                ranked by 24-hour activity.
              </motion.p>
            </div>
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.4 }}
              className="self-start md:self-auto md:pb-3"
            >
              <Link
                href="/market/agents/publish"
                className="atlas-cta inline-flex items-center gap-2 px-6 h-12 rounded-2xl text-[14px] font-medium tracking-tight"
              >
                <Plus className="w-4 h-4" strokeWidth={2.5} />
                Publish listing
              </Link>
            </motion.div>
          </div>
        </div>
      </header>

      {/* Stat strip — 4 premium tiles. Live pulse keys are wired so real
          socket events still flash the relevant tiles via the AtlasStatTile
          pulse animation. */}
      <ScrollReveal delay={0.04}>
        <section className="px-6 md:px-10 mt-2 md:mt-4">
          <div className="mx-auto max-w-[1400px] grid grid-cols-2 lg:grid-cols-4 gap-4">
            <AtlasStatTile
              label="Volume 24h"
              icon={<Coins className="w-3.5 h-3.5" strokeWidth={1.75} />}
              pulseKey={statPulse.vol}
              value={
                <>
                  <CountUp value={pulse?.stats.volumeEth24h || 0} decimals={2} duration={1.4} />
                  <span className="ml-1 text-base text-[var(--text-muted)] font-medium tracking-normal">
                    SOL
                  </span>
                </>
              }
              caption="last 24 hours"
            />
            <AtlasStatTile
              label="Sales 24h"
              icon={<ShoppingCart className="w-3.5 h-3.5" strokeWidth={1.75} />}
              pulseKey={statPulse.sales}
              value={<CountUp value={pulse?.stats.sales24h || 0} duration={1.4} />}
              caption="orders settled"
            />
            <AtlasStatTile
              label="Active listings"
              icon={<Package className="w-3.5 h-3.5" strokeWidth={1.75} />}
              pulseKey={statPulse.active}
              value={<CountUp value={pulse?.stats.activeListings || 0} duration={1.6} />}
              caption="agents · repos · bots"
            />
            <AtlasStatTile
              label="All-time sales"
              icon={<LineChart className="w-3.5 h-3.5" strokeWidth={1.75} />}
              value={<CountUp value={pulse?.stats.totalSales || 0} duration={1.8} />}
              caption="cumulative"
            />
          </div>
        </section>
      </ScrollReveal>

      {/* New launches ticker — keeps a small gap from the stats above
          but no full divider line: the page should feel like a single
          continuous dashboard, not stacked sections. */}
      <ScrollReveal delay={0.05}>
        <div className="mt-4">
          <NewLaunchesTicker items={pulse?.recentListings || []} />
        </div>
      </ScrollReveal>

      {/* Filters — sticky AtlasFilterBar. Search + AtlasTabs (segment) for
          the listing type filter + sort chips on the right. The sticky
          offset matches the PowerNavbar height (64px). Tight top
          margin so there's no dark "page-bg gap" between the stats
          strip and the filter bar — they read as one continuous block. */}
      <ScrollReveal delay={0.05}>
        <section className="px-6 md:px-10 mt-4 mb-4 sticky top-[64px] z-30">
          <div className="mx-auto max-w-[1400px]">
            <AtlasFilterBar
              search={search}
              onSearch={setSearch}
              searchPlaceholder="Search agents, repos, bots, tags…"
              leftSlot={
                <AtlasTabs
                  variant="segment"
                  value={typeFilter}
                  onChange={(v) => setTypeFilter(v as TypeFilter)}
                  tabs={[
                    { value: 'ALL', label: 'All' },
                    { value: 'AI_AGENT', label: 'Agents' },
                    { value: 'BOT', label: 'Bots' },
                    { value: 'REPO', label: 'Repos' },
                    { value: 'SCRIPT', label: 'Scripts' },
                  ]}
                />
              }
              rightSlot={
                <div className="flex items-center gap-1">
                  <AtlasButton
                    size="sm"
                    variant={sort === 'trending' ? 'secondary' : 'ghost'}
                    onClick={() => setSort('trending')}
                    leftIcon={<Flame className="w-3.5 h-3.5" strokeWidth={1.75} />}
                  >
                    Hot
                  </AtlasButton>
                  <AtlasButton
                    size="sm"
                    variant={sort === 'recent' ? 'secondary' : 'ghost'}
                    onClick={() => setSort('recent')}
                    leftIcon={<Sparkles className="w-3.5 h-3.5" strokeWidth={1.75} />}
                  >
                    New
                  </AtlasButton>
                  <AtlasButton
                    size="sm"
                    variant={sort === 'volume' ? 'secondary' : 'ghost'}
                    onClick={() => setSort('volume')}
                    leftIcon={<TrendingUp className="w-3.5 h-3.5" strokeWidth={1.75} />}
                  >
                    Volume
                  </AtlasButton>
                </div>
              }
            />
            {/* Quick price filter chips — sit below the main filter bar
                so the primary controls stay clean. The chip rail itself
                is also sticky-friendly (no own bg, inherits the page). */}
            <div className="mt-3 px-1">
              <AtlasFilterChips
                label="Price"
                value={priceBand}
                onChange={(v) => setPriceBand(v as 'free' | 'lt1' | '1to10' | 'gt10' | null)}
                clearable
                options={[
                  { value: 'free', label: 'Free' },
                  { value: 'lt1', label: '< 1 SOL' },
                  { value: '1to10', label: '1–10 SOL' },
                  { value: 'gt10', label: '> 10 SOL' },
                ]}
              />
            </div>
          </div>
        </section>
      </ScrollReveal>

      {/* Table + trades feed */}
      <ScrollReveal delay={0.08}>
        <section className="px-6 md:px-10 mt-6">
          <div className="mx-auto max-w-[1400px] grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
            <div>
              <ScreenerTable
                listings={mergedListings}
                flash={flash}
                liveIds={new Set(liveListings.map((l) => l.id))}
                loading={loading}
              />
            </div>
            <aside className="hidden lg:block">
              <LiveTradesFeed trades={liveTrades} />
            </aside>
          </div>
        </section>
      </ScrollReveal>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

/**
 * Horizontal ticker tape — last N marketplace trades, scrolling
 * right-to-left infinitely. Pauses on hover so users can click into a
 * trade. The track contains the trade list duplicated; the keyframe
 * `mk-marquee` translates it by -50%, so when the second copy reaches
 * the original position the loop seams without jump. Renders nothing
 * if there are no trades yet — better than a blank tape.
 */
function TradeTickerTape({ trades }: { trades: Pulse['recentTrades'] }) {
  if (!trades || trades.length === 0) return null;
  // Doubled list = seamless loop with the -50% translate keyframe.
  const items = [...trades, ...trades];
  // Slow down for short lists so motion is comfortable to read.
  const seconds = Math.max(40, trades.length * 5);

  return (
    <div
      className="relative overflow-hidden border-b border-[var(--border)] bg-[var(--bg-card)]/40 backdrop-blur-md"
      role="marquee"
      aria-label="Live marketplace trades"
    >
      {/* Edge fades so trades enter/exit the viewport without a hard cut. */}
      <div
        className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16"
        style={{
          background:
            'linear-gradient(90deg, var(--bg) 0%, rgba(7,8,10,0.7) 60%, transparent 100%)',
        }}
      />
      <div
        className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16"
        style={{
          background:
            'linear-gradient(270deg, var(--bg) 0%, rgba(7,8,10,0.7) 60%, transparent 100%)',
        }}
      />
      <div
        className="flex shrink-0 items-center gap-8 whitespace-nowrap py-2.5 text-xs font-light"
        style={{
          width: 'max-content',
          animation: `mk-marquee ${seconds}s linear infinite`,
          // Pause animation on hover via :hover descendant selector handled inline.
        }}
        onMouseEnter={(e) => (e.currentTarget.style.animationPlayState = 'paused')}
        onMouseLeave={(e) => (e.currentTarget.style.animationPlayState = 'running')}
      >
        {items.map((t, i) => (
          <div
            key={`${t.id}-${i}`}
            className="flex shrink-0 items-center gap-2 text-[var(--text-secondary)]"
          >
            <UserAvatar
              size={16}
              src={t.buyer.avatarUrl}
              name={t.buyer.username}
              userId={t.buyer.id}
            />
            <span className="text-[var(--text-muted)]">@{t.buyer.username || 'anon'}</span>
            <ArrowUpRight className="w-3 h-3 text-[var(--text-muted)]" strokeWidth={2} />
            <span className="text-[var(--text)] truncate max-w-[200px]">{t.listing.title}</span>
            <span className="text-[var(--brand)] tabular-nums font-medium">
              {formatEth(t.priceEth)} SOL
            </span>
            <span className="text-[var(--text-muted)]">·</span>
            <span className="text-[var(--text-muted)]">{timeAgo(t.createdAt)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LiveDot() {
  return (
    <span className="relative inline-flex items-center justify-center w-2 h-2 ml-1">
      <span
        className="absolute inset-0 rounded-full animate-ping"
        style={{ background: '#22c55e' }}
      />
      <span className="relative inline-block w-1.5 h-1.5 rounded-full bg-[#22c55e]" />
    </span>
  );
}

function StatTile({
  label,
  value,
  sub,
  pulseKey,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  pulseKey?: number;
  accent: string;
}) {
  const [pulsing, setPulsing] = useState(false);
  useEffect(() => {
    if (!pulseKey) return;
    setPulsing(true);
    const t = setTimeout(() => setPulsing(false), 700);
    return () => clearTimeout(t);
  }, [pulseKey]);

  return (
    <div
      className="relative rounded-xl px-4 sm:px-5 py-3.5 sm:py-4 overflow-hidden transition-all"
      style={{
        background: 'var(--bg-card)',
        boxShadow: pulsing
          ? `0 0 0 1px ${accent}66, inset 0 1px 0 rgba(255,255,255,0.04), 0 0 20px -4px ${accent}55`
          : '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.04)',
      }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px opacity-80"
        style={{
          background: `linear-gradient(90deg, transparent 0%, ${accent} 50%, transparent 100%)`,
        }}
      />
      <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-200 mb-1">
        {label}
      </div>
      <div className="font-mono text-xl md:text-2xl font-light text-white tabular-nums">
        {value}
      </div>
      <div className="text-[10.5px] text-zinc-200 font-light mt-0.5">{sub}</div>
    </div>
  );
}

function NewLaunchesTicker({
  items,
}: {
  items: Array<{
    id: string;
    title: string;
    type: ListingType;
    price: number;
    currency: string;
    createdAt: string;
  }>;
}) {
  if (items.length === 0) return null;
  const doubled = [...items, ...items];
  return (
    <section className="px-6 md:px-10 mb-2">
      <div className="mx-auto max-w-[1400px]">
        <div className="flex items-center gap-2 mb-1.5 text-[10.5px] uppercase tracking-[0.16em] text-zinc-500 font-medium">
          New launches
          <span className="h-px flex-1 bg-white/[0.06]" />
        </div>
        <div className="relative overflow-hidden rounded-lg py-3 bg-[var(--bg-card)] border border-[var(--border)]">
          <div
            className="absolute inset-y-0 left-0 w-10 z-10 pointer-events-none"
            style={{
              background: 'linear-gradient(90deg, var(--bg-card), transparent)',
            }}
          />
          <div
            className="absolute inset-y-0 right-0 w-10 z-10 pointer-events-none"
            style={{
              background: 'linear-gradient(270deg, var(--bg-card), transparent)',
            }}
          />
          <div
            className="flex gap-7 whitespace-nowrap px-4"
            style={{
              animation: 'haggl-ticker 60s linear infinite',
            }}
          >
            {doubled.map((item, i) => {
              const Icon = TYPE_ICON[item.type] ?? Package;
              return (
                <Link
                  href={`/market/agents/${item.id}`}
                  key={`${item.id}-${i}`}
                  className="inline-flex items-center gap-2 text-[12px] font-light text-zinc-300 hover:text-white transition"
                >
                  <Icon
                    className="w-3 h-3"
                    strokeWidth={1.75}
                    style={{ color: TYPE_ACCENT[item.type] }}
                  />
                  <span className="text-white">{item.title}</span>
                  <span className="text-zinc-500">{timeAgo(item.createdAt)} ago</span>
                  <span className="text-zinc-700">·</span>
                  <span className="font-mono tabular-nums text-zinc-400">
                    {formatEth(item.price)} SOL
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
      <style jsx>{`
        @keyframes  haggl-ticker {
          from {
            transform: translateX(0);
          }
          to {
            transform: translateX(-50%);
          }
        }
      `}</style>
    </section>
  );
}

function TypeTabs({ value, onChange }: { value: TypeFilter; onChange: (v: TypeFilter) => void }) {
  const tabs: { key: TypeFilter; label: string }[] = [
    { key: 'ALL', label: 'All' },
    { key: 'AI_AGENT', label: 'Agents' },
    { key: 'BOT', label: 'Bots' },
    { key: 'REPO', label: 'Repos' },
    { key: 'SCRIPT', label: 'Scripts' },
  ];
  return (
    <div
      className="flex items-center gap-0.5 rounded-[10px] p-0.5 bg-[var(--bg)]/70"
      style={{ boxShadow: 'inset 0 0 0 1px var(--border)' }}
      role="tablist"
      aria-label="Listing type"
    >
      {tabs.map((t) => {
        const active = value === t.key;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            className={
              'px-2.5 py-1 text-[12px] font-medium rounded-md transition-colors duration-[var(--duration-base)] ' +
              (active
                ? 'text-[var(--text)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text)]')
            }
            style={{
              background: active ? 'rgba(20, 241, 149, 0.18)' : 'transparent',
              boxShadow: active ? 'inset 0 0 0 1px rgba(20, 241, 149, 0.32)' : 'none',
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function SortChip({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={'a-btn a-btn-sm ' + (active ? 'a-btn-ghost is-active' : 'a-btn-ghost')}
    >
      {icon}
      {label}
    </button>
  );
}

function ScreenerTable({
  listings,
  flash,
  liveIds,
  loading,
}: {
  listings: MarketListing[];
  flash: Map<string, number>;
  liveIds: Set<string>;
  loading: boolean;
}) {
  if (loading && listings.length === 0) {
    return (
      <div className="rounded-[var(--radius-lg)] overflow-hidden bg-[var(--bg-card)] border border-[var(--border)] shadow-[var(--shadow-card)]">
        <div className="grid grid-cols-[28px_minmax(0,1fr)_88px_60px_72px_56px_120px_32px] items-center gap-3 px-5 py-3 text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)] font-medium border-b border-[var(--border)]">
          <span className="text-center">#</span>
          <span>Listing</span>
          <span className="text-right">Price</span>
          <span className="text-right">24h</span>
          <span className="text-right">24h vol</span>
          <span className="text-right">Rating</span>
          <span className="hidden md:block">Seller</span>
          <span />
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <AtlasTableRowSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (!loading && listings.length === 0) {
    return (
      <div className="rounded-[var(--radius-lg)] px-6 py-20 text-center bg-[var(--bg-card)] border border-[var(--border)] shadow-[var(--shadow-card)]">
        <div className="text-sm font-light text-[var(--text)]">No listings match your filters.</div>
        <div className="text-xs font-light text-[var(--text-muted)] mt-1">
          Try changing the type or clearing the search.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius-lg)] overflow-hidden bg-[var(--bg-card)] border border-[var(--border)] shadow-[var(--shadow-card)]">
      <div className="grid grid-cols-[28px_minmax(0,1fr)_70px_44px_56px_44px_88px_32px] md:grid-cols-[28px_minmax(0,1fr)_88px_60px_72px_56px_120px_32px] items-center gap-3 px-5 py-3 text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)] font-medium border-b border-[var(--border)]">
        <span className="text-center">#</span>
        <span>Listing</span>
        <span className="text-right">Price</span>
        <span className="text-right">24h</span>
        <span className="text-right">24h vol</span>
        <span className="text-right">Rating</span>
        <span className="hidden md:block">Seller</span>
        <span />
      </div>
      <ul>
        {listings.map((l, i) => (
          <Row
            key={l.id}
            listing={l}
            index={i}
            flashedAt={flash.get(l.id)}
            isLive={liveIds.has(l.id)}
          />
        ))}
      </ul>
    </div>
  );
}

function Row({
  listing,
  index,
  flashedAt,
  isLive,
}: {
  listing: MarketListing;
  index: number;
  flashedAt?: number;
  isLive: boolean;
}) {
  const Icon = TYPE_ICON[listing.type] ?? Package;
  const accent = TYPE_ACCENT[listing.type];
  const flashing = !!flashedAt && Date.now() - flashedAt < 1500;
  const sparkline = listing.sparkline7d || [];

  return (
    <li>
      <Link
        href={`/market/agents/${listing.id}`}
        onMouseEnter={() => api.prefetch([`/market/${listing.id}`])}
        className="group relative grid grid-cols-[28px_minmax(0,1fr)_70px_44px_56px_44px_88px_32px] md:grid-cols-[28px_minmax(0,1fr)_88px_60px_72px_56px_120px_32px] items-center gap-3 px-5 py-4 border-b border-[var(--border)]/50 hover:bg-white/[0.02] transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out-expo)]"
        style={{
          background: flashing
            ? 'linear-gradient(90deg, rgba(20, 241, 149, 0.12), rgba(20, 241, 149, 0.02))'
            : isLive
              ? 'linear-gradient(90deg, rgba(20, 241, 149, 0.08), transparent)'
              : undefined,
        }}
      >
        {/* Flash left bar */}
        {flashing && (
          <span
            aria-hidden
            className="absolute left-0 top-0 bottom-0 w-[2px]"
            style={{ background: '#22c55e', boxShadow: '0 0 8px #22c55e' }}
          />
        )}
        {isLive && !flashing && (
          <span
            aria-hidden
            className="absolute left-0 top-0 bottom-0 w-[2px]"
            style={{ background: accent, opacity: 0.6 }}
          />
        )}

        <span className="text-[11px] text-zinc-300 font-mono text-center tabular-nums">
          {index + 1}
        </span>

        <div className="min-w-0 flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
            style={{
              background: `${accent}18`,
              boxShadow: `inset 0 0 0 1px ${accent}40`,
            }}
          >
            <Icon className="w-3.5 h-3.5" strokeWidth={1.75} style={{ color: accent }} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] font-normal text-white truncate">{listing.title}</span>
              {isLive && (
                <span
                  className="text-[9px] uppercase tracking-[0.12em] px-1 py-px rounded"
                  style={{
                    color: '#22c55e',
                    background: 'rgba(34,197,94,0.1)',
                    boxShadow: 'inset 0 0 0 1px rgba(34,197,94,0.3)',
                  }}
                >
                  NEW
                </span>
              )}
            </div>
            <div className="text-[10.5px] font-light text-zinc-200 truncate">
              <span style={{ color: accent }}>{TYPE_LABEL[listing.type]}</span>
              <span className="text-zinc-600"> · </span>
              <span className="text-zinc-300 whitespace-nowrap">
                {timeAgo(listing.createdAt)} ago
              </span>
              {(listing.tags || []).slice(0, 2).map((t) => (
                <span key={t} className="hidden md:inline">
                  <span className="text-zinc-600"> · </span>
                  <span className="text-zinc-300">{t}</span>
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="text-right font-mono tabular-nums text-[12.5px] text-[#b4a7ff]">
          {formatEth(listing.price)}
          <span className="text-zinc-300 ml-1 text-[10px]">SOL</span>
        </div>

        <div className="text-right font-mono tabular-nums text-[12px]">
          <SalesCell sales={listing.sales24h || 0} />
        </div>

        <div className="text-right font-mono tabular-nums text-[12px] text-zinc-300 flex items-center justify-end gap-1.5">
          <Sparkline data={sparkline} accent={listing.sales24h ? '#22c55e' : '#52525b'} />
          <span className="w-12 text-right">{formatEth(listing.volumeEth24h || 0)}</span>
        </div>

        <div className="text-right text-[12px] text-zinc-300 font-light">
          {listing.reviewCount ? (
            <span>
              <span className="text-[#f59e0b]">★</span> {(listing.reviewAverage ?? 0).toFixed(1)}
              <span className="text-zinc-300 ml-0.5 text-[10px]">({listing.reviewCount})</span>
            </span>
          ) : (
            <span className="text-zinc-300">—</span>
          )}
        </div>

        <div className="hidden md:flex items-center gap-2 text-[11.5px] text-[var(--text-secondary)] font-light truncate">
          <span className="ring-1 ring-[var(--border)] rounded-full inline-flex">
            <UserAvatar
              src={listing.seller.avatarUrl}
              name={listing.seller.username}
              userId={listing.seller.id}
              size={20}
            />
          </span>
          <span className="truncate">@{listing.seller.username || 'unknown'}</span>
        </div>

        <ArrowUpRight
          className="w-3.5 h-3.5 text-zinc-300 group-hover:text-white transition"
          strokeWidth={1.75}
        />
      </Link>
    </li>
  );
}

function SalesCell({ sales }: { sales: number }) {
  if (sales === 0) return <span className="text-zinc-300">0</span>;
  return (
    <span className="inline-flex items-center gap-0.5 text-[#22c55e]">
      <ArrowUpRight className="w-3 h-3" strokeWidth={2} />
      {sales}
    </span>
  );
}

function Sparkline({ data, accent }: { data: number[]; accent: string }) {
  if (!data || data.length === 0) return <span className="w-12 h-4 inline-block" />;
  const max = Math.max(1, ...data);
  const w = 48;
  const h = 16;
  const step = data.length > 1 ? w / (data.length - 1) : 0;
  const points = data
    .map((v, i) => {
      const x = i * step;
      const y = h - (v / max) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg width={w} height={h} className="flex-shrink-0" aria-hidden>
      <polyline
        points={points}
        fill="none"
        stroke={accent}
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LiveTradesFeed({ trades }: { trades: Pulse['recentTrades'] }) {
  return (
    <div className="rounded-[var(--radius-lg)] overflow-hidden sticky top-4 bg-[var(--bg-card)] border border-[var(--border)] shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
        <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.16em] text-[var(--text-muted)] font-medium">
          Live trades
          <LiveDot />
        </div>
        <span className="text-[10px] text-[var(--text-muted)] font-light">{trades.length}</span>
      </div>
      {trades.length === 0 ? (
        <div className="px-3 py-10 text-center text-[12px] text-[var(--text-muted)] font-light">
          Waiting for the first trade…
        </div>
      ) : (
        <ul className="max-h-[560px] overflow-y-auto">
          {trades.map((t) => (
            <TradeRow key={t.id} trade={t} />
          ))}
        </ul>
      )}
    </div>
  );
}

function TradeRow({ trade }: { trade: Pulse['recentTrades'][number] }) {
  const Icon = TYPE_ICON[trade.listing.type] ?? Package;
  const accent = TYPE_ACCENT[trade.listing.type];
  return (
    <li className="border-b border-[var(--border)]/50 last:border-0">
      <Link
        href={`/market/agents/${trade.listing.id}`}
        className="flex items-center gap-2 px-4 py-3 hover:bg-white/[0.02] transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out-expo)]"
      >
        <div
          className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
          style={{ background: `${accent}18`, boxShadow: `inset 0 0 0 1px ${accent}40` }}
        >
          <Icon className="w-3 h-3" strokeWidth={1.75} style={{ color: accent }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11.5px] text-[var(--text)] truncate font-light">
            {trade.listing.title}
          </div>
          <div className="text-[10px] text-[var(--text-muted)] font-light truncate">
            <span className="text-[var(--brand)]">@{trade.buyer.username || 'anon'}</span>
            <span className="text-[var(--text-muted)]"> bought from </span>
            <span className="text-[var(--text-secondary)]">@{trade.seller.username || 'anon'}</span>
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="font-mono text-[11.5px] text-[var(--brand)] tabular-nums">
            {formatEth(trade.priceEth)}
          </div>
          <div className="text-[10px] text-[var(--text-muted)] font-light">
            {timeAgo(trade.createdAt)}
          </div>
        </div>
      </Link>
    </li>
  );
}
