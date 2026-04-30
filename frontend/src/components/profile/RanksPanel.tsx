'use client';

import { ChevronRight, Lock } from 'lucide-react';
import React, { useMemo, useState } from 'react';

import { RANK_TIERS, getReputationRank } from '@/components/ui/reputation-badge';

/**
 * Interactive Ranks tab.
 *
 * Three layers, all on one page:
 *   1. Hero — the user's current tier with a progress bar to the next
 *      threshold and the point delta required.
 *   2. Tier ladder — every rank as a clickable card. Click expands the
 *      card to show its threshold, description, and a stub for "what
 *      this unlocks" (the perks list is wired so we can fill it in
 *      without touching this layout when the tier rewards land).
 *
 * Inputs are rays (reputation points) only. Everything else is
 * derived from RANK_TIERS so adding / renaming a tier reflects here
 * automatically.
 */

const TIER_PERKS: Record<string, string[]> = {
  HIERRO: ['Publish your first agent', 'Earn rays from any sale or review'],
  BRONCE: ['Custom user tag (#yourtag)', 'Visible in seller search'],
  PLATA: ['Marketplace seller badge', 'Listing boost discount: 5%'],
  ORO: ['Negotiation analytics dashboard', 'Listing boost discount: 10%'],
  PLATINO: ['Featured carousel rotation', 'Priority security review'],
  DIAMANTE: ['Direct line to platform team', 'Listing boost discount: 15%'],
  MAESTRIA: ['Master tier verified mark', 'Custom seller storefront'],
  CAMPEON: ['Top-5 spotlight', 'Free listing boosts (limited)'],
  LEYENDA: ['Founders circle access', 'Co-design future tiers'],
};

export function RanksPanel({ points }: { points: number }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const current = useMemo(() => getReputationRank(points), [points]);
  // current.tier is the numeric index into RANK_TIERS — use it directly
  // instead of re-looking-up by name. LEYENDA (#8) is treated as the
  // ceiling; everyone else has a `next` tier to grow into.
  const currentIdx = current.tier;
  const currentTier = RANK_TIERS[currentIdx] ?? RANK_TIERS[0];
  const next =
    currentIdx >= 0 && currentIdx < RANK_TIERS.length - 1 ? RANK_TIERS[currentIdx + 1] : null;
  const progress = next
    ? Math.min(
        100,
        Math.round(((points - current.threshold) / (next.threshold - current.threshold)) * 100),
      )
    : 100;
  const pointsToNext = next ? Math.max(0, next.threshold - points) : 0;

  return (
    <div className="space-y-4">
      {/* Hero current rank */}
      <div className="profile-content-card">
        <div className="flex items-start gap-4">
          <div
            className="w-14 h-14 rounded-2xl grid place-items-center shrink-0"
            style={{
              background: `${current.color}1f`,
              border: `1px solid ${current.color}55`,
            }}
          >
            <current.icon className="w-7 h-7" style={{ color: current.color }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10.5px] uppercase tracking-[0.18em] text-zinc-500 font-medium">
              Current rank
            </div>
            <div className="flex items-baseline gap-3 mt-0.5">
              <h2 className="text-[22px] text-white font-light">{current.label}</h2>
              <span className="text-[12px] font-mono text-zinc-500 tabular-nums">
                {points.toLocaleString()} rays
              </span>
            </div>
            <p className="text-[12px] text-zinc-400 font-light mt-0.5">{current.description}</p>
          </div>
        </div>

        {next ? (
          <div className="mt-4">
            <div className="flex items-center justify-between text-[11px] font-mono mb-1.5">
              <span className="text-zinc-500">
                Next: <span style={{ color: next.color }}>{next.label}</span>
              </span>
              <span className="text-zinc-300 tabular-nums">
                {pointsToNext.toLocaleString()} rays to go
              </span>
            </div>
            <div
              className="h-2 rounded-full overflow-hidden"
              style={{ background: 'var(--bg-card2)' }}
            >
              <div
                className="h-full transition-all"
                style={{
                  width: `${progress}%`,
                  background: `linear-gradient(90deg, ${current.color} 0%, ${next.color} 100%)`,
                }}
              />
            </div>
          </div>
        ) : (
          <div className="mt-4 text-[11.5px] text-zinc-400 font-light">
            You&apos;ve reached the top tier. Stay active to keep your standing.
          </div>
        )}
      </div>

      {/* Ladder */}
      <div className="profile-content-card">
        <div className="mb-3">
          <h3 className="text-[14px] text-white font-light">Tier ladder</h3>
          <p className="text-[11.5px] text-zinc-500 mt-0.5">
            Every rank, the rays it takes to reach it, and what it unlocks. Tap a tier to see its
            perks.
          </p>
        </div>
        <ul className="space-y-1.5">
          {RANK_TIERS.map((tier) => {
            const reached = points >= tier.threshold;
            const isCurrent = tier.rank === currentTier.rank;
            const open = expanded === tier.rank;
            const perks = TIER_PERKS[tier.rank] ?? [];
            return (
              <li
                key={tier.rank}
                className="rounded-lg overflow-hidden transition"
                style={{
                  background: isCurrent ? `${tier.color}10` : 'var(--bg-card2)',
                  border: `1px solid ${isCurrent ? `${tier.color}55` : 'var(--bg-card2)'}`,
                }}
              >
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : tier.rank)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
                  aria-expanded={open}
                >
                  <div
                    className="w-8 h-8 rounded-lg grid place-items-center shrink-0"
                    style={{
                      background: reached ? `${tier.color}1f` : 'var(--bg-card2)',
                      border: `1px solid ${reached ? `${tier.color}55` : 'var(--bg-card2)'}`,
                    }}
                  >
                    {reached ? (
                      <tier.icon
                        className="w-4 h-4"
                        style={{ color: tier.color }}
                        strokeWidth={1.75}
                      />
                    ) : (
                      <Lock className="w-3.5 h-3.5 text-zinc-600" strokeWidth={1.75} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span
                        className="text-[13px] font-light"
                        style={{ color: reached ? 'var(--text)' : 'var(--text-secondary)' }}
                      >
                        {tier.label}
                      </span>
                      {isCurrent && (
                        <span
                          className="text-[9.5px] uppercase tracking-[0.16em] font-medium px-1.5 py-0.5 rounded"
                          style={{
                            background: `${tier.color}26`,
                            color: tier.color,
                          }}
                        >
                          you
                        </span>
                      )}
                    </div>
                    <div className="text-[10.5px] font-mono text-zinc-500 tabular-nums">
                      {tier.threshold.toLocaleString()} rays
                    </div>
                  </div>
                  <ChevronRight
                    className="w-3.5 h-3.5 text-zinc-500 transition-transform shrink-0"
                    style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
                  />
                </button>
                {open && (
                  <div
                    className="px-3 pb-3 pt-1 text-[11.5px] font-light text-zinc-400 leading-relaxed"
                    style={{ borderTop: '1px solid var(--bg-card2)' }}
                  >
                    <p className="mt-2">{tier.description}.</p>
                    {perks.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {perks.map((p, i) => (
                          <li key={i} className="flex items-start gap-1.5">
                            <span style={{ color: tier.color }}>→</span>
                            <span>{p}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
