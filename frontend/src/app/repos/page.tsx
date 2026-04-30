'use client';

export const dynamic = 'force-dynamic';

import { motion } from 'framer-motion';
import {
  GitBranch,
  Lock,
  Globe,
  Star,
  Download,
  ArrowUp,
  ArrowDown,
  Twitter,
  Wallet,
  Upload,
  X,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import dynamicImport from 'next/dynamic';
import Link from 'next/link';
import React, { useState, useEffect, useCallback, useRef } from 'react';

import { ActionSearchBar, Action } from '@/components/ui/action-search-bar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { PaymentConsentModal, type PaymentMethod } from '@/components/ui/payment-consent-modal';

// three.js is ~150 kB minified. Defer it off the critical path so the first
// render of /repos doesn't wait on the background decoration.
const DottedSurface = dynamicImport(
  () => import('@/components/ui/dotted-surface').then((m) => m.DottedSurface),
  { ssr: false },
);
import { api, ApiError } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useKeyboardFocus } from '@/lib/hooks/useKeyboardFocus';
import { useWalletPicker } from '@/lib/hooks/useWalletPicker';
import { platformWeiForSeller } from '@/lib/payments/fees';
import {
  encodeErc20Transfer,
  loadHagglTokenConfig,
  usdToTokenUnits,
} from '@/lib/wallet/haggl-token';
import { getMetaMaskProvider } from '@/lib/wallet/ethereum';

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

interface Repository {
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
  user: { username: string | null; avatarUrl: string | null };
  collaborators?: Collaborator[];
}

// Reputation rank helper (rays-based, matches /components/ui/reputation-badge.tsx)
function getReputationRank(rays: number): { label: string; color: string; badge: string } {
  if (rays >= 2000) return { label: 'Champion', color: '#14F195', badge: 'CMP' };
  if (rays >= 1000) return { label: 'Master', color: '#ec4899', badge: 'MST' };
  if (rays >= 500) return { label: 'Diamond', color: '#38bdf8', badge: 'DIA' };
  if (rays >= 250) return { label: 'Platinum', color: '#14F195', badge: 'PLT' };
  if (rays >= 120) return { label: 'Gold', color: '#f59e0b', badge: 'GLD' };
  if (rays >= 50) return { label: 'Silver', color: '#9ca3af', badge: 'SLV' };
  if (rays >= 25) return { label: 'Bronze', color: '#cd7f32', badge: 'BRZ' };
  return { label: 'Iron', color: '#78716c', badge: 'IRN' };
}

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  description?: string;
  language?: string;
  stargazers_count: number;
  forks_count: number;
  html_url: string;
  clone_url: string;
  topics?: string[];
  private: boolean;
}

const LANGUAGES = [
  'All',
  'TypeScript',
  'JavaScript',
  'Next.js',
  'Node.js',
  'React',
  'Vue',
  'Svelte',
  'Astro',
  'Python',
  'Go',
  'Rust',
  'Java',
  'Kotlin',
  'Swift',
  'Dart',
  'Ruby',
  'PHP',
  'C',
  'C++',
  'C#',
  'Zig',
  'WASM',
  'Elixir',
  'Scala',
  'Haskell',
  'Lua',
  'R',
  'Julia',
  'Solidity',
  'Vyper',
  'Move',
  'Anchor',
  'Cairo',
  'Bash',
  'Shell',
  'YAML',
  'Other',
];
const SORTS = [
  { value: 'recent', label: 'latest' },
  { value: 'votes', label: 'top voted' },
  { value: 'stars', label: 'most starred' },
  { value: 'downloads', label: 'most downloaded' },
];

export default function ReposPage() {
  const { isAuthenticated, user } = useAuth();
  const { pickWallet, pickerElement: walletPicker } = useWalletPicker();
  const [repos, setRepos] = useState<Repository[]>([]);
  const [ghRepos, setGhRepos] = useState<GitHubRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [language, setLanguage] = useState('');
  const [sortBy, setSortBy] = useState<'recent' | 'votes' | 'stars' | 'downloads'>('recent');
  const [showPublish, setShowPublish] = useState(false);
  const [error, setError] = useState('');
  const [publishing, setPublishing] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [lockModal, setLockModal] = useState<{ repo: GitHubRepo } | null>(null);
  const [publishStep, setPublishStep] = useState<1 | 2 | 3>(1);
  const [lockPrice, setLockPrice] = useState('');
  const [lockType, setLockType] = useState<'public' | 'locked'>('public');

  // Logo upload (drag-and-drop)
  const [pubLogoUrl, setPubLogoUrl] = useState('');
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoDragOver, setLogoDragOver] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useKeyboardFocus(searchRef);

  // Branding fields
  const [pubWebsiteUrl, setPubWebsiteUrl] = useState('');
  const [pubTwitterUrl, setPubTwitterUrl] = useState('');

  // Collaborators in publish modal
  const [collaborators, setCollaborators] = useState<
    Array<{
      type: string;
      name: string;
      role: string;
      url: string;
      userId?: string;
      avatarUrl?: string;
      reputationPoints?: number;
    }>
  >([]);
  const [collabSearch, setCollabSearch] = useState('');
  const [collabSearchResults, setCollabSearchResults] = useState<
    Array<{
      id: string;
      username: string;
      displayName: string | null;
      avatarUrl: string | null;
      reputationPoints: number;
    }>
  >([]);
  const [collabType, setCollabType] = useState<'USER' | 'AI_AGENT' | 'PROGRAM'>('USER');
  const [collabName, setCollabName] = useState('');
  const [collabRole, setCollabRole] = useState('');
  const [collabUrl, setCollabUrl] = useState('');
  const [showCollabForm, setShowCollabForm] = useState(false);

  const [consentModal, setConsentModal] = useState<{
    repo: Repository;
    sellerWallet: string;
    buyerAddress: string;
    baseUsd: number;
    hagglDisabled: boolean;
  } | null>(null);

  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const fetchRepos = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ sortBy });
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (language && language !== 'All') params.set('language', language);
      const data = await api.get<{ data: Repository[] }>(`/repos?${params}`);
      setRepos(data.data);
    } catch {
      setError('Failed to load repositories');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, language, sortBy]);

  useEffect(() => {
    fetchRepos();
  }, [fetchRepos]);

  const deleteRepo = async (repoId: string) => {
    setDeletingId(repoId);
    setError('');
    try {
      await api.delete(`/repos/${repoId}`);
      setRepos((prev) => prev.filter((r) => r.id !== repoId));
      setConfirmDeleteId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete repository');
    } finally {
      setDeletingId(null);
    }
  };

  const [ghNeedsReauth, setGhNeedsReauth] = useState(false);
  const [ghNeedsConnect, setGhNeedsConnect] = useState(false);

  const GITHUB_OAUTH_URL = `https://github.com/login/oauth/authorize?client_id=${process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID || ''}&redirect_uri=${encodeURIComponent(process.env.NEXT_PUBLIC_GITHUB_CALLBACK_URL || 'http://localhost:3001/api/v1/auth/github/callback')}&scope=read%3Auser%20repo`;

  const loadGhRepos = async () => {
    setShowPublish(true);
    setGhNeedsReauth(false);
    setGhNeedsConnect(false);
    if (!user?.githubLogin) {
      setGhNeedsConnect(true);
      return;
    }
    try {
      await api.delete('/repos/github/cache').catch(() => {});
      const data = await api.get<GitHubRepo[]>('/repos/github');
      const raw = Array.isArray(data) ? data : [];
      const needsReauth = raw.some((r) => (r as unknown as Record<string, unknown>)._haggl_reauth);
      if (needsReauth) {
        setGhNeedsReauth(true);
        setGhRepos([]);
      } else {
        setGhRepos(raw as GitHubRepo[]);
      }
    } catch {
      setError('Failed to fetch GitHub repos.');
    }
  };

  // Logo upload handler
  const handleLogoUpload = async (file: File) => {
    // Validate file type — only static images
    const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml'];
    if (!allowed.includes(file.type)) {
      setError('Only static images are allowed (PNG, JPG, WebP, SVG). GIFs are not permitted.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Logo image must be under 5 MB.');
      return;
    }
    setLogoUploading(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const result = await api.upload<{ logoUrl: string }>('/repos/upload-logo', formData);
      setPubLogoUrl(result.logoUrl || '');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Logo upload failed');
    } finally {
      setLogoUploading(false);
    }
  };

  // User search for collaborators
  const searchUsers = async (query: string) => {
    if (query.length < 2) {
      setCollabSearchResults([]);
      return;
    }
    try {
      const results = await api.get<any[]>(`/users/search?q=${encodeURIComponent(query)}&limit=5`);
      setCollabSearchResults(Array.isArray(results) ? results : []);
    } catch {
      setCollabSearchResults([]);
    }
  };

  const openLockModal = (repo: GitHubRepo) => {
    setLockModal({ repo });
    setPublishStep(1);
    setLockType('public');
    setLockPrice('');
    setPubLogoUrl('');
    setPubWebsiteUrl('');
    setPubTwitterUrl('');
    setCollaborators([]);
    setShowCollabForm(false);
    setCollabSearch('');
    setCollabSearchResults([]);
  };

  const publishRepo = async (repo: GitHubRepo, isLocked: boolean, lockedPriceUsd?: number) => {
    setPublishing(repo.id);
    setLockModal(null);
    try {
      const publishedRepo = await api.post<{ id: string }>('/repos/publish', {
        id: repo.id,
        name: repo.name,
        full_name: repo.full_name,
        description: repo.description,
        language: repo.language,
        stargazers_count: repo.stargazers_count,
        forks_count: repo.forks_count,
        html_url: repo.html_url,
        clone_url: repo.clone_url,
        topics: repo.topics,
        private: repo.private,
        isLocked,
        lockedPriceUsd: isLocked ? lockedPriceUsd : undefined,
        logoUrl: pubLogoUrl || undefined,
        websiteUrl: pubWebsiteUrl || undefined,
        twitterUrl: pubTwitterUrl || undefined,
      });

      // Add collaborators after publishing
      if (collaborators.length > 0 && publishedRepo?.id) {
        for (const collab of collaborators) {
          try {
            await api.post(`/repos/${publishedRepo.id}/collaborators`, {
              targetUserId: collab.userId || undefined,
              name: collab.name,
              type: collab.type,
              role: collab.role || undefined,
              url: collab.url || undefined,
            });
          } catch {
            /* ignore individual collaborator errors */
          }
        }
      }

      api.invalidate('/repos');
      await fetchRepos();
      setError('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to publish');
    } finally {
      setPublishing(null);
    }
  };

  const confirmPublish = () => {
    if (!lockModal) return;
    const price = lockType === 'locked' ? parseFloat(lockPrice) : undefined;
    if (lockType === 'locked' && (!price || price <= 0)) {
      setError('Enter a valid price in USD');
      return;
    }
    publishRepo(lockModal.repo, lockType === 'locked', price);
  };

  const vote = async (repoId: string, value: 'UP' | 'DOWN') => {
    if (!isAuthenticated) return;
    try {
      await api.post(`/repos/${repoId}/vote`, { value });
      api.invalidate('/repos');
      await fetchRepos();
    } catch {
      setError('Vote failed');
    }
  };

  const download = async (repoId: string, githubUrl: string) => {
    try {
      const { downloadUrl } = await api.post<{ downloadUrl: string }>(
        `/repos/${repoId}/download`,
        {},
      );
      window.open(downloadUrl, '_blank', 'noopener,noreferrer');
    } catch {
      window.open(githubUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const payAndUnlock = async (repo: Repository) => {
    if (!repo.lockedPriceUsd) return;
    let sellerWallet: string | null = null;
    try {
      const details = await api.get<{ user: { walletAddress: string } }>(`/repos/${repo.id}`);
      sellerWallet = details.user?.walletAddress ?? null;
    } catch {
      setError('Could not fetch seller wallet');
      return;
    }
    if (!sellerWallet) {
      setError('Seller has no Solana wallet linked');
      return;
    }
    const ethereum = getMetaMaskProvider();
    if (!ethereum) {
      setError('MetaMask not found');
      return;
    }
    let buyerAddress: string;
    try {
      buyerAddress = await pickWallet();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not connect to MetaMask';
      setError(msg);
      return;
    }
    setConsentModal({
      repo,
      sellerWallet,
      buyerAddress,
      baseUsd: repo.lockedPriceUsd,
      hagglDisabled: !(await loadHagglTokenConfig()),
    });
  };

  const executeRepoPurchase = async (signature: string, message: string, method: PaymentMethod) => {
    if (!consentModal) return;
    const { repo, sellerWallet, buyerAddress, baseUsd } = consentModal;
    setConsentModal(null);
    const ethereum = getMetaMaskProvider();
    if (!ethereum) {
      setError('MetaMask not found');
      return;
    }
    const platformWallet = process.env.NEXT_PUBLIC_PLATFORM_WALLET;

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
          const priceData = await api.get<{ price: number }>('/chart/eth-price');
          if (priceData.price) ethPrice = priceData.price;
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
      const txHash = hagglCfg
        ? ((await ethereum.request({
            method: 'eth_sendTransaction',
            params: [
              {
                from: buyerAddress,
                to: hagglCfg.address,
                data: encodeErc20Transfer(sellerWallet, sellerWei),
                value: '0x0',
              },
            ],
          })) as string)
        : ((await ethereum.request({
            method: 'eth_sendTransaction',
            params: [
              { from: buyerAddress, to: sellerWallet, value: '0x' + sellerWei.toString(16) },
            ],
          })) as string);

      let platformFeeTxHash: string | undefined;
      if (platformWallet) {
        platformFeeTxHash = hagglCfg
          ? ((await ethereum.request({
              method: 'eth_sendTransaction',
              params: [
                {
                  from: buyerAddress,
                  to: hagglCfg.address,
                  data: encodeErc20Transfer(platformWallet, platformWei),
                  value: '0x0',
                },
              ],
            })) as string)
          : ((await ethereum.request({
              method: 'eth_sendTransaction',
              params: [
                {
                  from: buyerAddress,
                  to: platformWallet,
                  value: '0x' + platformWei.toString(16),
                },
              ],
            })) as string);
      }
      const result = await api.post<{ success: boolean; downloadUrl?: string }>(
        `/repos/${repo.id}/purchase`,
        { txHash, platformFeeTxHash, consentSignature: signature, consentMessage: message },
      );
      setError('');
      if (result.success && result.downloadUrl)
        window.open(result.downloadUrl, '_blank', 'noopener,noreferrer');
      api.invalidate('/repos');
      await fetchRepos();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('rejected') || msg.includes('denied')) setError('Payment cancelled');
      else if (err instanceof ApiError) setError(err.message);
      else setError('Payment failed: ' + msg.slice(0, 80));
    }
  };

  // Build ActionSearchBar actions from ghRepos
  const ghRepoActions: Action[] = ghRepos.map((repo) => ({
    id: String(repo.id),
    label: repo.name,
    icon: <GitBranch className="w-4 h-4 text-atlas-400" strokeWidth={1.5} />,
    description: repo.language || '',
    short: repo.private ? 'private' : 'public',
    end: publishing === repo.id ? '...' : 'publish',
  }));

  const handleRepoSelect = (action: Action) => {
    const repo = ghRepos.find((r) => String(r.id) === action.id);
    if (repo) openLockModal(repo);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-10">
      <DottedSurface />

      <div className="mb-10">
        <p className="text-xs font-mono text-atlas-400 uppercase tracking-widest mb-3">
          Repository Showcase
        </p>
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-light text-white mb-1">Explore Repos</h1>
            <p className="text-sm text-zinc-500">
              Community repositories — public &amp; locked. Discover, vote, download.
            </p>
          </div>
          {isAuthenticated && (
            <button
              onClick={loadGhRepos}
              className="flex items-center gap-2 text-sm font-mono font-light px-5 py-2.5 rounded-xl text-white transition-all hover:opacity-90 shrink-0"
              style={{
                background: 'linear-gradient(135deg,#14F195,#00A046)',
                border: '1px solid rgba(20, 241, 149, 0.4)',
              }}
            >
              <Upload className="w-4 h-4" /> Publish repo
            </button>
          )}
        </div>
      </div>

      {/* Controls */}
      <div
        className="border rounded-2xl p-4 mb-6 flex flex-wrap gap-3 items-center"
        style={{ borderColor: 'rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}
      >
        <div className="flex-1 min-w-48 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
          <input
            ref={searchRef}
            type="text"
            placeholder="Search repositories..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl pl-9 pr-14 py-2 text-sm font-mono outline-none transition-colors"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: 'var(--text)',
            }}
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {search ? (
              <button
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="w-6 h-6 rounded flex items-center justify-center text-zinc-500 hover:text-white hover:bg-white/5 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            ) : (
              <kbd className="hidden sm:inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded border border-white/10 bg-white/[0.04] text-[10px] text-zinc-400 font-mono leading-none">
                /
              </kbd>
            )}
          </div>
        </div>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="rounded-xl px-3 py-2 text-sm font-mono outline-none appearance-none cursor-pointer transition-colors"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: 'var(--text)',
          }}
        >
          {LANGUAGES.map((l) => (
            <option key={l} value={l === 'All' ? '' : l}>
              {l}
            </option>
          ))}
        </select>
        <div className="flex gap-1 flex-wrap">
          {SORTS.map((s) => {
            const active = sortBy === s.value;
            return (
              <motion.button
                key={s.value}
                onClick={() => setSortBy(s.value as typeof sortBy)}
                whileTap={{ scale: 0.96 }}
                transition={{ type: 'spring', stiffness: 360, damping: 22 }}
                className={`relative px-3 py-1.5 text-xs font-mono rounded-lg transition-colors ${
                  active ? 'text-atlas-300' : 'text-zinc-600 hover:text-zinc-300'
                }`}
                style={{
                  background: 'transparent',
                  boxShadow: active ? 'none' : 'inset 0 0 0 1px rgba(255,255,255,0.08)',
                }}
              >
                {active && (
                  <motion.span
                    layoutId="repos-sort-pill"
                    transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                    className="absolute inset-0 rounded-lg"
                    style={{
                      background:
                        'linear-gradient(180deg, rgba(20, 241, 149, 0.22) 0%, rgba(20, 241, 149, 0.06) 100%)',
                      boxShadow:
                        'inset 0 0 0 1px rgba(20, 241, 149, 0.4), 0 0 14px -4px rgba(20, 241, 149, 0.45)',
                    }}
                  />
                )}
                <span className="relative z-10">{s.label}</span>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* Publish panel with ActionSearchBar */}
      {showPublish && (
        <div
          className="border border-white/08 rounded-2xl p-5 mb-6"
          style={{ background: 'rgba(255,255,255,0.02)' }}
        >
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-light text-zinc-300">Your GitHub repositories</p>
            <button
              onClick={() => setShowPublish(false)}
              className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              close
            </button>
          </div>
          {/* Wallet not linked warning */}
          {!user?.walletAddress && (
            <div
              className="mb-4 flex items-start gap-3 p-3.5 rounded-xl border border-dashed border-atlas-500/25"
              style={{ background: 'rgba(20, 241, 149, 0.04)' }}
            >
              <Wallet
                className="w-4 h-4 text-atlas-400/60 flex-shrink-0 mt-0.5"
                strokeWidth={1.5}
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-zinc-400 mb-0.5">No MetaMask wallet linked</p>
                <p className="text-xs text-zinc-600 mb-2">
                  To publish locked repos and receive payments, link your wallet first.
                </p>
                <Link
                  href="/profile?tab=wallet"
                  className="inline-flex items-center gap-1 text-xs font-mono text-atlas-400 hover:text-atlas-300 border border-atlas-500/30 hover:bg-atlas-500/10 rounded-lg px-2.5 py-1 transition-colors"
                >
                  <Wallet className="w-3 h-3" strokeWidth={1.5} />
                  Link wallet →
                </Link>
              </div>
            </div>
          )}

          {ghNeedsConnect && (
            <div
              className="mb-4 p-4 border border-atlas-500/20 rounded-xl text-center"
              style={{ background: 'rgba(20, 241, 149, 0.05)' }}
            >
              <p className="text-sm text-zinc-400 mb-3">
                Connect your GitHub account to publish repos.
              </p>
              <a
                href={GITHUB_OAUTH_URL}
                className="inline-block px-4 py-2 rounded-xl border border-atlas-500/30 text-atlas-400 text-xs font-mono hover:bg-atlas-500/10 transition-colors"
              >
                Connect GitHub
              </a>
            </div>
          )}
          {ghNeedsReauth && (
            <div
              className="mb-4 p-4 border border-white/08 rounded-xl text-center"
              style={{ background: 'rgba(255,255,255,0.02)' }}
            >
              <p className="text-sm text-zinc-400 mb-1">Your GitHub token needs to be refreshed.</p>
              <p className="text-xs text-zinc-600 mb-3">Reconnect to access private repos.</p>
              <a
                href={`https://github.com/login/oauth/authorize?client_id=${process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID || ''}&redirect_uri=${encodeURIComponent(process.env.NEXT_PUBLIC_GITHUB_CALLBACK_URL || 'http://localhost:3001/api/v1/auth/github/callback')}&scope=read%3Auser%20repo`}
                className="inline-block px-4 py-2 rounded-xl border border-atlas-500/30 text-atlas-400 text-xs font-mono hover:bg-atlas-500/10 transition-colors"
              >
                Reconnect GitHub
              </a>
            </div>
          )}
          {!ghNeedsConnect && !ghNeedsReauth && (
            <ActionSearchBar
              actions={ghRepoActions}
              placeholder="Search your repos..."
              label="Select a repo to publish"
              onSelect={handleRepoSelect}
            />
          )}
        </div>
      )}

      {/* ── Publish modal ─────────────────────────────────────────────────── */}
      {lockModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm px-4 overflow-y-auto py-8">
          <div className="mk-wizard w-full max-w-md" style={{ margin: 0 }}>
            <div className="mk-wizard__header">
              <div>
                <h3 className="mk-wizard__title">Publish repository</h3>
                <p className="mk-wizard__sub">
                  {lockModal.repo.name}
                  {lockModal.repo.private ? ' · private' : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLockModal(null)}
                className="mk-wizard__close"
                aria-label="Close"
              >
                <X className="w-4 h-4" strokeWidth={1.75} />
              </button>
            </div>

            {/* Step indicator — mirrors the agent-publish wizard so users get
                the same pacing / visual language across publishes. */}
            <div className="mk-wizard__steps" style={{ marginBottom: 20 }}>
              {([1, 2, 3] as const).map((n) => {
                const labels: Record<1 | 2 | 3, string> = {
                  1: 'Access',
                  2: 'Branding',
                  3: 'Review',
                };
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setPublishStep(n)}
                    className={`mk-wizard__step ${publishStep === n ? 'mk-wizard__step--active' : ''} ${publishStep > n ? 'mk-wizard__step--done' : ''}`}
                  >
                    <span className="mk-wizard__step-n">{n}</span>
                    <span className="mk-wizard__step-label">{labels[n]}</span>
                  </button>
                );
              })}
            </div>

            {/* ── STEP 1: Access ───────────────────────────────────────────── */}
            {publishStep === 1 && (
              <>
                <label className="mk-wizard__section-title">Visibility</label>
                <div className="space-y-2 mb-5">
                  <button
                    onClick={() => setLockType('public')}
                    className={`mk-wizard__tile w-full flex items-center gap-3 ${lockType === 'public' ? 'mk-wizard__tile--active' : ''}`}
                  >
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${lockType === 'public' ? 'bg-atlas-500/20' : 'bg-white/05'}`}
                    >
                      <Globe
                        className={`w-4 h-4 ${lockType === 'public' ? 'text-atlas-400' : 'text-zinc-500'}`}
                        strokeWidth={1.5}
                      />
                    </div>
                    <div className="text-left">
                      <div
                        className={`text-sm font-light ${lockType === 'public' ? 'text-atlas-300' : 'text-zinc-400'}`}
                      >
                        Public — Free
                      </div>
                      <div className="text-xs text-zinc-600">Anyone can see and download</div>
                    </div>
                  </button>

                  <button
                    onClick={() => setLockType('locked')}
                    className={`mk-wizard__tile w-full flex items-center gap-3 ${lockType === 'locked' ? 'mk-wizard__tile--active' : ''}`}
                  >
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${lockType === 'locked' ? 'bg-atlas-500/20' : 'bg-white/05'}`}
                    >
                      <Lock
                        className={`w-4 h-4 ${lockType === 'locked' ? 'text-atlas-400' : 'text-zinc-500'}`}
                        strokeWidth={1.5}
                      />
                    </div>
                    <div className="text-left">
                      <div
                        className={`text-sm font-light ${lockType === 'locked' ? 'text-atlas-300' : 'text-zinc-400'}`}
                      >
                        Locked — Paid Access
                      </div>
                      <div className="text-xs text-zinc-600">Users pay to unlock download</div>
                    </div>
                  </button>
                </div>

                {lockType === 'locked' && (
                  <div className="mb-5">
                    <label className="text-xs text-zinc-500 font-mono block mb-1.5">
                      Price (USD)
                    </label>
                    <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 border border-zinc-800 bg-zinc-900/70 focus-within:border-atlas-500/50 transition-colors">
                      <span className="text-zinc-600 font-mono text-sm">$</span>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        placeholder="9.99"
                        value={lockPrice}
                        onChange={(e) => setLockPrice(e.target.value)}
                        className="flex-1 bg-transparent text-white text-sm outline-none placeholder:text-zinc-700"
                      />
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ── STEP 2: Branding ─────────────────────────────────────────── */}
            {publishStep === 2 && (
              <div className="mb-5">
                <p className="text-xs font-mono text-zinc-500 mb-3">Branding (optional)</p>
                <div className="space-y-3">
                  {/* Logo drag-and-drop upload */}
                  <div>
                    <label className="text-xs text-zinc-600 block mb-1.5">Project Logo</label>
                    <input
                      ref={logoInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/jpg,image/webp,image/svg+xml"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleLogoUpload(file);
                      }}
                    />
                    {pubLogoUrl ? (
                      <div
                        className="flex items-center gap-3 p-3 rounded-xl border border-white/08"
                        style={{ background: 'rgba(255,255,255,0.02)' }}
                      >
                        <img
                          src={
                            pubLogoUrl.startsWith('/api')
                              ? `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}${pubLogoUrl}`
                              : pubLogoUrl
                          }
                          alt="logo preview"
                          className="w-10 h-10 rounded-xl object-cover border border-white/10 flex-shrink-0"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-zinc-400 truncate">Logo uploaded</p>
                          <p className="text-xs text-zinc-600">PNG, JPG, WebP or SVG</p>
                        </div>
                        <button
                          onClick={() => setPubLogoUrl('')}
                          className="text-zinc-600 hover:text-red-400 transition-colors flex-shrink-0"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div
                        onDragOver={(e) => {
                          e.preventDefault();
                          setLogoDragOver(true);
                        }}
                        onDragLeave={() => setLogoDragOver(false)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setLogoDragOver(false);
                          const file = e.dataTransfer.files?.[0];
                          if (file) handleLogoUpload(file);
                        }}
                        onClick={() => logoInputRef.current?.click()}
                        className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl border border-dashed cursor-pointer transition-all"
                        style={{
                          borderColor: logoDragOver
                            ? 'rgba(20, 241, 149, 0.6)'
                            : 'rgba(255,255,255,0.12)',
                          background: logoDragOver
                            ? 'rgba(20, 241, 149, 0.08)'
                            : 'rgba(255,255,255,0.015)',
                        }}
                      >
                        {logoUploading ? (
                          <div className="w-4 h-4 rounded-full border-2 border-zinc-700 border-t-atlas-400 animate-spin" />
                        ) : (
                          <Upload className="w-4 h-4 text-zinc-600" strokeWidth={1.5} />
                        )}
                        <span className="text-xs text-zinc-600">
                          {logoUploading ? 'Uploading...' : 'Drag & drop or click to upload'}
                        </span>
                        <span className="text-xs text-zinc-700">
                          PNG, JPG, WebP, SVG · Max 5 MB · No GIFs
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Website */}
                  <div>
                    <label className="text-xs text-zinc-600 block mb-1">Website</label>
                    <input
                      type="url"
                      placeholder="https://your-project.com"
                      value={pubWebsiteUrl}
                      onChange={(e) => setPubWebsiteUrl(e.target.value)}
                      className="w-full rounded-xl px-3 py-2 text-sm bg-zinc-900/70 border border-zinc-800 text-white placeholder:text-zinc-700 outline-none focus:border-atlas-500/50 transition-colors"
                    />
                  </div>

                  {/* Twitter / X */}
                  <div>
                    <label className="text-xs text-zinc-600 block mb-1">X / Twitter</label>
                    <input
                      type="url"
                      placeholder="https://x.com/yourproject"
                      value={pubTwitterUrl}
                      onChange={(e) => setPubTwitterUrl(e.target.value)}
                      className="w-full rounded-xl px-3 py-2 text-sm bg-zinc-900/70 border border-zinc-800 text-white placeholder:text-zinc-700 outline-none focus:border-atlas-500/50 transition-colors"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* ── STEP 3: Collaborators + Review ──────────────────────────── */}
            {publishStep === 3 && (
              <>
                <div
                  className="mb-5 p-3 rounded-xl"
                  style={{
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px solid rgba(255,255,255,0.06)',
                  }}
                >
                  <p className="text-xs font-mono text-zinc-500 mb-2">Summary</p>
                  <div className="space-y-1 text-xs text-zinc-300 font-light">
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-500">Repository</span>
                      <span className="text-white truncate ml-2 font-mono">
                        {lockModal.repo.full_name}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-500">Access</span>
                      <span className="text-white">
                        {lockType === 'locked'
                          ? `Locked · $${lockPrice || '0.00'}`
                          : 'Public · free'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-500">Logo</span>
                      <span className="text-white">{pubLogoUrl ? 'uploaded' : '—'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-500">Website</span>
                      <span className="text-white truncate ml-2">{pubWebsiteUrl || '—'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-500">Twitter / X</span>
                      <span className="text-white truncate ml-2">{pubTwitterUrl || '—'}</span>
                    </div>
                  </div>
                </div>

                <div className="mb-5">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-mono text-zinc-500">Collaborators (optional)</p>
                    <button
                      onClick={() => setShowCollabForm((v) => !v)}
                      className="flex items-center gap-1 text-xs text-atlas-400 hover:text-atlas-300 transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                      Add
                    </button>
                  </div>

                  {collaborators.length > 0 && (
                    <div className="space-y-1.5 mb-3">
                      {collaborators.map((c, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-2 p-2.5 rounded-lg"
                          style={{
                            background: 'rgba(255,255,255,0.03)',
                            border: '1px solid rgba(255,255,255,0.06)',
                          }}
                        >
                          {c.avatarUrl ? (
                            <img
                              src={c.avatarUrl}
                              alt=""
                              className="w-6 h-6 rounded-full object-cover flex-shrink-0"
                            />
                          ) : (
                            <div
                              className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-light"
                              style={{ background: 'rgba(20, 241, 149, 0.2)', color: '#14F195' }}
                            >
                              {c.name.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-zinc-300 truncate">{c.name}</div>
                            {c.role && (
                              <div className="text-xs text-zinc-600 truncate">{c.role}</div>
                            )}
                          </div>
                          <span
                            className="text-xs font-mono px-1.5 py-0.5 rounded"
                            style={{
                              background: 'rgba(20, 241, 149, 0.1)',
                              color: '#14F195',
                              fontSize: '0.6rem',
                            }}
                          >
                            {c.type === 'AI_AGENT' ? 'AI' : c.type === 'PROGRAM' ? 'PROG' : 'USER'}
                          </span>
                          <button
                            onClick={() =>
                              setCollaborators((prev) => prev.filter((_, i) => i !== idx))
                            }
                            className="text-zinc-600 hover:text-red-400 transition-colors flex-shrink-0"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {showCollabForm && (
                    <div
                      className="rounded-xl p-3 space-y-2.5"
                      style={{
                        background: 'rgba(255,255,255,0.02)',
                        border: '1px solid rgba(255,255,255,0.06)',
                      }}
                    >
                      {/* Type selector */}
                      <div className="flex gap-1">
                        {(['USER', 'AI_AGENT', 'PROGRAM'] as const).map((t) => (
                          <button
                            key={t}
                            onClick={() => {
                              setCollabType(t);
                              setCollabSearch('');
                              setCollabSearchResults([]);
                              setCollabName('');
                            }}
                            className="flex-1 py-1.5 text-xs font-mono rounded-lg transition-all"
                            style={{
                              background:
                                collabType === t
                                  ? 'rgba(20, 241, 149, 0.15)'
                                  : 'rgba(255,255,255,0.03)',
                              color: collabType === t ? '#14F195' : 'rgba(161,161,170,0.5)',
                              border:
                                collabType === t
                                  ? '1px solid rgba(20, 241, 149, 0.3)'
                                  : '1px solid rgba(255,255,255,0.06)',
                            }}
                          >
                            {t === 'AI_AGENT' ? 'AI Agent' : t === 'PROGRAM' ? 'Program' : 'User'}
                          </button>
                        ))}
                      </div>

                      {collabType === 'USER' ? (
                        <div className="relative">
                          <div className="flex items-center gap-2 rounded-xl px-3 py-2 border border-zinc-800 bg-zinc-900/70 focus-within:border-atlas-500/50 transition-colors">
                            <Search
                              className="w-3.5 h-3.5 text-zinc-600 flex-shrink-0"
                              strokeWidth={1.5}
                            />
                            <input
                              type="text"
                              placeholder="Search users by username..."
                              value={collabSearch}
                              onChange={(e) => {
                                setCollabSearch(e.target.value);
                                searchUsers(e.target.value);
                              }}
                              className="flex-1 bg-transparent text-white text-xs outline-none placeholder:text-zinc-700"
                            />
                          </div>
                          {collabSearchResults.length > 0 && (
                            <div
                              className="absolute top-full mt-1 left-0 right-0 z-20 rounded-xl overflow-hidden shadow-xl"
                              style={{
                                background: 'var(--bg-card)',
                                border: '1px solid rgba(20, 241, 149, 0.2)',
                              }}
                            >
                              {collabSearchResults.map((u) => {
                                const rank = getReputationRank(u.reputationPoints);
                                return (
                                  <button
                                    key={u.id}
                                    onClick={() => {
                                      if (collaborators.find((c) => c.userId === u.id)) return;
                                      setCollaborators((prev) => [
                                        ...prev,
                                        {
                                          type: 'USER',
                                          name: u.displayName || u.username,
                                          role: collabRole,
                                          url: '',
                                          userId: u.id,
                                          avatarUrl: u.avatarUrl || undefined,
                                          reputationPoints: u.reputationPoints,
                                        },
                                      ]);
                                      setCollabSearch('');
                                      setCollabSearchResults([]);
                                      setShowCollabForm(false);
                                    }}
                                    className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-atlas-500/10 transition-colors text-left"
                                  >
                                    {u.avatarUrl ? (
                                      <img
                                        src={u.avatarUrl}
                                        alt=""
                                        className="w-7 h-7 rounded-full object-cover flex-shrink-0"
                                      />
                                    ) : (
                                      <div
                                        className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-light"
                                        style={{
                                          background: 'rgba(20, 241, 149, 0.2)',
                                          color: '#14F195',
                                        }}
                                      >
                                        {(u.username || 'U')[0].toUpperCase()}
                                      </div>
                                    )}
                                    <div className="flex-1 min-w-0">
                                      <div className="text-xs text-white truncate">
                                        {u.displayName || u.username}
                                      </div>
                                      <div className="text-xs text-zinc-600">@{u.username}</div>
                                    </div>
                                    <span className="text-xs" title={rank.label}>
                                      {rank.badge}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ) : (
                        <>
                          <input
                            type="text"
                            placeholder={
                              collabType === 'AI_AGENT'
                                ? 'AI Agent name (e.g. GPT-4, Claude)'
                                : 'Program name (e.g. Webpack, Docker)'
                            }
                            value={collabName}
                            onChange={(e) => setCollabName(e.target.value)}
                            className="w-full rounded-xl px-3 py-2 text-xs bg-zinc-900/70 border border-zinc-800 text-white placeholder:text-zinc-700 outline-none focus:border-atlas-500/50 transition-colors"
                          />
                          <input
                            type="url"
                            placeholder="Link (optional)"
                            value={collabUrl}
                            onChange={(e) => setCollabUrl(e.target.value)}
                            className="w-full rounded-xl px-3 py-2 text-xs bg-zinc-900/70 border border-zinc-800 text-white placeholder:text-zinc-700 outline-none focus:border-atlas-500/50 transition-colors"
                          />
                        </>
                      )}

                      <input
                        type="text"
                        placeholder="Role / contribution (optional)"
                        value={collabRole}
                        onChange={(e) => setCollabRole(e.target.value)}
                        className="w-full rounded-xl px-3 py-2 text-xs bg-zinc-900/70 border border-zinc-800 text-white placeholder:text-zinc-700 outline-none focus:border-atlas-500/50 transition-colors"
                      />

                      {collabType !== 'USER' && (
                        <button
                          onClick={() => {
                            if (!collabName.trim()) return;
                            setCollaborators((prev) => [
                              ...prev,
                              {
                                type: collabType,
                                name: collabName,
                                role: collabRole,
                                url: collabUrl,
                              },
                            ]);
                            setCollabName('');
                            setCollabRole('');
                            setCollabUrl('');
                            setShowCollabForm(false);
                          }}
                          className="w-full py-2 rounded-xl text-xs font-mono transition-colors"
                          style={{
                            background: 'rgba(20, 241, 149, 0.15)',
                            color: '#14F195',
                            border: '1px solid rgba(20, 241, 149, 0.25)',
                          }}
                        >
                          Add Collaborator
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  if (publishStep > 1) setPublishStep((publishStep - 1) as 1 | 2 | 3);
                  else setLockModal(null);
                }}
                className="mk-wizard__secondary"
              >
                {publishStep > 1 ? 'Back' : 'Cancel'}
              </button>
              {publishStep < 3 ? (
                <button
                  type="button"
                  onClick={() => {
                    if (publishStep === 1 && lockType === 'locked') {
                      const p = parseFloat(lockPrice);
                      if (!p || p <= 0) {
                        setError('Enter a valid price in USD');
                        return;
                      }
                      setError('');
                    }
                    setPublishStep((publishStep + 1) as 1 | 2 | 3);
                  }}
                  className="mk-wizard__primary"
                >
                  Next
                </button>
              ) : (
                <button type="button" onClick={confirmPublish} className="mk-wizard__primary">
                  Publish repository
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {error && <div className="text-red-400 text-xs font-mono mb-4 px-1">{error}</div>}

      {/* Repos Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton h-52 rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {repos.map((repo, idx) => (
            <motion.div
              key={repo.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                delay: Math.min(idx * 0.035, 0.4),
                duration: 0.32,
                ease: [0.22, 0.61, 0.36, 1],
              }}
              whileHover={{ y: -3 }}
            >
              <Card
                className="group flex flex-col overflow-hidden rounded-2xl shadow-lg transition-all duration-200 hover:shadow-[0_0_32px_rgba(20, 241, 149, 0.08)]"
                style={{ border: '1px solid rgba(255,255,255,0.07)', background: 'var(--bg-card)' }}
              >
                {/* Top accent */}
                <div
                  className="h-0.5 w-full"
                  style={{
                    background:
                      'linear-gradient(90deg, rgba(20, 241, 149, 0.6) 0%, rgba(20, 241, 149, 0.1) 100%)',
                  }}
                />
                {/* Cover banner */}
                <div className="relative h-20 w-full overflow-hidden">
                  {repo.logoUrl ? (
                    <img
                      src={repo.logoUrl}
                      alt={repo.name}
                      className="w-full h-full object-cover opacity-40"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : null}
                  <div
                    className="absolute inset-0"
                    style={{
                      background:
                        'linear-gradient(135deg, rgba(20, 241, 149, 0.12) 0%, rgba(99,102,241,0.05) 100%)',
                    }}
                  />
                  {/* Badges overlay */}
                  <div className="absolute top-2 right-2 flex items-center gap-1.5">
                    {repo.isLocked && (
                      <Badge className="rounded-full bg-atlas-500/20 border border-atlas-500/30 px-2 py-0.5 text-xs font-mono text-atlas-400 flex items-center gap-1">
                        <Lock className="w-2.5 h-2.5" strokeWidth={2} /> locked
                      </Badge>
                    )}
                    {repo.language && (
                      <Badge className="rounded-full bg-zinc-800/80 border border-white/10 px-2 py-0.5 text-xs font-mono text-zinc-400">
                        {repo.language}
                      </Badge>
                    )}
                  </div>
                  {/* Author */}
                  <div className="absolute bottom-2 left-3 flex items-center gap-2">
                    {repo.user.avatarUrl ? (
                      <img
                        src={repo.user.avatarUrl}
                        alt={repo.user.username || ''}
                        className="w-5 h-5 rounded-full border border-white/20 object-cover"
                      />
                    ) : (
                      <div className="w-5 h-5 rounded-full bg-atlas-500/20 border border-atlas-500/20 flex items-center justify-center">
                        <span className="text-atlas-400 font-light" style={{ fontSize: '0.5rem' }}>
                          {(repo.user.username || 'U').charAt(0).toUpperCase()}
                        </span>
                      </div>
                    )}
                    <span className="text-zinc-400 text-xs font-mono">@{repo.user.username}</span>
                    {/* Collaborators */}
                    {repo.collaborators && repo.collaborators.length > 0 && (
                      <div className="flex items-center -space-x-1">
                        {repo.collaborators.slice(0, 3).map((c) => (
                          <div
                            key={c.id}
                            className="w-5 h-5 rounded-full border border-zinc-900 overflow-hidden flex items-center justify-center text-xs"
                            style={{ background: 'rgba(20, 241, 149, 0.2)' }}
                            title={c.name}
                          >
                            {c.user?.avatarUrl ? (
                              <img
                                src={c.user.avatarUrl}
                                alt={c.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <span
                                className="text-atlas-400 font-light"
                                style={{ fontSize: '0.45rem' }}
                              >
                                {c.name.charAt(0).toUpperCase()}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <CardContent className="flex-grow p-3 pt-3">
                  {/* Topics */}
                  {!repo.isLocked && repo.topics.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {repo.topics.slice(0, 3).map((t) => (
                        <Badge
                          key={t}
                          className="rounded-full bg-zinc-800/60 border border-white/08 px-2 py-0.5 text-xs font-mono text-zinc-500 hover:text-zinc-300"
                        >
                          {t}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 mb-1">
                    {repo.isLocked && (
                      <Lock className="w-3 h-3 text-atlas-400/60 shrink-0" strokeWidth={1.5} />
                    )}
                    <a
                      href={repo.isLocked ? '#' : repo.githubUrl}
                      target={repo.isLocked ? undefined : '_blank'}
                      rel="noopener noreferrer"
                      className="font-mono font-light text-sm text-atlas-400 hover:text-atlas-300 transition-colors truncate"
                    >
                      {repo.name}
                    </a>
                  </div>
                  {repo.description && (
                    <p className="text-xs text-zinc-500 leading-relaxed line-clamp-2">
                      {repo.isLocked ? '████ ███████ ██████ ████ ██████' : repo.description}
                    </p>
                  )}
                  {/* Stats */}
                  <div className="flex items-center gap-3 text-zinc-600 text-xs font-mono mt-2">
                    <span className="flex items-center gap-1">
                      <Star className="w-3 h-3" strokeWidth={1.5} /> {repo.stars}
                    </span>
                    <span className="flex items-center gap-1">
                      <GitBranch className="w-3 h-3" strokeWidth={1.5} /> {repo.forks}
                    </span>
                    <span className="flex items-center gap-1">
                      <Download className="w-3 h-3" strokeWidth={1.5} /> {repo.downloadCount}
                    </span>
                    {(repo.websiteUrl || repo.twitterUrl) && (
                      <div className="flex items-center gap-1.5 ml-auto">
                        {repo.websiteUrl && (
                          <a
                            href={repo.websiteUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-zinc-600 hover:text-atlas-400 transition-colors"
                          >
                            <Globe className="w-3 h-3" strokeWidth={1.5} />
                          </a>
                        )}
                        {repo.twitterUrl && (
                          <a
                            href={repo.twitterUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-zinc-600 hover:text-atlas-400 transition-colors"
                          >
                            <Twitter className="w-3 h-3" strokeWidth={1.5} />
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>

                <CardFooter className="flex items-center justify-between p-3 pt-0 border-t border-white/[0.06]">
                  <div className="flex items-center gap-0.5">
                    <button
                      onClick={() => vote(repo.id, 'UP')}
                      disabled={!isAuthenticated}
                      className="flex items-center gap-1 px-2 py-1 text-xs font-mono text-atlas-400 hover:bg-atlas-400/10 rounded transition-colors disabled:opacity-30"
                    >
                      <ArrowUp className="w-3 h-3" strokeWidth={2} /> {repo.upvotes}
                    </button>
                    <button
                      onClick={() => vote(repo.id, 'DOWN')}
                      disabled={!isAuthenticated}
                      className="flex items-center gap-1 px-2 py-1 text-xs font-mono text-zinc-500 hover:bg-zinc-500/10 rounded transition-colors disabled:opacity-30"
                    >
                      <ArrowDown className="w-3 h-3" strokeWidth={2} /> {repo.downvotes}
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {repo.isLocked && repo.user.username !== user?.username ? (
                      <button
                        onClick={() => payAndUnlock(repo)}
                        className="text-xs py-1.5 px-3 font-mono font-light text-white rounded-lg transition-all hover:opacity-90"
                        style={{
                          background: 'linear-gradient(135deg,#14F195,#00A046)',
                          border: '1px solid rgba(20, 241, 149, 0.4)',
                        }}
                      >
                        Unlock — ${repo.lockedPriceUsd}
                      </button>
                    ) : (
                      <button
                        onClick={() => download(repo.id, repo.githubUrl)}
                        className="text-xs py-1.5 px-3 font-mono text-atlas-400 border rounded-lg transition-all hover:bg-atlas-500/10"
                        style={{ borderColor: 'rgba(20, 241, 149, 0.25)' }}
                      >
                        Download
                      </button>
                    )}
                    {/* Delete — only for the owner */}
                    {user &&
                      repo.user.username === user.username &&
                      (confirmDeleteId === repo.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => deleteRepo(repo.id)}
                            disabled={deletingId === repo.id}
                            className="text-xs py-1.5 px-2 font-mono text-red-400 border border-dashed border-red-500/40 rounded-lg hover:bg-red-500/10 transition-colors disabled:opacity-50"
                          >
                            {deletingId === repo.id ? '...' : 'confirm'}
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="text-xs py-1.5 px-2 font-mono text-zinc-500 border border-dashed border-white/10 rounded-lg hover:bg-white/05 transition-colors"
                          >
                            cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(repo.id)}
                          className="p-1.5 text-zinc-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                          title="Delete repository"
                        >
                          <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                        </button>
                      ))}
                  </div>
                </CardFooter>
              </Card>
            </motion.div>
          ))}
          {repos.length === 0 && !loading && (
            <div
              className="col-span-3 text-center py-20 border border-dashed rounded-2xl"
              style={{ borderColor: 'rgba(20, 241, 149, 0.15)' }}
            >
              <GitBranch className="w-10 h-10 text-atlas-400/20 mx-auto mb-3" strokeWidth={1} />
              <p className="text-zinc-600 font-mono text-sm">
                No repositories found. Be the first to publish.
              </p>
            </div>
          )}
        </div>
      )}

      {consentModal && (
        <PaymentConsentModal
          listingTitle={consentModal.repo.name}
          sellerAddress={consentModal.sellerWallet}
          baseUsd={consentModal.baseUsd}
          buyerAddress={consentModal.buyerAddress}
          hagglDisabled={consentModal.hagglDisabled}
          onConsent={executeRepoPurchase}
          onCancel={() => setConsentModal(null)}
        />
      )}
      {walletPicker}
    </div>
  );
}
