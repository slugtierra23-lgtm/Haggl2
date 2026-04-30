'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Plus, X, AlertCircle, Shield, Check } from 'lucide-react';
import Image from 'next/image';
import React, { useEffect, useState } from 'react';

interface Integration {
  // Wallet connections live in the dedicated Wallet tab and are deliberately
  // omitted from this section.
  id: string;
  category: 'social' | 'service' | 'security';
  name: string;
  description: string;
  icon?: React.ReactNode;
  connected: boolean;
  connectedAs?: string;
  url?: string;
  lastUsedAt?: string;
  verified?: boolean;
}

interface IntegrationsSectionProps {
  integrations: Integration[];
  onConnect: (id: string) => Promise<void>;
  onDisconnect: (id: string) => Promise<void>;
}

const IntegrationLogo: React.FC<{ id: string }> = ({ id }) => {
  if (id === 'two-factor') {
    return <Shield className="w-6 h-6" />;
  }

  if (id === 'api-keys') {
    return <span className="text-sm font-medium tracking-wider">API</span>;
  }

  const logoMap: Record<string, string> = {
    twitter: '/integrations/X.png',
    discord: '/integrations/discord.png',
    'github-social': '/integrations/github.png',
  };

  const logo = logoMap[id];
  if (!logo) return <span className="text-xl font-light">?</span>;

  return (
    <div className="relative w-7 h-7">
      <Image src={logo} alt={id} fill className="object-contain" unoptimized />
    </div>
  );
};

const getCategoryLabel = (category: string) => {
  const labels = {
    social: 'Social Networks',
    security: 'Security',
    service: 'Services',
  };
  return labels[category as keyof typeof labels] || category;
};

const getCategoryColor = (category: string) => {
  const colors: Record<string, string> = {
    social: '6,182,212',
    security: '239,68,68',
    service: '16,185,129',
  };
  return colors[category] || '16,185,129';
};

export const IntegrationsSection: React.FC<IntegrationsSectionProps> = ({
  integrations,
  onConnect,
  onDisconnect,
}) => {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [twoFASetup, setTwoFASetup] = useState<{ qrCode: string; secret: string } | null>(null);
  const [twoFACode, setTwoFACode] = useState('');

  const handleConnect = async (id: string) => {
    setLoading(id);
    setError(null);
    try {
      if (id === 'two-factor') {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
        const response = await fetch(`${apiUrl}/auth/2fa/enable/request`, {
          method: 'POST',
          credentials: 'include',
        });
        if (!response.ok) throw new Error('Failed to enable 2FA');
        const data = await response.json();
        setTwoFASetup(data);
        setTwoFACode('');
        return;
      }

      await onConnect(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
    } finally {
      setLoading(null);
    }
  };

  const handleTwoFACodeSubmit = async () => {
    if (!twoFACode || twoFACode.length !== 6) {
      setError('Please enter a valid 6-digit code');
      return;
    }

    setLoading('two-factor');
    setError(null);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
      const response = await fetch(`${apiUrl}/auth/2fa/enable`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: twoFACode }),
      });
      if (!response.ok) throw new Error('Invalid authenticator code');
      setTwoFASetup(null);
      setTwoFACode('');
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to verify code');
    } finally {
      setLoading(null);
    }
  };

  const handleDisconnect = async (id: string) => {
    if (!confirm('Unlink this integration?')) return;
    setLoading(id);
    setError(null);
    try {
      if (id === 'two-factor') {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
        const response = await fetch(`${apiUrl}/auth/2fa/disable`, {
          method: 'POST',
          credentials: 'include',
        });
        if (!response.ok) throw new Error('Failed to disable 2FA');
        return;
      }

      await onDisconnect(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setLoading(null);
    }
  };

  const categories = ['social', 'security', 'service'] as const;
  const connectedCount = integrations.filter((i) => i.connected).length;

  useEffect(() => {
    if (!twoFASetup) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && loading !== 'two-factor') {
        setTwoFASetup(null);
        setTwoFACode('');
      }
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [twoFASetup, loading]);

  return (
    <div className="profile-content-card space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-xl font-light text-white">Integrations</h2>
        <p className="text-sm text-gray-400 mt-1 tabular-nums">
          {connectedCount} of {integrations.length} connected
        </p>
      </div>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -6, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -6, height: 0 }}
            transition={{ duration: 0.24, ease: [0.22, 0.61, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div
              className="relative p-4 rounded-lg flex items-start gap-3 overflow-hidden"
              style={{
                background:
                  'linear-gradient(180deg, rgba(239,68,68,0.12) 0%, rgba(239,68,68,0.03) 100%)',
                boxShadow: 'inset 0 0 0 1px rgba(239,68,68,0.3)',
              }}
            >
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-[#fda4af]" />
              <p className="text-[13px] text-[#fda4af] tracking-[0.005em]">{error}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 2FA Setup Modal */}
      <AnimatePresence>
        {twoFASetup && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => {
              if (loading === 'two-factor') return;
              setTwoFASetup(null);
              setTwoFACode('');
            }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 12 }}
              transition={{ type: 'spring', stiffness: 320, damping: 26 }}
              onClick={(e) => e.stopPropagation()}
              className="relative rounded-xl p-8 max-w-md w-full overflow-hidden"
              style={{
                background: 'var(--bg-card)',
                boxShadow:
                  '0 0 0 1px rgba(20, 241, 149, 0.25), inset 0 1px 0 var(--bg-card2), 0 20px 60px -10px rgba(0,0,0,0.5)',
              }}
            >
              <div
                className="absolute inset-x-0 top-0 h-px"
                style={{
                  background:
                    'linear-gradient(90deg, transparent 0%, rgba(20, 241, 149, 0.55) 50%, transparent 100%)',
                }}
              />
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center"
                    style={{
                      background:
                        'linear-gradient(135deg, rgba(20, 241, 149, 0.22) 0%, rgba(20, 241, 149, 0.06) 100%)',
                      boxShadow:
                        'inset 0 0 0 1px rgba(20, 241, 149, 0.38), inset 0 1px 0 var(--bg-card2), 0 0 14px -4px rgba(20, 241, 149, 0.45)',
                    }}
                  >
                    <Shield className="w-4 h-4 text-[#b4a7ff]" />
                  </div>
                  <h3 className="text-lg font-light text-white tracking-[-0.005em]">
                    Set up Google Authenticator
                  </h3>
                </div>
                <motion.button
                  onClick={() => {
                    setTwoFASetup(null);
                    setTwoFACode('');
                  }}
                  whileHover={{ rotate: 90 }}
                  whileTap={{ scale: 0.88 }}
                  transition={{ type: 'spring', stiffness: 320, damping: 20 }}
                  className="text-zinc-400 hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </motion.button>
              </div>

              <div className="space-y-5">
                <div>
                  <p className="text-[13px] text-zinc-300 mb-4 tracking-[0.005em]">
                    Scan this QR code with Google Authenticator or any TOTP app
                  </p>
                  <div className="bg-white p-4 rounded-lg flex justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={twoFASetup.qrCode} alt="2FA QR Code" className="w-48 h-48" />
                  </div>
                </div>

                <div>
                  <p className="text-[10.5px] uppercase tracking-[0.18em] font-medium text-zinc-500 mb-2">
                    Or enter this code manually
                  </p>
                  <code
                    className="block p-3 rounded-lg text-center font-mono text-[12px] text-[#b4a7ff] break-words tracking-[0.005em]"
                    style={{
                      background:
                        'linear-gradient(180deg, rgba(8,8,12,0.8) 0%, rgba(4,4,8,0.8) 100%)',
                      boxShadow: 'inset 0 0 0 1px var(--bg-card2)',
                    }}
                  >
                    {twoFASetup.secret}
                  </code>
                </div>

                <div>
                  <label className="block text-[10.5px] uppercase tracking-[0.18em] font-medium text-zinc-500 mb-2">
                    Enter the 6-digit code
                  </label>
                  <input
                    type="text"
                    maxLength={6}
                    pattern="\d{6}"
                    value={twoFACode}
                    onChange={(e) => setTwoFACode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    className="w-full px-3 py-3 rounded-lg text-white text-center text-2xl tracking-[0.3em] font-mono focus:outline-none transition-all focus:brightness-110"
                    style={{
                      background:
                        'linear-gradient(180deg, rgba(8,8,12,0.8) 0%, rgba(4,4,8,0.8) 100%)',
                      boxShadow: 'inset 0 0 0 1px var(--bg-card2)',
                    }}
                  />
                </div>

                <motion.button
                  onClick={handleTwoFACodeSubmit}
                  disabled={loading === 'two-factor' || twoFACode.length !== 6}
                  whileHover={
                    loading === 'two-factor' || twoFACode.length !== 6 ? undefined : { y: -1 }
                  }
                  whileTap={
                    loading === 'two-factor' || twoFACode.length !== 6 ? undefined : { scale: 0.97 }
                  }
                  transition={{ type: 'spring', stiffness: 360, damping: 22 }}
                  className="w-full px-4 py-2.5 text-white rounded-lg font-light text-[13px] tracking-[0.005em] transition-all hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{
                    background:
                      'linear-gradient(180deg, rgba(20, 241, 149, 0.38) 0%, rgba(20, 241, 149, 0.14) 100%)',
                    boxShadow:
                      'inset 0 0 0 1px rgba(20, 241, 149, 0.48), inset 0 1px 0 var(--bg-card2), 0 0 22px -4px rgba(20, 241, 149, 0.55)',
                  }}
                >
                  {loading === 'two-factor' ? 'Verifying...' : 'Verify and Enable'}
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Categories */}
      <div className="space-y-8">
        {categories.map((category) => {
          const categoryIntegrations = integrations.filter((i) => i.category === category);
          if (categoryIntegrations.length === 0) return null;
          const catColor = getCategoryColor(category);

          return (
            <div key={category} className="space-y-4">
              {/* Category Header */}
              <div className="flex items-center gap-3 px-1">
                <div
                  className="h-[1px] flex-shrink-0 w-6"
                  style={{
                    background: `linear-gradient(90deg, transparent 0%, rgba(${catColor},0.5) 100%)`,
                  }}
                />
                <h3 className="text-[10.5px] uppercase tracking-[0.18em] font-medium text-zinc-400">
                  {getCategoryLabel(category)}
                </h3>
                <div
                  className="h-[1px] flex-1"
                  style={{
                    background: `linear-gradient(90deg, rgba(${catColor},0.3) 0%, transparent 100%)`,
                  }}
                />
              </div>

              {/* Integration Cards Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {categoryIntegrations.map((integration, idx) => (
                  <motion.div
                    key={integration.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      delay: Math.min(idx * 0.04, 0.25),
                      duration: 0.28,
                      ease: [0.22, 0.61, 0.36, 1],
                    }}
                    whileHover={{ y: -3 }}
                    className="relative p-4 rounded-xl flex flex-col items-center text-center overflow-hidden transition-colors hover:brightness-110"
                    style={{
                      background: integration.connected
                        ? `linear-gradient(180deg, rgba(${catColor},0.12) 0%, rgba(${catColor},0.02) 100%)`
                        : 'var(--bg-card)',
                      boxShadow: integration.connected
                        ? `inset 0 0 0 1px rgba(${catColor},0.32), inset 0 1px 0 var(--bg-card2), 0 0 24px -8px rgba(${catColor},0.35)`
                        : '0 0 0 1px var(--bg-card2), inset 0 1px 0 var(--bg-card2)',
                    }}
                  >
                    <div
                      className="absolute inset-x-0 top-0 h-px"
                      style={{
                        background: `linear-gradient(90deg, transparent 0%, rgba(${catColor},${integration.connected ? 0.55 : 0.3}) 50%, transparent 100%)`,
                      }}
                    />

                    {/* Connected Indicator */}
                    <AnimatePresence>
                      {integration.connected && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.4 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.4 }}
                          transition={{ type: 'spring', stiffness: 400, damping: 22 }}
                          className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center"
                          style={{
                            background:
                              'linear-gradient(135deg, rgba(34,197,94,0.8) 0%, rgba(34,197,94,0.5) 100%)',
                            boxShadow:
                              'inset 0 0 0 1px rgba(34,197,94,0.6), 0 0 10px -2px rgba(34,197,94,0.6)',
                          }}
                        >
                          <Check className="w-3 h-3 text-white" strokeWidth={3} />
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Logo */}
                    <div
                      className="w-14 h-14 rounded-xl mb-3 flex items-center justify-center"
                      style={{
                        background: integration.connected
                          ? `linear-gradient(135deg, rgba(${catColor},0.22) 0%, rgba(${catColor},0.06) 100%)`
                          : 'linear-gradient(135deg, rgba(40,40,48,0.7) 0%, var(--bg-card) 100%)',
                        boxShadow: integration.connected
                          ? `inset 0 0 0 1px rgba(${catColor},0.38), inset 0 1px 0 var(--bg-card2), 0 0 18px -4px rgba(${catColor},0.45)`
                          : 'inset 0 0 0 1px var(--bg-card2), inset 0 1px 0 var(--bg-card2)',
                        color: integration.connected ? `rgb(${catColor})` : 'var(--text-secondary)',
                      }}
                    >
                      <IntegrationLogo id={integration.id} />
                    </div>

                    {/* Name */}
                    <h4 className="text-[14px] font-light text-white mb-1 tracking-[0.005em]">
                      {integration.name}
                    </h4>

                    {/* Status */}
                    {integration.connected ? (
                      <p
                        className="text-[10.5px] uppercase tracking-[0.18em] font-medium mb-2"
                        style={{ color: `rgb(${catColor})` }}
                      >
                        Active
                      </p>
                    ) : (
                      <p className="text-[10.5px] uppercase tracking-[0.18em] font-medium text-zinc-500 mb-2">
                        Not connected
                      </p>
                    )}

                    {/* Connected As */}
                    {integration.connectedAs && (
                      <p className="text-xs text-zinc-500 mb-3 truncate w-full font-mono tracking-[0.005em]">
                        {integration.connectedAs.length > 20
                          ? integration.connectedAs.slice(0, 17) + '...'
                          : integration.connectedAs}
                      </p>
                    )}

                    {/* Action Button */}
                    <motion.button
                      onClick={() =>
                        integration.connected
                          ? handleDisconnect(integration.id)
                          : handleConnect(integration.id)
                      }
                      disabled={loading === integration.id}
                      whileHover={loading === integration.id ? undefined : { y: -1 }}
                      whileTap={loading === integration.id ? undefined : { scale: 0.96 }}
                      transition={{ type: 'spring', stiffness: 360, damping: 22 }}
                      className="w-full py-2 px-3 rounded-lg text-[12px] font-light tracking-[0.005em] transition-colors hover:brightness-110 flex items-center justify-center gap-1.5 mt-auto disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{
                        background: integration.connected
                          ? `linear-gradient(180deg, rgba(${catColor},0.22) 0%, rgba(${catColor},0.06) 100%)`
                          : 'linear-gradient(180deg, rgba(40,40,48,0.7) 0%, var(--bg-card) 100%)',
                        boxShadow: integration.connected
                          ? `inset 0 0 0 1px rgba(${catColor},0.38), inset 0 1px 0 var(--bg-card2)`
                          : 'inset 0 0 0 1px var(--bg-card2), inset 0 1px 0 var(--bg-card2)',
                        color: integration.connected ? `rgb(${catColor})` : 'var(--text)',
                      }}
                    >
                      {loading === integration.id ? (
                        <>
                          <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                          <span>{integration.connected ? 'Unlinking...' : 'Connecting...'}</span>
                        </>
                      ) : integration.connected ? (
                        <>
                          <X className="w-3.5 h-3.5" />
                          Unlink
                        </>
                      ) : (
                        <>
                          <Plus className="w-3.5 h-3.5" />
                          Connect
                        </>
                      )}
                    </motion.button>
                  </motion.div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Security Notice */}
      <div
        className="relative p-4 rounded-xl overflow-hidden"
        style={{
          background:
            'linear-gradient(180deg, rgba(20, 241, 149, 0.08) 0%, rgba(20, 241, 149, 0.02) 100%)',
          boxShadow: 'inset 0 0 0 1px rgba(20, 241, 149, 0.28), inset 0 1px 0 var(--bg-card2)',
        }}
      >
        <div
          className="absolute inset-x-0 top-0 h-px"
          style={{
            background:
              'linear-gradient(90deg, transparent 0%, rgba(20, 241, 149, 0.45) 50%, transparent 100%)',
          }}
        />
        <div className="flex items-start gap-3">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{
              background:
                'linear-gradient(135deg, rgba(20, 241, 149, 0.22) 0%, rgba(20, 241, 149, 0.06) 100%)',
              boxShadow:
                'inset 0 0 0 1px rgba(20, 241, 149, 0.38), inset 0 1px 0 var(--bg-card2), 0 0 14px -4px rgba(20, 241, 149, 0.45)',
            }}
          >
            <Shield className="w-3.5 h-3.5 text-[#b4a7ff]" />
          </div>
          <p className="text-[12px] text-zinc-300 tracking-[0.005em] leading-relaxed">
            <span className="text-[#b4a7ff] font-medium">Security:</span> Only connect integrations
            you trust. Review and remove unused connections regularly.
          </p>
        </div>
      </div>
    </div>
  );
};

IntegrationsSection.displayName = 'IntegrationsSection';
