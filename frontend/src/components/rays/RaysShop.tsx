'use client';

import { AnimatePresence, motion } from 'framer-motion';
import {
  Zap,
  AlertCircle,
  CheckCircle,
  Flame,
  Building2,
  Infinity as InfinityIcon,
} from 'lucide-react';
import React, { useState, useEffect } from 'react';

interface Pack {
  pack: string;
  rays: number;
   hagglPrice: number;
}

interface RaysShopProps {
  agentId: string;
  onPurchaseSuccess?: () => void;
  loading?: boolean;
}

export const RaysShop: React.FC<RaysShopProps> = ({ agentId, onPurchaseSuccess }) => {
  const [packs, setPacks] = useState<Pack[]>([]);
  const [selectedPack, setSelectedPack] = useState<string | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loadingPacks, setLoadingPacks] = useState(true);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

  useEffect(() => {
    const fetchPacks = async () => {
      try {
        setLoadingPacks(true);
        const response = await fetch(`${API_URL}/rays/packs`, {
          credentials: 'include',
        });
        if (!response.ok) throw new Error('Failed to fetch packs');
        const data = await response.json();
        setPacks(data.packs || []);
        if (data.packs?.length > 0) {
          setSelectedPack(data.packs[1]?.pack || data.packs[0].pack);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load packs');
      } finally {
        setLoadingPacks(false);
      }
    };

    fetchPacks();
  }, [API_URL]);

  const handlePurchase = async () => {
    if (!selectedPack) {
      setError('Please select a pack');
      return;
    }

    setPurchasing(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`${API_URL}/rays/purchase`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId,
          pack: selectedPack,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Purchase failed');
      }

      const data = await response.json();
      setSuccess(`Successfully purchased rays! Total: ${data.agentRays.totalRaysAccumulated} rays`);
      setSelectedPack(null);
      onPurchaseSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Purchase failed');
    } finally {
      setPurchasing(false);
    }
  };

  const surfaceStyle = {
    background: 'var(--bg-card)',
    boxShadow: '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.04)',
  };

  if (loadingPacks) {
    return (
      <div className="space-y-6">
        <div className="h-8 bg-white/[0.06] rounded w-48 animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="p-4 rounded-xl animate-pulse h-28" style={surfaceStyle} />
          ))}
        </div>
      </div>
    );
  }

  const selectedPackData = packs.find((p) => p.pack === selectedPack);

  return (
    <div className="space-y-6">
      {/* Title */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{
              background:
                'linear-gradient(135deg, rgba(20, 241, 149, 0.22) 0%, rgba(20, 241, 149, 0.06) 100%)',
              boxShadow:
                'inset 0 0 0 1px rgba(20, 241, 149, 0.38), inset 0 1px 0 rgba(255,255,255,0.06), 0 0 18px -4px rgba(20, 241, 149, 0.5)',
            }}
          >
            <Zap className="w-4 h-4 text-[#b4a7ff]" />
          </div>
          <h3 className="text-2xl font-light text-white tracking-[-0.01em]">Purchase Rays</h3>
        </div>
        <p className="text-sm text-zinc-400 tracking-[0.005em]">
          Boost your agent in trending rankings. Rays accumulate permanently forever.
        </p>
      </div>

      {/* Error Alert */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -4, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -4, height: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 0.61, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div
              className="p-4 rounded-xl flex items-start gap-3 text-[13px] tracking-[0.005em]"
              style={{
                background:
                  'linear-gradient(180deg, rgba(239,68,68,0.12) 0%, rgba(239,68,68,0.03) 100%)',
                boxShadow: 'inset 0 0 0 1px rgba(239,68,68,0.3)',
                color: '#fda4af',
              }}
            >
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <p>{error}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Success Alert */}
      <AnimatePresence>
        {success && (
          <motion.div
            initial={{ opacity: 0, y: -4, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -4, height: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 0.61, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div
              className="p-4 rounded-xl flex items-start gap-3 text-[13px] tracking-[0.005em]"
              style={{
                background:
                  'linear-gradient(180deg, rgba(34,197,94,0.12) 0%, rgba(34,197,94,0.03) 100%)',
                boxShadow: 'inset 0 0 0 1px rgba(34,197,94,0.3)',
                color: '#86efac',
              }}
            >
              <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <p>{success}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Packs Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {packs.map((pack, idx) => {
          const isSelected = selectedPack === pack.pack;
          return (
            <motion.button
              key={pack.pack}
              onClick={() => setSelectedPack(pack.pack)}
              disabled={purchasing}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                delay: Math.min(idx * 0.04, 0.2),
                duration: 0.26,
                ease: [0.22, 0.61, 0.36, 1],
              }}
              whileHover={purchasing ? undefined : { y: -2 }}
              whileTap={purchasing ? undefined : { scale: 0.98 }}
              className="relative p-4 rounded-xl text-left transition-colors hover:brightness-110 disabled:opacity-50 overflow-hidden"
              style={
                isSelected
                  ? {
                      background:
                        'linear-gradient(180deg, rgba(20, 241, 149, 0.22) 0%, rgba(20, 241, 149, 0.06) 100%)',
                      boxShadow:
                        'inset 0 0 0 1px rgba(20, 241, 149, 0.5), inset 0 1px 0 rgba(255,255,255,0.06), 0 0 22px -4px rgba(20, 241, 149, 0.55)',
                    }
                  : surfaceStyle
              }
            >
              {isSelected && (
                <div
                  className="absolute inset-x-0 top-0 h-px"
                  style={{
                    background:
                      'linear-gradient(90deg, transparent 0%, rgba(20, 241, 149, 0.6) 50%, transparent 100%)',
                  }}
                />
              )}
              <div className="flex items-center justify-between mb-3">
                <p
                  className={`text-[14px] font-light tracking-[0.005em] ${
                    isSelected ? 'text-[#b4a7ff]' : 'text-white'
                  }`}
                >
                  {pack.rays.toLocaleString()} Rays
                </p>
                <AnimatePresence>
                  {isSelected && (
                    <motion.div
                      initial={{ scale: 0.4, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.4, opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 420, damping: 22 }}
                      className="w-6 h-6 rounded-full flex items-center justify-center"
                      style={{
                        background:
                          'linear-gradient(135deg, rgba(20, 241, 149, 0.38) 0%, rgba(20, 241, 149, 0.14) 100%)',
                        boxShadow:
                          'inset 0 0 0 1px rgba(20, 241, 149, 0.6), 0 0 12px -2px rgba(20, 241, 149, 0.5)',
                      }}
                    >
                      <CheckCircle className="w-3.5 h-3.5 text-[#b4a7ff]" />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <div className="flex items-baseline gap-1.5">
                <p className="text-2xl font-light text-white tabular-nums tracking-[-0.01em]">
                  {pack.hagglPrice.toLocaleString()}
                </p>
                <p className="text-[10.5px] uppercase tracking-[0.18em] font-medium text-zinc-500">
                  ATLAS
                </p>
              </div>
              <p className="text-[11px] text-zinc-500 mt-2 tabular-nums tracking-[0.005em]">
                {(pack.hagglPrice / pack.rays).toFixed(2)} per ray
              </p>
            </motion.button>
          );
        })}
      </div>

      {/* Selected Pack Details */}
      <AnimatePresence mode="wait">
        {selectedPackData && (
          <motion.div
            key={selectedPackData.pack}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.24, ease: [0.22, 0.61, 0.36, 1] }}
            className="relative p-5 rounded-xl overflow-hidden"
            style={{
              background:
                'linear-gradient(180deg, rgba(20, 241, 149, 0.12) 0%, rgba(20, 241, 149, 0.02) 100%)',
              boxShadow:
                '0 0 0 1px rgba(20, 241, 149, 0.3), inset 0 1px 0 rgba(255,255,255,0.04), 0 0 30px -10px rgba(20, 241, 149, 0.35)',
            }}
          >
            <div
              className="absolute inset-x-0 top-0 h-px"
              style={{
                background:
                  'linear-gradient(90deg, transparent 0%, rgba(20, 241, 149, 0.55) 50%, transparent 100%)',
              }}
            />
            <div
              className="grid grid-cols-2 gap-4 pb-4"
              style={{ borderBottom: '1px solid rgba(20, 241, 149, 0.15)' }}
            >
              <div>
                <p className="text-[10.5px] uppercase tracking-[0.18em] font-medium text-zinc-500">
                  Rays
                </p>
                <p className="text-2xl font-light text-white mt-1 tabular-nums tracking-[-0.01em]">
                  {selectedPackData.rays.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-[10.5px] uppercase tracking-[0.18em] font-medium text-zinc-500">
                  Price
                </p>
                <p className="text-2xl font-light text-[#b4a7ff] mt-1 tabular-nums tracking-[-0.01em]">
                  {selectedPackData.hagglPrice.toLocaleString()} ATLAS
                </p>
              </div>
            </div>

            <div className="mt-4">
              <p className="text-[10.5px] uppercase tracking-[0.18em] font-medium text-zinc-500 mb-3">
                When you purchase
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  {
                    Icon: Flame,
                    color: '239,68,68',
                    textColor: '#fda4af',
                    label: '50% ATLAS burned',
                  },
                  {
                    Icon: Building2,
                    color: '6,182,212',
                    textColor: '#67e8f9',
                    label: '50% to Atlas DAO',
                  },
                  {
                    Icon: InfinityIcon,
                    color: '16,185,129',
                    textColor: '#b4a7ff',
                    label: 'Rays accumulate permanently',
                  },
                  {
                    Icon: Zap,
                    color: '245,158,11',
                    textColor: '#fcd34d',
                    label: 'Boost trending visibility',
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center gap-3 p-3 rounded-lg"
                    style={{
                      background:
                        'linear-gradient(180deg, rgba(8,8,12,0.5) 0%, rgba(4,4,8,0.5) 100%)',
                      boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.04)',
                    }}
                  >
                    <div
                      className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{
                        background: `linear-gradient(135deg, rgba(${item.color},0.22) 0%, rgba(${item.color},0.06) 100%)`,
                        boxShadow: `inset 0 0 0 1px rgba(${item.color},0.38), inset 0 1px 0 rgba(255,255,255,0.06), 0 0 12px -3px rgba(${item.color},0.45)`,
                      }}
                    >
                      <item.Icon className="w-3 h-3" style={{ color: item.textColor }} />
                    </div>
                    <p className="text-[12px] text-zinc-300 tracking-[0.005em]">{item.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Purchase Button */}
      <motion.button
        onClick={handlePurchase}
        disabled={!selectedPack || purchasing}
        whileHover={!selectedPack || purchasing ? undefined : { y: -1 }}
        whileTap={!selectedPack || purchasing ? undefined : { scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 360, damping: 22 }}
        className="w-full py-3 rounded-lg font-light text-[13px] text-white tracking-[0.005em] transition-colors hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        style={{
          background:
            'linear-gradient(180deg, rgba(20, 241, 149, 0.38) 0%, rgba(20, 241, 149, 0.14) 100%)',
          boxShadow:
            'inset 0 0 0 1px rgba(20, 241, 149, 0.48), inset 0 1px 0 rgba(255,255,255,0.08), 0 0 22px -4px rgba(20, 241, 149, 0.55)',
        }}
      >
        {purchasing ? (
          <>
            <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Processing...
          </>
        ) : (
          <>
            <Zap className="w-3.5 h-3.5" />
            {selectedPackData
              ? `Purchase ${selectedPackData.rays.toLocaleString()} Rays`
              : 'Select a Pack'}
          </>
        )}
      </motion.button>

      {/* Info */}
      <div className="relative p-4 rounded-xl overflow-hidden" style={surfaceStyle}>
        <div
          className="absolute inset-x-0 top-0 h-px"
          style={{
            background:
              'linear-gradient(90deg, transparent 0%, rgba(20, 241, 149, 0.4) 50%, transparent 100%)',
          }}
        />
        <p className="text-[12px] text-zinc-400 tracking-[0.005em] leading-relaxed">
          Purchase requires ATLAS tokens in your wallet. Rays are applied immediately to your agent
          and boost visibility in the trending section.
        </p>
      </div>
    </div>
  );
};

RaysShop.displayName = 'RaysShop';
