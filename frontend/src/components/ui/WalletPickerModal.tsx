'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Check, X } from 'lucide-react';
import React, { useEffect } from 'react';

import { WalletProviderIcon, walletProviderLabel } from './WalletIcons';

export interface PickableWallet {
  id: string;
  address: string;
  label: string | null;
  provider: string;
  isPrimary: boolean;
}

interface Props {
  wallets: PickableWallet[];
  selectedAddress?: string | null;
  onPick: (address: string) => void;
  onCancel: () => void;
  /** @default 'Select payment wallet' */
  title?: string;
  /** @default 'Choose which of your linked wallets should pay for this purchase.' */
  subtitle?: string;
}

export function WalletPickerModal({
  wallets,
  selectedAddress,
  onPick,
  onCancel,
  title = 'Select payment wallet',
  subtitle = 'Choose which of your linked wallets should pay for this purchase.',
}: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handler);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = previous;
    };
  }, [onCancel]);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="fixed inset-0 z-[110] flex items-center justify-center p-4"
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
          <div
            className="flex items-start justify-between px-5 py-4 border-b"
            style={{ borderColor: 'rgba(255,255,255,0.06)' }}
          >
            <div>
              <div className="text-sm font-light text-white">{title}</div>
              <p className="text-[11px] text-white/50 mt-1 leading-relaxed">{subtitle}</p>
            </div>
            <button
              onClick={onCancel}
              className="p-1 rounded-md text-zinc-500 hover:text-white/80 hover:bg-white/5 transition-colors flex-shrink-0"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-4 space-y-2 max-h-[55vh] overflow-y-auto">
            {wallets.map((w) => {
              const active = selectedAddress?.toLowerCase() === w.address.toLowerCase();
              const short = `${w.address.slice(0, 6)}…${w.address.slice(-4)}`;
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => onPick(w.address)}
                  className="w-full text-left rounded-xl p-3 sm:p-4 flex items-center gap-3 sm:gap-4 transition-colors border"
                  style={{
                    background: active ? 'rgba(20, 241, 149, 0.10)' : 'rgba(255,255,255,0.02)',
                    borderColor: active ? 'rgba(20, 241, 149, 0.55)' : 'rgba(255,255,255,0.06)',
                  }}
                >
                  <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center flex-shrink-0">
                    <WalletProviderIcon provider={w.provider} size={28} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-light text-white/90 truncate">
                        {w.label || walletProviderLabel(w.provider)}
                      </span>
                      {w.isPrimary && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] uppercase tracking-widest border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 flex-shrink-0">
                          Primary
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-[11px] sm:text-xs text-white/50 mt-0.5 truncate">
                      {short}
                    </div>
                  </div>
                  {active && (
                    <span className="grid place-items-center w-6 h-6 rounded-full bg-atlas-500/20 border border-atlas-500/60 flex-shrink-0">
                      <Check className="w-3.5 h-3.5 text-atlas-300" strokeWidth={3} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div
            className="px-5 py-4 border-t flex justify-end"
            style={{ borderColor: 'rgba(255,255,255,0.06)' }}
          >
            <button
              onClick={onCancel}
              className="px-4 py-2 text-xs text-zinc-400 rounded-lg border border-zinc-800 hover:border-zinc-600 hover:text-zinc-200 transition-colors"
            >
              Cancel
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
