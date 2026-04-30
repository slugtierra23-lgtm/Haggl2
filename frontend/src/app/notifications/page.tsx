'use client';

export const dynamic = 'force-dynamic';

import {
  ArrowUpRight,
  Bell,
  Check,
  DollarSign,
  MessageSquare,
  Package,
  PartyPopper,
  Search,
  Star,
  X,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useKeyboardFocus } from '@/lib/hooks/useKeyboardFocus';
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationItem,
  type NotificationType,
} from '@/lib/hooks/useNotifications';
import { cn } from '@/lib/utils';

const TYPE_META: Record<NotificationType, { icon: LucideIcon; color: string; label: string }> = {
  MARKET_NEW_SALE: { icon: DollarSign, color: '#22c55e', label: 'Sale' },
  MARKET_NEW_REVIEW: { icon: Star, color: '#f59e0b', label: 'Review' },
  MARKET_ORDER_DELIVERED: { icon: Package, color: '#06B6D4', label: 'Delivery' },
  MARKET_ORDER_COMPLETED: { icon: PartyPopper, color: '#14F195', label: 'Completed' },
  MARKET_NEGOTIATION_MESSAGE: { icon: MessageSquare, color: '#EC4899', label: 'Message' },
  SYSTEM: { icon: Bell, color: '#94a3b8', label: 'System' },
};

const TYPE_FILTERS: { value: NotificationType | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'MARKET_NEW_SALE', label: 'Sales' },
  { value: 'MARKET_NEW_REVIEW', label: 'Reviews' },
  { value: 'MARKET_ORDER_DELIVERED', label: 'Deliveries' },
  { value: 'MARKET_ORDER_COMPLETED', label: 'Completed' },
  { value: 'MARKET_NEGOTIATION_MESSAGE', label: 'Messages' },
  { value: 'SYSTEM', label: 'System' },
];

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 5) return 'now';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function formatNumber(n: number) {
  if (!Number.isFinite(n)) return '0';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return n.toString();
}

export default function NotificationsPage() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [typeFilter, setTypeFilter] = useState<NotificationType | 'ALL'>('ALL');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  useKeyboardFocus(searchRef);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchNotifications(filter === 'unread', 50);
      setItems(data.items);
      setUnread(data.unreadCount);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRead = async (n: NotificationItem) => {
    if (n.readAt) return;
    try {
      await markNotificationRead(n.id);
    } catch {
      return;
    }
    setItems((prev) =>
      prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)),
    );
    setUnread((c) => Math.max(0, c - 1));
  };

  const handleMarkAll = async () => {
    try {
      await markAllNotificationsRead();
    } catch {
      return;
    }
    const now = new Date().toISOString();
    setItems((prev) => prev.map((x) => (x.readAt ? x : { ...x, readAt: now })));
    setUnread(0);
  };

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    return items.filter((n) => {
      if (typeFilter !== 'ALL' && n.type !== typeFilter) return false;
      if (!q) return true;
      const haystack = `${n.title} ${n.body || ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [items, typeFilter, q]);

  const typeCounts = useMemo(() => {
    return items.reduce<Record<string, number>>((acc, n) => {
      acc[n.type] = (acc[n.type] || 0) + 1;
      return acc;
    }, {});
  }, [items]);

  const todayCount = useMemo(() => {
    const since = Date.now() - 24 * 60 * 60 * 1000;
    return items.filter((n) => new Date(n.createdAt).getTime() >= since).length;
  }, [items]);

  const mostActiveType = useMemo(() => {
    let best: { type: string; count: number } | null = null;
    for (const [t, c] of Object.entries(typeCounts)) {
      if (!best || c > best.count) best = { type: t, count: c };
    }
    return best;
  }, [typeCounts]);

  return (
    <div className="mk-app-page min-h-screen pb-20" style={{ maxWidth: 'none', padding: 0 }}>
      <header className="px-6 pt-8 pb-4 md:px-10 md:pt-10">
        <div className="mx-auto max-w-[1200px]">
          <div className="flex items-baseline justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 text-[10.5px] font-medium text-zinc-500 uppercase tracking-[0.18em] mb-2">
                <Bell className="w-3.5 h-3.5" strokeWidth={1.75} />
                <span>Activity feed</span>
                {unread > 0 && <LiveDot />}
              </div>
              <h1 className="text-2xl md:text-3xl font-light tracking-tight text-white">
                Notifications
              </h1>
              <p className="text-[12.5px] text-zinc-500 font-light mt-1">
                {unread > 0 ? `${unread} unread · ${items.length} total` : 'You are all caught up.'}
              </p>
            </div>
            {unread > 0 && (
              <button
                onClick={handleMarkAll}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[12px] text-zinc-300 hover:text-white transition"
                style={{
                  background: 'var(--bg-card)',
                  boxShadow:
                    '0 0 0 1px rgba(255,255,255,0.08), inset 0 1px 0 rgba(255,255,255,0.03)',
                }}
              >
                <Check className="w-3.5 h-3.5" strokeWidth={1.75} />
                Mark all read
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Stats strip */}
      <section className="px-6 md:px-10 mb-4">
        <div className="mx-auto max-w-[1200px] grid grid-cols-2 md:grid-cols-4 gap-2">
          <StatTile
            label="Unread"
            value={formatNumber(unread)}
            sub={unread > 0 ? 'waiting for you' : 'inbox zero'}
            accent="#14F195"
          />
          <StatTile
            label="Today"
            value={formatNumber(todayCount)}
            sub="last 24h"
            accent="#22c55e"
          />
          <StatTile
            label="Total"
            value={formatNumber(items.length)}
            sub="last 50 loaded"
            accent="#06B6D4"
          />
          <StatTile
            label="Top type"
            value={
              mostActiveType
                ? TYPE_META[mostActiveType.type as NotificationType]?.label || '—'
                : '—'
            }
            sub={mostActiveType ? `${mostActiveType.count} events` : 'no activity'}
            accent="#EC4899"
          />
        </div>
      </section>

      {/* Filters */}
      <section className="px-6 md:px-10 mb-3">
        <div className="mx-auto max-w-[1200px] flex items-center gap-2 flex-wrap">
          <div
            className="flex items-center gap-0.5 rounded-lg p-0.5"
            style={{
              background: 'rgba(0,0,0,0.4)',
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)',
            }}
          >
            {(['all', 'unread'] as const).map((f) => {
              const active = filter === f;
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className="px-3 py-1.5 text-[12px] font-light rounded-md transition"
                  style={{
                    color: active ? 'var(--text)' : 'var(--text-secondary)',
                    background: active ? 'rgba(20, 241, 149, 0.2)' : 'transparent',
                    boxShadow: active ? 'inset 0 0 0 1px rgba(20, 241, 149, 0.35)' : 'none',
                  }}
                >
                  {f === 'all' ? 'All' : 'Unread'}
                </button>
              );
            })}
          </div>

          <div
            className="flex items-center gap-1 flex-1 min-w-[220px] max-w-md px-3 py-1.5 rounded-lg"
            style={{
              background: 'rgba(0,0,0,0.4)',
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)',
            }}
          >
            <Search className="w-3.5 h-3.5 text-zinc-500" strokeWidth={1.75} />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search notifications…"
              className="flex-1 bg-transparent border-none outline-none text-[12.5px] font-light text-white placeholder-zinc-600"
            />
            {query ? (
              <button
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="w-5 h-5 rounded flex items-center justify-center text-zinc-500 hover:text-zinc-200"
              >
                <X className="w-3 h-3" />
              </button>
            ) : (
              <kbd className="hidden sm:inline-flex items-center justify-center text-[10px] text-zinc-500 px-1.5 py-0.5 rounded bg-white/5 border border-white/10">
                /
              </kbd>
            )}
          </div>

          <div className="flex items-center gap-1 ml-auto flex-wrap">
            {TYPE_FILTERS.map((t) => {
              const count = t.value === 'ALL' ? items.length : typeCounts[t.value] || 0;
              if (t.value !== 'ALL' && count === 0) return null;
              const active = typeFilter === t.value;
              const color =
                t.value === 'ALL'
                  ? '#14F195'
                  : TYPE_META[t.value as NotificationType]?.color || '#14F195';
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setTypeFilter(t.value)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11.5px] font-light transition"
                  style={{
                    color: active ? 'var(--text)' : 'var(--text-secondary)',
                    background: active ? `${color}22` : 'rgba(255,255,255,0.02)',
                    boxShadow: active
                      ? `inset 0 0 0 1px ${color}5a`
                      : 'inset 0 0 0 1px rgba(255,255,255,0.06)',
                  }}
                >
                  {t.label}
                  <span
                    className="text-[10px] font-mono tabular-nums"
                    style={{ color: active ? `${color}ee` : 'var(--text-muted)' }}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Feed */}
      <section className="px-6 md:px-10">
        <div className="mx-auto max-w-[1200px]">
          {loading && items.length === 0 ? (
            <div
              className="rounded-xl px-6 py-16 text-center text-sm text-zinc-500 font-light"
              style={{
                background: 'var(--bg-card)',
                boxShadow: '0 0 0 1px rgba(255,255,255,0.06)',
              }}
            >
              Loading notifications…
            </div>
          ) : visible.length === 0 ? (
            <EmptyState query={q} typeFilter={typeFilter} />
          ) : (
            <div
              className="rounded-xl overflow-hidden"
              style={{
                background: 'var(--bg-card)',
                boxShadow: '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.04)',
              }}
            >
              <div className="grid grid-cols-[28px_minmax(0,1fr)_90px_70px_28px] items-center gap-3 px-3 py-2 text-[10px] uppercase tracking-[0.14em] text-zinc-500 font-medium border-b border-white/5">
                <span className="text-center">#</span>
                <span>Notification</span>
                <span>Type</span>
                <span className="text-right">Age</span>
                <span />
              </div>
              <ul>
                {visible.map((n, i) => (
                  <NotifRow key={n.id} item={n} index={i} onRead={handleRead} />
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function LiveDot() {
  return (
    <span className="relative inline-flex items-center justify-center w-2 h-2 ml-1">
      <span
        className="absolute inset-0 rounded-full animate-ping"
        style={{ background: '#14F195' }}
      />
      <span className="relative inline-block w-1.5 h-1.5 rounded-full bg-[#14F195]" />
    </span>
  );
}

function StatTile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent: string;
}) {
  return (
    <div
      className="relative rounded-xl px-4 py-3 overflow-hidden"
      style={{
        background: 'var(--bg-card)',
        boxShadow: '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.04)',
      }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px opacity-80"
        style={{
          background: `linear-gradient(90deg, transparent 0%, ${accent} 50%, transparent 100%)`,
        }}
      />
      <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500 mb-1">
        {label}
      </div>
      <div className="font-mono text-xl md:text-2xl font-light text-white tabular-nums">
        {value}
      </div>
      <div className="text-[10.5px] text-zinc-500 font-light mt-0.5">{sub}</div>
    </div>
  );
}

function NotifRow({
  item,
  index,
  onRead,
}: {
  item: NotificationItem;
  index: number;
  onRead: (n: NotificationItem) => void;
}) {
  const meta = TYPE_META[item.type] ?? TYPE_META.SYSTEM;
  const Icon = meta.icon;
  const isUnread = !item.readAt;

  const inner = (
    <div className="group relative flex items-center gap-4 px-4 py-3.5 w-full text-left border-b border-[var(--border)] transition-all hover:bg-[var(--bg-card2)]">
      {/* Left accent bar — solid for unread, faint for read */}
      <span
        aria-hidden
        className="absolute left-0 top-0 bottom-0 w-[3px]"
        style={{ background: meta.color, opacity: isUnread ? 1 : 0.25 }}
      />
      {isUnread && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background: `linear-gradient(90deg, ${meta.color}10, transparent 35%)`,
          }}
        />
      )}

      {/* Icon plate */}
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 relative"
        style={{
          background: `${meta.color}14`,
          border: `1px solid ${meta.color}40`,
          boxShadow: isUnread ? `0 0 16px -4px ${meta.color}55` : 'none',
        }}
      >
        <Icon className="w-4 h-4" strokeWidth={1.75} style={{ color: meta.color }} />
        {isUnread && (
          <span
            aria-hidden
            className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full ring-2 ring-[var(--bg-card)]"
            style={{ background: meta.color, boxShadow: `0 0 8px ${meta.color}` }}
          />
        )}
      </div>

      {/* Title + body */}
      <div className="flex-1 min-w-0 relative">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={cn(
              'text-[14px] truncate',
              isUnread
                ? 'font-medium text-[var(--text)]'
                : 'font-normal text-[var(--text-secondary)]',
            )}
          >
            {item.title}
          </span>
          <span
            className="inline-flex items-center px-1.5 py-px rounded text-[10px] font-medium uppercase tracking-[0.06em] shrink-0"
            style={{
              color: meta.color,
              background: `${meta.color}14`,
              border: `1px solid ${meta.color}40`,
            }}
          >
            {meta.label}
          </span>
        </div>
        {item.body && (
          <div className="text-[12.5px] text-[var(--text-muted)] font-light line-clamp-2 mt-0.5">
            {item.body}
          </div>
        )}
      </div>

      {/* Right meta */}
      <div className="flex items-center gap-2 shrink-0 relative">
        <div className="text-right text-[11.5px] text-[var(--text-muted)] font-mono tabular-nums">
          {timeAgo(item.createdAt)}
        </div>
        <ArrowUpRight
          className="w-4 h-4 text-[var(--text-muted)] opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all"
          strokeWidth={1.75}
        />
      </div>
    </div>
  );

  return (
    <li>
      {item.url ? (
        <Link href={item.url} onClick={() => onRead(item)} className="block">
          {inner}
        </Link>
      ) : (
        <button type="button" onClick={() => onRead(item)} className="w-full text-left">
          {inner}
        </button>
      )}
    </li>
  );
}

function EmptyState({ query, typeFilter }: { query: string; typeFilter: string }) {
  return (
    <div
      className="relative rounded-xl px-6 py-16 text-center overflow-hidden"
      style={{
        background: 'var(--bg-card)',
        boxShadow: '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.04)',
      }}
    >
      <span
        aria-hidden
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
            'linear-gradient(135deg, rgba(20, 241, 149, 0.22) 0%, rgba(20, 241, 149, 0.06) 100%)',
          border: '1px solid rgba(20, 241, 149, 0.35)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), 0 0 24px -6px rgba(20, 241, 149, 0.45)',
        }}
      >
        <Bell className="w-5 h-5 text-[#b4a7ff]" strokeWidth={1.5} />
      </div>
      <p className="relative text-[14px] text-white font-normal">
        {query
          ? 'No notifications match your search'
          : typeFilter === 'ALL'
            ? 'Nothing here yet'
            : 'No notifications of that type'}
      </p>
      <p className="relative text-[12px] text-zinc-500 mt-1.5 max-w-sm mx-auto font-light">
        {query
          ? 'Try a different keyword or clear the search to see everything.'
          : 'Sales, reviews, deliveries and marketplace messages show up here in real time.'}
      </p>
    </div>
  );
}
