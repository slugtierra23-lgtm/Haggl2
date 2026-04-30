'use client';

export const dynamic = 'force-dynamic';

import { motion } from 'framer-motion';
import { AlertTriangle, ArrowLeft, CheckCircle, Loader2, ShieldCheck, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import React, { Suspense, useCallback, useEffect, useState } from 'react';

import { AmbientGlow, AtlasCard, DotPattern, WordReveal } from '@/components/atlas';
import { MetaMaskIcon, PhantomIcon, WalletConnectIcon } from '@/components/ui/WalletIcons';
import { useAuth } from '@/lib/auth/AuthProvider';
import {
  connectMetaMask,
  connectPhantom,
  getMetaMaskProvider,
  getPhantomProvider,
} from '@/lib/wallet/ethereum';
import { isWalletConnectConfigured, linkWalletConnect } from '@/lib/wallet/walletconnect';

/**
 * Atlas auth page — wallet-only.
 *
 * The previous /auth was a 1,000-line surface with email
 * registration, password strength meters, 2FA, and "forgot
 * password" flows. None of that fits how a Web3 platform should
 * onboard: identity belongs to the wallet, not to a username +
 * password pair.
 *
 * This rewrite cuts the surface down to: connect MetaMask, or
 * WalletConnect on mobile. One signed nonce → JWT → done.
 *
 * Backend email endpoints (/auth/register, /auth/login/email,
 * /auth/password/*, /auth/2fa/*) are NOT removed by this commit —
 * they stay live so any existing email-only accounts keep working.
 * They're just unreachable from the UI; new users are funnelled
 * straight into the wallet path.
 */
function AuthInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, refresh } = useAuth();
  const redirect = searchParams?.get('redirect') ?? '/market';

  const [phase, setPhase] = useState<'idle' | 'connecting' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [hasMM, setHasMM] = useState(false);
  const [hasPH, setHasPH] = useState(false);
  const [hasWC, setHasWC] = useState(false);

  useEffect(() => {
    setHasMM(!!getMetaMaskProvider());
    setHasPH(!!getPhantomProvider());
    setHasWC(isWalletConnectConfigured());
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      router.replace(redirect);
    }
  }, [isAuthenticated, redirect, router]);

  const onConnectMetaMask = useCallback(async () => {
    setError(null);
    setPhase('connecting');
    try {
      // connectMetaMask handles nonce → sign → verify in one call.
      await connectMetaMask();
      setPhase('success');
      await refresh();
      router.replace(redirect);
    } catch (err) {
      setPhase('error');
      setError(err instanceof Error ? err.message : 'Wallet connection failed');
    }
  }, [refresh, redirect, router]);

  const onConnectWC = useCallback(async () => {
    setError(null);
    setPhase('connecting');
    try {
      await linkWalletConnect();
      setPhase('success');
      await refresh();
      router.replace(redirect);
    } catch (err) {
      setPhase('error');
      setError(err instanceof Error ? err.message : 'WalletConnect failed');
    }
  }, [refresh, redirect, router]);

  const onConnectPhantom = useCallback(async () => {
    setError(null);
    setPhase('connecting');
    try {
      await connectPhantom();
      setPhase('success');
      await refresh();
      router.replace(redirect);
    } catch (err) {
      setPhase('error');
      setError(err instanceof Error ? err.message : 'Phantom connection failed');
    }
  }, [refresh, redirect, router]);

  return (
    <div className="min-h-screen relative flex items-center justify-center px-4 py-10 bg-[var(--bg)] text-[var(--text)] overflow-hidden">
      {/* Ambient layered background — matches /market hero treatment so the
          first authenticated surface and the entry surface feel like one app. */}
      <AmbientGlow />
      <DotPattern maskShape="center" />

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative w-full max-w-md"
      >
        <Link
          href="/market"
          className="inline-flex items-center gap-1.5 text-[12px] font-light text-[var(--text-muted)] hover:text-[var(--text)] transition mb-6"
        >
          <ArrowLeft className="w-3 h-3" />
          Back to marketplace
        </Link>

        <AtlasCard variant="default" topAccent tone="brand" innerGradient className="p-7">
          {/* Heading */}
          <div className="flex items-center gap-3 mb-2">
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
              style={{
                background: 'linear-gradient(135deg, var(--brand) 0%, #00C853 100%)',
                boxShadow: '0 4px 14px rgba(20, 241, 149, 0.30)',
              }}
            >
              <Wallet className="w-5 h-5 text-[#062014]" strokeWidth={2} />
            </div>
            <div>
              <h1
                className="font-light text-[var(--text)] leading-tight"
                style={{ fontSize: '22px', letterSpacing: '-0.3px' }}
              >
                <WordReveal>Connect wallet</WordReveal>
              </h1>
              <p
                className="font-light text-[var(--text-muted)] mt-0.5"
                style={{ fontSize: '12.5px' }}
              >
                Sign one short message — no email, no password
              </p>
            </div>
          </div>

          {/* Connect buttons */}
          <div className="mt-6 space-y-2">
            <ConnectButton
              label="MetaMask"
              icon={<MetaMaskIcon size={22} />}
              available={hasMM}
              busy={phase === 'connecting'}
              onClick={onConnectMetaMask}
              cta={!hasMM ? 'Install MetaMask' : undefined}
              installHref={!hasMM ? 'https://metamask.io/download/' : undefined}
            />
            <ConnectButton
              label="Phantom"
              icon={<PhantomIcon size={22} />}
              available={hasPH}
              busy={phase === 'connecting'}
              onClick={onConnectPhantom}
              cta={!hasPH ? 'Install Phantom' : undefined}
              installHref={!hasPH ? 'https://phantom.app/download' : undefined}
            />
            <ConnectButton
              label="WalletConnect (mobile)"
              icon={<WalletConnectIcon size={22} />}
              available={hasWC}
              busy={phase === 'connecting'}
              onClick={onConnectWC}
              cta={!hasWC ? 'Not configured' : undefined}
            />
          </div>

          {phase === 'success' && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 flex items-center gap-2 text-[12px] font-light text-[var(--brand)]"
            >
              <CheckCircle className="w-3.5 h-3.5" />
              Signed in. Redirecting…
            </motion.div>
          )}

          {phase === 'error' && error && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 rounded-lg p-2.5 text-[12px] font-light"
              style={{
                background: 'rgba(248,113,113,0.08)',
                color: '#f87171',
                boxShadow: 'inset 0 0 0 1px rgba(248,113,113,0.25)',
              }}
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            </motion.div>
          )}

          {/* Reassurance */}
          <div className="mt-5 pt-5 text-[11.5px] font-light text-[var(--text-muted)] border-t border-[var(--border)]">
            <div className="flex items-start gap-2">
              <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[var(--brand)]" />
              <p>
                We only read your address and ask you to sign a short message to prove ownership.{' '}
                <strong className="text-[var(--text)] font-normal">
                  haggl never holds your private keys
                </strong>{' '}
                and never asks for a transaction at sign-in.
              </p>
            </div>
          </div>
        </AtlasCard>

        <p className="mt-4 text-center text-[11px] font-light text-[var(--text-muted)]">
          By connecting you accept the{' '}
          <Link href="/terms" className="text-[var(--brand)] hover:brightness-125 transition">
            terms
          </Link>{' '}
          and{' '}
          <Link href="/privacy" className="text-[var(--brand)] hover:brightness-125 transition">
            privacy policy
          </Link>
          .
        </p>
      </motion.div>
    </div>
  );
}

function ConnectButton({
  label,
  icon,
  available,
  busy,
  onClick,
  cta,
  installHref,
}: {
  label: string;
  icon: React.ReactNode;
  available: boolean;
  busy: boolean;
  onClick: () => void;
  cta?: string;
  installHref?: string;
}) {
  const baseClass =
    'group flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 transition-all duration-150 bg-[var(--bg)] border border-[var(--border)] hover:border-[var(--brand)]/45 hover:bg-[var(--bg-elevated)] hover:translate-x-0.5 disabled:opacity-50 disabled:cursor-not-allowed';

  if (!available && installHref) {
    return (
      <a
        href={installHref}
        target="_blank"
        rel="noopener noreferrer"
        className={baseClass + ' text-[var(--text-muted)]'}
      >
        <span className="flex items-center gap-3">
          <span className="grid place-items-center w-6 h-6 shrink-0">{icon}</span>
          <span className="text-[13.5px] font-light">{label}</span>
        </span>
        <span className="text-[11px] font-light text-[var(--brand)] inline-flex items-center gap-1">
          {cta}
          <span className="transition-transform group-hover:translate-x-0.5">→</span>
        </span>
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!available || busy}
      className={baseClass + ' text-[var(--text)]'}
    >
      <span className="flex items-center gap-3">
        <span className="grid place-items-center w-6 h-6 shrink-0">{icon}</span>
        <span className="text-[13.5px] font-light">{label}</span>
      </span>
      {busy ? (
        <Loader2 className="w-4 h-4 animate-spin text-[var(--brand)]" />
      ) : cta ? (
        <span className="text-[11px] font-light text-[var(--text-muted)]">{cta}</span>
      ) : (
        <span className="text-[11.5px] font-light text-[var(--brand)] inline-flex items-center gap-1">
          Sign in
          <span className="transition-transform group-hover:translate-x-0.5">→</span>
        </span>
      )}
    </button>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={null}>
      <AuthInner />
    </Suspense>
  );
}
