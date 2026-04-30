'use client';

import { motion } from 'framer-motion';
import {
  BarChart3,
  TrendingUp,
  ShoppingCart,
  Package,
  Star,
  MessageSquare,
  DollarSign,
  ArrowUpRight,
  Download,
  Plus,
  Rocket,
  Search,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React, { useEffect, useRef, useState } from 'react';

import { BoostListingModal } from '@/components/market/BoostListingModal';
import { GradientText } from '@/components/ui/GradientText';
import { api } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useKeyboardFocus } from '@/lib/hooks/useKeyboardFocus';

interface SellerListing {
  id: string;
  title: string;
  type: string;
  price: number;
  currency: string;
  status: string;
  createdAt: string;
  sales: number;
  revenue: number;
  reviewAverage: number | null;
  reviewCount: number;
  boostedUntil?: string | null;
}

interface RecentSale {
  id: string;
  createdAt: string;
  status: string;
  listing: { id: string; title: string };
  buyer: { id: string; username: string | null; avatarUrl: string | null };
}

interface Analytics {
  totals: {
    listings: number;
    activeListings: number;
    salesAllTime: number;
    salesLast30: number;
    salesLast7: number;
    revenueAllTime: number;
    revenueLast30: number;
    negotiationsOpenLast30: number;
    avgRating: number | null;
    reviewCount: number;
  };
  listings: SellerListing[];
  recentSales: RecentSale[];
  salesByDay: { date: string; sales: number }[];
}

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function csvEscape(value: unknown) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadListingsCsv(listings: SellerListing[]) {
  const header = [
    'id',
    'title',
    'type',
    'status',
    'price',
    'currency',
    'sales',
    'revenue',
    'avgRating',
    'reviewCount',
    'createdAt',
  ];
  const rows = listings.map((l) =>
    [
      l.id,
      l.title,
      l.type,
      l.status,
      l.price,
      l.currency,
      l.sales,
      l.revenue,
      l.reviewAverage ?? '',
      l.reviewCount,
      l.createdAt,
    ]
      .map(csvEscape)
      .join(','),
  );
  const csv = [header.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `haggl-listings-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function SellerDashboardPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [listingSort, setListingSort] = useState<'sales' | 'revenue' | 'rating' | 'recent'>(
    'sales',
  );
  const [listingQuery, setListingQuery] = useState('');
  const [boostTarget, setBoostTarget] = useState<SellerListing | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useKeyboardFocus(searchRef);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/auth');
      return;
    }
    if (!isAuthenticated) return;
    (async () => {
      try {
        setLoading(true);
        const resp = await api.get<Analytics>('/market/seller/analytics');
        setData(resp);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load analytics');
      } finally {
        setLoading(false);
      }
    })();
  }, [isAuthenticated, isLoading, router]);

  if (isLoading || loading) {
    return (
      <div
        className="flex items-center justify-center min-h-screen"
        style={{ background: 'var(--bg)' }}
      >
        <motion.div
          className="w-5 h-5 rounded-full border-2 border-zinc-800 border-t-atlas-500"
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity }}
        />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
        <div className="max-w-7xl mx-auto px-6 py-24 text-center text-sm text-zinc-400">
          {error || 'No data available.'}
        </div>
      </div>
    );
  }

  const { totals, listings, recentSales, salesByDay } = data;
  const maxDay = Math.max(1, ...salesByDay.map((d) => d.sales));
  const q = listingQuery.trim().toLowerCase();
  const filteredListings = q
    ? listings.filter(
        (l) =>
          l.title.toLowerCase().includes(q) ||
          l.type.toLowerCase().includes(q) ||
          l.status.toLowerCase().includes(q),
      )
    : listings;
  const sortedListings = [...filteredListings].sort((a, b) => {
    switch (listingSort) {
      case 'revenue':
        return b.revenue - a.revenue;
      case 'rating':
        return (b.reviewAverage ?? 0) - (a.reviewAverage ?? 0);
      case 'recent':
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      case 'sales':
      default:
        return b.sales - a.sales;
    }
  });

  return (
    <div style={{ background: 'var(--bg)' }} className="relative min-h-screen overflow-hidden">
      {/* Ambient glows */}
      <div
        className="absolute -top-32 -left-32 w-[500px] h-[500px] rounded-full opacity-20 blur-3xl pointer-events-none"
        style={{ background: 'radial-gradient(circle, #14F195 0%, transparent 70%)' }}
      />

      <div className="border-b border-white/[0.06] sticky top-0 z-40 backdrop-blur-md bg-zinc-950/90">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 sm:py-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
          <div className="min-w-0">
            <div className="text-[10.5px] uppercase tracking-[0.18em] text-zinc-500 font-medium mb-2 flex items-center gap-2">
              <Link href="/market" className="hover:text-zinc-300 transition-colors">
                Marketplace
              </Link>
              <span className="text-zinc-700">/</span>
              <span className="text-zinc-300">Seller</span>
            </div>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-light text-white">
              <GradientText gradient="purple">Seller dashboard</GradientText>
            </h1>
            <p className="text-[13px] sm:text-sm text-zinc-400 mt-1">
              Track sales, revenue and engagement across your listings.
            </p>
          </div>
          <Link
            href="/market/agents?tab=mine&new=1"
            className="group hidden sm:inline-flex items-center gap-2 rounded-lg h-10 px-3.5 text-[12.5px] font-medium text-white transition-colors"
            style={{
              background:
                'linear-gradient(180deg, rgba(20, 241, 149, 0.22) 0%, rgba(20, 241, 149, 0.08) 100%)',
              boxShadow:
                'inset 0 0 0 1px rgba(20, 241, 149, 0.35), inset 0 1px 0 rgba(255,255,255,0.08), 0 6px 18px -6px rgba(20, 241, 149, 0.4)',
            }}
          >
            <Plus
              className="w-3.5 h-3.5 text-[#b4a7ff] group-hover:text-white transition-colors"
              strokeWidth={2}
            />
            <span className="tracking-[0.005em]">New listing</span>
          </Link>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-6 sm:space-y-10 relative z-10">
        {totals.listings === 0 ? (
          <EmptyState />
        ) : (
          <>
            {/* KPI row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Kpi
                label="Revenue (30d)"
                value={`${totals.revenueLast30.toFixed(2)}`}
                suffix="SOL"
                icon={DollarSign}
                accent="#14F195"
              />
              <Kpi
                label="Sales (30d)"
                value={totals.salesLast30.toString()}
                subtext={`${totals.salesLast7} last 7d`}
                icon={ShoppingCart}
                accent="#06B6D4"
              />
              <Kpi
                label="Active listings"
                value={totals.activeListings.toString()}
                subtext={`${totals.listings} total`}
                icon={Package}
                accent="#14F195"
              />
              <Kpi
                label="Avg rating"
                value={totals.avgRating !== null ? totals.avgRating.toFixed(1) : '—'}
                subtext={`${totals.reviewCount} reviews`}
                icon={Star}
                accent="#f59e0b"
              />
            </div>

            {/* Sales chart */}
            <section
              className="relative p-6 rounded-xl overflow-hidden"
              style={{
                background: 'var(--bg-card)',
                boxShadow:
                  '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.04), 0 12px 36px -20px rgba(0,0,0,0.55)',
              }}
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 h-px"
                style={{
                  background:
                    'linear-gradient(90deg, transparent 0%, rgba(20, 241, 149, 0.45) 50%, transparent 100%)',
                }}
              />
              <div className="relative flex items-center justify-between mb-5">
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center"
                    style={{
                      background:
                        'linear-gradient(135deg, rgba(20, 241, 149, 0.2) 0%, rgba(20, 241, 149, 0.06) 100%)',
                      border: '1px solid rgba(20, 241, 149, 0.28)',
                      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
                    }}
                  >
                    <BarChart3 className="w-3.5 h-3.5 text-[#b4a7ff]" strokeWidth={1.75} />
                  </div>
                  <h2 className="text-[10.5px] uppercase tracking-[0.18em] text-zinc-500 font-medium">
                    Sales · last 30 days
                  </h2>
                </div>
                <div className="text-[11px] text-zinc-500 tracking-wide">
                  Total {totals.salesLast30} sale{totals.salesLast30 === 1 ? '' : 's'}
                </div>
              </div>
              <div className="relative flex items-end gap-1 h-32">
                {salesByDay.map((d, idx) => {
                  const h = (d.sales / maxDay) * 100;
                  return (
                    <div
                      key={d.date}
                      className="flex-1 flex flex-col items-center justify-end group relative"
                    >
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: `${Math.max(2, h)}%` }}
                        transition={{
                          delay: Math.min(idx * 0.02, 0.4),
                          duration: 0.55,
                          ease: [0.22, 0.61, 0.36, 1],
                        }}
                        className="w-full rounded-[3px] transition-all group-hover:brightness-125"
                        style={{
                          background:
                            d.sales > 0
                              ? 'linear-gradient(180deg, #a89dff 0%, #7056ec 100%)'
                              : 'rgba(255,255,255,0.05)',
                          boxShadow:
                            d.sales > 0
                              ? 'inset 0 1px 0 rgba(255,255,255,0.18), 0 0 10px -2px rgba(20, 241, 149, 0.5)'
                              : 'none',
                        }}
                      />
                      <div
                        className="absolute bottom-full mb-1.5 hidden group-hover:block text-[10px] text-white whitespace-nowrap rounded-md px-2 py-1 pointer-events-none"
                        style={{
                          background: 'var(--bg-card)',
                          boxShadow:
                            '0 0 0 1px rgba(255,255,255,0.08), 0 6px 18px -6px rgba(0,0,0,0.6)',
                        }}
                      >
                        {d.date}: {d.sales}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Two-column: listings + recent sales */}
            <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
              <section
                className="relative rounded-xl overflow-hidden"
                style={{
                  background: 'var(--bg-card)',
                  boxShadow:
                    '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.04), 0 12px 36px -20px rgba(0,0,0,0.55)',
                }}
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 top-0 h-px"
                  style={{
                    background:
                      'linear-gradient(90deg, transparent 0%, rgba(20, 241, 149, 0.45) 50%, transparent 100%)',
                  }}
                />
                <header className="relative flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-white/[0.06]">
                  <div className="flex items-center gap-2.5">
                    <div
                      className="w-7 h-7 rounded-lg flex items-center justify-center"
                      style={{
                        background:
                          'linear-gradient(135deg, rgba(20, 241, 149, 0.2) 0%, rgba(20, 241, 149, 0.06) 100%)',
                        border: '1px solid rgba(20, 241, 149, 0.28)',
                        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
                      }}
                    >
                      <TrendingUp className="w-3.5 h-3.5 text-[#b4a7ff]" strokeWidth={1.75} />
                    </div>
                    <h2 className="text-[10.5px] uppercase tracking-[0.18em] text-zinc-500 font-medium">
                      Listing performance
                    </h2>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <div
                      className="inline-flex items-center p-0.5 rounded-lg"
                      style={{
                        background: 'var(--bg-card)',
                        boxShadow:
                          '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.03)',
                      }}
                    >
                      {(['sales', 'revenue', 'rating', 'recent'] as const).map((k) => {
                        const active = listingSort === k;
                        return (
                          <motion.button
                            key={k}
                            onClick={() => setListingSort(k)}
                            whileTap={{ scale: 0.96 }}
                            transition={{ type: 'spring', stiffness: 360, damping: 22 }}
                            className={`relative text-[11px] px-2.5 h-7 rounded-md transition-colors font-medium tracking-[0.005em] ${
                              active ? 'text-white' : 'text-zinc-500 hover:text-zinc-200'
                            }`}
                          >
                            {active && (
                              <motion.span
                                layoutId="seller-listing-sort-pill"
                                transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                                className="absolute inset-0 rounded-md"
                                style={{
                                  background:
                                    'linear-gradient(180deg, rgba(20, 241, 149, 0.22) 0%, rgba(20, 241, 149, 0.06) 100%)',
                                  boxShadow:
                                    'inset 0 0 0 1px rgba(20, 241, 149, 0.35), 0 0 14px -4px rgba(20, 241, 149, 0.45)',
                                }}
                              />
                            )}
                            <span className="relative z-10">
                              {k === 'recent' ? 'Newest' : k.charAt(0).toUpperCase() + k.slice(1)}
                            </span>
                          </motion.button>
                        );
                      })}
                    </div>
                    <span className="text-[11px] text-zinc-500 tracking-wide">
                      {q
                        ? `${sortedListings.length} of ${listings.length}`
                        : `${listings.length} listings`}
                    </span>
                    {listings.length > 0 && (
                      <button
                        onClick={() => downloadListingsCsv(sortedListings)}
                        className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400 hover:text-white transition-colors px-2.5 h-7 rounded-md"
                        style={{
                          background: 'var(--bg-card)',
                          boxShadow:
                            '0 0 0 1px rgba(255,255,255,0.08), inset 0 1px 0 rgba(255,255,255,0.03)',
                        }}
                        aria-label="Download listings as CSV"
                      >
                        <Download className="w-3 h-3" strokeWidth={2} />
                        CSV
                      </button>
                    )}
                  </div>
                </header>
                {listings.length > 0 && (
                  <div className="relative px-5 py-3 border-b border-white/[0.05]">
                    <div className="relative">
                      <Search
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500"
                        strokeWidth={1.75}
                      />
                      <input
                        ref={searchRef}
                        value={listingQuery}
                        onChange={(e) => setListingQuery(e.target.value)}
                        placeholder="Filter listings by title, type, or status"
                        className="w-full rounded-lg pl-9 pr-16 py-2 text-[12px] text-white placeholder-zinc-600 focus:outline-none transition-all focus:shadow-[0_0_0_3px_rgba(20, 241, 149, 0.12)]"
                        style={{
                          background: 'var(--bg-card)',
                          boxShadow:
                            '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.03)',
                        }}
                      />
                      {listingQuery ? (
                        <button
                          onClick={() => setListingQuery('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white transition-colors"
                          aria-label="Clear search"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <kbd
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-zinc-500 rounded-md px-1.5 py-0.5 leading-none"
                          style={{
                            background: 'rgba(255,255,255,0.04)',
                            border: '1px solid rgba(255,255,255,0.08)',
                          }}
                        >
                          /
                        </kbd>
                      )}
                    </div>
                  </div>
                )}
                <div className="divide-y divide-white/5">
                  {sortedListings.length === 0 && q && (
                    <div className="px-5 py-8 text-center text-xs text-zinc-500">
                      No listings match “{listingQuery}”.
                    </div>
                  )}
                  {sortedListings.map((l, idx) => {
                    const isBoosted =
                      l.boostedUntil && new Date(l.boostedUntil).getTime() > Date.now();
                    return (
                      <motion.div
                        key={l.id}
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{
                          delay: Math.min(idx * 0.025, 0.3),
                          duration: 0.26,
                          ease: [0.22, 0.61, 0.36, 1],
                        }}
                        className="relative"
                      >
                        <div className="flex items-center gap-4 px-5 py-4 hover:bg-white/[0.02] transition-colors">
                          <Link href={`/market/agents/${l.id}`} className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-white truncate">
                                {l.title}
                              </span>
                              <span
                                className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
                                  l.status === 'ACTIVE'
                                    ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
                                    : 'bg-zinc-500/10 text-zinc-400 border border-zinc-500/20'
                                }`}
                              >
                                {l.status.toLowerCase()}
                              </span>
                              {isBoosted && (
                                <span
                                  className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded inline-flex items-center gap-1"
                                  style={{
                                    color: '#f9a8d4',
                                    background: 'rgba(236,72,153,0.12)',
                                    border: '1px solid rgba(236,72,153,0.36)',
                                  }}
                                >
                                  <Rocket className="w-2.5 h-2.5" strokeWidth={2.5} />
                                  Boosted
                                </span>
                              )}
                            </div>
                            <div className="mt-1 text-[11px] text-zinc-500 flex items-center gap-3">
                              <span>
                                {l.price} {l.currency}
                              </span>
                              {l.reviewAverage !== null && l.reviewCount > 0 && (
                                <span className="inline-flex items-center gap-1">
                                  <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                                  {l.reviewAverage.toFixed(1)} ({l.reviewCount})
                                </span>
                              )}
                              <span>· {l.type.toLowerCase()}</span>
                            </div>
                          </Link>
                          <div className="text-right">
                            <div className="text-sm font-medium text-white">{l.sales}</div>
                            <div className="text-[10px] uppercase tracking-widest text-zinc-500">
                              sales
                            </div>
                          </div>
                          <div className="text-right min-w-[80px]">
                            <div className="text-sm font-medium text-atlas-300">
                              {l.revenue.toFixed(2)}
                            </div>
                            <div className="text-[10px] uppercase tracking-widest text-zinc-500">
                              {l.currency}
                            </div>
                          </div>
                          {l.status === 'ACTIVE' && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setBoostTarget(l);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-light transition-all"
                              style={{
                                color: isBoosted ? '#f9a8d4' : '#d4d4d8',
                                background: isBoosted
                                  ? 'rgba(236,72,153,0.18)'
                                  : 'rgba(255,255,255,0.04)',
                                boxShadow: isBoosted
                                  ? 'inset 0 0 0 1px rgba(236,72,153,0.45)'
                                  : 'inset 0 0 0 1px rgba(255,255,255,0.08)',
                              }}
                              title={isBoosted ? 'Extend boost' : 'Buy a boost for this listing'}
                            >
                              <Rocket className="w-3 h-3" strokeWidth={2} />
                              {isBoosted ? 'Extend' : 'Boost'}
                            </button>
                          )}
                          <Link href={`/market/agents/${l.id}`}>
                            <ArrowUpRight className="w-4 h-4 text-zinc-600" />
                          </Link>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </section>

              <section
                className="relative rounded-xl overflow-hidden"
                style={{
                  background: 'var(--bg-card)',
                  boxShadow:
                    '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.04), 0 12px 36px -20px rgba(0,0,0,0.55)',
                }}
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 top-0 h-px"
                  style={{
                    background:
                      'linear-gradient(90deg, transparent 0%, rgba(20, 241, 149, 0.45) 50%, transparent 100%)',
                  }}
                />
                <header className="relative flex items-center gap-2.5 px-5 py-4 border-b border-white/[0.06]">
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center"
                    style={{
                      background:
                        'linear-gradient(135deg, rgba(20, 241, 149, 0.2) 0%, rgba(20, 241, 149, 0.06) 100%)',
                      border: '1px solid rgba(20, 241, 149, 0.28)',
                      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
                    }}
                  >
                    <ShoppingCart className="w-3.5 h-3.5 text-[#b4a7ff]" strokeWidth={1.75} />
                  </div>
                  <h2 className="text-[10.5px] uppercase tracking-[0.18em] text-zinc-500 font-medium">
                    Recent sales
                  </h2>
                </header>
                <div className="divide-y divide-white/5">
                  {recentSales.length === 0 && (
                    <div className="px-5 py-6 text-xs text-zinc-500">
                      No sales yet. Share your listing to get your first buyer.
                    </div>
                  )}
                  {recentSales.map((s) => (
                    <div key={s.id} className="px-5 py-3 flex items-center gap-3">
                      <div className="w-7 h-7 rounded-full bg-zinc-800 overflow-hidden shrink-0 flex items-center justify-center">
                        {s.buyer.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={s.buyer.avatarUrl}
                            alt={s.buyer.username || 'buyer'}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="text-[10px] text-zinc-400">
                            {(s.buyer.username || '?').slice(0, 1).toUpperCase()}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-zinc-300 truncate">
                          @{s.buyer.username || 'anon'}{' '}
                          <span className="text-zinc-600">bought</span>{' '}
                          <Link
                            href={`/market/agents/${s.listing.id}`}
                            className="text-atlas-300 hover:underline"
                          >
                            {s.listing.title}
                          </Link>
                        </div>
                        <div className="text-[10px] text-zinc-500 mt-0.5">
                          {timeAgo(s.createdAt)} · {s.status.toLowerCase().replace(/_/g, ' ')}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            {/* Engagement footer */}
            <section className="grid grid-cols-2 md:grid-cols-3 gap-4 text-xs">
              <EngagementStat
                icon={MessageSquare}
                label="Open negotiations (30d)"
                value={totals.negotiationsOpenLast30}
              />
              <EngagementStat
                icon={DollarSign}
                label="Revenue all-time"
                value={`${totals.revenueAllTime.toFixed(2)} SOL`}
              />
              <EngagementStat
                icon={ShoppingCart}
                label="Sales all-time"
                value={totals.salesAllTime}
              />
            </section>
          </>
        )}
      </div>
      {boostTarget && (
        <BoostListingModal
          open
          onClose={() => setBoostTarget(null)}
          listingId={boostTarget.id}
          listingTitle={boostTarget.title}
          currentBoostedUntil={boostTarget.boostedUntil ?? null}
          onBoosted={(boostedUntil) => {
            setData((d) =>
              d
                ? {
                    ...d,
                    listings: d.listings.map((l) =>
                      l.id === boostTarget.id ? { ...l, boostedUntil } : l,
                    ),
                  }
                : d,
            );
            setBoostTarget(null);
          }}
        />
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  suffix,
  subtext,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  suffix?: string;
  subtext?: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  accent: string;
}) {
  return (
    <div
      className="group relative p-4 rounded-xl overflow-hidden transition-colors"
      style={{
        background: 'var(--bg-card)',
        boxShadow:
          '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.04), 0 8px 24px -14px rgba(0,0,0,0.55)',
      }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px opacity-80"
        style={{
          background: `linear-gradient(90deg, transparent 0%, ${accent} 50%, transparent 100%)`,
        }}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-10 -right-10 w-28 h-28 rounded-full blur-2xl opacity-30"
        style={{ background: `${accent}40` }}
      />
      <div className="relative flex items-center gap-3 mb-3">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{
            background: `linear-gradient(135deg, ${accent}28 0%, ${accent}08 100%)`,
            border: `1px solid ${accent}40`,
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
          }}
        >
          <Icon className="w-3.5 h-3.5" style={{ color: accent }} />
        </div>
        <span className="text-[10.5px] uppercase tracking-[0.18em] text-zinc-500 font-medium">
          {label}
        </span>
      </div>
      <div className="relative text-[24px] font-light text-white leading-none tracking-[-0.01em] mb-1.5">
        {value}
        {suffix && (
          <span className="ml-1.5 text-[11px] text-zinc-500 font-normal tracking-wide">
            {suffix}
          </span>
        )}
      </div>
      {subtext && <div className="relative text-[11px] text-zinc-500 tracking-wide">{subtext}</div>}
    </div>
  );
}

function EngagementStat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
}) {
  return (
    <div
      className="relative p-4 rounded-xl overflow-hidden flex items-center gap-3"
      style={{
        background: 'var(--bg-card)',
        boxShadow: '0 0 0 1px rgba(255,255,255,0.055), inset 0 1px 0 rgba(255,255,255,0.03)',
      }}
    >
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
        style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <Icon className="w-3.5 h-3.5 text-zinc-400" />
      </div>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-medium">
          {label}
        </div>
        <div className="text-[13px] text-white font-normal mt-0.5 truncate">{value}</div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div
      className="relative text-center py-24 px-6 rounded-2xl overflow-hidden"
      style={{
        background: 'var(--bg-card)',
        boxShadow:
          '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.04), 0 12px 36px -20px rgba(0,0,0,0.55)',
      }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          background:
            'linear-gradient(90deg, transparent 0%, rgba(20, 241, 149, 0.45) 50%, transparent 100%)',
        }}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-72 h-72 rounded-full blur-3xl opacity-40"
        style={{ background: 'rgba(20, 241, 149, 0.18)' }}
      />
      <div
        className="relative w-14 h-14 rounded-xl mx-auto mb-5 flex items-center justify-center"
        style={{
          background:
            'linear-gradient(135deg, rgba(20, 241, 149, 0.22) 0%, rgba(20, 241, 149, 0.06) 100%)',
          border: '1px solid rgba(20, 241, 149, 0.3)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), 0 0 28px -8px rgba(20, 241, 149, 0.4)',
        }}
      >
        <Package className="w-6 h-6 text-[#b4a7ff]" strokeWidth={1.5} />
      </div>
      <h2 className="relative text-[16px] font-normal text-white mb-1.5 tracking-[0.005em]">
        You don&apos;t have any listings yet
      </h2>
      <p className="relative text-[12.5px] text-zinc-500 mb-6 max-w-md mx-auto leading-relaxed">
        Publish your first AI agent, repo, or script to start tracking sales and engagement here.
      </p>
      <Link
        href="/market/agents?tab=mine&new=1"
        className="group relative inline-flex items-center gap-2 rounded-lg h-10 px-4 text-[12.5px] font-medium text-white transition-colors"
        style={{
          background:
            'linear-gradient(180deg, rgba(20, 241, 149, 0.22) 0%, rgba(20, 241, 149, 0.08) 100%)',
          boxShadow:
            'inset 0 0 0 1px rgba(20, 241, 149, 0.35), inset 0 1px 0 rgba(255,255,255,0.08), 0 6px 18px -6px rgba(20, 241, 149, 0.4)',
        }}
      >
        <Plus
          className="w-3.5 h-3.5 text-[#b4a7ff] group-hover:text-white transition-colors"
          strokeWidth={2}
        />
        <span className="tracking-[0.005em]">Create a listing</span>
      </Link>
    </div>
  );
}
