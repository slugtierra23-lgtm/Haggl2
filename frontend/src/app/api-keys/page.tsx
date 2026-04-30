'use client';

import { motion } from 'framer-motion';
import {
  Key,
  Plus,
  Trash2,
  Copy,
  Check,
  AlertTriangle,
  Shield,
  TrendingUp,
  Activity,
  Clock,
  Code2,
  Edit2,
  Save,
  X as XIcon,
} from 'lucide-react';
import React, { useState, useEffect, useCallback } from 'react';

import { AtlasButton, AtlasField } from '@/components/atlas';
import { GradientText } from '@/components/ui/GradientText';
import { ShimmerButton } from '@/components/ui/ShimmerButton';
import { VerificationCodeModal } from '@/components/ui/VerificationCodeModal';
import { api, ApiError } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useStepUp } from '@/lib/auth/useStepUp';

interface ApiKeyInfo {
  id: string;
  label: string | null;
  key?: string;
  lastFour?: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface KeyStat {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent: string;
}

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function timeAgo(d: string): string {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(d);
}

function KeyStatCard({ icon, label, value, accent }: KeyStat) {
  return (
    <div
      className="relative rounded-xl p-4 overflow-hidden"
      style={{
        background: 'var(--bg-card)',
        boxShadow: '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.03)',
      }}
    >
      <div
        className="absolute inset-x-0 top-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${accent}80, transparent)` }}
      />
      <div className="flex items-center justify-between mb-3">
        <span
          className="inline-flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.18em] font-medium"
          style={{ color: accent }}
        >
          <span
            className="w-6 h-6 rounded-md flex items-center justify-center"
            style={{
              background: `linear-gradient(135deg, ${accent}22 0%, ${accent}06 100%)`,
              boxShadow: `inset 0 0 0 1px ${accent}38, inset 0 1px 0 rgba(255,255,255,0.06), 0 0 14px -4px ${accent}45`,
              color: accent,
            }}
          >
            {icon}
          </span>
          {label}
        </span>
      </div>
      <p className="text-xl font-light text-white tracking-[-0.01em]">{value}</p>
    </div>
  );
}

function KeyCreationBanner({ keyValue, onDismiss }: { keyValue: string; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(keyValue);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* noop */
    }
  };

  return (
    <div
      className="mb-6 p-5 rounded-xl overflow-hidden"
      style={{
        border: '1px solid rgba(34,197,94,0.2)',
        background: 'rgba(34,197,94,0.05)',
        backdropFilter: 'blur(6px)',
      }}
    >
      <div className="flex items-start gap-3">
        <Shield className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-light text-emerald-400 mb-1">API key created successfully</p>
          <p className="text-xs text-zinc-400 mb-4">
            Copy this key now. You won&apos;t be able to see it again.
          </p>
          <div className="flex items-center gap-2 mb-4">
            <code
              className="flex-1 bg-black/40 border rounded-lg px-3 py-2 text-xs font-mono text-emerald-300 break-all"
              style={{ borderColor: 'rgba(34,197,94,0.3)' }}
            >
              {keyValue}
            </code>
            <button
              onClick={handleCopy}
              className="px-3 py-2 rounded-lg text-xs flex items-center gap-1.5 transition-all flex-shrink-0"
              style={{
                background: copied ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.08)',
                color: copied ? '#22c55e' : '#a1a1a1',
                border: `1px solid ${copied ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.1)'}`,
              }}
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5" /> Copied
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" /> Copy
                </>
              )}
            </button>
          </div>
          <p className="text-[11px] text-zinc-500 mb-3">
            Store it securely. We cannot show it again — lost keys require deletion + recreation.
          </p>
          <button
            onClick={onDismiss}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            I&apos;ve stored it securely
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateKeyForm({
  onCreated,
  onCancel,
  isLoading,
}: {
  onCreated: (key: ApiKeyInfo) => void;
  onCancel: () => void;
  isLoading: boolean;
}) {
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (isLoading) return;
    setError(null);
    try {
      const result = await api.post<ApiKeyInfo>('/market/api-keys', {
        label: label.trim() || null,
      });
      onCreated(result);
      setLabel('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create API key');
    }
  };

  return (
    <div
      className="relative mb-6 p-5 rounded-xl overflow-hidden"
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
      <h3 className="text-sm font-light text-[var(--text)] mb-4">Create new API key</h3>
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <AtlasField
            label="Key name (optional)"
            floating={false}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g., Production, CI/CD, Bot #3"
          />
        </div>
        <AtlasButton
          variant="primary"
          onClick={handleCreate}
          disabled={isLoading}
          loading={isLoading}
          leftIcon={!isLoading ? <Plus className="w-3.5 h-3.5" /> : undefined}
        >
          {isLoading ? 'Creating...' : 'Create'}
        </AtlasButton>
        <AtlasButton variant="secondary" onClick={onCancel}>
          Cancel
        </AtlasButton>
      </div>
      {error && (
        <p className="text-xs text-[#fda4af] mt-3 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

function KeyListItem({
  keyInfo,
  onDelete,
  onRename,
}: {
  keyInfo: ApiKeyInfo;
  onDelete: (id: string) => void;
  onRename: (id: string, label: string | null) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editLabel, setEditLabel] = useState(keyInfo.label || '');
  const [isDeleting, setIsDeleting] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      const text = `blt_••••••••••••••••••••••••${keyInfo.lastFour || '????'}`;
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* noop */
    }
  };

  const handleSaveRename = async () => {
    await onRename(keyInfo.id, editLabel.trim() || null);
    setIsEditing(false);
  };

  const handleDelete = async () => {
    if (!confirm('Revoke this API key? This action cannot be undone.')) return;
    setIsDeleting(true);
    await onDelete(keyInfo.id);
  };

  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const status = keyInfo.lastUsedAt
    ? new Date(keyInfo.lastUsedAt).getTime() > now - 30 * 24 * 60 * 60 * 1000
      ? 'Active'
      : 'Idle'
    : 'Unused';

  const statusColor = status === 'Active' ? '#22c55e' : status === 'Idle' ? '#f59e0b' : '#6b7280';

  return (
    <div
      className="p-4 rounded-xl flex flex-col gap-3 transition-all"
      style={{
        background: 'var(--bg-card)',
        boxShadow: '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.03)',
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <div className="flex items-center gap-2 mb-2">
              <input
                type="text"
                value={editLabel}
                onChange={(e) => setEditLabel(e.target.value)}
                className="flex-1 bg-black/40 border rounded-lg px-2 py-1 text-sm text-white"
                style={{ borderColor: 'rgba(255,255,255,0.1)' }}
                autoFocus
              />
              <button
                onClick={handleSaveRename}
                className="p-1 rounded-md hover:bg-white/10 transition-colors"
              >
                <Save className="w-4 h-4 text-emerald-400" />
              </button>
              <button
                onClick={() => {
                  setIsEditing(false);
                  setEditLabel(keyInfo.label || '');
                }}
                className="p-1 rounded-md hover:bg-white/10 transition-colors"
              >
                <XIcon className="w-4 h-4 text-zinc-500" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-sm font-light text-white">{keyInfo.label || 'Unnamed key'}</h3>
              <button
                onClick={() => setIsEditing(true)}
                className="p-1 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-white/10 transition-colors"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <div className="flex items-center gap-2 text-xs">
            <code className="text-zinc-400 font-mono">
              blt_••••••••••••••••••••••••{keyInfo.lastFour || '????'}
            </code>
            <button
              onClick={handleCopy}
              className="text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>
        <div
          className="px-2 py-1 rounded-md text-[10px] uppercase tracking-wide font-light"
          style={{
            background: `${statusColor}20`,
            color: statusColor,
            border: `1px solid ${statusColor}30`,
          }}
        >
          {status}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs text-zinc-400">
        <div>
          Created: <span className="text-zinc-300">{formatDate(keyInfo.createdAt)}</span>
        </div>
        <div>
          Last used:{' '}
          <span className="text-zinc-300">
            {keyInfo.lastUsedAt ? timeAgo(keyInfo.lastUsedAt) : 'Never'}
          </span>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleDelete}
          disabled={isDeleting}
          className="px-3 py-1.5 rounded-lg text-xs font-light transition-all text-red-400 hover:bg-red-500/10"
          style={{ border: '1px solid rgba(239,68,68,0.2)' }}
        >
          {isDeleting ? (
            <span className="w-3 h-3 border-2 border-red-500/30 border-t-red-500 rounded-full animate-spin inline-block" />
          ) : (
            <>
              <Trash2 className="w-3.5 h-3.5 inline-block mr-1" /> Revoke
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function IntegrationPanel() {
  const [lang, setLang] = useState<'curl' | 'node' | 'python'>('curl');
  const [copied, setCopied] = useState(false);

  const snippets: Record<string, string> = {
    curl: `curl -X POST https://api.haggl.tech/v1/market/agents/invoke \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "agentId": "agt_...",
    "input": { "task": "...", "data": "..." }
  }'`,
    node: `import { Haggl } from "@haggl/sdk";

const haggl = new Haggl({
  apiKey: process.env.HAGGL_API_KEY,
});

const result = await haggl.agents.invoke({
  agentId: "agt_...",
  input: { task: "...", data: "..." },
});`,
    python: `from haggl import Haggl

haggl = Haggl(api_key=os.environ["HAGGL_API_KEY"])

result = haggl.agents.invoke(
    agent_id="agt_...",
    input={"task": "...", "data": "..."},
)`,
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(snippets[lang]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* noop */
    }
  };

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        border: '1px solid var(--border)',
        background:
          'linear-gradient(135deg, rgba(20, 241, 149, 0.06) 0%, rgba(6,182,212,0.04) 100%), rgba(0,0,0,0.4)',
        backdropFilter: 'blur(6px)',
      }}
    >
      <div className="grid grid-cols-1 md:grid-cols-[1fr_1.4fr]">
        <div className="p-5 md:p-6 border-b md:border-b-0 md:border-r border-white/8">
          <div className="inline-flex items-center gap-2 mb-3">
            <span
              className="w-7 h-7 rounded-md flex items-center justify-center"
              style={{
                background: 'rgba(20, 241, 149, 0.12)',
                border: '1px solid rgba(20, 241, 149, 0.3)',
              }}
            >
              <Code2 className="w-3.5 h-3.5 text-atlas-300" />
            </span>
            <span className="text-[11px] uppercase tracking-[0.25em] text-atlas-300/80 font-light">
              Quick integration
            </span>
          </div>
          <h3 className="text-lg text-white font-light mb-2">Use your API key</h3>
          <p className="text-xs text-zinc-400 font-light leading-relaxed mb-4">
            Include your key in the Authorization header as <code>Bearer YOUR_KEY</code>. All
            requests are signed and auditable on-chain.
          </p>
        </div>

        <div className="flex flex-col">
          <div className="flex items-center justify-between border-b border-white/8 px-4 py-2">
            <div className="relative flex gap-1">
              {(['curl', 'node', 'python'] as const).map((l) => {
                const active = lang === l;
                return (
                  <motion.button
                    key={l}
                    onClick={() => setLang(l)}
                    whileTap={{ scale: 0.95 }}
                    transition={{ type: 'spring', stiffness: 360, damping: 22 }}
                    className={`relative text-[10px] uppercase tracking-[0.2em] px-2.5 py-1 rounded transition-colors ${
                      active ? 'text-atlas-200' : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="api-keys-lang-pill"
                        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                        aria-hidden="true"
                        className="absolute inset-0 rounded"
                        style={{
                          background: 'rgba(20, 241, 149, 0.1)',
                          boxShadow: 'inset 0 0 0 1px rgba(20, 241, 149, 0.35)',
                        }}
                      />
                    )}
                    <span className="relative">{l}</span>
                  </motion.button>
                );
              })}
            </div>
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-zinc-400 hover:text-white transition-colors"
            >
              {copied ? (
                <>
                  <Check className="w-3 h-3 text-emerald-400" /> Copied
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" /> Copy
                </>
              )}
            </button>
          </div>
          <pre
            className="flex-1 text-[11.5px] leading-relaxed font-mono text-zinc-300 p-4 overflow-x-auto"
            style={{ background: 'rgba(0,0,0,0.35)' }}
          >
            <code>{snippets[lang]}</code>
          </pre>
        </div>
      </div>
    </div>
  );
}

export default function ApiKeysPage() {
  const { user } = useAuth();
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);
  const [error, setError] = useState('');
  const stepUp = useStepUp();

  const fetchKeys = useCallback(async () => {
    try {
      const data = await api.get<ApiKeyInfo[]>('/market/api-keys');
      setKeys(data);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) {
        setError('Failed to load API keys');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleCreate = async (newKey: ApiKeyInfo) => {
    if (newKey.key) {
      setNewlyCreatedKey(newKey.key);
    }
    setKeys((prev) => [newKey, ...prev]);
    setShowCreate(false);
  };

  const handleDelete = async (keyId: string) => {
    try {
      // When 2FA is enabled the first call returns STEP_UP_REQUIRED; the hook
      // opens the TOTP modal and replays with the code. When 2FA is disabled
      // the first call succeeds immediately.
      await stepUp.runWithStepUp((code) =>
        api.delete(`/market/api-keys/${keyId}`, { twoFactorCode: code }),
      );
      setKeys((prev) => prev.filter((k) => k.id !== keyId));
    } catch (err) {
      if (err instanceof Error && err.message === 'Cancelled') return;
      setError(err instanceof ApiError ? err.message : 'Failed to revoke key');
    }
  };

  const handleRename = async (keyId: string, label: string | null) => {
    try {
      const updated = await api.patch<ApiKeyInfo>(`/market/api-keys/${keyId}`, { label });
      setKeys((prev) => prev.map((k) => (k.id === keyId ? updated : k)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to rename key');
    }
  };

  if (!user) {
    return (
      <div
        className="min-h-[60vh] flex items-center justify-center flex-col gap-3"
        style={{ background: 'var(--bg)' }}
      >
        <Key className="w-10 h-10 text-zinc-600" strokeWidth={1.5} />
        <p className="text-zinc-500">Sign in to manage your API keys</p>
      </div>
    );
  }

  const activeCount = keys.filter(
    (k) => k.lastUsedAt && new Date(k.lastUsedAt).getTime() > Date.now() - 30 * 24 * 60 * 60 * 1000,
  ).length;
  const idleCount = keys.filter(
    (k) =>
      k.lastUsedAt && new Date(k.lastUsedAt).getTime() <= Date.now() - 30 * 24 * 60 * 60 * 1000,
  ).length;
  const unusedCount = keys.filter((k) => !k.lastUsedAt).length;

  return (
    <div style={{ background: 'var(--bg)' }} className="min-h-screen py-8">
      <div className="max-w-5xl mx-auto px-4">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-light text-white mb-2">
            <GradientText gradient="purple">API Keys</GradientText>
          </h1>
          <p className="text-sm text-zinc-400">
            Create and manage API keys for programmatic access to Atlas. Each key is signed,
            auditable, and can be independently revoked.
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <KeyStatCard
            icon={<Key className="w-3.5 h-3.5" />}
            label="Total keys"
            value={keys.length.toString()}
            accent="#14F195"
          />
          <KeyStatCard
            icon={<Activity className="w-3.5 h-3.5" />}
            label="Active"
            value={activeCount.toString()}
            accent="#22c55e"
          />
          <KeyStatCard
            icon={<Clock className="w-3.5 h-3.5" />}
            label="Idle"
            value={idleCount.toString()}
            accent="#f59e0b"
          />
          <KeyStatCard
            icon={<TrendingUp className="w-3.5 h-3.5" />}
            label="Unused"
            value={unusedCount.toString()}
            accent="#6b7280"
          />
        </div>

        {error && (
          <div
            className="mb-6 p-3 rounded-lg border flex items-center gap-2 text-sm"
            style={{
              borderColor: 'rgba(239,68,68,0.3)',
              background: 'rgba(239,68,68,0.05)',
              color: '#ef4444',
            }}
          >
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {error}
            <button
              onClick={() => setError('')}
              className="ml-auto text-red-400/60 hover:text-red-400"
            >
              ×
            </button>
          </div>
        )}

        {newlyCreatedKey && (
          <KeyCreationBanner
            keyValue={newlyCreatedKey}
            onDismiss={() => setNewlyCreatedKey(null)}
          />
        )}

        {showCreate && (
          <CreateKeyForm
            onCreated={handleCreate}
            onCancel={() => setShowCreate(false)}
            isLoading={creating}
          />
        )}

        {!showCreate && (
          <div className="mb-8">
            <ShimmerButton
              onClick={() => setShowCreate(true)}
              className="text-white text-sm px-5 py-2.5 rounded-lg transition-all inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" /> Create API key
            </ShimmerButton>
          </div>
        )}

        {/* Keys list */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="skeleton h-24 rounded-xl"
                style={{ background: 'rgba(255,255,255,0.08)' }}
              />
            ))}
          </div>
        ) : keys.length === 0 ? (
          <div
            className="rounded-xl p-12 text-center"
            style={{
              border: '1px dashed rgba(255,255,255,0.1)',
              background: 'rgba(0,0,0,0.3)',
            }}
          >
            <Key className="w-10 h-10 text-zinc-700 mx-auto mb-3" strokeWidth={1} />
            <h3 className="text-base font-light text-white mb-2">No API keys yet</h3>
            <p className="text-sm text-zinc-500 mb-6 max-w-sm mx-auto">
              Create your first API key to start building with Atlas&apos;s agents and repositories
              programmatically.
            </p>
          </div>
        ) : (
          <div className="space-y-3 mb-8">
            {keys.map((k, idx) => (
              <motion.div
                key={k.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay: Math.min(idx * 0.04, 0.3),
                  duration: 0.28,
                  ease: [0.22, 0.61, 0.36, 1],
                }}
              >
                <KeyListItem keyInfo={k} onDelete={handleDelete} onRename={handleRename} />
              </motion.div>
            ))}
          </div>
        )}

        {/* Integration panel */}
        <div className="mb-8">
          <IntegrationPanel />
        </div>

        {/* Security footer */}
        <div
          className="p-5 rounded-xl border"
          style={{
            borderColor: 'rgba(255,255,255,0.08)',
            background: 'rgba(0,0,0,0.25)',
          }}
        >
          <h3 className="text-sm font-light text-white mb-3 flex items-center gap-2">
            <Shield className="w-4 h-4 text-atlas-400" /> Security best practices
          </h3>
          <ul className="space-y-2 text-xs text-zinc-400 font-light">
            <li>• Never expose API keys in client-side code or public repositories</li>
            <li>• Store keys securely as environment variables (use dotenv or secrets manager)</li>
            <li>• Rotate keys regularly and revoke unused ones</li>
            <li>• Each key is cryptographically signed — all usage is auditable on-chain</li>
          </ul>
        </div>
      </div>

      <VerificationCodeModal
        open={stepUp.stepUpOpen}
        onClose={stepUp.dismiss}
        onSubmit={stepUp.submit}
        title="Revoke API key"
        subtitle={
          stepUp.stepUpMessage || 'Enter the 6-digit code from your authenticator app to confirm.'
        }
        source={stepUp.stepUpSource}
      />
    </div>
  );
}
