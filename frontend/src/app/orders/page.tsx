'use client';

export const dynamic = 'force-dynamic';

import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Bot,
  CheckCircle2,
  Clock,
  Download,
  Handshake,
  Lock,
  Package,
  Search,
  ShoppingBag,
  Sparkles,
  TrendingUp,
  Truck,
  X,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AtlasStatTile, AtlasTabs } from '@/components/atlas';
import { api } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useRequireAuth } from '@/lib/auth/useRequireAuth';
import { getCached, getCachedWithStatus, setCached } from '@/lib/cache/pageCache';
import { useKeyboardFocus } from '@/lib/hooks/useKeyboardFocus';
import {
  LISTING_TYPE_ACCENT as TYPE_ACCENT,
  LISTING_TYPE_ICON as TYPE_ICON,
  type ListingType,
} from '@/lib/listing/types';

type OrderStatus = 'PENDING_DELIVERY' | 'IN_PROGRESS' | 'DELIVERED' | 'COMPLETED' | 'DISPUTED';
type EscrowStatus = 'NONE' | 'FUNDED' | 'RELEASED' | 'DISPUTED' | 'RESOLVED' | 'REFUNDED';
type NegotiationStatus = 'ACTIVE' | 'AGREED' | 'REJECTED' | 'EXPIRED';
type NegotiationMode = 'AI_AI' | 'HUMAN';

interface NegotiationRow {
  id: string;
  status: NegotiationStatus;
  mode: NegotiationMode;
  agreedPrice: number | null;
  turnCount: number;
  createdAt: string;
  updatedAt: string;
  buyerId: string;
  listing: {
    id: string;
    title: string;
    price: number;
    currency: string;
    type: ListingType;
    minPrice: number | null;
  };
  buyer: { id: string; username: string | null };
  messages: Array<{ id: string; fromRole: string; content: string; createdAt: string }>;
}

interface Order {
  id: string;
  createdAt: string;
  status: OrderStatus;
  escrowStatus: EscrowStatus;
  escrowContract: string | null;
  amountWei: string;
  txHash: string;
  listing: { id: string; title: string; type: ListingType; price: number; currency: string };
  buyer: { id: string; username: string | null; avatarUrl: string | null };
  seller: { id: string; username: string | null; avatarUrl: string | null };
}

interface SellerStats {
  total: number;
  pending: number;
  inProgress: number;
  delivered: number;
  completed: number;
  disputed: number;
}

const STATUS_CONFIG: Record<OrderStatus, { label: string; icon: LucideIcon; color: string }> = {
  PENDING_DELIVERY: { label: 'Pending', icon: Clock, color: '#f59e0b' },
  IN_PROGRESS: { label: 'In progress', icon: Package, color: '#06B6D4' },
  DELIVERED: { label: 'Delivered', icon: Truck, color: '#22c55e' },
  COMPLETED: { label: 'Completed', icon: CheckCircle2, color: '#14F195' },
  DISPUTED: { label: 'Disputed', icon: AlertTriangle, color: '#ef4444' },
};

type StatusFilter = 'ALL' | OrderStatus;

const STATUS_FILTER_ORDER: StatusFilter[] = [
  'ALL',
  'PENDING_DELIVERY',
  'IN_PROGRESS',
  'DELIVERED',
  'COMPLETED',
  'DISPUTED',
];

const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  ALL: 'All',
  PENDING_DELIVERY: 'Pending',
  IN_PROGRESS: 'In progress',
  DELIVERED: 'Delivered',
  COMPLETED: 'Completed',
  DISPUTED: 'Disputed',
};

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

function formatEth(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n === 0) return '0';
  if (n < 0.0001) return '<0.0001';
  if (n < 1) return n.toFixed(4);
  if (n < 100) return n.toFixed(3);
  return n.toFixed(2);
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return n.toString();
}

function csvEscape(v: unknown) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadOrdersCsv(orders: Order[], kind: 'buying' | 'selling') {
  const header = [
    'orderId',
    'createdAt',
    'status',
    'escrowStatus',
    'listingTitle',
    'listingType',
    'priceEth',
    'amountWei',
    'counterparty',
    'txHash',
  ];
  const rows = orders.map((o) => {
    const peer = kind === 'selling' ? o.buyer : o.seller;
    const eth = o.amountWei ? (parseFloat(o.amountWei) / 1e18).toString() : '';
    return [
      o.id,
      o.createdAt,
      o.status,
      o.escrowStatus,
      o.listing.title,
      o.listing.type,
      eth,
      o.amountWei,
      peer?.username || '',
      o.txHash,
    ]
      .map(csvEscape)
      .join(',');
  });
  const csv = [header.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `haggl-orders-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Page ────────────────────────────────────────────────────────────────

export default function OrdersPage() {
  const { user } = useAuth();
  const { isAuthenticated, isLoading: authLoading } = useRequireAuth({
    message: 'Sign in or register to view your orders.',
  });
  const router = useRouter();
  const [tab, setTab] = useState<'buying' | 'selling' | 'negotiations'>('buying');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  useKeyboardFocus(searchRef);
  // Seed from the session cache so returning to /orders shows the last
  // known state instantly while we refetch in the background.
  const [buyerOrders, setBuyerOrders] = useState<Order[]>(
    () => getCached<Order[]>('orders:buyer') ?? [],
  );
  const [sellerOrders, setSellerOrders] = useState<Order[]>(
    () => getCached<Order[]>('orders:seller') ?? [],
  );
  const [negotiations, setNegotiations] = useState<NegotiationRow[]>(
    () => getCached<NegotiationRow[]>('orders:negotiations') ?? [],
  );
  const [stats, setStats] = useState<SellerStats | null>(
    () => getCached<SellerStats>('orders:stats') ?? null,
  );
  const [loading, setLoading] = useState(() => !getCached<Order[]>('orders:buyer'));

  const fetchOrders = useCallback(async () => {
    if (!user) return;
    // If the cached snapshot is still fresh (<30s) don't hit the
    // network at all — this is the "instant" feel on quick back-
    // navigation. The refetch kicks in only after the data ages out.
    const { fresh } = getCachedWithStatus('orders:buyer');
    if (fresh) {
      setLoading(false);
      return;
    }
    try {
      const [buyOrders, sellOrders, sellerStats, negs] = await Promise.all([
        api.get<Order[]>('/orders').catch(() => null),
        api.get<Order[]>('/orders/selling').catch(() => null),
        api.get<SellerStats>('/orders/seller/stats').catch(() => null),
        api.get<NegotiationRow[]>('/market/negotiations').catch(() => null),
      ]);
      if (buyOrders) {
        setBuyerOrders(buyOrders);
        setCached('orders:buyer', buyOrders);
      }
      if (sellOrders) {
        setSellerOrders(sellOrders);
        setCached('orders:seller', sellOrders);
      }
      if (sellerStats) {
        setStats(sellerStats);
        setCached('orders:stats', sellerStats);
      }
      if (negs) {
        setNegotiations(negs);
        setCached('orders:negotiations', negs);
      }
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  if (authLoading || !isAuthenticated || !user) {
    // useRequireAuth is already redirecting with a toast; render nothing
    // so we don't flash protected chrome to an unauthenticated visitor.
    return null;
  }

  const baseOrders = tab === 'selling' ? sellerOrders : buyerOrders;
  const q = search.trim().toLowerCase();
  const searched =
    tab === 'negotiations'
      ? []
      : q
        ? baseOrders.filter((o) => {
            const counterparty = tab === 'buying' ? o.seller.username : o.buyer.username;
            return (
              o.listing.title.toLowerCase().includes(q) ||
              (counterparty || '').toLowerCase().includes(q) ||
              o.id.toLowerCase().includes(q)
            );
          })
        : baseOrders;
  const orders =
    statusFilter === 'ALL' ? searched : searched.filter((o) => o.status === statusFilter);
  const statusCounts = searched.reduce<Record<string, number>>((acc, o) => {
    acc[o.status] = (acc[o.status] || 0) + 1;
    return acc;
  }, {});

  const filteredNegotiations =
    tab === 'negotiations' && q
      ? negotiations.filter(
          (n) =>
            n.listing.title.toLowerCase().includes(q) ||
            (n.buyer.username || '').toLowerCase().includes(q) ||
            n.id.toLowerCase().includes(q),
        )
      : negotiations;

  // Buyer-side quick metrics
  const buyingMetrics = useMemo(() => {
    const spent = buyerOrders.reduce((sum, o) => {
      const eth = o.amountWei ? parseFloat(o.amountWei) / 1e18 : 0;
      return sum + (Number.isFinite(eth) ? eth : 0);
    }, 0);
    const open = buyerOrders.filter(
      (o) => o.status === 'PENDING_DELIVERY' || o.status === 'IN_PROGRESS',
    ).length;
    const delivered = buyerOrders.filter((o) => o.status === 'DELIVERED').length;
    const completed = buyerOrders.filter((o) => o.status === 'COMPLETED').length;
    const disputed = buyerOrders.filter((o) => o.status === 'DISPUTED').length;
    return { spent, open, delivered, completed, disputed, total: buyerOrders.length };
  }, [buyerOrders]);

  // Seller-side quick metrics
  const sellingMetrics = useMemo(() => {
    const earned = sellerOrders
      .filter((o) => o.escrowStatus === 'RELEASED' || o.status === 'COMPLETED')
      .reduce((sum, o) => {
        const eth = o.amountWei ? parseFloat(o.amountWei) / 1e18 : 0;
        return sum + (Number.isFinite(eth) ? eth : 0);
      }, 0);
    return { earned };
  }, [sellerOrders]);

  return (
    <div className="mk-app-page min-h-screen pb-20" style={{ maxWidth: 'none', padding: 0 }}>
      {/* Header */}
      <header className="px-6 pt-8 pb-4 md:px-10 md:pt-10">
        <div className="mx-auto max-w-[1400px]">
          <div className="flex items-baseline justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 text-[10.5px] font-medium text-zinc-500 uppercase tracking-[0.18em] mb-2">
                <TrendingUp className="w-3.5 h-3.5" strokeWidth={1.75} />
                <span>Atlas Orders</span>
                <LiveDot />
              </div>
              <h1 className="text-2xl md:text-3xl font-light tracking-tight text-white">Orders</h1>
              <p className="text-[12.5px] text-zinc-500 font-light mt-1">
                Track every purchase, sale and escrow release in one feed.
              </p>
            </div>
            {tab !== 'negotiations' && baseOrders.length > 0 && (
              <button
                onClick={() =>
                  downloadOrdersCsv(baseOrders, tab === 'selling' ? 'selling' : 'buying')
                }
                className="inline-flex items-center gap-1.5 text-[12px] text-zinc-300 hover:text-white h-9 px-3 rounded-lg transition-colors"
                style={{
                  background: 'var(--bg-card)',
                  boxShadow:
                    '0 0 0 1px rgba(255,255,255,0.08), inset 0 1px 0 rgba(255,255,255,0.03)',
                }}
                aria-label="Export orders as CSV"
              >
                <Download className="w-3.5 h-3.5" strokeWidth={1.75} />
                Export CSV
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Stats strip */}
      <section className={`px-6 md:px-10 mb-4 ${tab === 'negotiations' ? 'hidden' : ''}`}>
        <div className="mx-auto max-w-[1400px] grid grid-cols-2 md:grid-cols-4 gap-2">
          {tab === 'buying' ? (
            <>
              <StatTile
                label="Total spent"
                value={`${formatEth(buyingMetrics.spent)} SOL`}
                sub={`across ${buyingMetrics.total} orders`}
                accent="#14F195"
              />
              <StatTile
                label="Open"
                value={formatNumber(buyingMetrics.open)}
                sub="in progress or pending"
                accent="#06B6D4"
              />
              <StatTile
                label="Delivered"
                value={formatNumber(buyingMetrics.delivered)}
                sub="awaiting release"
                accent="#22c55e"
              />
              <StatTile
                label="Completed"
                value={formatNumber(buyingMetrics.completed)}
                sub={`${buyingMetrics.disputed} disputed`}
                accent="#EC4899"
              />
            </>
          ) : (
            <>
              <StatTile
                label="Revenue"
                value={`${formatEth(sellingMetrics.earned)} SOL`}
                sub="released + completed"
                accent="#22c55e"
              />
              <StatTile
                label="Open orders"
                value={formatNumber((stats?.pending || 0) + (stats?.inProgress || 0))}
                sub={`${stats?.pending || 0} pending · ${stats?.inProgress || 0} in progress`}
                accent="#f59e0b"
              />
              <StatTile
                label="Delivered"
                value={formatNumber(stats?.delivered || 0)}
                sub="awaiting release"
                accent="#06B6D4"
              />
              <StatTile
                label="Completed"
                value={formatNumber(stats?.completed || 0)}
                sub={`${stats?.disputed || 0} disputed`}
                accent="#14F195"
              />
            </>
          )}
        </div>
      </section>

      {/* Tabs */}
      <section className="px-6 md:px-10 mb-3">
        <div className="mx-auto max-w-[1400px] flex items-center gap-2 flex-wrap">
          <AtlasTabs
            variant="segment"
            value={tab}
            onChange={(v) => {
              setTab(v as 'buying' | 'selling' | 'negotiations');
              setStatusFilter('ALL');
              setSearch('');
            }}
            tabs={[
              {
                value: 'buying',
                label: 'Buying',
                icon: <ShoppingBag className="w-3.5 h-3.5" strokeWidth={1.75} />,
              },
              {
                value: 'selling',
                label: 'Selling',
                icon: <TrendingUp className="w-3.5 h-3.5" strokeWidth={1.75} />,
              },
            ]}
          />

          {/* Search */}
          {(tab === 'negotiations' ? negotiations.length > 0 : baseOrders.length > 0) && (
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
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by title, counterparty, id…"
                className="flex-1 bg-transparent border-none outline-none text-[12.5px] font-light text-white placeholder-zinc-600"
              />
              {search ? (
                <button
                  onClick={() => setSearch('')}
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
          )}

          {/* Status chips */}
          <div
            className={`flex items-center gap-1 ml-auto flex-wrap ${
              tab === 'negotiations' ? 'hidden' : ''
            }`}
          >
            {STATUS_FILTER_ORDER.map((s) => {
              const count = s === 'ALL' ? baseOrders.length : statusCounts[s] || 0;
              const active = statusFilter === s;
              const color = s === 'ALL' ? '#14F195' : STATUS_CONFIG[s as OrderStatus]?.color;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusFilter(s)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11.5px] font-light transition"
                  style={{
                    color: active ? 'var(--text)' : 'var(--text-secondary)',
                    background: active ? `${color}22` : 'rgba(255,255,255,0.02)',
                    boxShadow: active
                      ? `inset 0 0 0 1px ${color}5a`
                      : 'inset 0 0 0 1px rgba(255,255,255,0.06)',
                  }}
                >
                  {STATUS_FILTER_LABELS[s]}
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

      {/* Table */}
      <section className="px-6 md:px-10">
        <div className="mx-auto max-w-[1400px]">
          {tab === 'negotiations' ? (
            <NegotiationsTable
              negotiations={filteredNegotiations}
              loading={loading}
              userId={user.id}
              onRowClick={(n) => router.push(`/market/agents?negotiate=${n.listing.id}`)}
            />
          ) : (
            <OrdersTable
              orders={orders}
              tab={tab === 'selling' ? 'selling' : 'buying'}
              loading={loading}
              onRowClick={(id) => router.push(`/orders/${id}`)}
            />
          )}
        </div>
      </section>
    </div>
  );
}

// ── Components ──────────────────────────────────────────────────────────

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
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent: string;
}) {
  return <AtlasStatTile label={label} value={value} caption={sub} accent={accent} />;
}

function OrdersTable({
  orders,
  tab,
  loading,
  onRowClick,
}: {
  orders: Order[];
  tab: 'buying' | 'selling';
  loading: boolean;
  onRowClick: (id: string) => void;
}) {
  if (loading && orders.length === 0) {
    return (
      <div
        className="rounded-xl px-6 py-20 text-center text-sm text-zinc-500 font-light"
        style={{
          background: 'var(--bg-card)',
          boxShadow: '0 0 0 1px rgba(255,255,255,0.06)',
        }}
      >
        Loading orders…
      </div>
    );
  }

  if (!loading && orders.length === 0) {
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
        <span
          aria-hidden
          className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-64 h-64 rounded-full blur-3xl opacity-30"
          style={{ background: 'rgba(20, 241, 149, 0.25)' }}
        />
        <div
          className="relative w-12 h-12 rounded-xl mx-auto mb-4 flex items-center justify-center"
          style={{
            background:
              'linear-gradient(135deg, rgba(20, 241, 149, 0.22) 0%, rgba(20, 241, 149, 0.06) 100%)',
            border: '1px solid rgba(20, 241, 149, 0.35)',
            boxShadow:
              'inset 0 1px 0 rgba(255,255,255,0.08), 0 0 24px -6px rgba(20, 241, 149, 0.45)',
          }}
        >
          <ShoppingBag className="w-5 h-5 text-[#b4a7ff]" strokeWidth={1.5} />
        </div>
        <p className="relative text-[14px] text-white font-normal">
          {tab === 'buying' ? 'No purchases match your filters' : 'No sales match your filters'}
        </p>
        <p className="relative text-[12px] text-zinc-500 mt-1.5 mb-5 max-w-sm mx-auto font-light">
          {tab === 'buying'
            ? 'Explore the marketplace to start acquiring agents, bots and repos.'
            : 'Publish listings to start receiving orders from buyers.'}
        </p>
        <Link
          href={tab === 'buying' ? '/market' : '/market/seller/publish'}
          className="relative inline-flex items-center gap-2 h-9 px-4 rounded-lg text-[12px] font-normal text-white transition"
          style={{
            background:
              'linear-gradient(180deg, rgba(20, 241, 149, 0.9) 0%, rgba(20, 241, 149, 0.7) 100%)',
            boxShadow:
              'inset 0 1px 0 rgba(255,255,255,0.18), 0 6px 14px -6px rgba(20, 241, 149, 0.5)',
          }}
        >
          {tab === 'buying' ? (
            <>
              <BarChart3 className="w-3.5 h-3.5" strokeWidth={1.75} /> Explore marketplace
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5" strokeWidth={1.75} /> Publish listing
            </>
          )}
        </Link>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        background: 'var(--bg-card)',
        boxShadow: '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.04)',
      }}
    >
      <div className="grid grid-cols-[28px_minmax(0,1fr)_110px_90px_110px_140px_70px_28px] items-center gap-3 px-3 py-2 text-[10px] uppercase tracking-[0.14em] text-zinc-500 font-medium border-b border-white/5">
        <span className="text-center">#</span>
        <span>Order</span>
        <span>Status</span>
        <span>Escrow</span>
        <span className="text-right">Amount</span>
        <span className="hidden md:block">{tab === 'buying' ? 'Seller' : 'Buyer'}</span>
        <span className="text-right">Age</span>
        <span />
      </div>
      <ul>
        {orders.map((o, i) => (
          <OrderRow
            key={o.id}
            order={o}
            index={i}
            isSeller={tab === 'selling'}
            onClick={() => onRowClick(o.id)}
          />
        ))}
      </ul>
    </div>
  );
}

function OrderRow({
  order,
  index,
  isSeller,
  onClick,
}: {
  order: Order;
  index: number;
  isSeller: boolean;
  onClick: () => void;
}) {
  const cfg = STATUS_CONFIG[order.status];
  const StatusIcon = cfg.icon;
  const TypeIcon = TYPE_ICON[order.listing.type] ?? Package;
  const typeAccent = TYPE_ACCENT[order.listing.type];
  const peer = isSeller ? order.buyer : order.seller;
  const ethAmount = order.amountWei ? parseFloat(order.amountWei) / 1e18 : null;

  const escrowActive = order.escrowStatus && order.escrowStatus !== 'NONE';
  const escrowColor =
    order.escrowStatus === 'RELEASED'
      ? '#22c55e'
      : order.escrowStatus === 'DISPUTED'
        ? '#ef4444'
        : order.escrowStatus === 'REFUNDED'
          ? '#94a3b8'
          : '#06B6D4';

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
          }
        }}
        className="group relative grid grid-cols-[28px_minmax(0,1fr)_110px_90px_110px_140px_70px_28px] items-center gap-3 px-3 py-2.5 border-b border-white/[0.04] w-full text-left transition-all hover:bg-white/[0.02] cursor-pointer"
      >
        <span
          aria-hidden
          className="absolute left-0 top-0 bottom-0 w-[2px]"
          style={{ background: cfg.color, opacity: 0.6 }}
        />

        <span className="text-[11px] text-zinc-600 font-mono text-center tabular-nums">
          {index + 1}
        </span>

        <div className="min-w-0 flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
            style={{
              background: `${typeAccent}18`,
              boxShadow: `inset 0 0 0 1px ${typeAccent}40`,
            }}
          >
            <TypeIcon className="w-3.5 h-3.5" strokeWidth={1.75} style={{ color: typeAccent }} />
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-normal text-white truncate">{order.listing.title}</div>
            <div className="text-[10.5px] text-zinc-500 font-light truncate">
              <span className="font-mono text-zinc-600">#{order.id.slice(0, 8)}</span>
              {order.txHash && (
                <>
                  <span className="text-zinc-700 mx-1">·</span>
                  <span className="font-mono text-zinc-600">{order.txHash.slice(0, 10)}…</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Status */}
        <div className="min-w-0">
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10.5px] font-medium"
            style={{
              color: cfg.color,
              background: `${cfg.color}14`,
              boxShadow: `inset 0 0 0 1px ${cfg.color}44`,
            }}
          >
            <StatusIcon className="w-2.5 h-2.5" strokeWidth={2} />
            {cfg.label}
          </span>
        </div>

        {/* Escrow */}
        <div className="min-w-0">
          {escrowActive ? (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium"
              style={{
                color: escrowColor,
                background: `${escrowColor}14`,
                boxShadow: `inset 0 0 0 1px ${escrowColor}44`,
              }}
            >
              <Lock className="w-2.5 h-2.5" strokeWidth={2} />
              {order.escrowStatus.toLowerCase()}
            </span>
          ) : (
            <span className="text-[10.5px] text-zinc-700 font-light">—</span>
          )}
        </div>

        {/* Amount */}
        <div className="text-right font-mono tabular-nums text-[12.5px] text-[#b4a7ff]">
          {ethAmount !== null ? formatEth(ethAmount) : '—'}
          <span className="text-zinc-600 ml-1 text-[10px]">SOL</span>
        </div>

        {/* Counterparty */}
        <div className="hidden md:flex items-center gap-1.5 text-[11.5px] text-zinc-400 font-light truncate">
          <div
            className="w-5 h-5 rounded-full overflow-hidden flex-shrink-0"
            style={{ background: 'rgba(255,255,255,0.05)' }}
          >
            {peer?.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={peer.avatarUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[10px] text-zinc-500">
                {(peer?.username || '?')[0].toUpperCase()}
              </div>
            )}
          </div>
          <span className="truncate">@{peer?.username || 'anon'}</span>
        </div>

        {/* Age */}
        <div className="text-right text-[11px] text-zinc-500 font-mono tabular-nums">
          {timeAgo(order.createdAt)}
        </div>

        <ArrowUpRight
          className="w-3.5 h-3.5 text-zinc-700 group-hover:text-zinc-300 transition"
          strokeWidth={1.75}
        />
      </div>
    </li>
  );
}

const NEG_STATUS_CONFIG: Record<NegotiationStatus, { label: string; color: string }> = {
  ACTIVE: { label: 'Active', color: '#06B6D4' },
  AGREED: { label: 'Deal', color: '#22c55e' },
  REJECTED: { label: 'Rejected', color: '#ef4444' },
  EXPIRED: { label: 'Expired', color: '#94a3b8' },
};

function NegotiationsTable({
  negotiations,
  loading,
  userId,
  onRowClick,
}: {
  negotiations: NegotiationRow[];
  loading: boolean;
  userId: string;
  onRowClick: (n: NegotiationRow) => void;
}) {
  if (loading && negotiations.length === 0) {
    return (
      <div
        className="rounded-xl px-6 py-20 text-center text-sm text-zinc-500 font-light"
        style={{
          background: 'var(--bg-card)',
          boxShadow: '0 0 0 1px rgba(255,255,255,0.06)',
        }}
      >
        Loading negotiations…
      </div>
    );
  }

  if (!loading && negotiations.length === 0) {
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
            boxShadow:
              'inset 0 1px 0 rgba(255,255,255,0.08), 0 0 24px -6px rgba(20, 241, 149, 0.45)',
          }}
        >
          <Handshake className="w-5 h-5 text-[#b4a7ff]" strokeWidth={1.5} />
        </div>
        <p className="relative text-[14px] text-white font-normal">No negotiations yet</p>
        <p className="relative text-[12px] text-zinc-500 mt-1.5 mb-5 max-w-sm mx-auto font-light">
          Hit Negotiate on any agent listing and your AI will start haggling with the seller&apos;s
          agent. Past chats land here.
        </p>
        <Link
          href="/market/agents"
          className="relative inline-flex items-center gap-2 h-9 px-4 rounded-lg text-[12px] font-normal text-white transition"
          style={{
            background:
              'linear-gradient(180deg, rgba(20, 241, 149, 0.9) 0%, rgba(20, 241, 149, 0.7) 100%)',
            boxShadow:
              'inset 0 1px 0 rgba(255,255,255,0.18), 0 6px 14px -6px rgba(20, 241, 149, 0.5)',
          }}
        >
          <Bot className="w-3.5 h-3.5" strokeWidth={1.75} /> Browse agents
        </Link>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        background: 'var(--bg-card)',
        boxShadow: '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.04)',
      }}
    >
      <ul>
        {negotiations.map((n, i) => (
          <NegoRow key={n.id} index={i} neg={n} userId={userId} onClick={() => onRowClick(n)} />
        ))}
      </ul>
    </div>
  );
}

function NegoRow({
  neg,
  index,
  userId,
  onClick,
}: {
  neg: NegotiationRow;
  index: number;
  userId: string;
  onClick: () => void;
}) {
  const cfg = NEG_STATUS_CONFIG[neg.status];
  const TypeIcon = TYPE_ICON[neg.listing.type] ?? Package;
  const typeAccent = TYPE_ACCENT[neg.listing.type];
  const isBuyer = neg.buyerId === userId;
  const lastMsg = neg.messages[0];
  const asking = `${neg.listing.price} ${neg.listing.currency}`;
  const agreed =
    neg.agreedPrice !== null && neg.agreedPrice !== undefined
      ? `${neg.agreedPrice} ${neg.listing.currency}`
      : null;

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
          }
        }}
        className="group relative grid grid-cols-[28px_minmax(0,1fr)_110px_110px_120px_70px_28px] items-center gap-3 px-3 py-2.5 border-b border-white/[0.04] w-full text-left transition-all hover:bg-white/[0.02] cursor-pointer"
      >
        <span
          aria-hidden
          className="absolute left-0 top-0 bottom-0 w-[2px]"
          style={{ background: cfg.color, opacity: 0.6 }}
        />

        <span className="text-[11px] text-zinc-600 font-mono text-center tabular-nums">
          {index + 1}
        </span>

        <div className="min-w-0 flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
            style={{
              background: `${typeAccent}18`,
              boxShadow: `inset 0 0 0 1px ${typeAccent}40`,
            }}
          >
            <TypeIcon className="w-3.5 h-3.5" strokeWidth={1.75} style={{ color: typeAccent }} />
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-normal text-white truncate">{neg.listing.title}</div>
            <div className="text-[10.5px] text-zinc-500 font-light truncate">
              <span className="text-zinc-600">{isBuyer ? 'Buying' : 'Selling'}</span>
              <span className="text-zinc-700 mx-1">·</span>
              <span className="font-mono text-zinc-600">{neg.mode}</span>
              {lastMsg && (
                <>
                  <span className="text-zinc-700 mx-1">·</span>
                  <span className="truncate">{lastMsg.content.slice(0, 80)}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Status */}
        <div className="min-w-0">
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10.5px] font-medium"
            style={{
              color: cfg.color,
              background: `${cfg.color}14`,
              boxShadow: `inset 0 0 0 1px ${cfg.color}44`,
            }}
          >
            {cfg.label}
          </span>
        </div>

        {/* Turns */}
        <div className="text-[11px] text-zinc-400 font-mono tabular-nums">
          {neg.turnCount} turn{neg.turnCount === 1 ? '' : 's'}
        </div>

        {/* Price */}
        <div className="text-right font-mono tabular-nums text-[12px]">
          {agreed ? (
            <span className="text-emerald-400">{agreed}</span>
          ) : (
            <span className="text-zinc-500">ask {asking}</span>
          )}
        </div>

        {/* Age */}
        <div className="text-right text-[11px] text-zinc-500 font-mono tabular-nums">
          {timeAgo(neg.updatedAt)}
        </div>

        <ArrowUpRight
          className="w-3.5 h-3.5 text-zinc-700 group-hover:text-zinc-300 transition"
          strokeWidth={1.75}
        />
      </div>
    </li>
  );
}
