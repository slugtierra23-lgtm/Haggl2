'use client';

import { motion } from 'framer-motion';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Loader2,
  ShieldAlert,
  Undo2,
  Wallet,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { API_URL, api, ApiError } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/AuthProvider';
import { escrowResolve, isEscrowEnabled } from '@/lib/wallet/escrow';

interface DisputedOrder {
  id: string;
  createdAt: string;
  status: string;
  escrowStatus: string;
  escrowContract: string | null;
  escrowDisputedAt: string | null;
  amountWei: string;
  listing: { id: string; title: string; type: string; price: number; currency: string };
  buyer: {
    id: string;
    username: string | null;
    avatarUrl: string | null;
    walletAddress: string | null;
  };
  seller: {
    id: string;
    username: string | null;
    avatarUrl: string | null;
    walletAddress: string | null;
  };
}

type Phase = 'idle' | 'signing' | 'confirming' | 'done' | 'error';

function formatEth(wei: string) {
  if (!wei) return '—';
  try {
    return (Number(BigInt(wei)) / 1e18).toFixed(4);
  } catch {
    return '—';
  }
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleDateString()} · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

export default function AdminDisputesPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [disputes, setDisputes] = useState<DisputedOrder[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DisputedOrder | null>(null);

  const isAdmin = user?.role === 'ADMIN';
  const isMod = user?.role === 'MODERATOR';
  const canView = isAdmin || isMod;

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace('/');
      return;
    }
    if (!canView) {
      router.replace('/');
    }
  }, [user, isLoading, canView, router]);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.get<DisputedOrder[]>('/escrow/disputes');
      setDisputes(data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load disputes');
    } finally {
      setLoading(false);
    }
  }, [canView]);

  useEffect(() => {
    load();
  }, [load]);

  if (isLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-zinc-400 font-light text-sm">Access denied.</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-6 py-10 md:px-10 md:py-14">
      <div className="mx-auto max-w-5xl">
        <Header count={disputes.length} />

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
          </div>
        ) : loadError ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-6 text-sm text-red-300 font-light">
            {loadError}
          </div>
        ) : disputes.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-3">
            {disputes.map((d, i) => (
              <DisputeRow key={d.id} order={d} index={i} onOpen={() => setSelected(d)} />
            ))}
          </div>
        )}
      </div>

      {selected && (
        <ResolveModal
          order={selected}
          isAdmin={isAdmin}
          onClose={() => setSelected(null)}
          onResolved={() => {
            setSelected(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function Header({ count }: { count: number }) {
  return (
    <div className="mb-10">
      <div className="flex items-center gap-2 text-[10.5px] font-medium text-zinc-500 uppercase tracking-[0.18em] mb-3">
        <ShieldAlert className="w-3.5 h-3.5" strokeWidth={1.75} />
        Admin · Escrow
      </div>
      <h1 className="text-3xl md:text-4xl font-light tracking-tight text-white">
        Disputes
        {count > 0 && (
          <span className="ml-3 text-[13px] font-normal text-[#14F195] align-middle">
            {count} open
          </span>
        )}
      </h1>
      <p className="mt-3 text-sm font-light text-zinc-400 max-w-2xl">
        Review disputed escrow orders. To resolve, call{' '}
        <code className="text-zinc-300">resolve()</code> on the escrow contract from the admin
        wallet, then confirm the decision here with the transaction hash.
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <div
      className="rounded-xl p-12 text-center"
      style={{
        background: 'var(--bg-card)',
        boxShadow: '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.04)',
      }}
    >
      <CheckCircle2 className="w-8 h-8 mx-auto mb-3 text-[#22c55e]" strokeWidth={1.5} />
      <div className="text-sm font-light text-zinc-300">No open disputes.</div>
      <div className="text-xs font-light text-zinc-500 mt-1">All escrow orders are healthy.</div>
    </div>
  );
}

function DisputeRow({
  order,
  index,
  onOpen,
}: {
  order: DisputedOrder;
  index: number;
  onOpen: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.03, 0.3), duration: 0.24 }}
      whileHover={{ y: -1 }}
      className="group relative w-full text-left rounded-xl overflow-hidden"
      style={{
        background: 'linear-gradient(180deg, rgba(30,15,18,0.55) 0%, var(--bg) 100%)',
        boxShadow:
          '0 0 0 1px rgba(239,68,68,0.22), inset 0 1px 0 rgba(255,255,255,0.04), 0 8px 24px -14px rgba(0,0,0,0.55)',
      }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ background: 'linear-gradient(90deg, transparent, #ef4444, transparent)' }}
      />

      <div className="relative flex items-center gap-4 p-4">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
          style={{
            background: 'rgba(239,68,68,0.12)',
            boxShadow: 'inset 0 0 0 1px rgba(239,68,68,0.35)',
          }}
        >
          <AlertTriangle className="w-4 h-4 text-[#ef4444]" strokeWidth={1.75} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="font-normal text-[13px] text-white truncate">
              {order.listing.title}
            </span>
            <span
              className="text-[10px] font-medium px-1.5 py-0.5 rounded-full uppercase tracking-[0.12em]"
              style={{
                color: '#ef4444',
                background: 'rgba(239,68,68,0.1)',
                boxShadow: 'inset 0 0 0 1px rgba(239,68,68,0.3)',
              }}
            >
              Disputed
            </span>
          </div>
          <div className="text-[11px] text-zinc-500 font-light">
            Buyer <span className="text-zinc-300">@{order.buyer.username || 'unknown'}</span>
            <span className="mx-1 opacity-40">↔</span>
            Seller <span className="text-zinc-300">@{order.seller.username || 'unknown'}</span>
            <span className="mx-1 opacity-40">·</span>
            {formatDate(order.escrowDisputedAt || order.createdAt)}
          </div>
        </div>

        <div className="text-right flex-shrink-0">
          <div className="font-mono font-normal text-[13px] text-[#b4a7ff]">
            {formatEth(order.amountWei)} ETH
          </div>
          <div className="text-[10px] text-zinc-600 uppercase tracking-[0.14em] font-medium mt-0.5">
            {order.listing.type}
          </div>
        </div>

        <ChevronRight
          className="w-4 h-4 text-zinc-600 flex-shrink-0 transition-all group-hover:text-zinc-300 group-hover:translate-x-0.5"
          strokeWidth={1.5}
        />
      </div>
    </motion.button>
  );
}

function ResolveModal({
  order,
  isAdmin,
  onClose,
  onResolved,
}: {
  order: DisputedOrder;
  isAdmin: boolean;
  onClose: () => void;
  onResolved: () => void;
}) {
  const [refundBuyer, setRefundBuyer] = useState<boolean | null>(null);
  const [note, setNote] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const escrowReady = useMemo(() => isEscrowEnabled(), []);

  const submit = useCallback(async () => {
    if (refundBuyer === null) return;
    setError(null);
    setPhase('signing');
    let hash: string;
    try {
      hash = await escrowResolve(order.id, refundBuyer);
      setTxHash(hash);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign transaction');
      setPhase('error');
      return;
    }

    setPhase('confirming');
    try {
      await api.post(`/escrow/orders/${order.id}/resolve`, {
        refundBuyer,
        txHash: hash,
        note: note.trim() || undefined,
      });
      setPhase('done');
      setTimeout(onResolved, 1200);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Backend verification failed';
      setError(msg);
      setPhase('error');
    }
  }, [refundBuyer, order.id, note, onResolved]);

  const busy = phase === 'signing' || phase === 'confirming';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
      onClick={busy ? undefined : onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.22 }}
        className="w-full max-w-lg rounded-xl overflow-hidden"
        style={{
          background: 'linear-gradient(180deg, rgba(18,18,24,0.98) 0%, var(--bg) 100%)',
          boxShadow:
            '0 0 0 1px rgba(255,255,255,0.08), inset 0 1px 0 rgba(255,255,255,0.05), 0 40px 80px -20px rgba(0,0,0,0.6)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-white/5">
          <div>
            <div className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-zinc-500 mb-1">
              Resolve dispute
            </div>
            <div className="text-sm font-light text-white">{order.listing.title}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-500 hover:text-white hover:bg-white/5 transition disabled:opacity-40"
          >
            <X className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className="p-5 space-y-4 text-[13px] font-light">
          <DetailRow
            label="Order ID"
            value={<code className="text-zinc-300 text-[11px]">{order.id}</code>}
          />
          <DetailRow
            label="Amount"
            value={
              <span className="font-mono text-[#b4a7ff]">{formatEth(order.amountWei)} ETH</span>
            }
          />
          <DetailRow
            label="Buyer"
            value={
              <span>
                <span className="text-zinc-200">@{order.buyer.username || 'unknown'}</span>
                {order.buyer.walletAddress && (
                  <span className="ml-2 text-[11px] font-mono text-zinc-500">
                    {shortAddr(order.buyer.walletAddress)}
                  </span>
                )}
              </span>
            }
          />
          <DetailRow
            label="Seller"
            value={
              <span>
                <span className="text-zinc-200">@{order.seller.username || 'unknown'}</span>
                {order.seller.walletAddress && (
                  <span className="ml-2 text-[11px] font-mono text-zinc-500">
                    {shortAddr(order.seller.walletAddress)}
                  </span>
                )}
              </span>
            }
          />
          <DetailRow label="Disputed at" value={formatDate(order.escrowDisputedAt)} />

          {!isAdmin ? (
            <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-[12px] text-yellow-200 font-light">
              Moderators can view disputes but only admins can resolve them.
            </div>
          ) : !escrowReady ? (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-[12px] text-red-300 font-light">
              Escrow contract address is not configured. Set{' '}
              <code>NEXT_PUBLIC_ESCROW_CONTRACT</code>.
            </div>
          ) : (
            <>
              <div className="pt-2">
                <div className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-zinc-500 mb-2">
                  Resolution
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <ChoiceButton
                    active={refundBuyer === false}
                    onClick={() => setRefundBuyer(false)}
                    disabled={busy}
                    icon={<CheckCircle2 className="w-4 h-4" strokeWidth={1.75} />}
                    label="Pay seller"
                    help="Seller wins. Platform fee: 7% (ETH) / 3% (HAGGL)."
                    accent="#22c55e"
                  />
                  <ChoiceButton
                    active={refundBuyer === true}
                    onClick={() => setRefundBuyer(true)}
                    disabled={busy}
                    icon={<Undo2 className="w-4 h-4" strokeWidth={1.75} />}
                    label="Refund buyer"
                    help="Buyer wins. Full refund, no fee."
                    accent="#14F195"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="note"
                  className="block text-[10.5px] font-medium uppercase tracking-[0.16em] text-zinc-500 mb-2"
                >
                  Note (optional, posted to order chat)
                </label>
                <textarea
                  id="note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  disabled={busy}
                  maxLength={1800}
                  rows={3}
                  placeholder="Rationale for your decision…"
                  className="w-full rounded-lg px-3 py-2 text-[13px] font-light text-white bg-black/40 border border-white/10 focus:outline-none focus:border-[#14F195]/50 resize-none"
                />
              </div>

              {error && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-[12px] text-red-300 font-light break-words">
                  {error}
                </div>
              )}
              {txHash && phase !== 'done' && (
                <div className="rounded-lg border border-[#14F195]/30 bg-[#14F195]/5 px-3 py-2 text-[12px] text-zinc-300 font-light">
                  Tx: <code className="text-[#b4a7ff] font-mono">{shortAddr(txHash)}</code>
                </div>
              )}
              {phase === 'done' && (
                <div className="rounded-lg border border-[#22c55e]/30 bg-[#22c55e]/5 px-3 py-2 text-[12px] text-[#86efac] font-light flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                  Dispute resolved.
                </div>
              )}

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={busy}
                  className="px-4 py-2 rounded-lg text-[12.5px] font-light text-zinc-300 hover:bg-white/5 transition disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={busy || refundBuyer === null || phase === 'done'}
                  className="px-4 py-2 rounded-lg text-[12.5px] font-normal text-white flex items-center gap-2 transition disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    background:
                      'linear-gradient(180deg, rgba(20, 241, 149, 0.9) 0%, rgba(20, 241, 149, 0.7) 100%)',
                    boxShadow:
                      'inset 0 1px 0 rgba(255,255,255,0.18), 0 6px 14px -6px rgba(20, 241, 149, 0.5)',
                  }}
                >
                  {phase === 'signing' ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Awaiting wallet…
                    </>
                  ) : phase === 'confirming' ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Verifying on chain…
                    </>
                  ) : (
                    <>
                      <Wallet className="w-3.5 h-3.5" strokeWidth={1.75} /> Resolve
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="text-[11px] uppercase tracking-[0.14em] text-zinc-500 font-medium pt-0.5">
        {label}
      </div>
      <div className="text-right text-zinc-200">{value}</div>
    </div>
  );
}

function ChoiceButton({
  active,
  disabled,
  onClick,
  icon,
  label,
  help,
  accent,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  help: string;
  accent: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="text-left rounded-lg p-3 transition disabled:opacity-50"
      style={{
        background: active ? `${accent}18` : 'rgba(255,255,255,0.02)',
        boxShadow: active
          ? `inset 0 0 0 1px ${accent}70`
          : 'inset 0 0 0 1px rgba(255,255,255,0.06)',
      }}
    >
      <div className="flex items-center gap-2 mb-1" style={{ color: active ? accent : '#d4d4d8' }}>
        {icon}
        <span className="text-[12.5px] font-normal">{label}</span>
      </div>
      <div className="text-[11px] text-zinc-500 font-light">{help}</div>
    </button>
  );
}

function shortAddr(addr: string) {
  if (!addr) return '';
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// Referenced to keep the import alive for TS — the value is read inside effects.
void API_URL;
