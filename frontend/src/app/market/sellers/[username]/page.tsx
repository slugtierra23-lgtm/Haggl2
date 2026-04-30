'use client';

import { motion } from 'framer-motion';
import {
  Bot,
  GitBranch,
  Zap,
  Package,
  Star,
  Globe,
  Twitter,
  Linkedin,
  Github,
  Calendar,
  ShoppingCart,
  ChevronRight,
  Heart,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import React, { useEffect, useState } from 'react';

import { GradientText } from '@/components/ui/GradientText';
import { ShareButton } from '@/components/ui/ShareButton';
import { api, ApiError } from '@/lib/api/client';
import { useFavorites } from '@/lib/hooks/useFavorites';

type ListingType = 'REPO' | 'BOT' | 'SCRIPT' | 'AI_AGENT' | 'OTHER';

interface SellerProfile {
  seller: {
    id: string;
    username: string;
    avatarUrl: string | null;
    bio: string | null;
    githubLogin: string | null;
    walletAddress: string | null;
    twitterUrl: string | null;
    linkedinUrl: string | null;
    websiteUrl: string | null;
    createdAt: string;
  };
  listings: Array<{
    id: string;
    title: string;
    type: ListingType;
    price: number;
    currency: string;
    tags: string[];
    createdAt: string;
    reviewAverage?: number | null;
    reviewCount?: number;
  }>;
  stats: {
    listings: number;
    salesAllTime: number;
    avgRating: number | null;
    reviewCount: number;
  };
  recentReviews: Array<{
    id: string;
    createdAt: string;
    rating: number;
    content: string | null;
    author: { id: string; username: string | null; avatarUrl: string | null };
    listing: { id: string; title: string };
  }>;
}

const TYPE_META: Record<
  ListingType,
  {
    label: string;
    color: string;
    Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  }
> = {
  AI_AGENT: { label: 'AI Agent', color: '#14F195', Icon: Bot },
  BOT: { label: 'Bot', color: '#14F195', Icon: Bot },
  SCRIPT: { label: 'Script', color: '#06B6D4', Icon: Zap },
  REPO: { label: 'Repo', color: '#3b82f6', Icon: GitBranch },
  OTHER: { label: 'Other', color: '#64748b', Icon: Package },
};

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatJoined(d: string) {
  const date = new Date(d);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export default function SellerProfilePage() {
  const { username } = useParams<{ username: string }>();
  const [data, setData] = useState<SellerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const { has, toggle } = useFavorites();

  useEffect(() => {
    if (!username) return;
    (async () => {
      try {
        setLoading(true);
        const resp = await api.get<SellerProfile>(`/market/sellers/${username}`);
        setData(resp);
      } catch (err) {
        if (err instanceof ApiError) setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [username]);

  if (loading) {
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

  if (notFound || !data) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center gap-4"
        style={{ background: 'var(--bg)' }}
      >
        <p className="text-6xl font-mono text-zinc-800">404</p>
        <p className="text-zinc-400">Seller not found</p>
        <Link
          href="/market"
          className="text-sm text-atlas-300 hover:text-atlas-200 inline-flex items-center gap-1.5"
        >
          Back to marketplace
        </Link>
      </div>
    );
  }

  const { seller, listings, stats, recentReviews } = data;
  const repoListings = listings.filter((l) => l.type === 'REPO');
  const agentListings = listings.filter((l) => l.type !== 'REPO');

  return (
    <div style={{ background: 'var(--bg)' }} className="relative min-h-screen overflow-hidden">
      <div
        className="absolute -top-32 -left-32 w-[500px] h-[500px] rounded-full opacity-20 blur-3xl pointer-events-none"
        style={{ background: 'radial-gradient(circle, #14F195 0%, transparent 70%)' }}
      />

      {/* Breadcrumb */}
      <div
        className="sticky top-0 z-40 backdrop-blur-md"
        style={{
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          background: 'var(--bg)',
        }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-2 text-[11px] text-zinc-500 overflow-x-auto">
          <Link href="/market" className="hover:text-zinc-200 transition-colors">
            Marketplace
          </Link>
          <ChevronRight className="w-3 h-3 text-zinc-700" />
          <Link href="/market/agents" className="hover:text-zinc-200 transition-colors">
            Sellers
          </Link>
          <ChevronRight className="w-3 h-3 text-zinc-700" />
          <span className="text-zinc-300 truncate max-w-md">@{seller.username}</span>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10 relative z-10 space-y-6 sm:space-y-8">
        {/* Hero */}
        <section
          className="relative rounded-2xl overflow-hidden p-6 sm:p-8"
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
          <div className="flex flex-col sm:flex-row gap-6 items-start">
            <div
              className="w-20 h-20 rounded-full overflow-hidden shrink-0 flex items-center justify-center"
              style={{
                background:
                  'linear-gradient(135deg, rgba(20, 241, 149, 0.22) 0%, rgba(20, 241, 149, 0.04) 100%)',
                boxShadow:
                  'inset 0 0 0 1px rgba(20, 241, 149, 0.35), 0 0 32px -6px rgba(20, 241, 149, 0.5)',
              }}
            >
              {seller.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={seller.avatarUrl}
                  alt={seller.username}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-2xl font-light" style={{ color: '#b4a7ff' }}>
                  {seller.username.slice(0, 1).toUpperCase()}
                </span>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-light text-white tracking-[-0.01em] break-all">
                <GradientText gradient="purple">@{seller.username}</GradientText>
              </h1>
              {seller.bio && (
                <p className="text-sm text-zinc-300 mt-2 leading-relaxed max-w-2xl">{seller.bio}</p>
              )}
              <div className="mt-4 flex flex-wrap gap-1.5 text-[11px]">
                <SocialChip icon={Calendar} label={`Joined ${formatJoined(seller.createdAt)}`} />
                {seller.githubLogin && (
                  <SocialChip
                    href={`https://github.com/${seller.githubLogin}`}
                    icon={Github}
                    label={seller.githubLogin}
                  />
                )}
                {seller.twitterUrl && (
                  <SocialChip href={seller.twitterUrl} icon={Twitter} label="twitter" />
                )}
                {seller.linkedinUrl && (
                  <SocialChip href={seller.linkedinUrl} icon={Linkedin} label="linkedin" />
                )}
                {seller.websiteUrl && (
                  <SocialChip href={seller.websiteUrl} icon={Globe} label="website" />
                )}
              </div>
            </div>

            <div className="flex flex-col items-end gap-2">
              <ShareButton
                title={`@${seller.username} on Atlas`}
                text={`Check out @${seller.username}'s listings on Atlas`}
                ariaLabel="Share seller profile"
              />
              <Link
                href={`/u/${seller.username}`}
                className="text-[11px] transition-colors"
                style={{ color: 'rgba(161,161,170,0.6)' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#b4a7ff')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(161,161,170,0.6)')}
              >
                View full profile →
              </Link>
            </div>
          </div>
        </section>

        {/* Stats */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Listings" value={stats.listings} icon={Package} />
          <StatCard label="Sales" value={stats.salesAllTime} icon={ShoppingCart} />
          <StatCard
            label="Avg rating"
            value={stats.avgRating !== null ? stats.avgRating.toFixed(1) : '—'}
            icon={Star}
          />
          <StatCard label="Reviews" value={stats.reviewCount} icon={Star} />
        </section>

        {/* Listings — split into Repositories and AI Agents */}
        {listings.length === 0 ? (
          <section>
            <h2 className="text-[10.5px] uppercase tracking-[0.18em] font-medium text-zinc-500 mb-4">
              Listings
            </h2>
            <div
              className="relative rounded-2xl p-10 text-center overflow-hidden"
              style={{
                background: 'var(--bg-card)',
                boxShadow: '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.04)',
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
                className="w-12 h-12 rounded-xl mx-auto mb-3 flex items-center justify-center"
                style={{
                  background:
                    'linear-gradient(135deg, rgba(20, 241, 149, 0.22) 0%, rgba(20, 241, 149, 0.04) 100%)',
                  boxShadow:
                    'inset 0 0 0 1px rgba(20, 241, 149, 0.35), 0 0 24px -6px rgba(20, 241, 149, 0.5)',
                }}
              >
                <Package className="w-5 h-5" style={{ color: '#b4a7ff' }} />
              </div>
              <p className="text-sm text-zinc-400">
                This seller hasn't published any listings yet.
              </p>
            </div>
          </section>
        ) : (
          <>
            {agentListings.length > 0 && (
              <section>
                <h2 className="text-[10.5px] uppercase tracking-[0.18em] font-medium text-zinc-500 mb-4 flex items-center gap-2">
                  <Bot className="w-3 h-3" style={{ color: '#b4a7ff' }} />
                  AI Agents ({agentListings.length})
                </h2>
                <ListingsGrid items={agentListings} has={has} toggle={toggle} />
              </section>
            )}
            {repoListings.length > 0 && (
              <section className="mt-8">
                <h2 className="text-[10.5px] uppercase tracking-[0.18em] font-medium text-zinc-500 mb-4 flex items-center gap-2">
                  <GitBranch className="w-3 h-3" style={{ color: '#b4a7ff' }} />
                  Repositories ({repoListings.length})
                </h2>
                <ListingsGrid items={repoListings} has={has} toggle={toggle} />
              </section>
            )}
          </>
        )}
        {/* Recent reviews */}
        {recentReviews.length > 0 && (
          <section>
            <h2 className="text-[10.5px] uppercase tracking-[0.18em] font-medium text-zinc-500 mb-4">
              Recent reviews
            </h2>
            <div className="space-y-3">
              {recentReviews.map((r) => (
                <div
                  key={r.id}
                  className="relative rounded-xl p-4 flex gap-3 overflow-hidden"
                  style={{
                    background: 'var(--bg-card)',
                    boxShadow:
                      '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.03)',
                  }}
                >
                  <div
                    className="w-8 h-8 rounded-full overflow-hidden shrink-0 flex items-center justify-center"
                    style={{
                      background: 'rgba(255,255,255,0.04)',
                      boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)',
                    }}
                  >
                    {r.author.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.author.avatarUrl}
                        alt={r.author.username || 'author'}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-xs text-zinc-400">
                        {(r.author.username || '?').slice(0, 1).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-zinc-200 font-light">
                        @{r.author.username || 'anon'}
                      </span>
                      <span className="text-zinc-600">·</span>
                      <Link
                        href={`/market/agents/${r.listing.id}`}
                        className="truncate transition-colors"
                        style={{ color: '#b4a7ff' }}
                      >
                        {r.listing.title}
                      </Link>
                      <span className="text-zinc-600">·</span>
                      <span className="text-zinc-500">{timeAgo(r.createdAt)}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-0.5">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <Star
                          key={i}
                          className="w-3 h-3"
                          style={
                            i <= r.rating
                              ? { color: '#b4a7ff', fill: '#b4a7ff' }
                              : { color: '#3f3f46' }
                          }
                        />
                      ))}
                    </div>
                    {r.content && (
                      <p className="mt-2 text-sm text-zinc-300 leading-relaxed">{r.content}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function SocialChip({
  icon: Icon,
  label,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  href?: string;
}) {
  const style: React.CSSProperties = {
    background: 'rgba(255,255,255,0.03)',
    boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)',
    color: 'rgba(161,161,170,0.75)',
  };
  const content = (
    <span className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px]">
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" style={style} className="rounded-md">
        {content}
      </a>
    );
  }
  return (
    <span style={style} className="rounded-md">
      {content}
    </span>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  accent = '#14F195',
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  accent?: string;
}) {
  return (
    <div
      className="relative rounded-xl p-4 overflow-hidden transition-all"
      style={{
        background: 'var(--bg-card)',
        boxShadow: '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.03)',
      }}
    >
      <div
        className="absolute inset-0 opacity-[0.08] pointer-events-none"
        style={{ background: `radial-gradient(circle at 0% 0%, ${accent}, transparent 60%)` }}
      />
      <div className="flex items-center justify-between mb-2 relative">
        <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-medium">
          {label}
        </span>
        <div
          className="w-6 h-6 rounded-md flex items-center justify-center"
          style={{
            background: `linear-gradient(135deg, ${accent}22 0%, ${accent}06 100%)`,
            boxShadow: `inset 0 0 0 1px ${accent}38`,
          }}
        >
          <Icon className="w-3 h-3" style={{ color: accent }} />
        </div>
      </div>
      <div className="text-2xl font-light text-white relative tracking-[-0.01em]">{value}</div>
    </div>
  );
}

type SellerListingItem = SellerProfile['listings'][number];

function ListingsGrid({
  items,
  has,
  toggle,
}: {
  items: SellerListingItem[];
  has: (id: string) => boolean;
  toggle: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {items.map((l, idx) => {
        const meta = TYPE_META[l.type] || TYPE_META.OTHER;
        const saved = has(l.id);
        return (
          <motion.div
            key={l.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              delay: Math.min(idx * 0.035, 0.35),
              duration: 0.32,
              ease: [0.22, 0.61, 0.36, 1],
            }}
            whileHover={{ y: -3 }}
          >
            <Link
              href={`/market/agents/${l.id}`}
              className="group relative rounded-xl p-4 overflow-hidden transition-all block"
              style={{
                background: 'var(--bg-card)',
                boxShadow: '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.03)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = `0 0 0 1px ${meta.color}40, inset 0 1px 0 rgba(255,255,255,0.04), 0 8px 24px -12px rgba(0,0,0,0.5)`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow =
                  '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.03)';
              }}
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 h-px opacity-0 group-hover:opacity-100 transition-opacity"
                style={{
                  background: `linear-gradient(90deg, transparent 0%, ${meta.color}80 50%, transparent 100%)`,
                }}
              />
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  toggle(l.id);
                }}
                aria-pressed={saved}
                aria-label={saved ? 'Remove from saved' : 'Save for later'}
                className={`absolute top-3 right-3 w-7 h-7 rounded-md flex items-center justify-center transition-all ${
                  saved ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
                style={
                  saved
                    ? {
                        color: '#f9a8d4',
                        background: 'rgba(236,72,153,0.1)',
                        boxShadow: 'inset 0 0 0 1px rgba(236,72,153,0.35)',
                      }
                    : {
                        color: 'rgba(161,161,170,0.5)',
                        background: 'rgba(255,255,255,0.04)',
                        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)',
                      }
                }
              >
                <Heart className={`w-3.5 h-3.5 ${saved ? 'fill-current' : ''}`} />
              </button>
              <div className="flex items-start gap-3 mb-3">
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                  style={{
                    background: `linear-gradient(135deg, ${meta.color}22 0%, ${meta.color}06 100%)`,
                    boxShadow: `inset 0 0 0 1px ${meta.color}38, inset 0 1px 0 rgba(255,255,255,0.06), 0 0 16px -6px ${meta.color}40`,
                  }}
                >
                  <meta.Icon className="w-4 h-4" style={{ color: meta.color }} />
                </div>
                <div className="min-w-0 flex-1 pr-7">
                  <div className="text-[13px] font-light text-white truncate tracking-[0.005em]">
                    {l.title}
                  </div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">
                    {meta.label} · {timeAgo(l.createdAt)}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-white font-light">
                  {l.price} <span className="text-zinc-500 text-xs">{l.currency}</span>
                </span>
                {l.reviewAverage !== null &&
                  l.reviewAverage !== undefined &&
                  (l.reviewCount ?? 0) > 0 && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400">
                      <Star className="w-3 h-3" style={{ color: '#b4a7ff', fill: '#b4a7ff' }} />
                      {l.reviewAverage.toFixed(1)}
                      <span className="text-zinc-600">({l.reviewCount})</span>
                    </span>
                  )}
              </div>
            </Link>
          </motion.div>
        );
      })}
    </div>
  );
}
