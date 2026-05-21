'use client';

import { BrowserProvider, Contract, parseEther } from 'ethers';
import { Flame, Loader2, Rocket } from 'lucide-react';
import React, { useEffect, useState } from 'react';

import { Modal } from '@/components/ui/Modal';
import { api } from '@/lib/api/client';
import { getMetaMaskProvider } from '@/lib/wallet/ethereum';

interface BoostTier {
  days: number;
  price: number;
}

interface BoostPricingResponse {
  currency: string;
  platformWallet: string | null;
  tokenContract: string | null;
  tiers: BoostTier[];
}

interface BoostListingModalProps {
  open: boolean;
  onClose: () => void;
  listingId: string;
  listingTitle: string;
  currentBoostedUntil: string | null;
  onBoosted: (boostedUntil: string) => void;
}

export function BoostListingModal({
  open,
  onClose,
  listingId,
  listingTitle,
  currentBoostedUntil,
  onBoosted,
}: BoostListingModalProps) {
  const [pricing, setPricing] = useState<BoostPricingResponse | null>(null);
  const [selectedDays, setSelectedDays] = useState<number>(7);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    api
      .get<BoostPricingResponse>('/market/boost-pricing')
      .then((data) => setPricing(data))
      .catch(() => setError('Failed to load boost pricing'));
  }, [open]);

  async function handleBoost() {
    setSubmitting(true);
    setError(null);
    try {
      const tier = pricing?.tiers.find((t) => t.days === selectedDays);
      if (!pricing || !tier) throw new Error('Pricing not loaded');
      if (!pricing.platformWallet) {
        throw new Error('Boosts are not configured on this deployment');
      }
      const mm = getMetaMaskProvider();
      if (!mm) throw new Error('Connect MetaMask to pay for a boost');

      const provider = new BrowserProvider(mm as unknown as import('ethers').Eip1193Provider);
      const signer = await provider.getSigner();
      const amountWei = parseEther(tier.price.toString());

      let txHash: string;
      if (pricing.tokenContract) {
        // ERC-20 transfer(platformWallet, amountWei)
        const erc20 = new Contract(
          pricing.tokenContract,
          ['function transfer(address,uint256) returns (bool)'],
          signer,
        );
        const sent = await erc20.transfer(pricing.platformWallet, amountWei);
        txHash = sent.hash;
      } else {
        // Plain ETH transfer
        const sent = await signer.sendTransaction({
          to: pricing.platformWallet,
          value: amountWei,
        });
        txHash = sent.hash;
      }

      const result = await api.post<{
        ok: boolean;
        boostedUntil: string;
        durationDays: number;
        amountTokens: number;
      }>(`/market/${listingId}/boost`, { durationDays: selectedDays, txHash });
      onBoosted(result.boostedUntil);
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Boost failed';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  const isCurrentlyBoosted =
    currentBoostedUntil && new Date(currentBoostedUntil).getTime() > Date.now();
  const selectedTier = pricing?.tiers.find((t) => t.days === selectedDays);

  return (
    <Modal isOpen={open} onClose={onClose} title="Boost listing" subtitle={listingTitle} size="md">
      <div className="space-y-5">
        <div
          className="rounded-lg p-3 flex items-start gap-3"
          style={{
            background: 'rgba(236,72,153,0.06)',
            border: '1px solid rgba(236,72,153,0.22)',
          }}
        >
          <Flame className="w-4 h-4 text-pink-300 flex-shrink-0 mt-0.5" strokeWidth={2} />
          <div className="text-[12px] text-zinc-300 font-light leading-snug">
            Boosted listings rank higher in <span className="text-white">/market</span> browse and
            appear in the global ticker — typically 3–5x more impressions while active.
          </div>
        </div>

        {isCurrentlyBoosted && (
          <div className="text-[11.5px] text-zinc-400 font-mono">
            Currently boosted until {new Date(currentBoostedUntil!).toLocaleString()}. Buying more
            extends from that date.
          </div>
        )}

        <div className="grid grid-cols-5 gap-1.5">
          {(
            pricing?.tiers || [
              { days: 1, price: 5 },
              { days: 3, price: 12 },
              { days: 7, price: 25 },
              { days: 14, price: 45 },
              { days: 30, price: 80 },
            ]
          ).map((tier) => {
            const active = tier.days === selectedDays;
            return (
              <button
                key={tier.days}
                type="button"
                onClick={() => setSelectedDays(tier.days)}
                className="rounded-lg py-3 transition-all"
                style={{
                  color: active ? '#ffffff' : '#a1a1aa',
                  background: active ? 'rgba(236,72,153,0.18)' : 'rgba(255,255,255,0.02)',
                  boxShadow: active
                    ? 'inset 0 0 0 1px rgba(236,72,153,0.55), 0 0 16px -8px rgba(236,72,153,0.6)'
                    : 'inset 0 0 0 1px rgba(255,255,255,0.06)',
                }}
              >
                <div className="text-[13px] font-light">{tier.days}d</div>
                <div className="text-[10.5px] font-mono mt-0.5 text-zinc-500">
                  {tier.price} ATLAS
                </div>
              </button>
            );
          })}
        </div>

        {error && <div className="text-[12px] text-red-300 font-light">{error}</div>}

        <div className="flex items-center justify-between pt-2 border-t border-white/5">
          <div className="text-[11.5px] text-zinc-500 font-light">
            Total{' '}
            <span className="text-white font-mono">
              {selectedTier?.price ?? '—'} {pricing?.currency || 'HAGGL'}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-[12.5px] text-zinc-400 hover:text-white transition"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleBoost}
              disabled={submitting}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[12.5px] font-light transition"
              style={{
                color: '#ffffff',
                background:
                  'linear-gradient(180deg, rgba(236,72,153,0.55) 0%, rgba(20, 241, 149, 0.55) 100%)',
                boxShadow: '0 0 0 1px rgba(236,72,153,0.5), 0 0 20px -8px rgba(236,72,153,0.6)',
              }}
            >
              {submitting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Rocket className="w-3.5 h-3.5" />
              )}
              Boost listing
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
