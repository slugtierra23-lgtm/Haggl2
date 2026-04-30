'use client';
import { AnimatePresence, motion } from 'framer-motion';
import { Shield, AlertTriangle, Lock, X, Check, TrendingDown } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';

import { feeUsdForBase, FEE_BPS, grossUsdForBase, type PaymentMethod } from '@/lib/payments/fees';
import { isEscrowEnabled } from '@/lib/wallet/escrow';
import { getMetaMaskProvider } from '@/lib/wallet/ethereum';

export type { PaymentMethod };

interface PaymentConsentModalProps {
  listingTitle: string;
  sellerAddress: string;
  /** USD amount the seller takes home (= the listing price). */
  baseUsd: number;
  buyerAddress: string;
  /** When true, ATLAS option is hidden (token not configured for this build). */
  hagglDisabled?: boolean;
  onConsent: (signature: string, message: string, paymentMethod: PaymentMethod) => void;
  onCancel: () => void;
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n >= 100) return n.toFixed(2);
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(3);
}

export function PaymentConsentModal({
  listingTitle,
  sellerAddress,
  baseUsd,
  buyerAddress,
  hagglDisabled = false,
  onConsent,
  onCancel,
}: PaymentConsentModalProps) {
  const [signing, setSigning] = useState(false);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState('');
  // Default to ATLAS when available — it's the strictly cheaper option.
  const [method, setMethod] = useState<PaymentMethod>(hagglDisabled ? 'SOL' : 'ATLAS');

  const escrow = isEscrowEnabled();

  const ethTotal = useMemo(() => grossUsdForBase(baseUsd, 'SOL'), [baseUsd]);
  const  hagglTotal = useMemo(() => grossUsdForBase(baseUsd, 'ATLAS'), [baseUsd]);
  const savingsUsd = ethTotal -  hagglTotal;

  const grossUsd = method === 'ATLAS' ?  hagglTotal : ethTotal;
  const platformFeeUsd = useMemo(() => feeUsdForBase(baseUsd, method), [baseUsd, method]);
  const feePct = method === 'SOL' ? '7%' : '3%';
  const currency = method === 'SOL' ? 'SOL' : 'ATLAS';

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !signing) onCancel();
    };
    window.addEventListener('keydown', handler);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = previous;
    };
  }, [onCancel, signing]);

  const handleSign = async () => {
    if (!checked) {
      setError('You must accept the terms first');
      return;
    }
    setSigning(true);
    setError('');

    try {
      const eth = getMetaMaskProvider();
      if (!eth) throw new Error('MetaMask not found. Install it to continue.');

      const timestamp = new Date().toISOString();
      const escrowTerms = escrow
        ? [
            '1. Funds will be deposited into the Atlas Escrow smart contract on Base (chainId 8453).',
            '2. The seller will NOT receive payment until I confirm delivery.',
            '3. I can open a dispute if the seller does not deliver.',
            '4. After 14 days without dispute, funds auto-release to the seller.',
            '5. Disputes are resolved by the Atlas admin.',
            '6. Smart contract interactions on Base require gas fees (paid in SOL).',
            '7. This cryptographic signature constitutes irrevocable proof of my consent.',
            '8. I have the technical knowledge required to conduct this transaction.',
          ]
        : [
            '1. This is a voluntary peer-to-peer transaction on Base (Solana Layer 2).',
            '2. Blockchain transactions are FINAL and IRREVERSIBLE once confirmed.',
            '3. Atlas Platform is NOT a custodian and does NOT hold or escrow funds.',
            '4. Atlas Platform bears NO liability for disputes, fraud, or losses.',
            '5. I have independently verified the seller and listing before paying.',
            '6. I accept FULL personal responsibility for this transaction.',
            '7. This cryptographic signature constitutes irrevocable proof of my consent.',
            '8. I have the technical knowledge required to conduct this transaction.',
          ];

      const message = [
        `=== ATLAS PLATFORM — PAYMENT CONSENT DOCUMENT${escrow ? ' (ESCROW)' : ''} ===`,
        '',
        `Date: ${timestamp}`,
        'Network: Base (Solana L2, chainId 8453)',
        `Payment method: ${method}${method === 'ATLAS' ? ' (ERC-20, lower fee)' : ' (native)'}`,
        `Buyer wallet:  ${buyerAddress}`,
        `Seller wallet: ${sellerAddress}`,
        `Listing: ${listingTitle}`,
        escrow ? 'Mode: ESCROW (funds held until delivery confirmed)' : 'Mode: DIRECT PAYMENT',
        '',
        'PAYMENT BREAKDOWN (USD-equivalent):',
        `  Listing price (to seller):   $${fmtUsd(baseUsd)}`,
        `  Platform fee (${feePct}):${' '.repeat(Math.max(1, 14 - feePct.length))}$${fmtUsd(platformFeeUsd)}`,
        `  Total you pay:               $${fmtUsd(grossUsd)} (in ${currency})`,
        '',
        'BY SIGNING THIS DOCUMENT I CONFIRM:',
        ...escrowTerms,
        '',
        'This document is stored as proof of informed consent.',
      ].join('\n');

      const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
      const signature = (await eth.request({
        method: 'personal_sign',
        params: [message, accounts[0]],
      })) as string;

      onConsent(signature, message, method);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('rejected') || msg.includes('denied') || msg.includes('User denied')) {
        setError('Signature cancelled.');
      } else {
        setError(msg.slice(0, 120));
      }
    } finally {
      setSigning(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="fixed inset-0 z-[100] flex items-center justify-center p-4"
        style={{ background: 'rgba(0,0,0,0.92)', backdropFilter: 'blur(14px)' }}
      >
        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.97 }}
          transition={{ duration: 0.28, ease: [0.22, 0.61, 0.36, 1] }}
          className="relative w-full max-w-md rounded-2xl overflow-hidden"
          style={{
            background: 'var(--bg)',
            border: '1px solid rgba(20, 241, 149, 0.3)',
            boxShadow: '0 0 80px rgba(20, 241, 149, 0.08)',
          }}
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-px"
            style={{
              background:
                'linear-gradient(90deg, transparent 0%, rgba(20, 241, 149, 0.55) 50%, transparent 100%)',
            }}
          />
          {/* Header */}
          <div
            className="flex items-center justify-between px-6 py-4 border-b"
            style={{ borderColor: 'rgba(255,255,255,0.06)' }}
          >
            <div className="flex items-center gap-2.5">
              <Shield className="w-4 h-4 text-atlas-400" />
              <span className="font-light text-white text-sm">Payment Consent</span>
              <span className="text-[10px] font-mono text-cyan-300/80 border border-cyan-400/25 px-1.5 py-0.5 rounded">
                BASE
              </span>
            </div>
            <motion.button
              onClick={onCancel}
              whileTap={{ scale: 0.88 }}
              whileHover={{ rotate: 90 }}
              transition={{ type: 'spring', stiffness: 320, damping: 20 }}
              className="p-1 rounded-md text-zinc-600 hover:text-zinc-300 hover:bg-white/5 transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </motion.button>
          </div>

          {/* Payment method selector */}
          <div className="px-5 pt-5">
            <p className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest mb-2">
              Choose payment method on Base
            </p>
            <div className={`grid gap-2.5 ${hagglDisabled ? 'grid-cols-1' : 'grid-cols-2'}`}>
              <MethodCard
                active={method === 'SOL'}
                onClick={() => setMethod('SOL')}
                title="SOL"
                subtitle={`7% fee · you pay $${fmtUsd(ethTotal)}`}
                accent="#60a5fa"
              />
              {!hagglDisabled && (
                <MethodCard
                  active={method === 'ATLAS'}
                  onClick={() => setMethod('ATLAS')}
                  title="ATLAS"
                  subtitle={`3% fee · you pay $${fmtUsd(hagglTotal)}`}
                  accent="#14F195"
                  badge={savingsUsd > 0 ? `Save $${fmtUsd(savingsUsd)}` : undefined}
                  highlighted
                />
              )}
            </div>
            {!hagglDisabled && savingsUsd > 0 && (
              <p className="mt-2 flex items-center gap-1.5 text-[10.5px] font-light text-zinc-400 leading-relaxed">
                <TrendingDown className="w-3 h-3 text-emerald-400 shrink-0" strokeWidth={2} />
                Paying in ATLAS costs ${fmtUsd(savingsUsd)} less. The seller receives $
                {fmtUsd(baseUsd)} either way — only the fee changes.
              </p>
            )}
          </div>

          {/* Warning / Info */}
          {escrow ? (
            <div
              className="mx-5 mt-4 flex gap-3 p-3.5 rounded-xl"
              style={{
                background: 'rgba(34,197,94,0.06)',
                border: '1px solid rgba(34,197,94,0.2)',
              }}
            >
              <Lock className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-green-300/80 leading-relaxed">
                <strong>Escrow protected.</strong> Funds are held in a smart contract on Base until
                you confirm delivery. You can dispute if the seller doesn&apos;t deliver.
              </p>
            </div>
          ) : (
            <div
              className="mx-5 mt-4 flex gap-3 p-3.5 rounded-xl"
              style={{
                background: 'rgba(234,179,8,0.06)',
                border: '1px solid rgba(234,179,8,0.2)',
              }}
            >
              <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-yellow-300/80 leading-relaxed">
                <strong>Peer-to-peer Base transaction.</strong> Payments are irreversible. Atlas is
                not responsible for disputes or losses.
              </p>
            </div>
          )}

          {/* Breakdown */}
          <div
            className="mx-5 mt-4 p-4 rounded-xl"
            style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px dashed rgba(255,255,255,0.07)',
            }}
          >
            <p className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest mb-3">
              Transaction breakdown
            </p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-zinc-400">Listing price (to seller)</span>
                <span className="text-white font-mono">${fmtUsd(baseUsd)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">
                  Platform fee <span className="text-zinc-600 font-mono text-xs">({feePct})</span>
                </span>
                <span className="text-white font-mono">+ ${fmtUsd(platformFeeUsd)}</span>
              </div>
              <div
                className="flex justify-between pt-2 border-t"
                style={{ borderColor: 'rgba(255,255,255,0.06)' }}
              >
                <span className="text-zinc-200 font-light">
                  You pay{escrow ? ' (1 escrow deposit)' : ' (2 transactions)'}
                </span>
                <span className="text-atlas-300 font-mono font-light">
                  ${fmtUsd(grossUsd)} <span className="text-zinc-500 text-xs">in {currency}</span>
                </span>
              </div>
            </div>
          </div>

          {/* Terms scroll box */}
          <div
            className="mx-5 mt-4 max-h-36 overflow-y-auto p-4 rounded-xl text-[11px] text-zinc-500 leading-relaxed font-mono space-y-1"
            style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.04)' }}
          >
            <p className="text-zinc-400 font-light">By signing you confirm:</p>
            {escrow ? (
              <ol className="list-decimal list-inside space-y-0.5 mt-1">
                <li>Funds will be deposited into the Atlas Escrow contract on Base.</li>
                <li>The seller will NOT receive payment until I confirm delivery.</li>
                <li>I can dispute within 14 days if the seller does not deliver.</li>
                <li>After 14 days without dispute, funds auto-release to the seller.</li>
                <li>Disputes are resolved by Atlas admin.</li>
                <li>This cryptographic signature is irrevocable proof of consent.</li>
              </ol>
            ) : (
              <ol className="list-decimal list-inside space-y-0.5 mt-1">
                <li>All Base transactions are final and irreversible.</li>
                <li>Atlas Platform does not hold, escrow, or guarantee any funds.</li>
                <li>You have independently verified the seller and listing.</li>
                <li>Atlas Platform bears no liability for disputes, fraud, or losses.</li>
                <li>You accept full personal responsibility for this transaction.</li>
                <li>This cryptographic signature is irrevocable proof of consent.</li>
                <li>You possess sufficient technical knowledge to conduct this transaction.</li>
              </ol>
            )}
          </div>

          {/* Checkbox */}
          <div className="mx-5 mt-4 flex items-start gap-3">
            <input
              type="checkbox"
              id="consent-check"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              className="mt-0.5 w-4 h-4 cursor-pointer accent-violet-500 flex-shrink-0"
            />
            <label
              htmlFor="consent-check"
              className="text-xs text-zinc-400 cursor-pointer leading-relaxed"
            >
              I have read and understood all terms. I voluntarily consent to this transaction on
              Base network and accept all associated risks.
            </label>
          </div>

          {error && <p className="mx-5 mt-3 text-xs text-red-400 font-mono">{error}</p>}

          {/* Actions */}
          <div className="px-5 py-5 mt-1 flex gap-3">
            <motion.button
              onClick={onCancel}
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 360, damping: 22 }}
              className="flex-1 py-2.5 text-sm text-zinc-400 rounded-xl border border-zinc-800 hover:border-zinc-600 hover:text-zinc-200 transition-colors"
            >
              Cancel
            </motion.button>
            <motion.button
              onClick={handleSign}
              disabled={!checked || signing}
              whileHover={!checked || signing ? undefined : { y: -1 }}
              whileTap={!checked || signing ? undefined : { scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 360, damping: 22 }}
              className="flex-1 py-2.5 text-sm font-light text-white rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110"
              style={{
                background: 'rgba(20, 241, 149, 0.18)',
                border: '1px solid rgba(20, 241, 149, 0.45)',
              }}
            >
              {signing ? 'Signing…' : `Sign & pay $${fmtUsd(grossUsd)} ${currency}`}
            </motion.button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// Keep FEE_BPS available to anyone still importing from this file.
export { FEE_BPS };

function MethodCard({
  active,
  onClick,
  title,
  subtitle,
  accent,
  highlighted,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
  accent: string;
  highlighted?: boolean;
  badge?: string;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.98 }}
      className="relative text-left p-3 rounded-xl transition-colors"
      style={{
        background: active ? `${accent}18` : 'rgba(255,255,255,0.02)',
        border: `1px solid ${active ? `${accent}80` : 'rgba(255,255,255,0.06)'}`,
      }}
    >
      {highlighted && !active && badge && (
        <span
          className="absolute top-1.5 right-1.5 text-[8.5px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded"
          style={{
            background: `${accent}22`,
            color: accent,
            border: `1px solid ${accent}50`,
          }}
        >
          {badge}
        </span>
      )}
      {active && (
        <span
          className="absolute top-1.5 right-1.5 grid place-items-center w-4 h-4 rounded-full"
          style={{ background: accent }}
        >
          <Check className="w-2.5 h-2.5 text-black" strokeWidth={3} />
        </span>
      )}
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-light text-white">{title}</span>
      </div>
      <p className="text-[10.5px] text-zinc-500 mt-1 leading-snug">{subtitle}</p>
    </motion.button>
  );
}
