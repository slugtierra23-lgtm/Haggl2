'use client';

import { Crown, DollarSign, Flame, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import React, { useEffect, useRef, useState } from 'react';

import { getReputationRank } from '@/components/ui/reputation-badge';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { api } from '@/lib/api/client';

interface TickerAgent {
  id: string;
  title: string;
  sales: number;
  earnings: number;
  currency: string;
  sellerUsername: string | null;
  sellerAvatar: string | null;
}

interface TickerDev {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  reputationPoints: number;
  totalSales: number;
  totalEarnings: number;
}

interface TickerData {
  topAgents: TickerAgent[];
  topDevs: TickerDev[];
}

const REFRESH_MS = 30_000;

export function MarketTicker() {
  const [data, setData] = useState<TickerData>({ topAgents: [], topDevs: [] });
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await api.get<TickerData>('/market/ticker');
        if (!cancelled) setData(res);
      } catch {
        /* swallow — ticker is best-effort */
      }
    }
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const items = useTickerItems(data);
  const [viewportWidth, setViewportWidth] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const update = () => setViewportWidth(containerRef.current?.clientWidth || window.innerWidth);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  if (items.length === 0) return null;

  // Each entry is ~240px wide on average (badge + avatar + text + gap).
  // Ensure each half of the track is at least 1.5× the viewport so the
  // marquee looks continuous even when only a couple of top-5 items exist.
  const AVG_ITEM_PX = 240;
  const halfTargetPx = Math.max(1200, viewportWidth * 1.5);
  const itemsPerHalf = Math.max(items.length, Math.ceil(halfTargetPx / AVG_ITEM_PX));
  const repeats = Math.ceil(itemsPerHalf / items.length);
  const half = Array.from({ length: repeats }, () => items).flat();
  // Two identical halves → animating translateX 0→-50% produces a seamless loop.
  const loop = [...half, ...half];

  // Constant pixels/sec so visual speed is independent of how many items exist.
  const SPEED_PX_PER_SEC = 70;
  const durationSec = Math.max(30, (half.length * AVG_ITEM_PX) / SPEED_PX_PER_SEC);

  return (
    <div
      ref={containerRef}
      className="mk-ticker relative overflow-hidden hidden md:block"
      style={{
        background: 'var(--bg-card)',
        borderBottom: '1px solid var(--border)',
        height: '34px',
      }}
      aria-label="Top agents and developers ticker"
    >
      <div
        className="absolute inset-y-0 left-0 z-10 pointer-events-none"
        style={{
          width: 56,
          background: 'linear-gradient(90deg, var(--bg-card) 0%, transparent 100%)',
        }}
      />
      <div
        className="absolute inset-y-0 right-0 z-10 pointer-events-none"
        style={{
          width: 56,
          background: 'linear-gradient(270deg, var(--bg-card) 0%, transparent 100%)',
        }}
      />
      <div
        ref={trackRef}
        className="ticker-track flex items-center gap-7 h-full whitespace-nowrap w-max"
        style={{
          animation: `ticker-slide ${durationSec}s linear infinite`,
          willChange: 'transform',
        }}
      >
        {loop.map((it, i) => (
          <TickerEntry key={`${it.key}-${i}`} item={it} />
        ))}
      </div>
      <style jsx>{`
        @keyframes ticker-slide {
          from {
            transform: translate3d(0, 0, 0);
          }
          to {
            transform: translate3d(-50%, 0, 0);
          }
        }
        .ticker-track:hover {
          animation-play-state: paused;
        }
      `}</style>
    </div>
  );
}

type TickerItem =
  | {
      key: string;
      kind: 'agent';
      href: string;
      title: string;
      sales: number;
      earnings: number;
      currency: string;
      sellerUsername: string | null;
      sellerAvatar: string | null;
    }
  | {
      key: string;
      kind: 'dev';
      href: string;
      username: string | null;
      displayName: string | null;
      avatarUrl: string | null;
      reputationPoints: number;
      totalSales: number;
      totalEarnings: number;
    };

function useTickerItems(data: TickerData): TickerItem[] {
  // Interleave agents / devs so the bar feels mixed.
  const agents = data.topAgents.slice(0, 10);
  const devs = data.topDevs.slice(0, 10);
  const items: TickerItem[] = [];
  const max = Math.max(agents.length, devs.length);
  for (let i = 0; i < max; i++) {
    const a = agents[i];
    if (a) {
      items.push({
        key: `a-${a.id}`,
        kind: 'agent',
        href: `/market/agents/${a.id}`,
        title: a.title,
        sales: a.sales,
        earnings: a.earnings,
        currency: a.currency,
        sellerUsername: a.sellerUsername,
        sellerAvatar: a.sellerAvatar,
      });
    }
    const d = devs[i];
    if (d) {
      items.push({
        key: `d-${d.id}`,
        kind: 'dev',
        href: d.username ? `/u/${d.username}` : '#',
        username: d.username,
        displayName: d.displayName,
        avatarUrl: d.avatarUrl,
        reputationPoints: d.reputationPoints,
        totalSales: d.totalSales,
        totalEarnings: d.totalEarnings,
      });
    }
  }
  return items;
}

function formatEarnings(amount: number, currency: string = 'ETH'): string {
  if (!amount) return `0 ${currency}`;
  const fixed =
    amount >= 1000 ? amount.toFixed(0) : amount >= 1 ? amount.toFixed(2) : amount.toFixed(4);
  return `${fixed} ${currency}`;
}

function TickerEntry({ item }: { item: TickerItem }) {
  if (item.kind === 'agent') {
    return (
      <Link
        href={item.href}
        className="inline-flex items-center gap-2 hover:brightness-125 transition-all"
        style={{ fontSize: 11.5 }}
      >
        <span
          className="inline-flex items-center gap-1 px-1.5 py-[1.5px] rounded font-mono uppercase"
          style={{
            background: 'rgba(236,72,153,0.12)',
            color: '#f9a8d4',
            border: '1px solid rgba(236,72,153,0.32)',
            fontSize: 9.5,
            letterSpacing: '0.12em',
          }}
        >
          <Flame className="w-2.5 h-2.5" strokeWidth={2.5} />
          Top sold
        </span>
        <UserAvatar
          src={item.sellerAvatar}
          name={item.sellerUsername}
          userId={item.sellerUsername || item.title}
          size={16}
        />
        <span style={{ color: 'var(--text)' }} className="truncate max-w-[160px]">
          {item.title}
        </span>
        <span style={{ color: 'var(--text-muted)' }} className="font-mono">
          ·
        </span>
        <span
          style={{ color: '#22c55e', fontSize: 10.5 }}
          className="font-mono inline-flex items-center gap-1"
        >
          <TrendingUp className="w-2.5 h-2.5" strokeWidth={2.5} />
          {item.sales} sales
        </span>
        {item.earnings > 0 && (
          <span
            style={{ color: '#22c55e', fontSize: 10.5 }}
            className="font-mono inline-flex items-center gap-1"
          >
            <DollarSign className="w-2.5 h-2.5" strokeWidth={2.5} />
            {formatEarnings(item.earnings, item.currency)}
          </span>
        )}
      </Link>
    );
  }

  const rank = getReputationRank(item.reputationPoints);
  const RankIcon = rank.icon;
  return (
    <Link
      href={item.href}
      className="inline-flex items-center gap-2 hover:brightness-125 transition-all"
      style={{ fontSize: 11.5 }}
    >
      <span
        className="inline-flex items-center gap-1 px-1.5 py-[1.5px] rounded font-mono uppercase"
        style={{
          background: `${rank.color}14`,
          color: rank.color,
          border: `1px solid ${rank.color}38`,
          fontSize: 9.5,
          letterSpacing: '0.12em',
        }}
      >
        <Crown className="w-2.5 h-2.5" strokeWidth={2.5} />
        Top dev
      </span>
      <UserAvatar
        src={item.avatarUrl}
        name={item.username}
        userId={item.username || item.href}
        size={16}
      />
      <span style={{ color: 'var(--text)' }} className="truncate max-w-[140px]">
        @{item.username || 'anon'}
      </span>
      {item.totalEarnings > 0 && (
        <span
          style={{ color: '#22c55e', fontSize: 10.5 }}
          className="font-mono inline-flex items-center gap-1"
        >
          <DollarSign className="w-2.5 h-2.5" strokeWidth={2.5} />
          {formatEarnings(item.totalEarnings)}
        </span>
      )}
    </Link>
  );
}
