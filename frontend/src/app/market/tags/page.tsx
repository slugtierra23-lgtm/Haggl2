'use client';

import { motion } from 'framer-motion';
import { ArrowLeft, ArrowDownAZ, BarChart3, Hash, Tag, X } from 'lucide-react';
import Link from 'next/link';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import { GradientText } from '@/components/ui/GradientText';
import { api } from '@/lib/api/client';
import { useKeyboardFocus } from '@/lib/hooks/useKeyboardFocus';

interface TagFacet {
  tag: string;
  count: number;
}

interface Facets {
  tags: TagFacet[];
  types: { type: string; count: number }[];
  priceRange: { min: number; max: number };
  totalActive: number;
}

type TagSort = 'popular' | 'alpha';

export default function MarketTagsPage() {
  const [facets, setFacets] = useState<Facets | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<TagSort>('popular');
  const searchRef = useRef<HTMLInputElement>(null);
  useKeyboardFocus(searchRef);

  useEffect(() => {
    (async () => {
      try {
        const data = await api.get<Facets>('/market/facets');
        setFacets(data);
      } catch {
        setFacets({ tags: [], types: [], priceRange: { min: 0, max: 0 }, totalActive: 0 });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    if (!facets) return [];
    const q = search.trim().toLowerCase();
    const base = q ? facets.tags.filter((t) => t.tag.toLowerCase().includes(q)) : facets.tags;
    if (sort === 'alpha') {
      return [...base].sort((a, b) => a.tag.localeCompare(b.tag));
    }
    return base;
  }, [facets, search, sort]);

  const maxCount = facets?.tags[0]?.count || 1;

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-page)' }}>
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute -top-40 right-0 w-[420px] h-[420px] rounded-full blur-3xl opacity-25"
          style={{ background: 'radial-gradient(circle, #EC4899 0%, transparent 70%)' }}
        />
        <div
          className="absolute top-60 -left-20 w-[380px] h-[380px] rounded-full blur-3xl opacity-20"
          style={{ background: 'radial-gradient(circle, #14F195 0%, transparent 70%)' }}
        />
      </div>

      <div className="relative max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <Link
          href="/market"
          className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white mb-6 sm:mb-8 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to market
        </Link>

        <div className="relative border-t-2 border-l-2 border-white/20 rounded-tl-2xl p-5 sm:p-8 mb-6 sm:mb-8">
          <div className="flex items-center gap-3 mb-3">
            <Hash className="w-5 h-5 text-[#EC4899]" />
            <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">Explore</span>
          </div>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-light text-white mb-3">
            Browse by <GradientText>tag</GradientText>
          </h1>
          <p className="text-zinc-400 font-light max-w-xl">
            {facets
              ? `${facets.tags.length} tags across ${facets.totalActive} active listings.`
              : 'Discover listings by topic.'}
          </p>
        </div>

        <div
          className="relative rounded-xl overflow-hidden p-4 mb-6 space-y-3"
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
          <div className="relative">
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter tags…"
              className="w-full rounded-lg pl-3.5 pr-16 py-2.5 text-[13px] text-white placeholder-zinc-600 outline-none transition-all focus:shadow-[0_0_0_3px_rgba(20, 241, 149, 0.12)]"
              style={{
                background: 'var(--bg-card)',
                boxShadow: '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.03)',
              }}
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {search ? (
                <button
                  onClick={() => setSearch('')}
                  aria-label="Clear filter"
                  className="w-6 h-6 rounded-md flex items-center justify-center text-zinc-500 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
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
          <div className="relative flex items-center justify-between">
            <span className="text-[10.5px] uppercase tracking-[0.18em] text-zinc-500 font-medium">
              Sort
            </span>
            <div
              className="inline-flex items-center p-0.5 rounded-lg"
              style={{
                background: 'var(--bg-card)',
                boxShadow: '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.03)',
              }}
            >
              {[
                { k: 'popular' as const, label: 'Popular', Icon: BarChart3 },
                { k: 'alpha' as const, label: 'A–Z', Icon: ArrowDownAZ },
              ].map(({ k, label, Icon }) => {
                const active = sort === k;
                return (
                  <motion.button
                    key={k}
                    onClick={() => setSort(k)}
                    whileTap={{ scale: 0.95 }}
                    transition={{ type: 'spring', stiffness: 360, damping: 22 }}
                    className={`relative inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] font-medium transition-colors tracking-[0.005em] ${
                      active ? 'text-white' : 'text-zinc-500 hover:text-zinc-200'
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="tags-sort-pill"
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

        {loading ? (
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 14 }).map((_, i) => (
              <div
                key={i}
                className="h-8 w-24 rounded-full border border-white/5 animate-pulse"
                style={{ background: 'var(--bg-card)' }}
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
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
                  'linear-gradient(90deg, transparent 0%, rgba(236,72,153,0.45) 50%, transparent 100%)',
              }}
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -top-20 left-1/2 -translate-x-1/2 w-56 h-56 rounded-full blur-3xl opacity-30"
              style={{ background: 'rgba(236,72,153,0.2)' }}
            />
            <div
              className="relative w-12 h-12 rounded-xl mx-auto mb-4 flex items-center justify-center"
              style={{
                background:
                  'linear-gradient(135deg, rgba(236,72,153,0.2) 0%, rgba(236,72,153,0.06) 100%)',
                border: '1px solid rgba(236,72,153,0.3)',
                boxShadow:
                  'inset 0 1px 0 rgba(255,255,255,0.08), 0 0 24px -6px rgba(236,72,153,0.35)',
              }}
            >
              <Tag className="w-5 h-5 text-[#f9a8d4]" strokeWidth={1.5} />
            </div>
            <p className="relative text-[14px] text-white font-normal tracking-[0.005em]">
              {search ? `No tags match "${search}"` : 'No tags yet'}
            </p>
            <p className="relative text-[12px] text-zinc-500 mt-1.5 max-w-sm mx-auto leading-relaxed">
              Tags will appear here as creators publish listings.
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {filtered.map((t, i) => {
              const weight = Math.max(0.5, t.count / maxCount);
              return (
                <motion.div
                  key={t.tag}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: Math.min(i * 0.015, 0.6), duration: 0.2 }}
                >
                  <Link
                    href={`/market?tags=${encodeURIComponent(t.tag)}`}
                    className="group inline-flex items-center gap-2 px-3.5 py-2 rounded-full transition-all hover:-translate-y-0.5"
                    style={{
                      background: `linear-gradient(180deg, rgba(20, 241, 149, ${
                        0.08 + weight * 0.14
                      }) 0%, rgba(20, 241, 149, ${0.02 + weight * 0.05}) 100%)`,
                      boxShadow: `inset 0 0 0 1px rgba(20, 241, 149, ${
                        0.16 + weight * 0.16
                      }), inset 0 1px 0 rgba(255,255,255,0.05), 0 0 ${
                        8 + weight * 12
                      }px -4px rgba(20, 241, 149, ${0.12 + weight * 0.18})`,
                    }}
                  >
                    <Hash className="w-3 h-3 text-[#b4a7ff]" strokeWidth={2} />
                    <span
                      className="font-normal text-white tracking-[0.005em]"
                      style={{ fontSize: `${12 + weight * 4}px` }}
                    >
                      {t.tag}
                    </span>
                    <span
                      className="text-[10.5px] font-medium"
                      style={{ color: 'rgba(180,167,255,0.6)' }}
                    >
                      {t.count}
                    </span>
                  </Link>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
