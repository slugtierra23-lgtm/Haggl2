'use client';

import {
  Bot,
  CheckCircle2,
  Clock,
  Code2,
  ExternalLink,
  GitBranch,
  Heart,
  Shield,
  ShoppingBag,
  Sparkles,
  Upload,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';

import { AtlasTabs } from '@/components/atlas';
import { Badge, Hero, Stat, StatStrip } from '@/components/ui/app';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { api, ApiError } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useRequireAuth } from '@/lib/auth/useRequireAuth';
import { getCached, getCachedWithStatus, setCached } from '@/lib/cache/pageCache';
import { useFavorites } from '@/lib/hooks/useFavorites';
import { LISTING_TYPE_LABEL as TYPE_LABEL, type ListingType } from '@/lib/listing/types';

interface PublishedRepo {
  id: string;
  name: string;
  fullName: string;
  description: string | null;
  language: string | null;
  stars: number;
  forks: number;
  downloadCount: number;
  githubUrl: string;
  topics: string[];
  logoUrl: string | null;
  isPrivate: boolean;
  isLocked: boolean;
  lockedPriceUsd: number | null;
  createdAt: string;
  raysEarned: number;
}

interface PublishedListing {
  id: string;
  title: string;
  type: string;
  price: number;
  currency: string;
  tags: string[];
  status: string;
  createdAt: string;
  raysEarned: number;
}

interface PurchasedRepo {
  id: string;
  purchasedAt: string;
  txHash: string;
  amountWei: string;
  verified: boolean;
  repository: {
    id: string;
    name: string;
    fullName: string;
    githubUrl: string;
    logoUrl: string | null;
  };
  seller: {
    id: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  };
}

interface PurchasedListing {
  id: string;
  purchasedAt: string;
  txHash: string;
  amountWei: string;
  verified: boolean;
  status: string;
  escrowStatus: string;
  listing: {
    id: string;
    title: string;
    type: string;
    price: number;
    currency: string;
  };
  seller: {
    id: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  };
}

interface ReputationEvent {
  id: string;
  createdAt: string;
  points: number;
  reason: string;
  resourceId: string | null;
  note: string | null;
}

interface InventoryData {
  published: { repos: PublishedRepo[]; listings: PublishedListing[] };
  purchased: { repos: PurchasedRepo[]; listings: PurchasedListing[] };
  rays: { total: number; recentEvents: ReputationEvent[] };
}

type Tab = 'published' | 'purchased' | 'saved' | 'rays';

interface SavedListing {
  id: string;
  title: string;
  description: string;
  type: ListingType;
  price: number;
  currency: string;
  tags: string[];
  status: string;
  seller: { id: string; username: string | null; avatarUrl: string | null };
}

const REASON_LABEL: Record<string, string> = {
  REPO_PUBLISHED: 'Published a repository',
  REPO_SOLD: 'Sold a repository',
  REPO_PURCHASED: 'Bought a repository',
  REPO_UPVOTE_RECEIVED: 'Upvote received',
  LISTING_PUBLISHED: 'Published a listing',
  AI_AGENT_PUBLISHED: 'Published an AI agent',
  LISTING_SOLD: 'Sold a listing',
  LISTING_PURCHASED: 'Bought a listing',
  PROFILE_COMPLETED: 'Profile completed',
  SERVICE_COMPLETED: 'Service completed',
  FIRST_SALE: 'First sale bonus',
  FIRST_PURCHASE: 'First purchase bonus',
  COLLABORATOR_ADDED: 'Added as collaborator',
};

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatEth(wei: string): string {
  try {
    const n = Number(wei) / 1e18;
    if (!Number.isFinite(n) || n === 0) return '0';
    return n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  } catch {
    return '0';
  }
}

function shortTx(tx: string): string {
  if (!tx || tx.length < 14) return tx;
  return `${tx.slice(0, 8)}…${tx.slice(-6)}`;
}

export default function InventoryPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <InventoryPageContent />
    </Suspense>
  );
}

function InventoryPageContent() {
  useAuth(); // keeps the subscription live; gate delegated to useRequireAuth
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab: Tab = useMemo(() => {
    const t = searchParams?.get('tab');
    return t === 'purchased' || t === 'saved' || t === 'rays' ? t : 'published';
  }, [searchParams]);
  const { isAuthenticated, isLoading } = useRequireAuth({
    message: 'Create an account or sign in to see your inventory.',
  });
  const [data, setData] = useState<InventoryData | null>(
    () => getCached<InventoryData>('inventory:data') ?? null,
  );
  const [loading, setLoading] = useState(() => !getCached('inventory:data'));
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(initialTab);
  const { ids: favIds, remove: removeFav } = useFavorites();
  // Sync ?tab=… in the URL so deep links + back-nav land on the right tab
  // without re-triggering the data fetch.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (tab === 'published') url.searchParams.delete('tab');
    else url.searchParams.set('tab', tab);
    window.history.replaceState({}, '', url.toString());
  }, [tab]);

  const load = useCallback(async () => {
    setError(null);
    const { fresh } = getCachedWithStatus('inventory:data');
    if (fresh) {
      setLoading(false);
      return;
    }
    try {
      const result = await api.get<InventoryData>('/market/my-inventory');
      setData(result);
      setCached('inventory:data', result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load inventory');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isLoading || !isAuthenticated) return;
    void load();
  }, [isAuthenticated, isLoading, load]);

  const totals = useMemo(() => {
    if (!data) return { published: 0, purchased: 0, rays: 0 };
    return {
      published: data.published.repos.length + data.published.listings.length,
      purchased: data.purchased.repos.length + data.purchased.listings.length,
      rays: data.rays.total,
    };
  }, [data]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-5 h-5 rounded-full border-2 border-zinc-800 border-t-atlas-500 animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen px-6 py-20 flex flex-col items-center justify-center gap-3">
        <p className="text-zinc-400">{error || 'Something went wrong'}</p>
        <button
          onClick={load}
          className="px-3 py-1.5 rounded-md text-[12px] text-white"
          style={{
            background: 'rgba(20, 241, 149, 0.2)',
            boxShadow: 'inset 0 0 0 1px rgba(20, 241, 149, 0.45)',
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="mk-app-page mx-auto max-w-6xl px-4 sm:px-6 py-8" style={{ maxWidth: '72rem' }}>
      <Hero
        crumbs={
          <>
            <Link href="/market" className="mk-hero__crumb-link">
              Market
            </Link>
            <span className="mk-hero__crumb-sep">/</span>
            <span>Your inventory</span>
          </>
        }
        title="Inventory"
        subtitle="Everything you've published and everything you've bought — tx hashes, sellers, all in one place."
      >
        <StatStrip>
          <Stat label="Published" value={totals.published} />
          <Stat label="Purchased" value={totals.purchased} />
        </StatStrip>
      </Hero>

      <div className="mt-6">
        <AtlasTabs
          variant="underline"
          value={tab === 'saved' || tab === 'rays' ? 'published' : tab}
          onChange={(v) => setTab(v as Tab)}
          tabs={[
            {
              value: 'published',
              label: 'Published',
              count: totals.published || undefined,
            },
            {
              value: 'purchased',
              label: 'Purchased',
              count: totals.purchased || undefined,
            },
          ]}
        />
      </div>

      <div className="mt-5">
        {(tab === 'published' || tab === 'saved' || tab === 'rays') && (
          <PublishedTab published={data.published} />
        )}
        {tab === 'purchased' && (
          <PurchasedTab purchased={data.purchased} onRecovered={() => void load()} />
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="relative px-3 py-2 text-[12.5px] font-light transition-colors"
      style={{ color: active ? 'var(--text)' : '#9ca3af' }}
    >
      {children}
      {active && (
        <span
          className="absolute left-0 right-0 -bottom-px h-[2px]"
          style={{ background: 'linear-gradient(90deg, #06B6D4, #14F195, #EC4899)' }}
        />
      )}
    </button>
  );
}

function Count({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-1.5 px-1.5 py-0.5 rounded-md text-[10px] font-mono text-zinc-400 bg-white/[0.04]">
      {children}
    </span>
  );
}

function PublishedTab({ published }: { published: InventoryData['published'] }) {
  if (published.repos.length === 0 && published.listings.length === 0) {
    return (
      <EmptyState
        icon={Upload}
        title="Nothing published yet"
        subtitle="Publish a GitHub repo or list an agent to appear here."
        action={{ label: 'Publish a repo', href: '/repos' }}
      />
    );
  }
  // Merge repos + listings into one unified feed, newest first.
  // Dense row layout (type / name / meta / rays) replaces the old
  // section + card split — reads like a ledger, not a gallery.
  type Row = {
    id: string;
    href: string;
    kind: 'REPO' | 'AGENT' | 'BOT' | 'SCRIPT' | 'OTHER';
    name: string;
    meta: string;
    createdAt: string;
    rays: number;
  };
  const rows: Row[] = [
    ...published.repos.map(
      (r): Row => ({
        id: r.id,
        href: `/market/repos/${r.id}`,
        kind: 'REPO',
        name: r.name,
        meta: `${r.isLocked ? `$${r.lockedPriceUsd} locked` : 'Public'} · ${r.downloadCount} downloads`,
        createdAt: r.createdAt,
        rays: r.raysEarned,
      }),
    ),
    ...published.listings.map((l): Row => {
      const raw = (l.type || '').toUpperCase();
      const kind: Row['kind'] =
        raw === 'AI_AGENT' || raw === 'AGENT'
          ? 'AGENT'
          : raw === 'BOT'
            ? 'BOT'
            : raw === 'SCRIPT'
              ? 'SCRIPT'
              : 'OTHER';
      return {
        id: l.id,
        href: `/market/agents/${l.id}`,
        kind,
        name: l.title,
        meta: `${l.price} ${l.currency} · ${l.status.toLowerCase()}`,
        createdAt: l.createdAt,
        rays: l.raysEarned,
      };
    }),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div
      className="mk-list"
      style={
        {
          '--mk-row-cols': '70px minmax(0, 1fr) auto auto',
        } as React.CSSProperties
      }
    >
      <div className="mk-list__head">
        <span>Type</span>
        <span>Name</span>
        <span style={{ textAlign: 'right' }}>Posted</span>
        <span style={{ textAlign: 'right' }}>Rays</span>
      </div>
      {rows.map((r) => (
        <Link key={r.id} href={r.href} className="mk-list__row">
          <span>
            <Badge
              variant={r.kind === 'REPO' ? 'info' : 'neutral'}
              className="uppercase tracking-wider"
            >
              {r.kind}
            </Badge>
          </span>
          <span className="min-w-0">
            <div className="truncate text-[13px] text-white">{r.name}</div>
            <div className="truncate text-[11px] text-zinc-500">{r.meta}</div>
          </span>
          <span
            className="text-[11px] text-[var(--text-muted)] tabular-nums"
            style={{ textAlign: 'right' }}
          >
            {formatDate(r.createdAt)}
          </span>
        </Link>
      ))}
    </div>
  );
}

function PurchasedTab({
  purchased,
  onRecovered,
}: {
  purchased: InventoryData['purchased'];
  onRecovered: () => void;
}) {
  return (
    <>
      <RecoverPaymentCard onRecovered={onRecovered} />
      <PurchasedTabBody purchased={purchased} />
    </>
  );
}

function PurchasedTabBody({ purchased }: { purchased: InventoryData['purchased'] }) {
  if (purchased.repos.length === 0 && purchased.listings.length === 0) {
    return (
      <EmptyState
        icon={ShoppingBag}
        title="No purchases yet"
        subtitle="Agents, scripts and locked repos you buy will land here."
        action={{ label: 'Browse marketplace', href: '/market' }}
      />
    );
  }
  return (
    <div className="space-y-6">
      {purchased.repos.length > 0 && (
        <Section title="Bought repositories" count={purchased.repos.length} icon={GitBranch}>
          <ul className="space-y-2">
            {purchased.repos.map((p) => (
              <PurchaseRow
                key={p.id}
                title={p.repository.name}
                subtitle={p.repository.fullName}
                href={`/market/repos/${p.repository.id}`}
                seller={p.seller}
                purchasedAt={p.purchasedAt}
                txHash={p.txHash}
                amountWei={p.amountWei}
                verified={p.verified}
              />
            ))}
          </ul>
        </Section>
      )}
      {purchased.listings.length > 0 && (
        <Section title="Bought listings" count={purchased.listings.length} icon={Bot}>
          <ul className="space-y-2">
            {purchased.listings.map((p) => (
              <PurchaseRow
                key={p.id}
                title={p.listing.title}
                subtitle={`${p.listing.type} · ${p.listing.price} ${p.listing.currency}`}
                href={`/orders/${p.id}`}
                seller={p.seller}
                purchasedAt={p.purchasedAt}
                txHash={p.txHash}
                amountWei={p.amountWei}
                verified={p.verified}
              />
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function PurchaseRow({
  title,
  subtitle,
  href,
  seller,
  purchasedAt,
  txHash,
  amountWei,
  verified,
}: {
  title: string;
  subtitle: string;
  href: string;
  seller: {
    id: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  };
  purchasedAt: string;
  txHash: string;
  amountWei: string;
  verified: boolean;
}) {
  return (
    <li
      className="relative rounded-lg p-3"
      style={{
        background: 'var(--bg-card)',
        boxShadow: '0 0 0 1px rgba(255,255,255,0.05)',
      }}
    >
      <div className="flex items-start gap-3">
        <UserAvatar
          src={seller.avatarUrl ?? undefined}
          name={seller.displayName || seller.username || 'Seller'}
          userId={seller.id}
          size={36}
        />
        <div className="min-w-0 flex-1">
          <Link href={href} className="block">
            <div className="text-[13px] text-white font-light truncate hover:text-[#b4a7ff] transition-colors">
              {title}
            </div>
            <div className="text-[11px] text-zinc-500 font-light truncate">{subtitle}</div>
          </Link>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[10.5px] text-zinc-400 font-light">
            <span>
              from{' '}
              <Link href={`/u/${seller.username ?? ''}`} className="text-[#b4a7ff] hover:underline">
                @{seller.username ?? 'unknown'}
              </Link>
            </span>
            <span className="text-zinc-700">·</span>
            <span className="inline-flex items-center gap-1">
              <Clock className="w-3 h-3" /> {formatDate(purchasedAt)}
            </span>
            <span className="text-zinc-700">·</span>
            <span className="font-mono tabular-nums text-[#b4a7ff]">
              {formatEth(amountWei)} SOL
            </span>
            <span className="text-zinc-700">·</span>
            <a
              href={`https://basescan.org/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-mono text-zinc-500 hover:text-white transition-colors"
              title={txHash}
            >
              {shortTx(txHash)} <ExternalLink className="w-3 h-3" />
            </a>
            <span
              className="inline-flex items-center gap-1 ml-auto px-1.5 py-0.5 rounded-md text-[10px]"
              style={{
                color: verified ? '#22c55e' : '#f59e0b',
                background: verified ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)',
                boxShadow: `inset 0 0 0 1px ${verified ? 'rgba(34,197,94,0.35)' : 'rgba(245,158,11,0.35)'}`,
              }}
            >
              {verified ? (
                <CheckCircle2 className="w-2.5 h-2.5" />
              ) : (
                <Clock className="w-2.5 h-2.5" />
              )}
              {verified ? 'Verified' : 'Pending'}
            </span>
          </div>
        </div>
      </div>
    </li>
  );
}

function RecoverPaymentCard({ onRecovered }: { onRecovered: () => void }) {
  const [open, setOpen] = useState(false);
  const [tx, setTx] = useState('');
  const [seller, setSeller] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const submit = async () => {
    const txTrim = tx.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(txTrim)) {
      setMsg({ kind: 'err', text: 'Invalid tx hash — paste the full 0x… from MetaMask.' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      // Try the repo-recovery path first. If the tx was actually for a
      // market listing (agent / bot / script) the repo endpoint returns
      // a 400 — we then try the listing recovery using the same hash.
      // Seller username is only useful for the repo path.
      const body: { txHash: string; sellerUsername?: string } = { txHash: txTrim };
      if (seller.trim()) body.sellerUsername = seller.trim().replace(/^@/, '');

      let result: { success?: boolean; downloadUrl?: string } | null = null;
      try {
        result = await api.post('/repos/recover-purchase', body);
      } catch (repoErr) {
        // Fall back to the listing-purchase recovery. We can't guess
        // the listingId from the hash, so we ask the backend to scan
        // recent listings bought by this user that match the tx.
        try {
          result = await api.post('/market/recover-purchase', { txHash: txTrim });
        } catch (listingErr) {
          // Surface whichever error was the most actionable.
          const msgTxt =
            listingErr instanceof ApiError
              ? listingErr.message
              : repoErr instanceof ApiError
                ? repoErr.message
                : 'Recovery failed. Try again.';
          throw new Error(msgTxt);
        }
      }

      if (result?.success) {
        setMsg({ kind: 'ok', text: 'Recovered! Refreshing your inventory…' });
        if (result.downloadUrl) {
          window.open(result.downloadUrl, '_blank', 'noopener,noreferrer');
        }
        setTimeout(() => {
          setTx('');
          setSeller('');
          setMsg(null);
          setOpen(false);
          onRecovered();
        }, 1400);
      }
    } catch (err) {
      setMsg({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Recovery failed. Try again.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="mb-5 rounded-xl p-4"
      style={{
        background: 'linear-gradient(180deg, rgba(20, 241, 149, 0.08), var(--bg))',
        boxShadow: '0 0 0 1px rgba(20, 241, 149, 0.3)',
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0"
          style={{
            background: 'rgba(20, 241, 149, 0.2)',
            boxShadow: 'inset 0 0 0 1px rgba(20, 241, 149, 0.45)',
          }}
        >
          <Shield className="w-4 h-4 text-[#b4a7ff]" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-light text-white">Missing a purchase?</h3>
          <p className="text-[11.5px] text-zinc-400 font-light mt-0.5">
            Paid on-chain but the repo didn&apos;t appear? Paste the transaction hash from MetaMask.
            We&apos;ll find the repo automatically.
          </p>
          {!open && (
            <button
              onClick={() => setOpen(true)}
              className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] text-white transition-all hover:brightness-110"
              style={{
                background:
                  'linear-gradient(180deg, rgba(20, 241, 149, 0.38), rgba(20, 241, 149, 0.14))',
                boxShadow: 'inset 0 0 0 1px rgba(20, 241, 149, 0.48)',
              }}
            >
              Recover stuck payment
            </button>
          )}
          {open && (
            <div className="mt-3 space-y-2">
              <input
                type="text"
                value={tx}
                onChange={(e) => setTx(e.target.value)}
                placeholder="0x… transaction hash (required)"
                disabled={busy}
                className="w-full px-3 py-2 rounded-lg text-[12px] font-mono text-white placeholder:text-zinc-600 focus:outline-none"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)',
                }}
              />
              <input
                type="text"
                value={seller}
                onChange={(e) => setSeller(e.target.value)}
                placeholder="@seller username (optional, speeds up match)"
                disabled={busy}
                className="w-full px-3 py-2 rounded-lg text-[12px] text-white placeholder:text-zinc-600 focus:outline-none"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)',
                }}
              />
              {msg && (
                <p
                  className="text-[11.5px] font-light"
                  style={{ color: msg.kind === 'ok' ? '#86efac' : '#fca5a5' }}
                >
                  {msg.text}
                </p>
              )}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  onClick={() => {
                    if (busy) return;
                    setOpen(false);
                    setTx('');
                    setSeller('');
                    setMsg(null);
                  }}
                  disabled={busy}
                  className="px-3 py-1.5 rounded-md text-[12px] text-zinc-400 hover:text-white disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={submit}
                  disabled={busy || !tx.trim()}
                  className="px-3 py-1.5 rounded-md text-[12px] text-white disabled:opacity-50"
                  style={{
                    background:
                      'linear-gradient(180deg, rgba(20, 241, 149, 0.38), rgba(20, 241, 149, 0.14))',
                    boxShadow: 'inset 0 0 0 1px rgba(20, 241, 149, 0.48)',
                  }}
                >
                  {busy ? 'Verifying…' : 'Recover'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SavedTab({ favIds, onRemove }: { favIds: string[]; onRemove: (id: string) => void }) {
  const [listings, setListings] = useState<SavedListing[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (favIds.length === 0) {
      setListings([]);
      setMissing([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const rows = await api.get<SavedListing[]>(
          `/market/by-ids?ids=${encodeURIComponent(favIds.join(','))}`,
        );
        if (cancelled) return;
        const found = Array.isArray(rows) ? rows : [];
        const foundIds = new Set(found.map((l) => l.id));
        setListings(found);
        setMissing(favIds.filter((id) => !foundIds.has(id)));
      } catch {
        if (!cancelled) {
          setListings([]);
          setMissing([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [favIds]);

  if (favIds.length === 0) {
    return (
      <EmptyState
        icon={Heart}
        title="Nothing saved yet"
        subtitle="Hit the heart on any listing to keep it here for later. Saved items live in this browser."
        action={{ label: 'Browse marketplace', href: '/market' }}
      />
    );
  }
  if (loading && listings.length === 0) {
    return (
      <div
        className="rounded-xl px-6 py-12 text-center text-[12.5px] text-zinc-500 font-light"
        style={{
          background: 'var(--bg-card)',
          boxShadow: '0 0 0 1px rgba(255,255,255,0.05)',
        }}
      >
        Loading your saved listings…
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {missing.length > 0 && (
        <div
          className="flex items-center justify-between gap-2 px-3 py-2 rounded-md text-[11.5px] text-zinc-400 font-light"
          style={{
            background: 'rgba(245,158,11,0.06)',
            boxShadow: 'inset 0 0 0 1px rgba(245,158,11,0.25)',
          }}
        >
          <span>
            {missing.length} saved listing{missing.length === 1 ? '' : 's'} no longer available.
          </span>
          <button
            onClick={() => missing.forEach(onRemove)}
            className="text-amber-300 hover:text-amber-200 underline underline-offset-2"
          >
            Clean up
          </button>
        </div>
      )}
      <div
        className="mk-list"
        style={
          {
            '--mk-row-cols': '70px minmax(0, 1fr) auto auto 28px',
          } as React.CSSProperties
        }
      >
        <div className="mk-list__head">
          <span>Type</span>
          <span>Listing</span>
          <span style={{ textAlign: 'right' }}>Price</span>
          <span style={{ textAlign: 'right' }}>Seller</span>
          <span />
        </div>
        {listings.map((l) => {
          return (
            <div key={l.id} className="mk-list__row">
              <span>
                <Badge variant="neutral" className="uppercase tracking-wider">
                  {TYPE_LABEL[l.type]}
                </Badge>
              </span>
              <Link
                href={`/market/agents/${l.id}`}
                className="min-w-0 hover:text-white transition-colors"
              >
                <div className="truncate text-[13px] text-white">{l.title}</div>
                <div className="truncate text-[11px] text-zinc-500">{l.description}</div>
              </Link>
              <span
                className="text-[12px] font-mono tabular-nums text-[#b4a7ff]"
                style={{ textAlign: 'right' }}
              >
                {l.price === 0 ? 'Free' : `${l.price} ${l.currency}`}
              </span>
              <Link
                href={`/u/${l.seller.username ?? ''}`}
                className="text-[11px] text-zinc-400 hover:text-white truncate"
                style={{ textAlign: 'right' }}
              >
                @{l.seller.username || 'anon'}
              </Link>
              <button
                onClick={() => onRemove(l.id)}
                aria-label="Remove from saved"
                className="text-pink-300 hover:text-pink-200 transition-colors"
                title="Remove from saved"
              >
                <Heart className="w-3.5 h-3.5 fill-pink-400" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RaysTab({ events, total }: { events: ReputationEvent[]; total: number }) {
  if (events.length === 0) {
    return (
      <EmptyState
        icon={Sparkles}
        title="No rays yet"
        subtitle="Earn rays by publishing work, getting upvotes, and making sales."
      />
    );
  }
  return (
    <div>
      <div className="text-[12px] text-zinc-400 font-light mb-3">
        Total: <span className="text-white tabular-nums">{total.toLocaleString()}</span> rays from{' '}
        {events.length} events.
      </div>
      <ul className="divide-y divide-white/[0.04]">
        {events.map((ev) => (
          <li key={ev.id} className="flex items-center gap-3 py-2.5">
            <div
              className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
              style={{
                background: 'rgba(236,72,153,0.12)',
                boxShadow: 'inset 0 0 0 1px rgba(236,72,153,0.35)',
              }}
            >
              <Sparkles className="w-3.5 h-3.5 text-[#EC4899]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] text-white font-light truncate">
                {REASON_LABEL[ev.reason] || ev.reason}
              </div>
              <div className="text-[10.5px] text-zinc-500 font-light truncate">
                {ev.note ?? '—'} · {formatDate(ev.createdAt)}
              </div>
            </div>
            <span className="text-[12.5px] font-mono tabular-nums text-[#EC4899]">
              +{ev.points}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Section({
  title,
  count,
  icon: Icon,
  children,
}: {
  title: string;
  count: number;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-xl p-4"
      style={{
        background: 'var(--bg-card)',
        boxShadow: '0 0 0 1px rgba(255,255,255,0.05)',
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <div
          className="w-7 h-7 rounded-md flex items-center justify-center"
          style={{
            background: 'rgba(20, 241, 149, 0.12)',
            boxShadow: 'inset 0 0 0 1px rgba(20, 241, 149, 0.3)',
          }}
        >
          <Icon className="w-3.5 h-3.5 text-[#b4a7ff]" />
        </div>
        <h2 className="text-[11px] uppercase tracking-[0.18em] font-medium text-zinc-300">
          {title}
        </h2>
        <span className="text-[11px] font-mono text-zinc-500 ml-1">{count}</span>
      </div>
      {children}
    </section>
  );
}

function RaysBadge({ rays }: { rays: number }) {
  if (!rays) {
    return <span className="text-[10.5px] text-zinc-700 font-mono">—</span>;
  }
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-mono"
      style={{
        color: '#EC4899',
        background: 'rgba(236,72,153,0.1)',
        boxShadow: 'inset 0 0 0 1px rgba(236,72,153,0.35)',
      }}
    >
      <Sparkles className="w-3 h-3" />+{rays}
    </span>
  );
}

function EmptyState({
  icon: Icon,
  title,
  subtitle,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  action?: { label: string; href: string };
}) {
  return (
    <div
      className="rounded-xl px-6 py-16 flex flex-col items-center justify-center text-center gap-3"
      style={{
        background: 'var(--bg-card)',
        boxShadow: '0 0 0 1px rgba(255,255,255,0.05)',
      }}
    >
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center"
        style={{
          background: 'rgba(20, 241, 149, 0.08)',
          boxShadow: 'inset 0 0 0 1px rgba(20, 241, 149, 0.25)',
        }}
      >
        <Icon className="w-5 h-5 text-[#b4a7ff]" />
      </div>
      <div>
        <p className="text-sm text-white font-light">{title}</p>
        <p className="text-xs text-zinc-500 font-light mt-1">{subtitle}</p>
      </div>
      {action && (
        <Link
          href={action.href}
          className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] text-white"
          style={{
            background:
              'linear-gradient(180deg, rgba(20, 241, 149, 0.38), rgba(20, 241, 149, 0.14))',
            boxShadow: 'inset 0 0 0 1px rgba(20, 241, 149, 0.48)',
          }}
        >
          <Code2 className="w-3.5 h-3.5" />
          {action.label}
        </Link>
      )}
    </div>
  );
}
