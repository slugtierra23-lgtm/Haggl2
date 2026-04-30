'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import React, { useState, useEffect, useCallback } from 'react';

import { api, ApiError, API_URL } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/AuthProvider';

// ── Types ──────────────────────────────────────────────────────────────────────

interface AgentListing {
  id: string;
  title: string;
  description: string;
  type: string;
  price: number;
  currency: string;
  tags: string[];
  agentUrl: string | null;
  agentEndpoint: string | null;
  fileKey: string | null;
  fileName: string | null;
  fileSize: number | null;
  status: string;
  createdAt: string;
  seller: { id: string; username: string | null; avatarUrl: string | null };
}

interface AgentPost {
  id: string;
  createdAt: string;
  content: string;
  postType: 'GENERAL' | 'PRICE_UPDATE' | 'ANNOUNCEMENT' | 'DEAL';
  price: number | null;
  currency: string | null;
}

interface ApiKey {
  id: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

const POST_TYPE_CONFIG = {
  GENERAL: { label: 'Update', color: 'text-zinc-400 border-zinc-700 bg-zinc-800/40' },
  PRICE_UPDATE: { label: 'Price', color: 'text-yellow-400 border-yellow-400/30 bg-yellow-400/5' },
  ANNOUNCEMENT: {
    label: 'Announcement',
    color: 'text-atlas-400 border-atlas-400/30 bg-atlas-400/5',
  },
  DEAL: { label: 'Deal', color: 'text-green-400 border-green-400/30 bg-green-400/5' },
};

const TYPE_COLORS: Record<string, string> = {
  AI_AGENT: 'text-emerald-400 border-emerald-400/30 bg-emerald-400/5',
  BOT: 'text-atlas-400 border-atlas-400/30 bg-atlas-400/5',
  SCRIPT: 'text-yellow-400 border-yellow-400/30 bg-yellow-400/5',
  REPO: 'text-blue-400 border-blue-400/30 bg-blue-400/5',
  OTHER: 'text-zinc-400 border-zinc-600/30 bg-zinc-800/30',
};

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Components ─────────────────────────────────────────────────────────────────

function PostCard({ post }: { post: AgentPost }) {
  const cfg = POST_TYPE_CONFIG[post.postType] || POST_TYPE_CONFIG.GENERAL;
  return (
    <div
      className="relative rounded-xl p-4 overflow-hidden"
      style={{
        background: 'var(--bg-card)',
        boxShadow: '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.03)',
      }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          background:
            'linear-gradient(90deg, transparent 0%, rgba(20, 241, 149, 0.3) 50%, transparent 100%)',
        }}
      />
      <div className="flex items-center justify-between mb-2 gap-2">
        <span
          className={`text-[10.5px] font-mono uppercase tracking-[0.14em] font-medium px-2 py-0.5 rounded-md border ${cfg.color}`}
        >
          {cfg.label}
        </span>
        <span className="text-[10.5px] font-mono" style={{ color: 'rgba(161,161,170,0.5)' }}>
          {timeAgo(post.createdAt)}
        </span>
      </div>
      <p className="text-sm leading-relaxed whitespace-pre-wrap text-zinc-200">{post.content}</p>
      {post.postType === 'PRICE_UPDATE' && post.price != null && (
        <div className="mt-3 pt-2.5" style={{ borderTop: '1px solid rgba(250,204,21,0.18)' }}>
          <span className="text-yellow-400 font-mono font-light text-sm">
            {post.price} {post.currency || ''}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, isAuthenticated } = useAuth();

  const [agent, setAgent] = useState<AgentListing | null>(null);
  const [posts, setPosts] = useState<AgentPost[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [activeTab, setActiveTab] = useState<'feed' | 'about' | 'keys'>('feed');

  // Post form
  const [showPost, setShowPost] = useState(false);
  const [postContent, setPostContent] = useState('');
  const [postType, setPostType] = useState<AgentPost['postType']>('GENERAL');
  const [postPrice, setPostPrice] = useState('');
  const [postCurrency, setPostCurrency] = useState('SOL');
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState('');

  // API key form
  const [keyLabel, setKeyLabel] = useState('');
  const [generatingKey, setGeneratingKey] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);

  const isOwner = isAuthenticated && agent?.seller.id === user?.id;

  const load = useCallback(async () => {
    try {
      const data = await api.get<AgentListing>(`/market/${id}`);
      setAgent(data);
      const postsData = await api.get<AgentPost[]>(`/market/${id}/posts`);
      setPosts(postsData);
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (isOwner && activeTab === 'keys') {
      api
        .get<ApiKey[]>(`/market/${id}/apikeys`)
        .then(setApiKeys)
        .catch(() => {});
    }
  }, [isOwner, activeTab, id]);

  const submitPost = async () => {
    if (!postContent.trim()) return;
    setPosting(true);
    setPostError('');
    try {
      const created = await api.post<AgentPost>(`/market/${id}/posts`, {
        content: postContent.trim(),
        postType,
        price: postPrice ? parseFloat(postPrice) : undefined,
        currency: postType === 'PRICE_UPDATE' ? postCurrency : undefined,
      });
      setPosts((prev) => [created, ...prev]);
      setPostContent('');
      setPostPrice('');
      setPostType('GENERAL');
      setShowPost(false);
    } catch (err) {
      setPostError(err instanceof ApiError ? err.message : 'Failed to post');
    } finally {
      setPosting(false);
    }
  };

  const generateKey = async () => {
    setGeneratingKey(true);
    setNewKey(null);
    try {
      const result = await api.post<{ key: string; label: string | null }>(
        `/market/${id}/apikeys`,
        {
          label: keyLabel.trim() || undefined,
        },
      );
      setNewKey(result.key);
      setKeyLabel('');
      const updated = await api.get<ApiKey[]>(`/market/${id}/apikeys`);
      setApiKeys(updated);
    } catch (err) {
      setPostError(err instanceof ApiError ? err.message : 'Failed to generate key');
    } finally {
      setGeneratingKey(false);
    }
  };

  const revokeKey = async (keyId: string) => {
    await api.delete(`/market/apikeys/${keyId}`);
    setApiKeys((prev) => prev.filter((k) => k.id !== keyId));
  };

  if (loading)
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-6 h-6 rounded-full border-2 border-zinc-700 border-t-atlas-400 animate-spin" />
      </div>
    );

  if (notFound || !agent)
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-3">
        <div className="text-4xl font-mono text-zinc-700">404</div>
        <div className="text-zinc-400 text-sm">Agent not found</div>
        <Link href="/market" className="text-atlas-400 text-sm hover:underline">
          ← Back to Agents
        </Link>
      </div>
    );

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      {/* ── Agent header ── */}
      <div
        className="relative rounded-2xl p-6 mb-6 overflow-hidden"
        style={{
          background: 'var(--bg-card)',
          boxShadow:
            '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.04), 0 12px 36px -20px rgba(0,0,0,0.55)',
        }}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{
            background:
              'linear-gradient(90deg, transparent 0%, rgba(20, 241, 149, 0.45) 50%, transparent 100%)',
          }}
        />
        <div className="flex items-start justify-between flex-wrap gap-4 relative">
          <div className="flex items-start gap-4">
            {/* Agent avatar */}
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl flex-shrink-0"
              style={{
                background:
                  'linear-gradient(135deg, rgba(20, 241, 149, 0.22) 0%, rgba(20, 241, 149, 0.04) 100%)',
                boxShadow:
                  'inset 0 0 0 1px rgba(20, 241, 149, 0.35), 0 0 24px -6px rgba(20, 241, 149, 0.5)',
              }}
            >
              🤖
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <h1 className="text-xl font-light" style={{ color: 'var(--text)' }}>
                  {agent.title}
                </h1>
                <span
                  className={`text-xs font-mono px-2 py-0.5 rounded border ${TYPE_COLORS[agent.type] || TYPE_COLORS.OTHER}`}
                >
                  {agent.type.toLowerCase().replace('_', ' ')}
                </span>
                {agent.agentEndpoint && (
                  <span className="text-xs text-emerald-400 border border-emerald-400/30 bg-emerald-400/5 px-2 py-0.5 rounded">
                    🤖 live agent
                  </span>
                )}
              </div>
              <Link
                href={`/u/${agent.seller.username}`}
                className="text-sm hover:underline"
                style={{ color: 'var(--text-muted)' }}
              >
                by @{agent.seller.username || 'anon'}
              </Link>
            </div>
          </div>

          {/* Price + action */}
          <div className="flex flex-col items-end gap-2">
            <div className="text-lg font-mono font-light">
              {agent.price === 0 ? (
                <span className="text-green-400">Free</span>
              ) : (
                <span className="text-atlas-400">
                  {agent.price} {agent.currency}
                </span>
              )}
            </div>
            <Link href={`/market/agents/${agent.id}`} className="btn-neon text-xs py-1.5 px-4">
              {agent.price === 0 ? 'Get' : 'Buy now'}
            </Link>
          </div>
        </div>

        {/* Tags */}
        {agent.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-4">
            {agent.tags.map((t) => (
              <span
                key={t}
                className="text-xs px-2 py-0.5 rounded-full font-mono"
                style={{
                  background: 'var(--bg-elevated)',
                  color: 'var(--text-muted)',
                  border: '1px solid var(--border)',
                }}
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── Tabs ── */}
      <div
        className="flex gap-1 mb-6 rounded-xl p-1"
        style={{
          background: 'var(--bg-card)',
          boxShadow: '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.03)',
        }}
      >
        {(['feed', 'about', ...(isOwner ? ['keys'] : [])] as const).map((tab) => {
          const active = activeTab === tab;
          return (
            <motion.button
              key={tab}
              onClick={() => setActiveTab(tab as typeof activeTab)}
              whileTap={{ scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 360, damping: 22 }}
              className={`relative flex-1 py-2 text-[13px] font-light rounded-lg transition-colors capitalize ${
                active ? 'text-[#b4a7ff]' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {active && (
                <motion.span
                  layoutId="agent-detail-tab-pill"
                  transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                  className="absolute inset-0 rounded-lg"
                  style={{
                    background:
                      'linear-gradient(180deg, rgba(20, 241, 149, 0.22) 0%, rgba(20, 241, 149, 0.06) 100%)',
                    boxShadow:
                      'inset 0 0 0 1px rgba(20, 241, 149, 0.35), 0 0 14px -4px rgba(20, 241, 149, 0.45)',
                  }}
                />
              )}
              <span className="relative z-10">
                {tab === 'feed' ? `Feed (${posts.length})` : tab === 'keys' ? 'API Keys' : 'About'}
              </span>
            </motion.button>
          );
        })}
      </div>

      {/* ── Feed tab ── */}
      {activeTab === 'feed' && (
        <div className="space-y-4">
          {isOwner && (
            <>
              <button
                onClick={() => setShowPost(!showPost)}
                className="w-full py-3 rounded-xl text-[13px] font-light transition-all"
                style={{
                  background:
                    'linear-gradient(180deg, rgba(20, 241, 149, 0.12) 0%, rgba(20, 241, 149, 0.02) 100%)',
                  boxShadow: 'inset 0 0 0 1px rgba(20, 241, 149, 0.25)',
                  color: '#b4a7ff',
                }}
              >
                + Post an update as this agent
              </button>

              {showPost && (
                <div
                  className="relative rounded-xl p-4 space-y-3 overflow-hidden"
                  style={{
                    background: 'var(--bg-card)',
                    boxShadow:
                      '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.04)',
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 top-0 h-px"
                    style={{
                      background:
                        'linear-gradient(90deg, transparent 0%, rgba(20, 241, 149, 0.45) 50%, transparent 100%)',
                    }}
                  />
                  <div className="flex gap-2 flex-wrap">
                    {(Object.keys(POST_TYPE_CONFIG) as AgentPost['postType'][]).map((t) => (
                      <button
                        key={t}
                        onClick={() => setPostType(t)}
                        className={`text-xs px-3 py-1 rounded-lg border transition-all ${
                          postType === t
                            ? POST_TYPE_CONFIG[t].color
                            : 'text-zinc-500 border-zinc-700 hover:border-zinc-500'
                        }`}
                      >
                        {POST_TYPE_CONFIG[t].label}
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={postContent}
                    onChange={(e) => setPostContent(e.target.value)}
                    rows={3}
                    maxLength={2000}
                    placeholder="What does your agent want to say?"
                    className="w-full px-4 py-2.5 rounded-xl text-[13px] resize-none outline-none text-zinc-100 placeholder:text-zinc-500 focus:shadow-[0_0_0_1px_rgba(20, 241, 149, 0.45),_0_0_0_4px_rgba(20, 241, 149, 0.12)]"
                    style={{
                      background: 'var(--bg-card)',
                      boxShadow:
                        '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.03)',
                    }}
                  />
                  {postType === 'PRICE_UPDATE' && (
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={postPrice}
                        onChange={(e) => setPostPrice(e.target.value)}
                        placeholder="Price"
                        min="0"
                        step="0.01"
                        className="flex-1 px-3 py-2 rounded-lg text-sm outline-none"
                        style={{
                          background: 'var(--bg-elevated)',
                          border: '1px solid var(--border)',
                          color: 'var(--text)',
                        }}
                      />
                      <select
                        value={postCurrency}
                        onChange={(e) => setPostCurrency(e.target.value)}
                        className="px-3 py-2 rounded-lg text-sm outline-none"
                        style={{
                          background: 'var(--bg-elevated)',
                          border: '1px solid var(--border)',
                          color: 'var(--text)',
                        }}
                      >
                        <option value="SOL">SOL (Base)</option>
                        <option value="ATLAS">ATLAS (Base)</option>
                        <option value="USD">USD</option>
                      </select>
                    </div>
                  )}
                  {postError && <p className="text-red-400 text-xs">{postError}</p>}
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setShowPost(false)}
                      className="text-xs text-zinc-500 hover:text-zinc-300 px-3 py-1.5"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={submitPost}
                      disabled={posting || !postContent.trim()}
                      className="btn-neon text-xs px-4 py-1.5 disabled:opacity-40"
                    >
                      {posting ? 'Posting...' : 'Post'}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {posts.length === 0 ? (
            <div
              className="text-center py-16 rounded-xl"
              style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }}
            >
              <p className="text-sm font-mono">No posts yet.</p>
              {isOwner && (
                <p className="text-xs mt-1 opacity-60">
                  Post the first update for this agent above.
                </p>
              )}
            </div>
          ) : (
            posts.map((post, idx) => (
              <motion.div
                key={post.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay: Math.min(idx * 0.035, 0.3),
                  duration: 0.3,
                  ease: [0.22, 0.61, 0.36, 1],
                }}
              >
                <PostCard post={post} />
              </motion.div>
            ))
          )}
        </div>
      )}

      {/* ── About tab ── */}
      {activeTab === 'about' && (
        <div className="space-y-4">
          <div
            className="rounded-xl p-5"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
          >
            <h3 className="text-sm font-light mb-3" style={{ color: 'var(--text)' }}>
              Description
            </h3>
            <p
              className="text-sm leading-relaxed whitespace-pre-wrap"
              style={{ color: 'var(--text-muted)' }}
            >
              {agent.description}
            </p>
          </div>

          {agent.agentUrl && (
            <div
              className="rounded-xl p-4"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
            >
              <h3 className="text-xs font-mono text-zinc-500 mb-2">Agent URL</h3>
              <a
                href={agent.agentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-atlas-400 hover:underline break-all"
              >
                {agent.agentUrl}
              </a>
            </div>
          )}

          {agent.fileName && agent.fileKey && (
            <div
              className="rounded-xl p-4"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
            >
              <h3 className="text-xs font-mono text-zinc-500 mb-2">Download</h3>
              <a
                href={`${API_URL}/market/files/${agent.fileKey}`}
                className="text-sm text-yellow-400 hover:underline flex items-center gap-2"
              >
                <span>↓</span>
                <span>{agent.fileName}</span>
                {agent.fileSize && (
                  <span className="text-zinc-600 text-xs">({formatBytes(agent.fileSize)})</span>
                )}
              </a>
            </div>
          )}

          <div
            className="rounded-xl p-4 text-xs font-mono space-y-1"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              color: 'var(--text-muted)',
            }}
          >
            <p>
              Published:{' '}
              {new Date(agent.createdAt).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </p>
            <p>
              Status:{' '}
              <span className={agent.status === 'ACTIVE' ? 'text-green-400' : 'text-yellow-400'}>
                {agent.status.toLowerCase()}
              </span>
            </p>
          </div>
        </div>
      )}

      {/* ── API Keys tab (owner only) ── */}
      {activeTab === 'keys' && isOwner && (
        <div className="space-y-4">
          {/* Info box */}
          <div
            className="rounded-xl p-4 text-sm"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
          >
            <p className="font-light mb-1" style={{ color: 'var(--text)' }}>
              API Keys for automated posting
            </p>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Your agent or script can post updates automatically using an API key. Call{' '}
              <code className="text-atlas-400 bg-atlas-400/10 px-1 rounded">
                POST {API_URL}/market/{agent.id}/posts
              </code>{' '}
              with header{' '}
              <code className="text-atlas-400 bg-atlas-400/10 px-1 rounded">
                X-Agent-Key: bak_...
              </code>
            </p>
            <pre
              className="mt-3 p-3 rounded-lg text-xs overflow-x-auto"
              style={{ background: 'var(--bg-card)', color: 'var(--text-muted)' }}
            >{`fetch("${API_URL}/market/${agent.id}/posts", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Agent-Key": "bak_your_key_here"
  },
  body: JSON.stringify({
    content: "New price update!",
    postType: "PRICE_UPDATE",
    price: 0.5,
    currency: "SOL"
  })
})`}</pre>
          </div>

          {/* New key shown once */}
          {newKey && (
            <div
              className="rounded-xl p-4"
              style={{
                border: '1px solid rgba(74,222,128,0.3)',
                background: 'rgba(74,222,128,0.05)',
              }}
            >
              <p className="text-green-400 text-xs font-light mb-2">
                API key generated — save it now, it won&apos;t be shown again:
              </p>
              <code className="text-sm font-mono text-green-300 break-all">{newKey}</code>
            </div>
          )}

          {/* Generate form */}
          <div className="flex gap-2">
            <input
              value={keyLabel}
              onChange={(e) => setKeyLabel(e.target.value)}
              placeholder="Label (optional, e.g. 'my-script')"
              className="flex-1 px-3 py-2 rounded-xl text-sm outline-none"
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
              }}
            />
            <button
              onClick={generateKey}
              disabled={generatingKey}
              className="btn-neon text-xs px-4 py-2 disabled:opacity-40"
            >
              {generatingKey ? '...' : '+ Generate Key'}
            </button>
          </div>

          {/* Key list */}
          {apiKeys.length === 0 ? (
            <p
              className="text-xs text-center py-8 font-mono"
              style={{ color: 'var(--text-muted)' }}
            >
              No API keys yet.
            </p>
          ) : (
            <div className="space-y-2">
              {apiKeys.map((k) => (
                <div
                  key={k.id}
                  className="flex items-center justify-between rounded-xl px-4 py-3"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
                >
                  <div>
                    <p className="text-sm font-light" style={{ color: 'var(--text)' }}>
                      {k.label || 'Unnamed key'}
                    </p>
                    <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                      Created {new Date(k.createdAt).toLocaleDateString()} ·{' '}
                      {k.lastUsedAt ? `Last used ${timeAgo(k.lastUsedAt)}` : 'Never used'}
                    </p>
                  </div>
                  <button
                    onClick={() => revokeKey(k.id)}
                    className="text-xs text-red-400 hover:text-red-300 border border-red-400/30 px-2.5 py-1 rounded-lg"
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
