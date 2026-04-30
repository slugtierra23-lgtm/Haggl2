'use client';

import { motion } from 'framer-motion';
import { Activity, Clock, Key, Package, ShoppingBag, Store, TrendingUp, Users } from 'lucide-react';
import React from 'react';

interface UsageData {
  // Legacy fields preserved for backward compat
  totalCalls?: number;
  maxCalls?: number;
  activeAgents?: number;
  last24hCalls?: number;
  lastResetDate?: string;
  // New honest breakdown
  purchasesThisMonth?: number;
  repoPurchasesThisMonth?: number;
  salesThisMonth?: number;
  activeListings?: number;
  last24hPurchases?: number;
  last30dPurchases?: number;
  apiKeysCount?: number;
  lastApiUsedAt?: string | null;
  lastPurchaseAt?: string | null;
}

interface UsageSectionProps {
  data: UsageData;
}

function timeAgo(date: string | null | undefined): string {
  if (!date) return 'Never';
  const ms = Date.now() - new Date(date).getTime();
  if (ms < 60_000) return 'Just now';
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30);
  return `${mo}mo ago`;
}

export const UsageSection: React.FC<UsageSectionProps> = ({ data }) => {
  const purchases = data.purchasesThisMonth ?? data.totalCalls ?? 0;
  const repos = data.repoPurchasesThisMonth ?? 0;
  const sales = data.salesThisMonth ?? 0;
  const listings = data.activeListings ?? data.activeAgents ?? 0;
  const last24h = data.last24hPurchases ?? data.last24hCalls ?? 0;
  const last30d = data.last30dPurchases ?? 0;
  const apiKeys = data.apiKeysCount ?? 0;
  const resetDate = data.lastResetDate || new Date().toISOString();
  const totalThisMonth = purchases + repos + sales;

  // Trend indicator — compare last 24h vs average daily over 30d
  const avgDaily = last30d / 30;
  const trendUp = last24h > avgDaily;

  return (
    <div className="profile-content-card space-y-4 sm:space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-light text-white">Usage &amp; Activity</h2>
        <p className="text-sm text-white/50 mt-1">
          Live activity on your account. Resets monthly on the{' '}
          <span className="tabular-nums text-white/70">
            {new Date(resetDate).toLocaleDateString('en-US', {
              month: 'long',
              day: 'numeric',
            })}
          </span>
          .
        </p>
      </div>

      {/* Hero metric — total activity this month */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.22, 0.61, 0.36, 1] }}
        className="relative p-5 sm:p-6 rounded-xl overflow-hidden"
        style={{
          background: 'var(--bg-card)',
          boxShadow: '0 0 0 1px var(--bg-card2), inset 0 1px 0 var(--bg-card2)',
        }}
      >
        <span
          className="absolute inset-x-0 top-0 h-px"
          style={{
            background:
              'linear-gradient(90deg, transparent 0%, rgba(20, 241, 149, 0.45) 50%, transparent 100%)',
          }}
        />
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <p className="text-[10.5px] uppercase tracking-[0.18em] font-medium text-white/50 mb-2">
              Activity this month
            </p>
            <p className="text-3xl sm:text-4xl font-light text-white tabular-nums tracking-[-0.01em]">
              {totalThisMonth.toLocaleString()}
            </p>
            <p className="text-xs text-white/50 mt-1">
              Combined transactions (buys, sales, repo unlocks)
            </p>
          </div>
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
            style={{
              background: trendUp ? 'rgba(34,197,94,0.08)' : 'var(--bg-card2)',
              border: `1px solid ${trendUp ? 'rgba(34,197,94,0.28)' : 'var(--bg-card2)'}`,
            }}
          >
            <TrendingUp
              className={`w-3.5 h-3.5 ${trendUp ? 'text-emerald-400' : 'text-white/40'}`}
            />
            <span
              className={`text-xs tabular-nums ${trendUp ? 'text-emerald-300' : 'text-white/50'}`}
            >
              {last24h} last 24h
            </span>
          </div>
        </div>
      </motion.div>

      {/* Breakdown grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
        <StatCard
          delay={0.08}
          accent="#06B6D4"
          label="Listings active"
          value={listings}
          sub="Currently published"
          Icon={Store}
        />
        <StatCard
          delay={0.12}
          accent="#14F195"
          label="Purchases"
          value={purchases}
          sub="AI agents / tools"
          Icon={ShoppingBag}
        />
        <StatCard
          delay={0.16}
          accent="#EC4899"
          label="Repo unlocks"
          value={repos}
          sub="Paid repositories"
          Icon={Package}
        />
        <StatCard
          delay={0.2}
          accent="#22c55e"
          label="Sales"
          value={sales}
          sub="Things you sold"
          Icon={Activity}
        />
        <StatCard
          delay={0.24}
          accent="#f59e0b"
          label="API keys"
          value={apiKeys}
          sub={data.lastApiUsedAt ? `Last used ${timeAgo(data.lastApiUsedAt)}` : 'None used yet'}
          Icon={Key}
        />
        <StatCard
          delay={0.28}
          accent="#b4a7ff"
          label="Last 30 days"
          value={last30d}
          sub={`Last purchase ${timeAgo(data.lastPurchaseAt ?? null)}`}
          Icon={Clock}
        />
      </div>

      {/* Helper note */}
      <div
        className="flex items-start gap-3 p-3 sm:p-4 rounded-xl"
        style={{
          background: 'var(--bg-card2)',
          border: '1px dashed var(--bg-card2)',
        }}
      >
        <Users className="w-4 h-4 text-white/40 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-white/55 leading-relaxed">
          These numbers come straight from your on-chain activity on Atlas. Sales and purchases are
          only counted after payment is verified on Base.
        </p>
      </div>
    </div>
  );
};

UsageSection.displayName = 'UsageSection';

// ── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  delay,
  accent,
  label,
  value,
  sub,
  Icon,
}: {
  delay: number;
  accent: string;
  label: string;
  value: number;
  sub: string;
  Icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.28, ease: [0.22, 0.61, 0.36, 1] }}
      whileHover={{ y: -2 }}
      className="relative p-3 sm:p-4 rounded-xl overflow-hidden transition-colors hover:brightness-110"
      style={{
        background: 'var(--bg-card)',
        boxShadow: '0 0 0 1px var(--bg-card2), inset 0 1px 0 var(--bg-card2)',
      }}
    >
      <span
        className="absolute inset-x-0 top-0 h-px"
        style={{
          background: `linear-gradient(90deg, transparent 0%, ${accent}66 50%, transparent 100%)`,
        }}
      />
      <div className="flex items-center justify-between mb-2 sm:mb-3">
        <p className="text-[9.5px] sm:text-[10.5px] uppercase tracking-[0.18em] font-medium text-white/50 truncate">
          {label}
        </p>
        <div
          className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{
            background: `linear-gradient(135deg, ${accent}33 0%, ${accent}0d 100%)`,
            boxShadow: `inset 0 0 0 1px ${accent}60, 0 0 12px -4px ${accent}aa`,
          }}
        >
          <Icon className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
        </div>
      </div>
      <p className="text-2xl sm:text-3xl font-light text-white tabular-nums tracking-[-0.01em]">
        {value.toLocaleString()}
      </p>
      <p className="text-[11px] sm:text-xs text-white/50 mt-1.5 sm:mt-2 truncate">{sub}</p>
    </motion.div>
  );
}
