'use client';

import { motion } from 'framer-motion';
import { ArrowLeft, Package, Search, ShoppingCart, Star, Users, X } from 'lucide-react';
import Link from 'next/link';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import { GradientText } from '@/components/ui/GradientText';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { api } from '@/lib/api/client';
import { useKeyboardFocus } from '@/lib/hooks/useKeyboardFocus';

interface TopSeller {
  id: string;
  username: string | null;
  avatarUrl: string | null;
  bio: string | null;
  githubLogin: string | null;
  createdAt: string;
  sales: number;
  activeListings: number;
  avgRating: number | null;
  reviewCount: number;
}

function Avatar({
  url,
  username,
  userId,
}: {
  url: string | null;
  username: string | null;
  userId?: string | null;
}) {
  return <UserAvatar src={url} name={username} userId={userId} size={56} />;
}

type SellerSort = 'sales' | 'rating' | 'listings';

export default function TopSellersPage() {
  const [sellers, setSellers] = useState<TopSeller[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SellerSort>('sales');
  const searchRef = useRef<HTMLInputElement>(null);
  useKeyboardFocus(searchRef);

  useEffect(() => {
    (async () => {
      try {
        const data = await api.get<TopSeller[]>('/market/top-sellers?limit=48');
        setSellers(data);
      } catch {
        setSellers([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? sellers.filter((s) =>
          [s.username ?? '', s.bio ?? '', s.githubLogin ?? ''].join(' ').toLowerCase().includes(q),
        )
      : sellers;
    if (sort === 'rating') {
      return [...filtered].sort((a, b) => (b.avgRating ?? 0) - (a.avgRating ?? 0));
    }
    if (sort === 'listings') {
      return [...filtered].sort((a, b) => b.activeListings - a.activeListings);
    }
    return filtered;
  }, [sellers, query, sort]);

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-page)' }}>
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute -top-40 -left-20 w-[420px] h-[420px] rounded-full blur-3xl opacity-30"
          style={{ background: 'radial-gradient(circle, #14F195 0%, transparent 70%)' }}
        />
        <div
          className="absolute top-40 right-0 w-[380px] h-[380px] rounded-full blur-3xl opacity-20"
          style={{ background: 'radial-gradient(circle, #06B6D4 0%, transparent 70%)' }}
        />
      </div>

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <Link
          href="/market"
          className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white mb-6 sm:mb-8 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to market
        </Link>

        <div className="relative border-t-2 border-l-2 border-white/20 rounded-tl-2xl p-5 sm:p-8 mb-8 sm:mb-10">
          <div className="flex items-center gap-3 mb-3">
            <Users className="w-5 h-5 text-[#14F195]" />
            <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">Discovery</span>
          </div>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-light text-white mb-3">
            Top <GradientText>sellers</GradientText>
          </h1>
          <p className="text-zinc-400 font-light max-w-xl">
            The most-purchased creators on Atlas — ranked by all-time sales. Explore their agents,
            scripts and repos.
          </p>
        </div>

        {!loading && sellers.length > 0 && (
          <div
            className="relative mb-6 rounded-xl overflow-hidden p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
            style={{
              background: 'var(--bg-card)',
              boxShadow: '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.03)',
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
            <div className="relative flex-1 max-w-sm">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none"
                strokeWidth={1.75}
              />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a creator…"
                className="w-full rounded-lg pl-9 pr-14 py-2.5 text-[12.5px] text-white placeholder-zinc-600 outline-none transition-all focus:shadow-[0_0_0_3px_rgba(20, 241, 149, 0.12)]"
                style={{
                  background: 'var(--bg-card)',
                  boxShadow:
                    '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.03)',
                }}
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                {query ? (
                  <button
                    onClick={() => setQuery('')}
                    aria-label="Clear search"
                    className="w-6 h-6 rounded-md flex items-center justify-center text-zinc-500 hover:text-white hover:bg-white/10 transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                ) : (
                  <kbd
                    className="hidden sm:inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-md text-[10px] font-medium text-zinc-500 leading-none"
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
            <div className="relative flex items-center gap-2">
              <span className="text-[10.5px] uppercase tracking-[0.18em] text-zinc-500 font-medium">
                Sort
              </span>
              <div
                className="inline-flex items-center p-0.5 rounded-lg"
                style={{
                  background: 'var(--bg-card)',
                  boxShadow:
                    '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.03)',
                }}
              >
                {(
                  [
                    { k: 'sales', label: 'Sales', Icon: ShoppingCart },
                    { k: 'rating', label: 'Rating', Icon: Star },
                    { k: 'listings', label: 'Listings', Icon: Package },
                  ] as const
                ).map(({ k, label, Icon }, idx) => {
                  const active = sort === k;
                  return (
                    <motion.button
                      key={k}
                      onClick={() => setSort(k)}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        delay: Math.min(idx * 0.04, 0.2),
                        duration: 0.22,
                        ease: [0.22, 0.61, 0.36, 1],
                      }}
                      whileTap={{ scale: 0.95 }}
                      className={`relative inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] font-medium transition-colors tracking-[0.005em] ${
                        active ? 'text-white' : 'text-zinc-500 hover:text-zinc-200'
                      }`}
                    >
                      {active && (
                        <motion.span
                          layoutId="sellers-sort-pill"
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
                      <Icon className="relative z-10 w-3 h-3" strokeWidth={2} />
                      <span className="relative z-10">{label}</span>
                    </motion.button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-36 rounded-xl border border-white/5 animate-pulse"
                style={{ background: 'var(--bg-card)' }}
              />
            ))}
          </div>
        ) : sellers.length === 0 ? (
          <div
            className="relative rounded-2xl overflow-hidden p-12 text-center"
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
              className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-64 h-64 rounded-full blur-3xl opacity-40"
              style={{ background: 'rgba(20, 241, 149, 0.18)' }}
            />
            <div
              className="relative w-12 h-12 rounded-xl mx-auto mb-4 flex items-center justify-center"
              style={{
                background:
                  'linear-gradient(135deg, rgba(20, 241, 149, 0.2) 0%, rgba(20, 241, 149, 0.06) 100%)',
                border: '1px solid rgba(20, 241, 149, 0.28)',
                boxShadow:
                  'inset 0 1px 0 rgba(255,255,255,0.08), 0 0 24px -6px rgba(20, 241, 149, 0.35)',
              }}
            >
              <Users className="w-5 h-5 text-[#b4a7ff]" strokeWidth={1.5} />
            </div>
            <p className="relative text-[14px] text-white font-normal tracking-[0.005em]">
              No top sellers yet
            </p>
            <p className="relative text-[12px] text-zinc-500 mt-1.5 max-w-sm mx-auto leading-relaxed">
              Once creators start shipping, you&apos;ll see them rise here.
            </p>
            <Link
              href="/market"
              className="relative inline-flex items-center gap-2 mt-5 rounded-lg h-9 px-4 text-[12px] font-medium text-zinc-300 hover:text-white transition-colors"
              style={{
                background: 'var(--bg-card)',
                boxShadow: '0 0 0 1px rgba(255,255,255,0.08), inset 0 1px 0 rgba(255,255,255,0.03)',
              }}
            >
              Browse listings
            </Link>
          </div>
        ) : visible.length === 0 ? (
          <div
            className="relative rounded-2xl overflow-hidden p-12 text-center"
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
            <div
              className="relative w-12 h-12 rounded-xl mx-auto mb-4 flex items-center justify-center"
              style={{
                background:
                  'linear-gradient(135deg, rgba(20, 241, 149, 0.2) 0%, rgba(20, 241, 149, 0.06) 100%)',
                border: '1px solid rgba(20, 241, 149, 0.28)',
                boxShadow:
                  'inset 0 1px 0 rgba(255,255,255,0.08), 0 0 24px -6px rgba(20, 241, 149, 0.35)',
              }}
            >
              <Users className="w-5 h-5 text-[#b4a7ff]" strokeWidth={1.5} />
            </div>
            <p className="relative text-[14px] text-white font-normal tracking-[0.005em]">
              {query ? `No creators match "${query}"` : 'No matches'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {visible.map((s, i) => (
              <motion.div
                key={s.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay: Math.min(i * 0.035, 0.4),
                  duration: 0.32,
                  ease: [0.22, 0.61, 0.36, 1],
                }}
                whileHover={{ y: -3 }}
              >
                <Link
                  href={`/market/sellers/${s.username || ''}`}
                  onMouseEnter={() => s.username && api.prefetch([`/market/sellers/${s.username}`])}
                  className="group relative block p-5 rounded-xl overflow-hidden transition-all"
                  style={{
                    background: 'var(--bg-card)',
                    boxShadow:
                      '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.04), 0 8px 24px -14px rgba(0,0,0,0.55)',
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 top-0 h-px opacity-60"
                    style={{
                      background:
                        'linear-gradient(90deg, transparent 0%, rgba(20, 241, 149, 0.5) 50%, transparent 100%)',
                    }}
                  />
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute -top-12 -right-12 w-32 h-32 rounded-full opacity-0 group-hover:opacity-100 transition-opacity blur-2xl"
                    style={{ background: 'rgba(20, 241, 149, 0.25)' }}
                  />
                  <div className="relative flex items-start gap-4">
                    <Avatar url={s.avatarUrl} username={s.username} userId={s.id} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-[13px] font-normal text-white truncate tracking-[0.005em]">
                          @{s.username || 'unknown'}
                        </p>
                        {sort === 'sales' && !query.trim() && i < 3 && (
                          <span
                            className="text-[10px] font-semibold px-2 py-0.5 rounded-full text-white"
                            style={{
                              background: 'linear-gradient(180deg, #9a83ff 0%, #7056ec 100%)',
                              boxShadow:
                                '0 2px 8px -1px rgba(20, 241, 149, 0.45), inset 0 1px 0 rgba(255,255,255,0.2)',
                            }}
                          >
                            #{i + 1}
                          </span>
                        )}
                      </div>
                      {s.bio ? (
                        <p className="text-[12px] text-zinc-400 font-normal line-clamp-2 mb-3 leading-relaxed">
                          {s.bio}
                        </p>
                      ) : (
                        <p className="text-[11.5px] text-zinc-600 italic font-light mb-3">
                          No bio yet
                        </p>
                      )}
                      <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-[11px] text-zinc-400">
                        <span className="inline-flex items-center gap-1.5">
                          <ShoppingCart className="w-3 h-3 text-zinc-500" strokeWidth={1.75} />
                          {s.sales} sale{s.sales === 1 ? '' : 's'}
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <Package className="w-3 h-3 text-zinc-500" strokeWidth={1.75} />
                          {s.activeListings} listing{s.activeListings === 1 ? '' : 's'}
                        </span>
                        {s.avgRating !== null && (
                          <span className="inline-flex items-center gap-1.5">
                            <Star
                              className="w-3 h-3"
                              style={{ color: '#b4a7ff', fill: '#b4a7ff' }}
                            />
                            {s.avgRating.toFixed(2)}
                            <span className="text-zinc-600">({s.reviewCount})</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
