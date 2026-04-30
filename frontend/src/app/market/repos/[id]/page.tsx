'use client';

import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FileText,
  GitBranch,
  Globe,
  Lock,
  Package,
  Shield,
  Star,
  Tag,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import React, { useCallback, useEffect, useState } from 'react';

import { PaymentConsentModal, type PaymentMethod } from '@/components/ui/payment-consent-modal';
import { ShareButton } from '@/components/ui/ShareButton';
import { api, ApiError, API_URL } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useFavoriteRepos } from '@/lib/hooks/useFavorites';
import { useWalletPicker } from '@/lib/hooks/useWalletPicker';
import { platformWeiForSeller } from '@/lib/payments/fees';
import {
  encodeErc20Transfer,
  loadHagglTokenConfig,
  usdToTokenUnits,
} from '@/lib/wallet/haggl-token';
import { getMetaMaskProvider } from '@/lib/wallet/ethereum';

// ── Types ──────────────────────────────────────────────────────────────────────

interface RepositoryDetail {
  id: string;
  name: string;
  fullName: string;
  description: string | null;
  language: string | null;
  stars: number;
  forks: number;
  githubUrl: string;
  topics: string[];
  downloadCount: number;
  upvotes: number;
  downvotes: number;
  score: number;
  isPrivate: boolean;
  isLocked: boolean;
  lockedPriceUsd: number | null;
  logoUrl: string | null;
  websiteUrl: string | null;
  twitterUrl: string | null;
  createdAt: string;
  user: {
    id?: string;
    username: string | null;
    displayName?: string | null;
    avatarUrl: string | null;
    walletAddress?: string | null;
  };
}

interface Collaborator {
  id: string;
  name: string;
  type: 'USER' | 'AI_AGENT' | 'PROGRAM';
  role: string | null;
  url: string | null;
  user: {
    id: string;
    username: string | null;
    avatarUrl: string | null;
    reputationPoints: number;
  } | null;
}

interface ConsentState {
  sellerWallet: string;
  buyerAddress: string;
  /** USD the seller takes home (= listing price). Wei is computed at sign time. */
  baseUsd: number;
  /** Whether the ATLAS option should be hidden in the modal. */
  hagglDisabled: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const LANG_COLORS: Record<string, string> = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Python: '#3572A5',
  Go: '#00add8',
  Rust: '#dea584',
  Java: '#b07219',
  Kotlin: '#A97BFF',
  Swift: '#F05138',
  Ruby: '#701516',
  PHP: '#4F5D95',
  'C++': '#f34b7d',
  'C#': '#178600',
  C: '#555555',
  Solidity: '#AA6746',
  Dart: '#00B4AB',
  Shell: '#89e051',
  Bash: '#89e051',
};

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function shortenAddress(addr: string) {
  if (addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function resolveLogoUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('/api')) return `${API_URL.replace('/api/v1', '')}${url}`;
  return url;
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function RepoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { isAuthenticated, user } = useAuth();
  const { pickWallet, pickerElement: walletPicker } = useWalletPicker();

  const [repo, setRepo] = useState<RepositoryDetail | null>(null);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState<ConsentState | null>(null);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [recoverOpen, setRecoverOpen] = useState(false);
  const [recoverTx, setRecoverTx] = useState('');
  const [recoverBusy, setRecoverBusy] = useState(false);
  const [recoverMsg, setRecoverMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [data, collabs] = await Promise.all([
        api.get<RepositoryDetail>(`/repos/${id}`),
        api.get<Collaborator[]>(`/repos/${id}/collaborators`).catch(() => [] as Collaborator[]),
      ]);
      setRepo(data);
      setCollaborators(collabs || []);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setNotFound(true);
      else setError(err instanceof ApiError ? err.message : 'Failed to load repository');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const vote = async (value: 'UP' | 'DOWN') => {
    if (!isAuthenticated || !repo) {
      router.push('/auth');
      return;
    }
    try {
      await api.post(`/repos/${repo.id}/vote`, { value });
      await load();
    } catch {
      setError('Vote failed');
    }
  };

  const download = async () => {
    if (!repo) return;
    try {
      const { downloadUrl } = await api.post<{ downloadUrl: string }>(
        `/repos/${repo.id}/download`,
        {},
      );
      window.open(downloadUrl, '_blank', 'noopener,noreferrer');
    } catch {
      window.open(repo.githubUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const startUnlock = async () => {
    if (!repo || !repo.lockedPriceUsd) return;
    if (!isAuthenticated) {
      router.push('/auth');
      return;
    }
    const sellerWallet = repo.user.walletAddress;
    if (!sellerWallet) {
      setError('Seller has no wallet linked');
      return;
    }
    const ethereum = getMetaMaskProvider();
    if (!ethereum) {
      setError('MetaMask not found');
      return;
    }
    try {
      const buyerAddress = await pickWallet();
      setConsent({
        sellerWallet,
        buyerAddress,
        baseUsd: repo.lockedPriceUsd,
        hagglDisabled: !(await loadHagglTokenConfig()),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not connect to MetaMask';
      setError(msg);
    }
  };

  const executePurchase = async (signature: string, message: string, method: PaymentMethod) => {
    if (!consent || !repo) return;
    const { sellerWallet, buyerAddress, baseUsd } = consent;
    setConsent(null);
    const ethereum = getMetaMaskProvider();
    if (!ethereum) {
      setError('MetaMask not found');
      return;
    }
    const platformWallet = process.env.NEXT_PUBLIC_PLATFORM_WALLET;

    // Compute on-chain amounts now that the method is known. The seller
    // always receives `baseUsd` worth of the chosen currency; the platform
    // fee is added on top so ATLAS (3%) is strictly cheaper for the buyer
    // than SOL (7%).
    const hagglCfg = method === 'ATLAS' ? await loadHagglTokenConfig() : null;
    if (method === 'ATLAS' && !hagglCfg) {
      setError('ATLAS payments are not enabled — please retry with SOL');
      return;
    }

    let sellerWei: bigint;
    let platformWei: bigint;
    try {
      if (hagglCfg) {
        sellerWei = usdToTokenUnits(baseUsd, hagglCfg);
      } else {
        let ethPrice = 2000;
        try {
          const p = await api.get<{ price?: number }>('/chart/eth-price');
          if (p.price) ethPrice = p.price;
        } catch {
          /* fallback */
        }
        sellerWei = BigInt(Math.ceil((baseUsd / ethPrice) * 1e18));
      }
      platformWei = platformWeiForSeller(sellerWei, method);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not compute price');
      return;
    }

    try {
      // Build the seller-payment tx. SOL → plain value transfer. ATLAS →
      // eth_sendTransaction to the token contract with encoded
      // transfer(seller, amount) calldata, value 0.
      let txHash: string;
      if (hagglCfg) {
        txHash = (await ethereum.request({
          method: 'eth_sendTransaction',
          params: [
            {
              from: buyerAddress,
              to: hagglCfg.address,
              data: encodeErc20Transfer(sellerWallet, sellerWei),
              value: '0x0',
            },
          ],
        })) as string;
      } else {
        txHash = (await ethereum.request({
          method: 'eth_sendTransaction',
          params: [{ from: buyerAddress, to: sellerWallet, value: '0x' + sellerWei.toString(16) }],
        })) as string;
      }

      let platformFeeTxHash: string | undefined;
      if (platformWallet) {
        if (hagglCfg) {
          platformFeeTxHash = (await ethereum.request({
            method: 'eth_sendTransaction',
            params: [
              {
                from: buyerAddress,
                to: hagglCfg.address,
                data: encodeErc20Transfer(platformWallet, platformWei),
                value: '0x0',
              },
            ],
          })) as string;
        } else {
          platformFeeTxHash = (await ethereum.request({
            method: 'eth_sendTransaction',
            params: [
              { from: buyerAddress, to: platformWallet, value: '0x' + platformWei.toString(16) },
            ],
          })) as string;
        }
      }
      // Retry the verify POST if the backend reports the tx is still pending.
      // The RPC can lag a few seconds behind wallet confirmation, and we
      // don't want to leave the buyer stranded after money has left their
      // wallet. The backend persists the attempt on first call so even
      // aborted retries won't lose the purchase record.
      const submitPurchase = async (): Promise<{ success: boolean; downloadUrl?: string }> => {
        const maxAttempts = 4;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            return await api.post<{ success: boolean; downloadUrl?: string }>(
              `/repos/${repo.id}/purchase`,
              {
                txHash,
                platformFeeTxHash,
                consentSignature: signature,
                consentMessage: message,
              },
            );
          } catch (err) {
            const apiMsg = err instanceof ApiError ? err.message.toLowerCase() : '';
            const retryable =
              apiMsg.includes('pending') ||
              apiMsg.includes('still') ||
              apiMsg.includes('not found');
            if (!retryable || attempt === maxAttempts) throw err;
            await new Promise((r) => setTimeout(r, 2500 * attempt));
          }
        }
        throw new Error('Verification retry exhausted');
      };

      const result = await submitPurchase();
      if (result.success && result.downloadUrl) {
        window.open(result.downloadUrl, '_blank', 'noopener,noreferrer');
      }
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof ApiError && err.status >= 400) {
        setError(`${err.message}. Your payment was captured — check /orders and retry if needed.`);
      } else {
        setError(
          msg.includes('rejected') ? 'Payment cancelled' : 'Payment failed: ' + msg.slice(0, 80),
        );
      }
    }
  };

  const copyInstall = () => {
    if (!repo) return;
    navigator.clipboard.writeText(`npm install ${repo.name.toLowerCase()}`);
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
  };

  // Recover a stuck payment: the buyer already paid on-chain but the
  // original /purchase call failed (or was made before the verification
  // fix deployed). Re-run verification against the existing tx hash —
  // no new payment is required.
  const submitRecover = async () => {
    if (!repo) return;
    const tx = recoverTx.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(tx)) {
      setRecoverMsg('Invalid tx hash — paste the 0x… hash from your wallet activity');
      return;
    }
    setRecoverBusy(true);
    setRecoverMsg(null);
    try {
      const result = await api.post<{ success: boolean; downloadUrl?: string }>(
        `/repos/${repo.id}/verify`,
        { txHash: tx },
      );
      if (result.success) {
        setRecoverMsg('Verified. Opening your download…');
        if (result.downloadUrl) {
          window.open(result.downloadUrl, '_blank', 'noopener,noreferrer');
        }
        await load();
        setTimeout(() => {
          setRecoverOpen(false);
          setRecoverTx('');
          setRecoverMsg(null);
        }, 1500);
      }
    } catch (err) {
      setRecoverMsg(
        err instanceof ApiError ? err.message : 'Verification failed. Try again in a moment.',
      );
    } finally {
      setRecoverBusy(false);
    }
  };

  if (loading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: 'var(--bg)' }}
      >
        <div className="w-5 h-5 rounded-full border-2 border-zinc-800 border-t-atlas-500 animate-spin" />
      </div>
    );
  }

  if (notFound || !repo) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center gap-4"
        style={{ background: 'var(--bg)' }}
      >
        <p className="text-6xl font-mono text-zinc-800">404</p>
        <p className="text-zinc-400">Repository not found</p>
        <Link
          href="/market/repos"
          className="inline-flex items-center gap-1.5 text-sm text-atlas-300 hover:text-atlas-200"
        >
          <ArrowLeft className="w-4 h-4" /> Back to repositories
        </Link>
      </div>
    );
  }

  const langColor = repo.language ? LANG_COLORS[repo.language] || '#8b949e' : null;
  const logo = resolveLogoUrl(repo.logoUrl);

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      {/* Breadcrumb */}
      <div className="border-b border-white/[0.06] sticky top-0 z-40 backdrop-blur-md bg-black/70">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-2 text-xs text-zinc-500 overflow-x-auto">
          <Link href="/market" className="hover:text-zinc-200 transition-colors">
            Marketplace
          </Link>
          <ChevronRight className="w-3 h-3 text-zinc-700" />
          <Link href="/market/repos" className="hover:text-zinc-200 transition-colors">
            Repositories
          </Link>
          <ChevronRight className="w-3 h-3 text-zinc-700" />
          <span className="text-zinc-300 truncate max-w-md">{repo.name}</span>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Hero */}
        <header className="mb-8 sm:mb-10">
          <div className="flex items-start gap-4 sm:gap-5 flex-wrap">
            {logo ? (
              <img
                src={logo}
                alt={repo.name}
                className="w-14 h-14 rounded-xl object-cover border border-white/10 shrink-0"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            ) : (
              <div
                className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0"
                style={{
                  background:
                    'linear-gradient(135deg, rgba(59,130,246,0.22) 0%, rgba(59,130,246,0.04) 100%)',
                  boxShadow:
                    'inset 0 0 0 1px rgba(59,130,246,0.36), 0 0 28px -6px rgba(59,130,246,0.4)',
                }}
              >
                <GitBranch className="w-6 h-6 text-blue-400" strokeWidth={1.75} />
              </div>
            )}

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2 text-[10.5px] uppercase tracking-[0.18em] font-medium text-zinc-500">
                <span className="text-blue-300">Repository</span>
                {repo.isLocked ? (
                  <>
                    <span className="text-zinc-700">·</span>
                    <span className="inline-flex items-center gap-1.5 text-[#a7f3d0]">
                      <Lock className="w-3 h-3" /> Paid
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-zinc-700">·</span>
                    <span className="inline-flex items-center gap-1.5 text-emerald-300">
                      <Globe className="w-3 h-3" /> Public
                    </span>
                  </>
                )}
              </div>
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-medium text-white tracking-tight leading-tight break-words">
                {repo.name}
              </h1>
              <p className="text-xs font-mono text-zinc-600 mt-1 truncate">{repo.fullName}</p>
              <div className="flex items-center gap-3 mt-3 text-sm text-zinc-400 flex-wrap">
                <Link
                  href={`/u/${repo.user.username || repo.user.id}`}
                  className="inline-flex items-center gap-2 hover:text-white transition-colors"
                >
                  {repo.user.avatarUrl ? (
                    <img
                      src={repo.user.avatarUrl}
                      alt=""
                      className="w-5 h-5 rounded-full object-cover"
                    />
                  ) : (
                    <span className="w-5 h-5 rounded-full bg-zinc-800 border border-white/10 flex items-center justify-center text-[10px] text-zinc-400">
                      {(repo.user.username || 'A').charAt(0).toUpperCase()}
                    </span>
                  )}
                  <span>@{repo.user.username || 'anonymous'}</span>
                </Link>
                {langColor && (
                  <>
                    <span className="text-zinc-700">·</span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded-full" style={{ background: langColor }} />
                      {repo.language}
                    </span>
                  </>
                )}
                <span className="text-zinc-700">·</span>
                <span>Published {timeAgo(repo.createdAt)}</span>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <FavoriteButton repoId={repo.id} />
              <ShareButton title={repo.name} />
              <a
                href={repo.githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-zinc-300 hover:text-white text-[12.5px] transition-all hover:brightness-110"
                style={{
                  background: 'var(--bg-card)',
                  boxShadow:
                    'inset 0 0 0 1px rgba(255,255,255,0.08), inset 0 1px 0 rgba(255,255,255,0.03)',
                }}
              >
                <ExternalLink className="w-3.5 h-3.5" /> GitHub
              </a>
            </div>
          </div>

          {/* Topics */}
          {repo.topics.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-5 sm:ml-[76px]">
              {repo.topics.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs text-zinc-400 bg-white/[0.03] border border-white/[0.06]"
                >
                  <Tag className="w-2.5 h-2.5 text-zinc-600" />
                  {t}
                </span>
              ))}
            </div>
          )}

          {error && (
            <p className="mt-4 text-xs text-red-400 font-mono" role="alert">
              {error}
            </p>
          )}
        </header>

        {/* Body */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-8">
          <main className="space-y-8 min-w-0">
            <Section title="About" icon={FileText}>
              {repo.description ? (
                <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">
                  {repo.description}
                </p>
              ) : (
                <p className="text-sm text-zinc-500 italic">
                  No description provided by the publisher.
                </p>
              )}
            </Section>

            <Section title={`Collaborators (${collaborators.length})`} icon={Users}>
              {collaborators.length === 0 ? (
                <p className="text-sm text-zinc-500 italic">
                  No collaborators listed. Only the publisher has worked on this repo.
                </p>
              ) : (
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {collaborators.map((c) => (
                    <li
                      key={c.id}
                      className="flex items-center gap-3 rounded-xl p-3"
                      style={{
                        background: 'var(--bg-card)',
                        boxShadow:
                          '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.03)',
                      }}
                    >
                      {c.user?.avatarUrl ? (
                        <img
                          src={c.user.avatarUrl}
                          alt=""
                          className="w-9 h-9 rounded-full object-cover"
                        />
                      ) : (
                        <div
                          className="w-9 h-9 rounded-full flex items-center justify-center text-sm text-zinc-200"
                          style={{
                            background:
                              'linear-gradient(135deg, rgba(20, 241, 149, 0.22) 0%, rgba(20, 241, 149, 0.04) 100%)',
                            boxShadow: 'inset 0 0 0 1px rgba(20, 241, 149, 0.32)',
                          }}
                        >
                          {c.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-white truncate">{c.name}</p>
                        <p className="text-[11px] text-zinc-500 truncate">
                          {c.role || c.type.replace('_', ' ').toLowerCase()}
                        </p>
                      </div>
                      {c.url && (
                        <a
                          href={c.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-zinc-500 hover:text-atlas-300 transition-colors"
                          aria-label="Open collaborator link"
                        >
                          <ArrowUpRight className="w-4 h-4" />
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </main>

          <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
            <ActionsCard
              repo={repo}
              onDownload={download}
              onUnlock={startUnlock}
              onRecover={() => setRecoverOpen(true)}
              onVote={vote}
              onCopy={copyInstall}
              copied={copiedCmd}
              isAuthenticated={isAuthenticated}
              isOwner={!!user && repo.user.id === user.id}
            />
            <SellerCard user={repo.user} />
            <StatsCard repo={repo} />
            {(repo.websiteUrl || repo.twitterUrl) && <LinksCard repo={repo} />}
          </aside>
        </div>
      </div>

      {consent && (
        <PaymentConsentModal
          listingTitle={repo.name}
          sellerAddress={consent.sellerWallet}
          baseUsd={consent.baseUsd}
          buyerAddress={consent.buyerAddress}
          hagglDisabled={consent.hagglDisabled}
          onConsent={executePurchase}
          onCancel={() => setConsent(null)}
        />
      )}
      {recoverOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)' }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !recoverBusy) setRecoverOpen(false);
          }}
        >
          <div
            className="w-full max-w-md rounded-xl p-6"
            style={{
              background: 'var(--bg-card)',
              boxShadow: '0 0 0 1px rgba(255,255,255,0.08), 0 20px 40px rgba(0,0,0,0.5)',
            }}
          >
            <h3 className="text-base font-light text-white mb-2">Verify an existing payment</h3>
            <p className="text-xs text-zinc-400 font-light leading-relaxed mb-4">
              Paste the transaction hash of the payment you already sent on Base. We&apos;ll re-run
              on-chain verification against the seller&apos;s wallet — no new payment is required.
            </p>
            <input
              type="text"
              value={recoverTx}
              onChange={(e) => setRecoverTx(e.target.value)}
              placeholder="0x…"
              disabled={recoverBusy}
              className="w-full px-3 py-2 rounded-lg text-[12px] font-mono text-white placeholder:text-zinc-600 focus:outline-none"
              style={{
                background: 'rgba(255,255,255,0.04)',
                boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)',
              }}
            />
            {recoverMsg && (
              <p className="mt-3 text-[11.5px] font-light text-[#b4a7ff]">{recoverMsg}</p>
            )}
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  if (recoverBusy) return;
                  setRecoverOpen(false);
                  setRecoverTx('');
                  setRecoverMsg(null);
                }}
                disabled={recoverBusy}
                className="px-3 py-1.5 rounded-md text-[12px] text-zinc-400 hover:text-white disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={submitRecover}
                disabled={recoverBusy || !recoverTx.trim()}
                className="px-3 py-1.5 rounded-md text-[12px] text-white disabled:opacity-50"
                style={{
                  background:
                    'linear-gradient(180deg, rgba(20, 241, 149, 0.38) 0%, rgba(20, 241, 149, 0.14) 100%)',
                  boxShadow: 'inset 0 0 0 1px rgba(20, 241, 149, 0.48)',
                }}
              >
                {recoverBusy ? 'Verifying…' : 'Verify'}
              </button>
            </div>
          </div>
        </div>
      )}
      {walletPicker}
    </div>
  );
}

// ── Sections ───────────────────────────────────────────────────────────────────

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-4 pb-2.5 border-b border-white/[0.06]">
        <div
          className="w-6 h-6 rounded-md flex items-center justify-center"
          style={{
            background:
              'linear-gradient(135deg, rgba(20, 241, 149, 0.18) 0%, rgba(20, 241, 149, 0.04) 100%)',
            boxShadow: 'inset 0 0 0 1px rgba(20, 241, 149, 0.28)',
          }}
        >
          <Icon className="w-3.5 h-3.5 text-[#b4a7ff]" />
        </div>
        <h2 className="text-[11px] uppercase tracking-[0.18em] font-medium text-zinc-300">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

function ActionsCard({
  repo,
  onDownload,
  onUnlock,
  onRecover,
  onVote,
  onCopy,
  copied,
  isAuthenticated,
  isOwner,
}: {
  repo: RepositoryDetail;
  onDownload: () => void;
  onUnlock: () => void;
  onRecover: () => void;
  onVote: (v: 'UP' | 'DOWN') => void;
  onCopy: () => void;
  copied: boolean;
  isAuthenticated: boolean;
  isOwner?: boolean;
}) {
  // Owners never see the unlock button — they already own the content.
  const locked = repo.isLocked && repo.lockedPriceUsd && !isOwner;
  return (
    <div
      className="relative rounded-xl p-5 overflow-hidden"
      style={{
        background: 'var(--bg-card)',
        boxShadow: '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.03)',
      }}
    >
      <div
        className="absolute inset-x-0 top-0 h-px"
        style={{
          background:
            'linear-gradient(90deg, transparent 0%, rgba(20, 241, 149, 0.45) 50%, transparent 100%)',
        }}
      />
      <p className="text-[10.5px] uppercase tracking-[0.18em] font-medium text-zinc-500 mb-2">
        {locked ? 'Price' : 'Access'}
      </p>
      {locked ? (
        <div className="flex items-baseline gap-2">
          <p className="text-3xl font-light text-white tabular-nums tracking-[-0.01em]">
            ${repo.lockedPriceUsd}
          </p>
          <p className="text-sm text-zinc-500">USD</p>
        </div>
      ) : (
        <p className="text-3xl font-light text-emerald-400 tracking-[-0.01em]">Free</p>
      )}

      {locked ? (
        <>
          <button
            onClick={onUnlock}
            className="w-full mt-4 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-white text-[13px] font-light tracking-[0.005em] transition-all hover:brightness-110"
            style={{
              background:
                'linear-gradient(180deg, rgba(20, 241, 149, 0.38) 0%, rgba(20, 241, 149, 0.14) 100%)',
              boxShadow:
                'inset 0 0 0 1px rgba(20, 241, 149, 0.48), inset 0 1px 0 rgba(255,255,255,0.08), 0 0 22px -4px rgba(20, 241, 149, 0.55)',
            }}
          >
            <Lock className="w-4 h-4" />
            Unlock — choose SOL or ATLAS
          </button>
          <button
            onClick={onRecover}
            className="w-full mt-2 text-[11px] text-zinc-500 hover:text-zinc-300 underline decoration-dotted underline-offset-2"
          >
            Already paid? Verify your transaction
          </button>
        </>
      ) : (
        <button
          onClick={onDownload}
          className="w-full mt-4 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-white text-[13px] font-light tracking-[0.005em] transition-all hover:brightness-110"
          style={{
            background:
              'linear-gradient(180deg, rgba(20, 241, 149, 0.38) 0%, rgba(20, 241, 149, 0.14) 100%)',
            boxShadow:
              'inset 0 0 0 1px rgba(20, 241, 149, 0.48), inset 0 1px 0 rgba(255,255,255,0.08), 0 0 22px -4px rgba(20, 241, 149, 0.55)',
          }}
        >
          <Download className="w-4 h-4" />
          Download
        </button>
      )}

      <button
        onClick={onCopy}
        className="w-full mt-2 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[11.5px] font-mono transition-all"
        style={{
          background: 'rgba(20, 241, 149, 0.07)',
          border: '1px solid rgba(20, 241, 149, 0.15)',
          color: copied ? '#a78bfa' : '#8b8b95',
        }}
      >
        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        {copied ? 'copied!' : `npm install ${repo.name.toLowerCase()}`}
      </button>

      <div className="flex items-center gap-2 mt-4 pt-3 border-t border-white/[0.06]">
        <button
          onClick={() => onVote('UP')}
          disabled={!isAuthenticated}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs text-zinc-400 hover:text-atlas-400 hover:bg-atlas-400/8 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          title={isAuthenticated ? 'Upvote' : 'Sign in to vote'}
        >
          <ArrowUp className="w-3.5 h-3.5" />
          {repo.upvotes}
        </button>
        <button
          onClick={() => onVote('DOWN')}
          disabled={!isAuthenticated}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs text-zinc-400 hover:text-red-400 hover:bg-red-400/8 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          title={isAuthenticated ? 'Downvote' : 'Sign in to vote'}
        >
          <ArrowDown className="w-3.5 h-3.5" />
          {repo.downvotes}
        </button>
      </div>

      {locked && (
        <p className="text-[11px] text-zinc-600 mt-2.5 text-center leading-relaxed">
          <Shield className="inline w-3 h-3 mr-1 -mt-0.5" />
          Base network · Platform fee: 7% (SOL) or 3% (ATLAS).
        </p>
      )}
    </div>
  );
}

function SellerCard({ user }: { user: RepositoryDetail['user'] }) {
  const [copied, setCopied] = useState(false);
  const copyWallet = async () => {
    if (!user.walletAddress) return;
    await navigator.clipboard.writeText(user.walletAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div
      className="relative rounded-xl p-5 overflow-hidden"
      style={{
        background: 'var(--bg-card)',
        boxShadow: '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.03)',
      }}
    >
      <p className="text-[10.5px] uppercase tracking-[0.18em] font-medium text-zinc-500 mb-3">
        Publisher
      </p>
      <div className="flex items-center gap-3">
        {user.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt=""
            className="w-10 h-10 rounded-full object-cover"
            style={{
              boxShadow:
                'inset 0 0 0 1px rgba(20, 241, 149, 0.32), 0 0 16px -4px rgba(20, 241, 149, 0.4)',
            }}
          />
        ) : (
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-sm text-zinc-200"
            style={{
              background:
                'linear-gradient(135deg, rgba(20, 241, 149, 0.22) 0%, rgba(20, 241, 149, 0.04) 100%)',
              boxShadow:
                'inset 0 0 0 1px rgba(20, 241, 149, 0.32), 0 0 16px -4px rgba(20, 241, 149, 0.4)',
            }}
          >
            {(user.username || 'A').charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium text-white truncate">@{user.username || 'anonymous'}</p>
          <div className="flex items-center gap-3 mt-0.5">
            <Link
              href={`/u/${user.username || user.id}`}
              className="text-xs text-atlas-300 hover:text-atlas-200 inline-flex items-center gap-1"
            >
              Profile <ArrowUpRight className="w-3 h-3" />
            </Link>
            {user.username && (
              <Link
                href={`/market/sellers/${user.username}`}
                className="text-xs text-zinc-500 hover:text-zinc-300 inline-flex items-center gap-1"
              >
                Storefront <ArrowUpRight className="w-3 h-3" />
              </Link>
            )}
          </div>
        </div>
      </div>
      {user.walletAddress && (
        <button
          onClick={copyWallet}
          className="w-full mt-3 inline-flex items-center justify-between gap-2 px-3 py-2 rounded-lg transition-all group hover:brightness-110"
          style={{
            background: 'linear-gradient(180deg, rgba(8,8,12,0.6) 0%, rgba(4,4,8,0.6) 100%)',
            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)',
          }}
          title={user.walletAddress}
        >
          <span className="text-[11px] font-mono text-zinc-500 group-hover:text-zinc-300">
            {shortenAddress(user.walletAddress)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Copy className="w-3 h-3 text-zinc-600 group-hover:text-zinc-300" />
            {copied && <span className="text-[10px] text-emerald-400">copied</span>}
          </span>
        </button>
      )}
    </div>
  );
}

function StatsCard({ repo }: { repo: RepositoryDetail }) {
  const stats = [
    { label: 'Stars', value: repo.stars.toLocaleString(), icon: Star },
    { label: 'Forks', value: repo.forks.toLocaleString(), icon: GitBranch },
    { label: 'Downloads', value: repo.downloadCount.toLocaleString(), icon: Download },
    { label: 'Score', value: repo.score.toLocaleString(), icon: Package },
  ];
  return (
    <div
      className="relative rounded-xl p-5 overflow-hidden"
      style={{
        background: 'var(--bg-card)',
        boxShadow: '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.03)',
      }}
    >
      <p className="text-[10.5px] uppercase tracking-[0.18em] font-medium text-zinc-500 mb-3">
        Stats
      </p>
      <dl className="grid grid-cols-2 gap-3">
        {stats.map((s) => (
          <div key={s.label}>
            <dt className="text-[11px] text-zinc-500 flex items-center gap-1.5">
              <s.icon className="w-3 h-3 text-zinc-600" />
              {s.label}
            </dt>
            <dd className="text-lg font-light text-white tabular-nums mt-0.5">{s.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function LinksCard({ repo }: { repo: RepositoryDetail }) {
  return (
    <div
      className="relative rounded-xl p-5 overflow-hidden"
      style={{
        background: 'var(--bg-card)',
        boxShadow: '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.03)',
      }}
    >
      <p className="text-[10.5px] uppercase tracking-[0.18em] font-medium text-zinc-500 mb-3">
        Links
      </p>
      <ul className="space-y-2">
        {repo.websiteUrl && (
          <li>
            <a
              href={repo.websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-xs text-zinc-300 hover:text-atlas-300 transition-colors"
            >
              <Globe className="w-3.5 h-3.5 text-zinc-500" />
              <span className="truncate">{repo.websiteUrl.replace(/^https?:\/\//, '')}</span>
              <ArrowUpRight className="w-3 h-3 ml-auto text-zinc-600" />
            </a>
          </li>
        )}
        {repo.twitterUrl && (
          <li>
            <a
              href={repo.twitterUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-xs text-zinc-300 hover:text-atlas-300 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5 text-zinc-500" />
              <span className="truncate">{repo.twitterUrl.replace(/^https?:\/\//, '')}</span>
              <ArrowUpRight className="w-3 h-3 ml-auto text-zinc-600" />
            </a>
          </li>
        )}
      </ul>
    </div>
  );
}

function FavoriteButton({ repoId }: { repoId: string }) {
  const { has, toggle } = useFavoriteRepos();
  const saved = has(repoId);
  return (
    <button
      type="button"
      onClick={() => toggle(repoId)}
      title={saved ? 'Remove from favorites' : 'Save to favorites'}
      aria-pressed={saved}
      className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[12.5px] transition-all hover:brightness-110"
      style={{
        background: saved
          ? 'linear-gradient(180deg, rgba(236,72,153,0.22) 0%, rgba(236,72,153,0.08) 100%)'
          : 'var(--bg-card)',
        color: saved ? '#f9a8d4' : '#d4d4d8',
        boxShadow: saved
          ? 'inset 0 0 0 1px rgba(236,72,153,0.5), inset 0 1px 0 rgba(255,255,255,0.06)'
          : 'inset 0 0 0 1px rgba(255,255,255,0.08), inset 0 1px 0 rgba(255,255,255,0.04)',
      }}
    >
      <Star
        className="w-3.5 h-3.5"
        fill={saved ? '#EC4899' : 'none'}
        stroke={saved ? '#EC4899' : 'currentColor'}
      />
      {saved ? 'Saved' : 'Save'}
    </button>
  );
}
