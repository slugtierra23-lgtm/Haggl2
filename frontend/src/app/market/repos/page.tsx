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
  ChevronDown,
  Trash2,
  Plus,
  Users,
  Wallet,
  X,
  Upload,
  Search,
  CheckCircle2,
  Copy,
  Check,
} from 'lucide-react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import React, { Suspense, useState, useEffect, useCallback, useRef } from 'react';

import { ActionSearchBar, Action } from '@/components/ui/action-search-bar';
import { Badge } from '@/components/ui/badge';
import { PaymentConsentModal, type PaymentMethod } from '@/components/ui/payment-consent-modal';
import { api, ApiError, API_URL } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/AuthProvider';
import { getCachedWithStatus, setCached } from '@/lib/cache/pageCache';
import { useKeyboardFocus } from '@/lib/hooks/useKeyboardFocus';
import { useWalletPicker } from '@/lib/hooks/useWalletPicker';
import { platformWeiForSeller } from '@/lib/payments/fees';
import {
  encodeErc20Transfer,
  loadHagglTokenConfig,
  usdToTokenUnits,
} from '@/lib/wallet/haggl-token';
import { getMetaMaskProvider } from '@/lib/wallet/ethereum';

// ── Types ──────────────────────────────────────────────────────────────────────

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
  user: { id?: string; username: string | null; avatarUrl: string | null };
  collaborators?: Collaborator[];
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

// ── Constants ──────────────────────────────────────────────────────────────────

const LANGUAGES = [
  'All',
  'TypeScript',
  'JavaScript',
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
  'Solidity',
  'Move',
  'Anchor',
  'Bash',
  'Shell',
  'Other',
];
const SORTS = [
  { value: 'recent', label: 'latest' },
  { value: 'votes', label: 'top voted' },
  { value: 'stars', label: 'most starred' },
  { value: 'downloads', label: 'most downloaded' },
];
const GITHUB_OAUTH_URL = `https://github.com/login/oauth/authorize?client_id=${process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID || ''}&redirect_uri=${encodeURIComponent(process.env.NEXT_PUBLIC_GITHUB_CALLBACK_URL || 'http://localhost:3001/api/v1/auth/github/callback')}&scope=read%3Auser%20repo`;

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// Language color dots — GitHub style
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
  Move: '#4a9eda',
  Anchor: '#9945FF',
};

function LanguageDot({ lang }: { lang: string }) {
  const color = LANG_COLORS[lang] || '#8b949e';
  return (
    <span className="flex items-center gap-1.5 text-xs text-[#8b949e]">
      <span className="w-3 h-3 rounded-full shrink-0" style={{ background: color }} />
      {lang}
    </span>
  );
}

function CopyInstallButton({ name }: { name: string }) {
  const [copied, setCopied] = useState(false);
  const cmd = `npm install ${name.toLowerCase()}`;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(cmd);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      title={`Copy: ${cmd}`}
      className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-mono transition-all"
      style={{
        background: 'rgba(20, 241, 149, 0.07)',
        border: '1px solid rgba(20, 241, 149, 0.15)',
        color: copied ? '#a78bfa' : '#6b7280',
      }}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? 'copied!' : 'npm i'}
    </button>
  );
}

function RepoCard({
  repo,
  isAuthenticated,
  userId,
  onVote,
  onDownload,
  onUnlock,
}: {
  repo: Repository;
  isAuthenticated: boolean;
  userId?: string;
  onVote: (id: string, v: 'UP' | 'DOWN') => void;
  onDownload: (id: string, url: string) => void;
  onUnlock: (repo: Repository) => void;
}) {
  const isOwner = !!userId && repo.user.id === userId;
  return (
    <div className="group relative flex flex-col rounded-2xl overflow-hidden transition-all duration-200 bg-[var(--bg-card)] border border-[var(--border)] shadow-[var(--shadow-card)] hover:border-[var(--border-hover)] hover:shadow-[var(--shadow-card-hover)] hover:-translate-y-[2px]">
      {/* Top hairline accent on hover */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px opacity-0 group-hover:opacity-60 transition-opacity duration-300"
        style={{
          background: 'linear-gradient(90deg, transparent 0%, var(--brand) 50%, transparent 100%)',
        }}
      />
      <Link
        href={`/market/repos/${repo.id}`}
        onMouseEnter={() => api.prefetch([`/repos/${repo.id}`])}
        className="p-4 flex-1 block"
      >
        {/* Repo header */}
        <div className="flex items-start gap-3 mb-3">
          {repo.logoUrl ? (
            <img
              src={
                repo.logoUrl.startsWith('/api')
                  ? `${API_URL.replace('/api/v1', '')}${repo.logoUrl}`
                  : repo.logoUrl
              }
              alt={repo.name}
              className="w-9 h-9 rounded-lg object-cover border border-white/10 shrink-0"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <div
              className="w-9 h-9 rounded-lg border border-white/10 flex items-center justify-center shrink-0"
              style={{ background: 'rgba(20, 241, 149, 0.1)' }}
            >
              <GitBranch className="w-4 h-4 text-atlas-400" strokeWidth={1.5} />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <h3 className="text-sm font-light text-atlas-300 hover:text-atlas-200 truncate">
                {repo.name}
              </h3>
              <span
                className={`px-1.5 py-0.5 rounded-full text-[11px] border ${
                  repo.isLocked
                    ? 'bg-atlas-500/10 border-atlas-500/30 text-atlas-400'
                    : 'bg-transparent border-white/10 text-zinc-500'
                }`}
              >
                {repo.isLocked ? 'Paid' : 'Public'}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <p className="text-xs text-zinc-500">@{repo.user.username || 'anon'}</p>
              <span title="Verified developer">
                <CheckCircle2 className="w-3 h-3 text-atlas-400" />
              </span>
            </div>
          </div>
        </div>

        {/* Description */}
        <p className="text-xs text-zinc-400 leading-relaxed line-clamp-2 mb-3 min-h-[2.5rem]">
          {repo.description || (
            <span className="italic text-zinc-600">No description provided.</span>
          )}
        </p>

        {/* Topics */}
        {repo.topics.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {repo.topics.slice(0, 4).map((t) => (
              <span
                key={t}
                className="px-2 py-0.5 rounded-full text-[11px] font-mono bg-atlas-500/10 text-atlas-400 border border-atlas-500/20"
              >
                #{t}
              </span>
            ))}
          </div>
        )}

        {/* Stats row */}
        <div className="flex items-center gap-4 text-xs text-zinc-500">
          {repo.language && <LanguageDot lang={repo.language} />}
          <span className="flex items-center gap-1" title="GitHub Stars">
            <Star className="w-3 h-3" />
            {repo.stars}
          </span>
          <span className="flex items-center gap-1" title="Forks">
            <GitBranch className="w-3 h-3" />
            {repo.forks}
          </span>
          <span className="flex items-center gap-1" title="Downloads">
            <Download className="w-3 h-3" />
            {repo.downloadCount}
          </span>
        </div>
      </Link>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)]">
        <div className="flex items-center gap-1">
          <button
            onClick={() => isAuthenticated && onVote(repo.id, 'UP')}
            className="flex items-center gap-1 px-2 py-1 rounded-full text-xs text-zinc-500 hover:text-atlas-400 hover:bg-atlas-400/8 transition-all disabled:opacity-50"
            disabled={!isAuthenticated}
            title="Upvote"
          >
            <ArrowUp className="w-3.5 h-3.5" />
            {repo.upvotes}
          </button>
          <button
            onClick={() => isAuthenticated && onVote(repo.id, 'DOWN')}
            className="flex items-center gap-1 px-2 py-1 rounded-full text-xs text-zinc-500 hover:text-red-400 hover:bg-red-400/8 transition-all disabled:opacity-50"
            disabled={!isAuthenticated}
            title="Downvote"
          >
            <ArrowDown className="w-3.5 h-3.5" />
            {repo.downvotes}
          </button>
          <CopyInstallButton name={repo.name} />
        </div>
        <div>
          {repo.isLocked && repo.lockedPriceUsd && !isOwner ? (
            <button
              onClick={() => onUnlock(repo)}
              className="px-3 py-1.5 rounded-full text-xs font-light text-white transition-all hover:shadow-[0_0_12px_rgba(20, 241, 149, 0.4)]"
              style={{
                background: 'linear-gradient(135deg,#00A046,#6d28d9)',
                border: '1px solid rgba(20, 241, 149, 0.4)',
              }}
            >
              Unlock — ${repo.lockedPriceUsd}
            </button>
          ) : (
            <button
              onClick={() => onDownload(repo.id, repo.githubUrl)}
              className="px-3 py-1.5 rounded-full text-xs font-light transition-all hover:border-atlas-500/40"
              style={{
                background: 'rgba(20, 241, 149, 0.08)',
                border: '1px solid rgba(20, 241, 149, 0.2)',
                color: '#a7f3d0',
              }}
            >
              Download
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── My Repo Card (publications) ────────────────────────────────────────────────

function MyRepoCard({ repo, onDelete }: { repo: Repository; onDelete: (id: string) => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [showCollabs, setShowCollabs] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    setDeleteError('');
    try {
      await api.delete(`/repos/${repo.id}`);
      onDelete(repo.id);
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : 'Failed to delete');
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div
      className="rounded-xl border transition-colors"
      style={{
        borderColor: showCollabs ? 'rgba(20, 241, 149, 0.2)' : 'rgba(255,255,255,0.07)',
        background: 'var(--bg-card)',
      }}
    >
      <div className="flex items-center gap-3 p-3">
        {/* Logo / icon */}
        <div
          className="w-9 h-9 rounded-lg overflow-hidden shrink-0 flex items-center justify-center border border-white/10"
          style={{ background: 'rgba(255,255,255,0.04)' }}
        >
          {repo.logoUrl ? (
            <img
              src={
                repo.logoUrl.startsWith('/api')
                  ? `${API_URL.replace('/api/v1', '')}${repo.logoUrl}`
                  : repo.logoUrl
              }
              alt={repo.name}
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <GitBranch className="w-4 h-4 text-zinc-600" strokeWidth={1.5} />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-light text-zinc-100 truncate">{repo.name}</h3>
            {repo.isLocked && (
              <Badge
                className="rounded-full px-2 py-0 text-xs font-mono"
                style={{
                  background: 'rgba(20, 241, 149, 0.12)',
                  border: '1px solid rgba(20, 241, 149, 0.25)',
                  color: '#a78bfa',
                }}
              >
                locked ${repo.lockedPriceUsd}
              </Badge>
            )}
            {repo.isPrivate && (
              <Badge className="rounded-full bg-zinc-800/50 border border-white/06 px-2 py-0 text-xs font-mono text-zinc-600">
                private
              </Badge>
            )}
          </div>
          <p className="text-xs text-zinc-600 font-mono mt-0.5">
            <span className="flex items-center gap-3 flex-wrap">
              <span className="flex items-center gap-1">
                <Star className="w-2.5 h-2.5" />
                {repo.stars}
              </span>
              <span className="flex items-center gap-1">
                <Download className="w-2.5 h-2.5" />
                {repo.downloadCount}
              </span>
              <span className="flex items-center gap-1">
                <ArrowUp className="w-2.5 h-2.5 text-atlas-400" />
                {repo.upvotes}
              </span>
              {(repo.collaborators?.length ?? 0) > 0 && (
                <span className="flex items-center gap-1">
                  <Users className="w-2.5 h-2.5" />
                  {repo.collaborators?.length} collab{repo.collaborators!.length !== 1 ? 's' : ''}
                </span>
              )}
            </span>
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <a
            href={repo.githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-mono px-2.5 py-1.5 rounded-lg text-zinc-500 border border-dashed border-zinc-700/40 hover:text-zinc-300 hover:border-zinc-600/60 transition-all"
          >
            GitHub
          </a>
          <button
            onClick={() => setShowCollabs((p) => !p)}
            className="flex items-center gap-1 text-xs font-mono px-2.5 py-1.5 rounded-lg transition-all"
            style={{
              background: showCollabs ? 'rgba(20, 241, 149, 0.15)' : 'transparent',
              border: `1px solid ${showCollabs ? 'rgba(20, 241, 149, 0.3)' : 'rgba(255,255,255,0.08)'}`,
              color: showCollabs ? '#a7f3d0' : '#71717a',
            }}
          >
            <Users className="w-3 h-3" /> collabs
          </button>
          {confirmDelete ? (
            <div className="flex items-center gap-1">
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="text-xs font-mono px-2 py-1.5 rounded-lg text-red-400 disabled:opacity-40 transition-all"
                style={{
                  border: '1px solid rgba(239,68,68,0.35)',
                  background: 'rgba(239,68,68,0.08)',
                }}
              >
                {deleting ? '...' : 'confirm'}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-xs font-mono px-2 py-1.5 rounded-lg text-zinc-500 transition-all"
                style={{ border: '1px solid rgba(255,255,255,0.08)' }}
              >
                cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="p-1.5 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-400/5 transition-all"
              title="Delete repo"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
      {deleteError && <p className="text-red-400 font-mono text-xs px-3 pb-2">{deleteError}</p>}
      {showCollabs && (
        <CollaboratorsPanel repoId={repo.id} collaborators={repo.collaborators ?? []} />
      )}
    </div>
  );
}

// ── Collaborators Panel ────────────────────────────────────────────────────────

function CollaboratorsPanel({
  repoId,
  collaborators: initial,
}: {
  repoId: string;
  collaborators: Collaborator[];
}) {
  const [collabs, setCollabs] = useState<Collaborator[]>(initial);
  const [showForm, setShowForm] = useState(false);
  const [type, setType] = useState<'USER' | 'AI_AGENT' | 'PROGRAM'>('USER');
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [url, setUrl] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [userResults, setUserResults] = useState<
    Array<{ id: string; username: string; avatarUrl: string | null; reputationPoints: number }>
  >([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const searchUsers = async (q: string) => {
    if (q.length < 2) {
      setUserResults([]);
      return;
    }
    try {
      const results = await api.get<any[]>(`/users/search?q=${encodeURIComponent(q)}&limit=5`);
      setUserResults(Array.isArray(results) ? results : []);
    } catch {
      setUserResults([]);
    }
  };

  const addCollab = async () => {
    if (!name.trim() && !selectedUserId) {
      setError('Name or user required');
      return;
    }
    setAdding(true);
    setError('');
    try {
      const result = await api.post<Collaborator>(`/repos/${repoId}/collaborators`, {
        targetUserId: selectedUserId || undefined,
        name: name.trim() || undefined,
        type,
        role: role.trim() || undefined,
        url: url.trim() || undefined,
      });
      setCollabs((p) => [...p, result]);
      setName('');
      setRole('');
      setUrl('');
      setUserSearch('');
      setSelectedUserId(null);
      setShowForm(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add');
    } finally {
      setAdding(false);
    }
  };

  const removeCollab = async (id: string) => {
    setRemovingId(id);
    try {
      await api.delete(`/repos/${repoId}/collaborators/${id}`);
      setCollabs((p) => p.filter((c) => c.id !== id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to remove');
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div
      className="mx-3 mb-3 rounded-xl border"
      style={{ borderColor: 'rgba(20, 241, 149, 0.12)', background: 'rgba(20, 241, 149, 0.02)' }}
    >
      <div
        className="flex items-center gap-2 px-3 py-2 border-b"
        style={{ borderColor: 'rgba(20, 241, 149, 0.08)' }}
      >
        <Users className="w-3 h-3 text-atlas-400" />
        <span className="text-atlas-400 font-mono text-xs font-light">Collaborators</span>
      </div>
      <div className="px-3 py-2 space-y-2">
        {collabs.length === 0 && (
          <p className="text-zinc-600 font-mono text-xs py-1">no collaborators</p>
        )}
        {collabs.map((c) => (
          <div key={c.id} className="flex items-center gap-2">
            {c.user?.avatarUrl ? (
              <img
                src={c.user.avatarUrl}
                alt=""
                className="w-5 h-5 rounded-full border border-white/10 object-cover shrink-0"
              />
            ) : (
              <div className="w-5 h-5 rounded-full border border-white/10 bg-zinc-800 flex items-center justify-center shrink-0">
                <span className="text-zinc-500 text-xs">{(c.name || '?').charAt(0)}</span>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <span className="text-zinc-300 font-mono text-xs">
                {c.user?.username ? `@${c.user.username}` : c.name}
              </span>
              {c.role && <span className="text-zinc-600 font-mono text-xs ml-2">· {c.role}</span>}
              <span className="text-zinc-700 font-mono text-xs ml-2 capitalize">
                [{c.type.toLowerCase()}]
              </span>
            </div>
            <button
              onClick={() => removeCollab(c.id)}
              disabled={removingId === c.id}
              className="text-zinc-700 hover:text-red-400 transition-colors disabled:opacity-40"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}

        {showForm ? (
          <div
            className="pt-2 border-t space-y-2"
            style={{ borderColor: 'rgba(255,255,255,0.06)' }}
          >
            <div className="flex gap-1">
              {(['USER', 'AI_AGENT', 'PROGRAM'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className={`text-xs font-mono px-2 py-1 rounded-lg transition-all ${type === t ? 'bg-atlas-500/20 border-atlas-500/30 text-atlas-300' : 'border-white/08 text-zinc-600 hover:text-zinc-400'} border`}
                >
                  {t.toLowerCase().replace('_', ' ')}
                </button>
              ))}
            </div>
            {type === 'USER' ? (
              <div className="relative">
                <input
                  type="text"
                  value={userSearch}
                  onChange={(e) => {
                    setUserSearch(e.target.value);
                    setSelectedUserId(null);
                    searchUsers(e.target.value);
                  }}
                  placeholder="Search username..."
                  className="w-full text-xs px-2 py-1.5 rounded-lg font-mono"
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    color: '#e4e4e7',
                    outline: 'none',
                  }}
                />
                {userResults.length > 0 && (
                  <div
                    className="absolute top-full mt-1 left-0 right-0 rounded-lg border z-10 overflow-hidden"
                    style={{ background: 'var(--bg-card)', borderColor: 'rgba(20, 241, 149, 0.2)' }}
                  >
                    {userResults.map((u) => (
                      <button
                        key={u.id}
                        onClick={() => {
                          setSelectedUserId(u.id);
                          setName(u.username);
                          setUserSearch(u.username);
                          setUserResults([]);
                        }}
                        className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-atlas-500/10 transition-colors text-left"
                      >
                        {u.avatarUrl && (
                          <img
                            src={u.avatarUrl}
                            alt=""
                            className="w-5 h-5 rounded-full object-cover"
                          />
                        )}
                        <span className="text-xs font-mono text-zinc-300">@{u.username}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name *"
                className="w-full text-xs px-2 py-1.5 rounded-lg font-mono"
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: '#e4e4e7',
                  outline: 'none',
                }}
              />
            )}
            <div className="flex gap-2">
              <input
                type="text"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="Role (optional)"
                className="flex-1 text-xs px-2 py-1.5 rounded-lg font-mono"
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: '#e4e4e7',
                  outline: 'none',
                }}
              />
              {type !== 'USER' && (
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="URL (optional)"
                  className="flex-1 text-xs px-2 py-1.5 rounded-lg font-mono"
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    color: '#e4e4e7',
                    outline: 'none',
                  }}
                />
              )}
            </div>
            {error && <p className="text-red-400 font-mono text-xs">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={addCollab}
                disabled={adding}
                className="text-xs font-mono px-3 py-1.5 rounded-lg disabled:opacity-40 transition-all"
                style={{
                  background: 'rgba(20, 241, 149, 0.15)',
                  border: '1px solid rgba(20, 241, 149, 0.3)',
                  color: '#a7f3d0',
                }}
              >
                {adding ? '...' : 'add'}
              </button>
              <button
                onClick={() => {
                  setShowForm(false);
                  setError('');
                }}
                className="text-xs font-mono px-3 py-1.5 rounded-lg text-zinc-500 transition-all"
                style={{ border: '1px solid rgba(255,255,255,0.08)' }}
              >
                cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1 text-xs font-mono text-zinc-600 hover:text-atlas-400 transition-colors py-0.5"
          >
            <Plus className="w-3 h-3" /> add collaborator
          </button>
        )}
      </div>
    </div>
  );
}

// ── Publish Repo Modal ─────────────────────────────────────────────────────────

function PublishRepoModal({
  ghRepo,
  onPublished,
  onClose,
}: {
  ghRepo: GitHubRepo;
  onPublished: (repo: Repository) => void;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [lockType, setLockType] = useState<'public' | 'locked'>('public');
  const [lockPrice, setLockPrice] = useState('');
  const [description, setDescription] = useState(ghRepo.description || '');
  const [logoUrl, setLogoUrl] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [twitterUrl, setTwitterUrl] = useState('');
  const [license, setLicense] = useState('MIT');
  const [tags, setTags] = useState('');
  const [logoUploading, setLogoUploading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');
  const logoInputRef = useRef<HTMLInputElement>(null);

  const handleLogoUpload = async (file: File) => {
    const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml'];
    if (!allowed.includes(file.type)) {
      setError('Only PNG, JPG, WebP, SVG allowed');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Logo must be under 5MB');
      return;
    }
    setLogoUploading(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const result = await api.upload<{ logoUrl: string }>('/repos/upload-logo', formData);
      setLogoUrl((result as any).logoUrl || '');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Logo upload failed');
    } finally {
      setLogoUploading(false);
    }
  };

  const handlePublish = async () => {
    const price = lockType === 'locked' ? parseFloat(lockPrice) : undefined;
    if (lockType === 'locked' && (!price || price <= 0)) {
      setError('Enter a valid price');
      return;
    }
    setPublishing(true);
    setError('');
    try {
      const published = await api.post<{ id: string }>('/repos/publish', {
        id: ghRepo.id,
        name: ghRepo.name,
        full_name: ghRepo.full_name,
        description: description.trim() || ghRepo.description,
        language: ghRepo.language,
        stargazers_count: ghRepo.stargazers_count,
        forks_count: ghRepo.forks_count,
        html_url: ghRepo.html_url,
        clone_url: ghRepo.clone_url,
        topics: ghRepo.topics,
        private: ghRepo.private,
        isLocked: lockType === 'locked',
        lockedPriceUsd: price,
        logoUrl: logoUrl || undefined,
        websiteUrl: websiteUrl.trim() || undefined,
        twitterUrl: twitterUrl.trim() || undefined,
      });
      const full = await api.get<Repository>(`/repos/${(published as any).id}`);
      onPublished(full);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to publish');
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)' }}
    >
      <div
        className="w-full max-w-sm rounded-2xl overflow-y-auto"
        style={{
          maxHeight: '90vh',
          background: 'var(--bg-card)',
          border: '1px solid rgba(20, 241, 149, 0.2)',
        }}
      >
        <div
          className="flex items-center justify-between px-5 pt-5 pb-4 border-b"
          style={{ borderColor: 'rgba(255,255,255,0.06)' }}
        >
          <div>
            <h3 className="font-light text-zinc-100 text-sm">Publish Repository</h3>
            <p className="text-zinc-600 font-mono text-xs mt-0.5">
              {ghRepo.name}
              {ghRepo.private ? ' · private' : ''}
            </p>
          </div>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          {/* Description */}
          <div>
            <label className="text-xs text-zinc-500 font-mono block mb-1.5">
              Description <span className="text-zinc-700">(what is this repo?)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Explain what this repository does..."
              rows={3}
              maxLength={500}
              className="w-full text-sm px-3 py-2 rounded-xl font-mono resize-none"
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.08)',
                color: '#e4e4e7',
                outline: 'none',
              }}
            />
          </div>
          {/* Visibility */}
          <div className="space-y-2">
            {(
              [
                [
                  'public',
                  'Public — Free',
                  'Anyone can see and download',
                  <Globe key="g" className="w-4 h-4" />,
                ],
                [
                  'locked',
                  'Locked — Paid Access',
                  'Users pay to unlock download',
                  <Lock key="l" className="w-4 h-4" />,
                ],
              ] as const
            ).map(([val, label, desc, icon]) => (
              <button
                key={val}
                onClick={() => setLockType(val)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${lockType === val ? 'border-atlas-500/40' : 'border-white/06 hover:border-white/12'}`}
                style={{
                  background:
                    lockType === val ? 'rgba(20, 241, 149, 0.08)' : 'rgba(255,255,255,0.02)',
                }}
              >
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${lockType === val ? 'bg-atlas-500/20 text-atlas-400' : 'bg-white/04 text-zinc-600'}`}
                >
                  {icon}
                </div>
                <div>
                  <p
                    className={`text-sm font-light ${lockType === val ? 'text-atlas-300' : 'text-zinc-400'}`}
                  >
                    {label}
                  </p>
                  <p className="text-xs text-zinc-600">{desc}</p>
                </div>
              </button>
            ))}
          </div>
          {lockType === 'locked' && (
            <div>
              <label className="text-xs text-zinc-500 font-mono block mb-1.5">
                Price in USD <span className="text-zinc-700">(paid via SOL on Base)</span>
              </label>
              <div
                className="flex items-center gap-2 rounded-xl px-3 py-2.5 border"
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  borderColor: 'rgba(255,255,255,0.08)',
                }}
              >
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
          {/* License + Tags */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-zinc-500 font-mono block mb-1.5">License</label>
              <select
                value={license}
                onChange={(e) => setLicense(e.target.value)}
                className="w-full text-xs px-3 py-2 rounded-lg font-mono outline-none"
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: '#e4e4e7',
                }}
              >
                <option value="MIT">MIT</option>
                <option value="Apache-2.0">Apache 2.0</option>
                <option value="GPL-3.0">GPL 3.0</option>
                <option value="BSD-3-Clause">BSD 3-Clause</option>
                <option value="Proprietary">Proprietary</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="text-xs text-zinc-500 font-mono block mb-1.5">
                Tags <span className="text-zinc-700">(comma separated)</span>
              </label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="#nlp, #autonomous, #tool"
                className="w-full text-xs px-3 py-2 rounded-lg font-mono"
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: '#e4e4e7',
                  outline: 'none',
                }}
              />
            </div>
          </div>
          {/* Branding */}
          <div
            className="border-t pt-4 space-y-3"
            style={{ borderColor: 'rgba(255,255,255,0.06)' }}
          >
            <p className="text-xs font-mono text-zinc-600">Branding (optional)</p>
            <div>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/jpg,image/webp,image/svg+xml"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleLogoUpload(f);
                }}
              />
              <button
                onClick={() => logoInputRef.current?.click()}
                className="w-full rounded-xl border-2 border-dashed py-4 text-center transition-colors hover:border-atlas-500/30"
                style={{ borderColor: logoUrl ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.08)' }}
              >
                {logoUploading ? (
                  <p className="text-xs font-mono text-atlas-400 animate-pulse">uploading...</p>
                ) : logoUrl ? (
                  <div className="flex items-center justify-center gap-3">
                    <img
                      src={
                        logoUrl.startsWith('/api')
                          ? `${API_URL.replace('/api/v1', '')}${logoUrl}`
                          : logoUrl
                      }
                      alt="logo"
                      className="w-8 h-8 rounded-lg object-cover"
                    />
                    <p className="text-xs font-mono text-atlas-400">logo uploaded ✓</p>
                  </div>
                ) : (
                  <p className="text-xs font-mono text-zinc-600 flex items-center justify-center gap-1.5">
                    <Upload className="w-3 h-3" /> upload logo
                  </p>
                )}
              </button>
            </div>
            <input
              type="url"
              placeholder="Website URL"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              className="w-full text-xs px-3 py-2 rounded-lg font-mono"
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.08)',
                color: '#e4e4e7',
                outline: 'none',
              }}
            />
            <input
              type="url"
              placeholder="Twitter/X URL"
              value={twitterUrl}
              onChange={(e) => setTwitterUrl(e.target.value)}
              className="w-full text-xs px-3 py-2 rounded-lg font-mono"
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.08)',
                color: '#e4e4e7',
                outline: 'none',
              }}
            />
          </div>
          {/* Wallet warning */}
          {!user?.walletAddress && (
            <div
              className="rounded-xl p-3 text-xs font-mono flex items-center gap-2"
              style={{
                background: 'rgba(20, 241, 149, 0.05)',
                border: '1px solid rgba(20, 241, 149, 0.15)',
              }}
            >
              <Wallet className="w-3.5 h-3.5 text-atlas-400/60 shrink-0" strokeWidth={1.5} />
              <span className="text-zinc-500">
                No wallet linked —{' '}
                <Link href="/profile?tab=wallet" className="text-atlas-400 hover:text-atlas-300">
                  link wallet
                </Link>{' '}
                to receive payments
              </span>
            </div>
          )}
          {error && <p className="text-red-400 font-mono text-xs">{error}</p>}
          <button
            onClick={handlePublish}
            disabled={publishing}
            className="w-full py-2.5 rounded-xl font-mono font-light text-sm disabled:opacity-40 transition-all"
            style={{
              background: 'linear-gradient(135deg, rgba(20, 241, 149, 0.4), rgba(99,102,241,0.3))',
              border: '1px solid rgba(20, 241, 149, 0.4)',
              color: '#e2d9ff',
            }}
          >
            {publishing ? 'publishing...' : 'publish →'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── SaaS chrome ────────────────────────────────────────────────────────────────

function RepoStat({
  icon,
  label,
  value,
  accent,
  delta,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent: string;
  delta: string;
}) {
  return (
    <div
      className="relative rounded-xl p-4 overflow-hidden group transition-all hover:border-white/20"
      style={{
        border: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(0,0,0,0.35)',
        backdropFilter: 'blur(6px)',
      }}
    >
      <div
        className="absolute inset-x-0 top-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }}
      />
      <div className="flex items-center justify-between mb-3">
        <span
          className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] font-light"
          style={{ color: accent }}
        >
          <span
            className="w-5 h-5 rounded-md flex items-center justify-center"
            style={{ background: `${accent}15`, border: `1px solid ${accent}30`, color: accent }}
          >
            {icon}
          </span>
          {label}
        </span>
      </div>
      <p className="text-xl font-light text-white">{value}</p>
      <p className="text-[11px] text-zinc-500 mt-1 font-light">{delta}</p>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function ReposMarketPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" style={{ background: 'var(--bg)' }} />}>
      <ReposMarketPageContent />
    </Suspense>
  );
}

function ReposMarketPageContent() {
  const { isAuthenticated, user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab = searchParams?.get('tab') === 'mine' ? 'mine' : 'market';
  const { pickWallet, pickerElement: walletPicker } = useWalletPicker();

  const [activeTab, setActiveTab] = useState<'market' | 'mine'>(initialTab);

  // Market tab state
  const [repos, setRepos] = useState<Repository[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [language, setLanguage] = useState('');
  const [sortBy, setSortBy] = useState<'recent' | 'votes' | 'stars' | 'downloads'>('recent');
  const [error, setError] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  useKeyboardFocus(searchRef);

  // My repos tab state
  const [myRepos, setMyRepos] = useState<Repository[]>([]);
  const [myLoading, setMyLoading] = useState(false);
  const [ghRepos, setGhRepos] = useState<GitHubRepo[]>([]);
  const [showPublishPanel, setShowPublishPanel] = useState(false);
  const [publishingRepo, setPublishingRepo] = useState<GitHubRepo | null>(null);
  const [ghNeedsConnect, setGhNeedsConnect] = useState(false);
  const [ghNeedsReauth, setGhNeedsReauth] = useState(false);
  const [ghLoading, setGhLoading] = useState(false);

  // Payment — wei amounts are computed at sign time so we can apply the
  // chosen method's fee model (ATLAS 3% / SOL 7%) to the seller's base.
  const [consentModal, setConsentModal] = useState<{
    repo: Repository;
    sellerWallet: string;
    buyerAddress: string;
    baseUsd: number;
    hagglDisabled: boolean;
  } | null>(null);

  useEffect(() => {
    const tab = searchParams?.get('tab');
    setActiveTab(tab === 'mine' ? 'mine' : 'market');
  }, [searchParams]);

  const fetchRepos = useCallback(async () => {
    const params = new URLSearchParams({ sortBy });
    if (search) params.set('search', search);
    if (language && language !== 'All') params.set('language', language);
    const key = `market:repos:${params.toString()}`;

    // Stale-while-revalidate: seed instantly from cache, skip network if fresh.
    // Marketplace lists tolerate 2 min staleness — listings change slowly
    // and the user feels filter / nav latency more than minor staleness.
    const cached = getCachedWithStatus<{ data: Repository[] }>(key, 120_000);
    if (cached.data) {
      setRepos(cached.data.data);
      setLoading(false);
      if (cached.fresh) return;
    } else {
      setLoading(true);
    }

    setError('');
    try {
      const data = await api.get<{ data: Repository[] }>(`/repos?${params}`);
      setRepos(data.data);
      setCached(key, data);
    } catch {
      if (!cached.data) setError('Failed to load repositories');
    } finally {
      setLoading(false);
    }
  }, [search, language, sortBy]);

  const fetchMyRepos = useCallback(async () => {
    if (!isAuthenticated || !user) return;
    setMyLoading(true);
    try {
      const params = new URLSearchParams({ sortBy: 'recent' });
      const data = await api.get<{ data: Repository[] }>(`/repos?${params}`);
      setMyRepos(data.data.filter((r) => r.user?.username === user.username));
    } catch {
      setError('Failed to load your repos');
    } finally {
      setMyLoading(false);
    }
  }, [isAuthenticated, user]);

  useEffect(() => {
    fetchRepos();
  }, [fetchRepos]);

  useEffect(() => {
    if (activeTab === 'mine' && isAuthenticated) fetchMyRepos();
  }, [activeTab, fetchMyRepos, isAuthenticated]);

  const switchTab = (tab: 'market' | 'mine') => {
    setActiveTab(tab);
    router.push(tab === 'mine' ? '/market/repos?tab=mine' : '/market/repos', { scroll: false });
  };

  const loadGhRepos = async () => {
    if (!user?.githubLogin) {
      setGhNeedsConnect(true);
      setShowPublishPanel(true);
      return;
    }
    setGhLoading(true);
    setGhNeedsReauth(false);
    setGhNeedsConnect(false);
    setShowPublishPanel(true);
    try {
      await api.delete('/repos/github/cache').catch(() => {});
      const data = await api.get<GitHubRepo[]>('/repos/github');
      const raw = Array.isArray(data) ? data : [];
      const needsReauth = raw.some((r: any) => r._haggl_reauth);
      if (needsReauth) {
        setGhNeedsReauth(true);
        setGhRepos([]);
      } else setGhRepos(raw);
    } catch {
      setError('Failed to fetch GitHub repos');
    } finally {
      setGhLoading(false);
    }
  };

  const vote = async (repoId: string, value: 'UP' | 'DOWN') => {
    if (!isAuthenticated) return;
    try {
      await api.post(`/repos/${repoId}/vote`, { value });
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

  const unlock = async (repo: Repository) => {
    if (!repo.lockedPriceUsd) return;
    let sellerWallet: string | null = null;
    try {
      const details = await api.get<any>(`/repos/${repo.id}`);
      sellerWallet = details?.user?.walletAddress;
    } catch {
      setError('Could not fetch seller wallet');
      return;
    }
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
      setConsentModal({
        repo,
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
          const p = await api.get<any>('/chart/eth-price');
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
      if (result.success && result.downloadUrl)
        window.open(result.downloadUrl, '_blank', 'noopener,noreferrer');
      await fetchRepos();
    } catch (err: any) {
      const msg = err?.message || String(err);
      setError(
        msg.includes('rejected')
          ? 'Payment cancelled'
          : err instanceof ApiError
            ? err.message
            : 'Payment failed: ' + msg.slice(0, 80),
      );
    }
  };

  const ghActions: Action[] = ghRepos.map((r) => ({
    id: String(r.id),
    label: r.name,
    icon: <GitBranch className="w-4 h-4 text-atlas-400" strokeWidth={1.5} />,
    description: r.language || '',
    short: r.private ? 'private' : 'public',
    end: 'publish',
  }));

  return (
    <div className="mk-agents-page mk-app-page">
      <div className="mk-hero">
        <div className="mk-hero__crumbs">
          <Link href="/market" className="mk-hero__crumb-link">
            Market
          </Link>
          <span className="mk-hero__crumb-sep">/</span>
          <span>Repos</span>
        </div>
        <div className="mk-hero__row">
          <div>
            <h1 className="text-3xl md:text-4xl font-medium tracking-[-0.02em] text-[var(--text)] leading-tight">
              Repos
            </h1>
            <p className="mt-2 text-[14px] text-[var(--text-secondary)] leading-relaxed max-w-2xl">
              Open-source code repositories. Vote, download, or publish your own with built-in
              escrow.
            </p>
          </div>
          {isAuthenticated && (
            <button
              type="button"
              onClick={() => {
                switchTab('mine');
                loadGhRepos();
              }}
              className="mk-btn mk-btn--primary"
            >
              <Plus className="w-3.5 h-3.5" strokeWidth={2} />
              Publish repo
            </button>
          )}
        </div>

        {/* Stats strip — segmented pills with tabular numbers */}
        <div className="mk-stats">
          <div className="mk-stat">
            <div className="mk-stat__label">Listed</div>
            <div className="mk-stat__value">{repos.length}</div>
          </div>
          <div className="mk-stat">
            <div className="mk-stat__label">Paid</div>
            <div className="mk-stat__value">{repos.filter((r) => r.isLocked).length}</div>
          </div>
          <div className="mk-stat">
            <div className="mk-stat__label">Total stars</div>
            <div className="mk-stat__value">
              {repos.reduce((acc, r) => acc + (r.stars ?? 0), 0).toLocaleString()}
            </div>
          </div>
          <div className="mk-stat">
            <div className="mk-stat__label">Scanned</div>
            <div className="mk-stat__value">100%</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="mk-tabs">
        {(
          [
            ['market', 'Marketplace'],
            ['mine', 'My repos'],
          ] as const
        ).map(([id, label]) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => switchTab(id)}
              className={`mk-tab ${active ? 'mk-tab--active' : ''}`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* ── Marketplace tab ── */}
      {activeTab === 'market' && (
        <>
          {/* Toolbar — matches /market/agents */}
          <div className="mk-toolbar">
            <div className="mk-search">
              <Search className="mk-search__icon" strokeWidth={2} />
              <input
                ref={searchRef}
                type="text"
                placeholder="Search repositories"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="mk-search__input"
              />
              {search ? (
                <button
                  onClick={() => setSearch('')}
                  className="mk-search__clear"
                  aria-label="Clear search"
                >
                  <X className="w-3.5 h-3.5" strokeWidth={2} />
                </button>
              ) : (
                <kbd className="mk-search__kbd">/</kbd>
              )}
            </div>

            <div className="mk-select">
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                aria-label="Language"
              >
                {LANGUAGES.map((l) => (
                  <option key={l} value={l === 'All' ? '' : l}>
                    {l}
                  </option>
                ))}
              </select>
              <ChevronDown className="mk-select__caret" strokeWidth={2} />
            </div>

            <div className="mk-seg mk-only-desktop">
              {SORTS.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setSortBy(s.value as typeof sortBy)}
                  className={`mk-seg__item ${sortBy === s.value ? 'mk-seg__item--active' : ''}`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            <div className="mk-select mk-only-mobile">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                aria-label="Sort"
              >
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="mk-select__caret" strokeWidth={2} />
            </div>
          </div>
          {error && (
            <div
              className="mb-4 flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm"
              style={{
                background: 'rgba(244,63,94,0.10)',
                boxShadow: 'inset 0 0 0 1px rgba(244,63,94,0.3)',
                color: '#FDA4AF',
              }}
            >
              <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-rose-500/30 text-[10px] font-mono">
                !
              </span>
              <span className="flex-1 font-light">{error}</span>
            </div>
          )}
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="relative h-56 rounded-2xl overflow-hidden"
                  style={{
                    background: 'var(--bg-card)',
                    boxShadow: '0 0 0 1px rgba(255,255,255,0.05)',
                  }}
                >
                  <div
                    className="absolute inset-0 animate-shimmer"
                    style={{
                      background:
                        'linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.06) 50%, transparent 70%)',
                      backgroundSize: '200% 100%',
                    }}
                  />
                </div>
              ))}
            </div>
          ) : repos.length === 0 ? (
            <div className="mk-empty-app">
              <div
                className="mk-empty-app__icon"
                style={{ background: 'rgba(59,130,246,0.15)', color: '#93c5fd' }}
              >
                <GitBranch className="w-5 h-5" strokeWidth={2} />
              </div>
              <div className="mk-empty-app__title">No repositories found</div>
              <div className="mk-empty-app__sub">
                Try tweaking the filters, or explore popular languages below.
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {repos.map((r, idx) => (
                <motion.div
                  key={r.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    delay: Math.min(idx * 0.035, 0.4),
                    duration: 0.32,
                    ease: [0.22, 0.61, 0.36, 1],
                  }}
                  whileHover={{ y: -2 }}
                >
                  <RepoCard
                    repo={r}
                    isAuthenticated={isAuthenticated}
                    userId={user?.id}
                    onVote={vote}
                    onDownload={download}
                    onUnlock={unlock}
                  />
                </motion.div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── My Publications tab ── */}
      {activeTab === 'mine' && (
        <>
          {!isAuthenticated ? (
            <div className="card text-center py-16">
              <p className="text-zinc-500 text-sm mb-4">Sign in to manage your repos</p>
              <Link href="/auth" className="btn-primary text-sm px-4 py-2 inline-flex">
                Sign in
              </Link>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-zinc-500">
                  {myRepos.length} repo{myRepos.length !== 1 ? 's' : ''} published
                </p>
                <button
                  onClick={() => {
                    setShowPublishPanel((p) => !p);
                    if (!showPublishPanel) loadGhRepos();
                  }}
                  className={`text-xs px-3 py-1.5 flex items-center gap-1.5 ${showPublishPanel ? 'btn-secondary' : 'btn-primary'}`}
                >
                  <Plus className="w-3 h-3" /> {showPublishPanel ? 'Close' : 'Publish new'}
                </button>
              </div>

              {/* GitHub repos panel */}
              {showPublishPanel && (
                <div className="mb-5 card p-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-light text-zinc-300">Your GitHub repositories</p>
                    <button
                      onClick={() => setShowPublishPanel(false)}
                      className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
                    >
                      Close
                    </button>
                  </div>
                  {ghNeedsConnect && (
                    <div className="p-4 rounded-xl border border-atlas-500/20 bg-atlas-500/5 text-center mb-3">
                      <p className="text-sm text-zinc-400 mb-3">Connect GitHub to publish repos</p>
                      {process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID ? (
                        <a
                          href={GITHUB_OAUTH_URL}
                          className="btn-primary text-xs px-4 py-2 inline-flex"
                        >
                          Connect GitHub
                        </a>
                      ) : (
                        <p className="text-xs text-zinc-600">
                          GitHub OAuth not configured — set NEXT_PUBLIC_GITHUB_CLIENT_ID
                        </p>
                      )}
                    </div>
                  )}
                  {ghNeedsReauth && (
                    <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/50 text-center mb-3">
                      <p className="text-sm text-zinc-400 mb-1">GitHub token expired</p>
                      <a
                        href={GITHUB_OAUTH_URL}
                        className="btn-primary text-xs px-4 py-2 inline-flex mt-2"
                      >
                        Reconnect GitHub
                      </a>
                    </div>
                  )}
                  {ghLoading && (
                    <p className="text-zinc-600 text-xs animate-pulse py-2">
                      Loading your repos...
                    </p>
                  )}
                  {!ghNeedsConnect && !ghNeedsReauth && !ghLoading && (
                    <ActionSearchBar
                      actions={ghActions}
                      placeholder="Search your repos..."
                      label="Select a repo to publish"
                      onSelect={(action) => {
                        const r = ghRepos.find((x) => String(x.id) === action.id);
                        if (r) setPublishingRepo(r);
                      }}
                    />
                  )}
                </div>
              )}

              {myLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="skeleton h-20 rounded-xl" />
                  ))}
                </div>
              ) : myRepos.length === 0 ? (
                <div className="card text-center py-16">
                  <GitBranch className="w-10 h-10 text-zinc-700 mx-auto mb-3" strokeWidth={1} />
                  <p className="text-zinc-600 text-sm mb-3">No repos published yet</p>
                  <button
                    onClick={() => {
                      setShowPublishPanel(true);
                      loadGhRepos();
                    }}
                    className="btn-primary text-xs px-4 py-2 inline-flex items-center gap-1.5"
                  >
                    <Plus className="w-3 h-3" /> Publish your first repo
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {myRepos.map((r) => (
                    <MyRepoCard
                      key={r.id}
                      repo={r}
                      onDelete={(id) => setMyRepos((p) => p.filter((x) => x.id !== id))}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Modals */}
      {publishingRepo && (
        <PublishRepoModal
          ghRepo={publishingRepo}
          onPublished={(r) => {
            setMyRepos((p) => [r, ...p]);
            setPublishingRepo(null);
            setShowPublishPanel(false);
          }}
          onClose={() => setPublishingRepo(null)}
        />
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
