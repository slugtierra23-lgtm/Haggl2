'use client';

import { motion } from 'framer-motion';
import { ArrowLeft, CheckCircle2, Copy, Printer, Shield } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import React, { useEffect, useState } from 'react';

import { api } from '@/lib/api/client';

type OrderStatus = 'PENDING_DELIVERY' | 'IN_PROGRESS' | 'DELIVERED' | 'COMPLETED' | 'DISPUTED';

interface Order {
  id: string;
  createdAt: string;
  completedAt: string | null;
  status: OrderStatus;
  amountWei: string;
  txHash: string;
  platformFeeWei: string | null;
  platformFeeTxHash: string | null;
  escrowStatus: string | null;
  escrowContract: string | null;
  escrowReleaseTx: string | null;
  deliveryNote: string | null;
  listing: { id: string; title: string; type: string; price: number; currency: string };
  buyer: { id: string; username: string | null; avatarUrl: string | null };
  seller: { id: string; username: string | null; avatarUrl: string | null };
}

const BRAND = '#14F195';

const WEI_PER_ETH = BigInt('1000000000000000000');
const BIGINT_ZERO = BigInt(0);

function formatEth(wei: string | null | undefined): string {
  if (!wei) return '0';
  try {
    const n = BigInt(wei);
    const whole = n / WEI_PER_ETH;
    const frac = n % WEI_PER_ETH;
    if (frac === BIGINT_ZERO) return `${whole}`;
    const fracStr = frac.toString().padStart(18, '0').replace(/0+$/, '');
    return `${whole}.${fracStr}`;
  } catch {
    return wei;
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function short(hash: string, head = 10, tail = 8) {
  if (!hash) return '';
  if (hash.length <= head + tail) return hash;
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

export default function OrderReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get<Order>(`/orders/${id}`);
        if (!cancelled) setOrder(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load order');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* ignore */
    }
  };

  if (loading) {
    return <div className="max-w-3xl mx-auto px-6 py-20 text-center text-zinc-500">Loading…</div>;
  }
  if (error || !order) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-20 text-center">
        <p className="text-zinc-400 mb-4">{error || 'Order not found'}</p>
        <Link href="/orders" className="text-sm text-zinc-500 hover:text-white">
          ← Back to orders
        </Link>
      </div>
    );
  }

  const useEscrow = order.escrowStatus && order.escrowStatus !== 'NONE';
  const amountLabel = formatEth(order.amountWei);
  const feeLabel = formatEth(order.platformFeeWei);
  const totalPaid = (() => {
    try {
      return formatEth(
        (BigInt(order.amountWei || '0') + BigInt(order.platformFeeWei || '0')).toString(),
      );
    } catch {
      return amountLabel;
    }
  })();

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <style jsx global>{`
        @media print {
          nav,
          aside,
          header,
          .no-print {
            display: none !important;
          }
          body {
            background: white !important;
            color: black !important;
          }
          .receipt-card {
            border: 1px solid #ddd !important;
            box-shadow: none !important;
            background: white !important;
            color: black !important;
          }
          .receipt-card * {
            color: black !important;
          }
        }
      `}</style>

      <div className="max-w-3xl mx-auto px-4 lg:px-6 py-8 lg:py-12">
        <div className="flex items-center justify-between mb-6 no-print">
          <Link
            href={`/orders/${order.id}`}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] font-medium text-zinc-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to order
          </Link>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] font-medium text-zinc-300 hover:text-white transition-colors"
            style={{
              background: 'rgba(255,255,255,0.04)',
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)',
            }}
          >
            <Printer className="w-3.5 h-3.5" /> Print / Save PDF
          </button>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 0.61, 0.36, 1] }}
          className="receipt-card relative rounded-2xl overflow-hidden p-8 lg:p-10"
          style={{
            background: 'var(--bg-card)',
            boxShadow:
              '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.04), 0 12px 36px -20px rgba(0,0,0,0.55)',
          }}
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-px no-print"
            style={{
              background:
                'linear-gradient(90deg, transparent 0%, rgba(20, 241, 149, 0.45) 50%, transparent 100%)',
            }}
          />
          <div className="flex items-start justify-between mb-8 pb-6 border-b border-zinc-800">
            <div>
              <div className="text-xl font-light tracking-tight mb-1" style={{ color: BRAND }}>
                Atlas
              </div>
              <div className="text-[11px] uppercase tracking-wider text-zinc-500">Receipt</div>
            </div>
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1">Order #</div>
              <div className="text-sm font-mono text-white">{order.id.slice(0, 12)}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6 mb-8">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">
                Issued
              </div>
              <div className="text-sm text-white font-light">{formatDate(order.createdAt)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">
                Status
              </div>
              <div className="flex items-center gap-1.5">
                {order.status === 'COMPLETED' ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                ) : null}
                <span className="text-sm font-light text-white">
                  {order.status.replace('_', ' ')}
                </span>
              </div>
              {order.completedAt && (
                <div className="text-[11px] text-zinc-500 mt-0.5">
                  Completed {formatDate(order.completedAt)}
                </div>
              )}
            </div>

            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">
                Seller
              </div>
              <Link
                href={`/market/sellers/${order.seller.username || ''}`}
                className="text-sm text-white font-light hover:text-[#14F195] transition-colors"
              >
                @{order.seller.username || 'seller'}
              </Link>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">Buyer</div>
              <div className="text-sm font-light text-white">
                @{order.buyer.username || 'buyer'}
              </div>
            </div>
          </div>

          <div className="mb-8">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">Item</div>
            <div className="border border-zinc-800 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3">
                <div className="min-w-0">
                  <Link
                    href={`/market/agents/${order.listing.id}`}
                    className="text-sm font-light text-white hover:text-[#14F195] transition-colors truncate block"
                  >
                    {order.listing.title}
                  </Link>
                  <div className="text-[11px] text-zinc-500 mt-0.5">{order.listing.type}</div>
                </div>
                <div className="text-sm font-mono text-white shrink-0 ml-4">
                  {order.listing.price} {order.listing.currency}
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-zinc-800 pt-6 mb-6">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-400 font-light">Subtotal</span>
                <span className="font-mono text-zinc-200">{amountLabel} ETH</span>
              </div>
              {order.platformFeeWei && order.platformFeeWei !== '0' && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-400 font-light">Platform fee</span>
                  <span className="font-mono text-zinc-200">{feeLabel} ETH</span>
                </div>
              )}
              <div className="flex items-center justify-between text-sm pt-3 mt-3 border-t border-zinc-800/60">
                <span className="font-light text-white">Total paid</span>
                <span className="font-mono text-white text-base">{totalPaid} ETH</span>
              </div>
            </div>
          </div>

          <div className="mb-6 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 shrink-0 pt-0.5">
                Tx hash
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono text-[11px] text-zinc-300 truncate">
                  {short(order.txHash, 14, 10)}
                </span>
                <button
                  onClick={() => copy(order.txHash, 'tx')}
                  className="no-print text-zinc-500 hover:text-white shrink-0"
                  aria-label="Copy tx hash"
                >
                  {copied === 'tx' ? (
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                </button>
              </div>
            </div>
            {order.platformFeeTxHash && (
              <div className="flex items-start justify-between gap-3">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 shrink-0 pt-0.5">
                  Fee tx
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-[11px] text-zinc-300 truncate">
                    {short(order.platformFeeTxHash, 14, 10)}
                  </span>
                  <button
                    onClick={() => copy(order.platformFeeTxHash!, 'fee')}
                    className="no-print text-zinc-500 hover:text-white shrink-0"
                    aria-label="Copy fee tx hash"
                  >
                    {copied === 'fee' ? (
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                </div>
              </div>
            )}
            {order.escrowReleaseTx && (
              <div className="flex items-start justify-between gap-3">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 shrink-0 pt-0.5">
                  Escrow release
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-[11px] text-zinc-300 truncate">
                    {short(order.escrowReleaseTx, 14, 10)}
                  </span>
                  <button
                    onClick={() => copy(order.escrowReleaseTx!, 'esc')}
                    className="no-print text-zinc-500 hover:text-white shrink-0"
                    aria-label="Copy escrow release tx hash"
                  >
                    {copied === 'esc' ? (
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>

          {useEscrow && (
            <div
              className="flex items-start gap-2.5 p-3 rounded-lg"
              style={{
                background:
                  'linear-gradient(180deg, rgba(20, 241, 149, 0.12) 0%, rgba(20, 241, 149, 0.04) 100%)',
                boxShadow: 'inset 0 0 0 1px rgba(20, 241, 149, 0.25)',
              }}
            >
              <Shield className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: BRAND }} />
              <div className="text-[11px] text-zinc-400 leading-relaxed">
                This transaction was secured by the Atlas escrow contract. Funds are only released
                to the seller after the buyer confirms delivery. Escrow status:{' '}
                <span className="font-mono text-zinc-300">{order.escrowStatus}</span>.
              </div>
            </div>
          )}

          <div className="border-t border-zinc-800 mt-8 pt-6 text-center">
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              This receipt is issued by Atlas as a proof of purchase recorded on-chain. Keep it for
              your records. For disputes, please open a dispute from the order page within the
              platform SLA.
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
