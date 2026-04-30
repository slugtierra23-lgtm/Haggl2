'use client';

import { Star, TrendingUp, ArrowUpRight, Heart, Share2, BadgeCheck, Flame } from 'lucide-react';
import Link from 'next/link';
import React from 'react';

import { UserAvatar } from '@/components/ui/UserAvatar';
import { cn } from '@/lib/utils';

export interface AtlasListingCardProps {
  href: string;
  title: string;
  /** Type label e.g. "Agent", "Repo". Renders as a small tag. */
  typeLabel?: string;
  typeIcon?: React.ReactNode;
  /** Tint for the type tag — accepts CSS color (rgba/hex/var). */
  typeAccent?: string;
  tags?: string[];
  price: number | null;
  currency?: string;
  /** SOL→USD rate (cents per SOL). If provided, an USD equivalent is
   * shown beneath the SOL price in muted ink to communicate value. */
  solUsdRate?: number | null;
  rating?: number | null;
  reviewCount?: number;
  sales24h?: number;
  seller?: {
    id?: string;
    username?: string | null;
    avatarUrl?: string | null;
    /** When true, a small green check appears next to the username. */
    verified?: boolean;
  };
  /** Cover/avatar image. Falls back to a UserAvatar of the seller. */
  cover?: string | null;
  /** "hot" surface — pulls eye to fast-moving listings. */
  isHot?: boolean;
  /** Save / unsave this listing. Heart fills when isSaved=true. */
  isSaved?: boolean;
  onToggleSave?: () => void;
  /** Triggered by the share button — caller should copy URL or open share sheet. */
  onShare?: () => void;
  className?: string;
}

// Always display prices in SOL — even if the listing in the DB still has
// `currency: 'ETH'` from the pre-Solana era, the platform is now
// Solana-native and showing "ETH" on a card confuses every user.
const formatPrice = (n: number | null, _ccy = 'SOL') => {
  if (n == null) return '—';
  if (n === 0) return 'Free';
  if (n < 0.01) return '<0.01 SOL';
  if (n < 1) return `${n.toFixed(3)} SOL`;
  return `${n.toFixed(2)} SOL`;
};

/**
 * AtlasListingCard — marketplace tile used across `/market`, `/market/agents`,
 * `/market/repos`, seller profiles, inventory. Replaces several near-duplicate
 * card layouts that all reinvented hover/spacing/typography. Hover state has a
 * Solana-green glow + arrow-up-right reveal.
 */
export function AtlasListingCard({
  href,
  title,
  typeLabel,
  typeIcon,
  typeAccent = 'var(--brand)',
  tags = [],
  price,
  currency = 'SOL',
  solUsdRate,
  rating,
  reviewCount,
  sales24h,
  seller,
  cover,
  isHot,
  isSaved,
  onToggleSave,
  onShare,
  className,
}: AtlasListingCardProps) {
  const isFree = price === 0;
  const usdEquivalent =
    price != null && price > 0 && solUsdRate != null && solUsdRate > 0 ? price * solUsdRate : null;

  return (
    <div
      className={cn(
        'atlas-listing-card group relative overflow-hidden rounded-xl',
        'flex flex-col h-full',
        'bg-[var(--bg-card)] border border-[var(--border)]',
        'transition-colors duration-150',
        'hover:border-[var(--border-hover)]',
        className,
      )}
    >
      {/* "Hot" pill — pinned top-right when listing is trending. */}
      {isHot && (
        <span
          className="pointer-events-none absolute top-3 right-3 z-20 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-[0.1em]"
          style={{
            background: 'rgba(245, 158, 11, 0.14)',
            color: '#f59e0b',
            border: '1px solid rgba(245, 158, 11, 0.32)',
          }}
        >
          <Flame className="w-2.5 h-2.5" strokeWidth={2.5} />
          Hot
        </span>
      )}

      {/* Quick actions — heart + share. Reveal on hover, top-right.
          stopPropagation so clicking them doesn't navigate the parent
          <Link>. */}
      {(onToggleSave || onShare) && (
        <div
          className={cn(
            'absolute z-20 flex items-center gap-1 transition-all duration-200',
            isHot ? 'top-3 right-[68px]' : 'top-3 right-3',
            'opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0',
          )}
        >
          {onToggleSave && (
            <button
              type="button"
              aria-label={isSaved ? 'Unsave' : 'Save'}
              aria-pressed={isSaved}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleSave();
              }}
              className={cn(
                'inline-flex items-center justify-center w-7 h-7 rounded-lg transition-colors',
                'bg-[var(--bg-card)]/85 backdrop-blur border border-[var(--border)]',
                isSaved
                  ? 'text-red-400 hover:text-red-300'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]',
              )}
            >
              <Heart
                className="w-3.5 h-3.5"
                strokeWidth={1.75}
                fill={isSaved ? 'currentColor' : 'none'}
              />
            </button>
          )}
          {onShare && (
            <button
              type="button"
              aria-label="Share"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onShare();
              }}
              className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-[var(--bg-card)]/85 backdrop-blur border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
            >
              <Share2 className="w-3.5 h-3.5" strokeWidth={1.75} />
            </button>
          )}
        </div>
      )}

      <Link href={href} className="flex flex-col flex-1 p-5 relative z-10">
        <div className="flex items-start gap-4 mb-4">
          {/* Cover / avatar — larger, with brand glow on hover */}
          <div className="relative h-14 w-14 shrink-0 rounded-lg overflow-hidden border border-[var(--border)] bg-[var(--bg-card2)] grid place-items-center">
            {cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cover} alt={title} className="h-full w-full object-cover" />
            ) : (
              <UserAvatar
                size={56}
                src={seller?.avatarUrl}
                name={seller?.username}
                userId={seller?.id}
              />
            )}
          </div>

          {/* Title + tags */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-2">
              {typeLabel && (
                <span
                  className="inline-flex items-center gap-1 text-[10.5px] font-medium uppercase tracking-[0.08em] shrink-0"
                  style={{ color: typeAccent }}
                >
                  {typeIcon}
                  {typeLabel}
                </span>
              )}
            </div>
            <h3 className="mt-1.5 text-[15px] font-medium text-[var(--text)] leading-snug line-clamp-2 tracking-tight">
              {title}
            </h3>
            {seller?.username && (
              <p className="mt-1 text-[12px] text-[var(--text-muted)] truncate inline-flex items-center gap-1">
                @{seller.username}
                {seller.verified && (
                  <BadgeCheck
                    className="w-3 h-3 text-[var(--brand)] shrink-0"
                    strokeWidth={2.25}
                    aria-label="Verified seller"
                  />
                )}
              </p>
            )}
          </div>

          {/* Reveal arrow */}
          <ArrowUpRight
            className="shrink-0 w-4 h-4 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity duration-150"
            strokeWidth={2}
          />
        </div>

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4 min-h-[20px]">
            {tags.slice(0, 3).map((t) => (
              <span
                key={t}
                className="inline-flex h-5 px-2 items-center rounded text-[10.5px] font-medium text-[var(--text-secondary)] bg-[var(--bg-card2)] border border-[var(--border)]"
              >
                {t}
              </span>
            ))}
            {tags.length > 3 && (
              <span className="inline-flex h-5 px-2 items-center rounded text-[10.5px] font-medium text-[var(--text-muted)]">
                +{tags.length - 3}
              </span>
            )}
          </div>
        )}

        <div className="mt-auto flex items-center justify-between pt-3 border-t border-[var(--border)]">
          <div className="flex items-center gap-3 min-w-0">
            {rating != null && (
              <div className="flex items-center gap-1">
                <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" strokeWidth={1.5} />
                <span className="text-[12px] font-medium text-[var(--text)] tabular-nums">
                  {rating.toFixed(1)}
                </span>
                {reviewCount != null && reviewCount > 0 && (
                  <span className="text-[11px] text-[var(--text-muted)]">({reviewCount})</span>
                )}
              </div>
            )}
            {sales24h != null && sales24h > 0 && (
              <div className="flex items-center gap-1 text-[var(--text-muted)]">
                <TrendingUp className="w-3.5 h-3.5 text-[var(--brand)]" strokeWidth={1.75} />
                <span className="text-[11px] font-medium">{sales24h}/24h</span>
              </div>
            )}
          </div>

          <div className="flex flex-col items-end shrink-0 leading-none">
            <span
              className={cn(
                'font-mono text-[15px] font-medium tabular-nums tracking-tight',
                isFree ? 'text-[var(--brand)]' : 'text-[var(--text)]',
              )}
            >
              {formatPrice(price, currency)}
            </span>
            {usdEquivalent != null && (
              <span className="mt-0.5 font-mono text-[10.5px] text-[var(--text-muted)] tabular-nums">
                ≈ ${usdEquivalent < 1 ? usdEquivalent.toFixed(2) : usdEquivalent.toFixed(0)}
              </span>
            )}
          </div>
        </div>
      </Link>
    </div>
  );
}

export default AtlasListingCard;
