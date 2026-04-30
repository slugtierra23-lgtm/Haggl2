'use client';

export const dynamic = 'force-dynamic';

import { motion } from 'framer-motion';
import {
  Bot,
  ChevronDown,
  WifiOff,
  X,
  Key,
  Plus,
  Trash2,
  Copy,
  Search,
  ShoppingBag,
} from 'lucide-react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import React, { Suspense, useState, useEffect, useCallback, useRef, useMemo } from 'react';

import { AtlasListingCard, AtlasListingCardSkeleton } from '@/components/atlas';
import { Badge } from '@/components/ui/badge';
import { PaymentConsentModal, type PaymentMethod } from '@/components/ui/payment-consent-modal';
import { api, ApiError } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/AuthProvider';
import { getCachedWithStatus, setCached as setCachedEntry } from '@/lib/cache/pageCache';
import { useKeyboardFocus } from '@/lib/hooks/useKeyboardFocus';
import { useWalletPicker } from '@/lib/hooks/useWalletPicker';
import { platformWeiForSeller, grossWeiForSeller } from '@/lib/payments/fees';
import {
  encodeErc20Transfer,
  loadHagglTokenConfig,
  usdToTokenUnits,
} from '@/lib/wallet/haggl-token';
import { isEscrowEnabled, getEscrowAddress, escrowDeposit } from '@/lib/wallet/escrow';
import { getMetaMaskProvider } from '@/lib/wallet/ethereum';

// ── Types ──────────────────────────────────────────────────────────────────────

interface MarketListing {
  id: string;
  createdAt: string;
  title: string;
  description: string;
  type: 'REPO' | 'BOT' | 'SCRIPT' | 'AI_AGENT' | 'OTHER';
  price: number;
  currency: string;
  minPrice?: number | null;
  tags: string[];
  status: string;
  agentUrl?: string | null;
  agentEndpoint?: string | null;
  hasAgentEndpoint?: boolean;
  fileKey?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  fileMimeType?: string | null;
  seller: { id: string; username: string | null; avatarUrl: string | null };
  reviewAverage?: number | null;
  reviewCount?: number;
}

interface ApiKeyInfo {
  id: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

interface NegotiationMessage {
  id: string;
  createdAt: string;
  fromRole: 'buyer' | 'seller' | 'buyer_agent' | 'seller_agent' | 'system';
  content: string;
  proposedPrice?: number | null;
}

interface Negotiation {
  id: string;
  status: 'ACTIVE' | 'AGREED' | 'REJECTED' | 'EXPIRED';
  agreedPrice?: number | null;
  mode: 'AI_AI' | 'HUMAN';
  humanSwitchRequestedBy?: string | null;
  listing: {
    id: string;
    title: string;
    price: number;
    currency: string;
    sellerId: string;
    agentEndpoint?: string | null;
    minPrice?: number | null;
  };
  buyer: { id: string; username: string | null };
  messages: NegotiationMessage[];
}

interface UploadedFileMeta {
  fileKey: string;
  fileName: string;
  fileSize: number;
  fileMimeType: string;
  scanPassed?: boolean;
  scanNote?: string;
}

interface SecurityScan {
  passed: boolean;
  score: number;
  issues: { severity: 'critical' | 'high' | 'medium' | 'low'; message: string }[];
}

// ── Constants ──────────────────────────────────────────────────────────────────

const TYPES = ['ALL', 'AI_AGENT', 'BOT', 'SCRIPT', 'OTHER'];
const TYPE_LABELS: Record<string, string> = {
  ALL: 'All',
  AI_AGENT: 'AI Agent',
  BOT: 'Bot',
  SCRIPT: 'Script',
  OTHER: 'Other',
};
const TYPE_COLORS: Record<string, string> = {
  BOT: 'text-atlas-400/80 border-atlas-400/25 bg-atlas-400/5',
  AI_AGENT: 'text-atlas-400/70 border-atlas-400/20 bg-atlas-400/5',
  SCRIPT: 'text-zinc-400 border-zinc-600/30 bg-zinc-800/30',
  OTHER: 'text-zinc-400 border-zinc-600/30 bg-zinc-800/30',
};
const ACCEPTS_FILE = new Set(['AI_AGENT', 'BOT', 'SCRIPT', 'OTHER']);
const ACCEPTS_AGENT_ENDPOINT = new Set(['AI_AGENT', 'BOT']);

const AGENT_CATEGORIES = {
  AI_AGENT: {
    name: 'AI Agent',
    subcategories: [
      'LLM Assistant',
      'Data Analysis',
      'Content Generation',
      'Automation',
      'Code Generation',
      'Other',
    ],
  },
  BOT: {
    name: 'Bot',
    subcategories: [
      'Discord Bot',
      'Telegram Bot',
      'Twitter Bot',
      'Chat Bot',
      'Utility Bot',
      'Other',
    ],
  },
  SCRIPT: {
    name: 'Script',
    subcategories: [
      'Python Script',
      'JavaScript/Node',
      'Shell Script',
      'Automation',
      'Data Processing',
      'Other',
    ],
  },
  OTHER: {
    name: 'Other',
    subcategories: ['Tool', 'Plugin', 'Extension', 'Template', 'Library', 'Other'],
  },
};

const PRICING_TIERS = [
  { label: 'Free', value: '0', description: 'No cost' },
  { label: 'Pay-per-use', value: 'usage', description: 'Based on usage' },
  { label: 'Fixed Price', value: 'fixed', description: 'One-time payment' },
  { label: 'Subscription', value: 'subscription', description: 'Recurring payment' },
];

const AGENT_TYPE_INFO: Record<string, { description: string; examples: string[] }> = {
  AI_AGENT: {
    description: 'LLM-powered agents that can think and make decisions autonomously',
    examples: ['Data analysis', 'Content generation', 'Code generation', 'Research assistant'],
  },
  BOT: {
    description: 'Bots that integrate with platforms like Discord, Telegram, or Slack',
    examples: ['Discord moderation', 'Twitter automation', 'Telegram assistant', 'Chat support'],
  },
  SCRIPT: {
    description: 'Standalone scripts and automation tools for developers',
    examples: ['Data processing', 'Report generation', 'System automation', 'Batch operations'],
  },
  OTHER: {
    description: 'Tools, plugins, extensions, and other technical products',
    examples: ['Browser extension', 'IDE plugin', 'Template', 'Library'],
  },
};

// Generate README content
const generateReadme = (form: any, tiers?: any[]): string => {
  const tierSection =
    tiers && tiers.length > 0
      ? `\n${tiers.map((tier) => `- **${tier.name}**: $${tier.price}/month`).join('\n')}`
      : `- **Basic**: $${form.price}/month`;

  return `# ${form.title || 'Agent'}

${form.description || 'Agent description'}

## Features

- Core functionality overview
- Support for ${form.type === 'AI_AGENT' ? 'AI-powered operations' : form.type === 'BOT' ? 'bot integration' : 'automation'}
- Easy integration with existing systems

## Getting Started

### Installation

\`\`\`bash
npm install @haggl/${form.title?.toLowerCase().replace(/\\s+/g, '-') || 'agent'}
\`\`\`

### Basic Usage

\`\`\`python
import haggl

agent = haggl.Agent(
    api_key="YOUR_API_KEY",
    endpoint="https://api.haggl.tech/agents/${form.title?.toLowerCase().replace(/\\s+/g, '-') || 'agent'}"
)

result = agent.invoke(input="Your input here")
print(result.output)
\`\`\`

## Configuration

The agent can be configured with the following options:

- **api_key**: Your Atlas API key
- **timeout**: Request timeout in seconds (default: 30)
- **retry**: Number of retries on failure (default: 3)

## API Reference

### invoke(input, context)

Invoke the agent with the given input.

**Parameters:**
- \`input\` (string): The input for the agent
- \`context\` (dict, optional): Additional context data

**Returns:**
- Response object with \`output\` and \`metadata\`

## Pricing
${tierSection}

## Support

For questions and support, contact the Atlas team.

## License

MIT License - See LICENSE file for details

---

Built with love on Atlas Marketplace
`;
};

// Generate security scan results
const generateSecurityScan = (fileName: string): SecurityScan => {
  const issues: Array<{ severity: 'critical' | 'high' | 'medium' | 'low'; message: string }> = [];
  const seed = fileName.charCodeAt(0) || 0;

  // Simulate scan results based on file type
  if (fileName.includes('.py')) {
    if (seed % 3 === 0) {
      issues.push({
        severity: 'low' as const,
        message: 'Consider using environment variables for sensitive data',
      });
    }
    if (seed % 5 === 0) {
      issues.push({
        severity: 'medium' as const,
        message: 'Update dependencies to latest versions',
      });
    }
  } else if (fileName.includes('.js') || fileName.includes('.ts')) {
    if (seed % 4 === 0) {
      issues.push({
        severity: 'low' as const,
        message: 'Recommend using strict mode',
      });
    }
  }

  const score =
    100 -
    issues.reduce((acc, i) => {
      const weights: Record<'critical' | 'high' | 'medium' | 'low', number> = {
        critical: 30,
        high: 20,
        medium: 10,
        low: 5,
      };
      return acc - (weights[i.severity] || 0);
    }, 0);

  return {
    passed: score >= 70,
    score: Math.max(score, 0),
    issues,
  };
};

// Generate analytics data
const generateAnalyticsData = (agentName: string) => {
  const seed = agentName.length;
  return {
    totalRevenue: 2450 + seed * 150,
    requestsMonth: 1240 + seed * 80,
    avgResponseTime: 145 + seed * 5,
    successRate: 98.5 + (seed % 1.4),
    topIntegration: 'Python SDK',
    users: 12 + seed,
    dailyRequests: Array.from({ length: 30 }, (_, i) => ({
      day: i + 1,
      requests: Math.floor(Math.random() * 60 + 20),
    })),
    pricingTiers: {
      Free: 35,
      Pro: 45,
      Enterprise: 20,
    },
  };
};

// Generate code snippets for integration
const codeSnippets = {
  python: (agentName: string) => `import requests

# Invoke agent
response = requests.post(
    "https://api.haggl.tech/agents/${agentName.toLowerCase().replace(/\\s+/g, '-')}/invoke",
    json={
        "input": "Your agent input here",
        "context": {}
    },
    headers={
        "Authorization": f"Bearer {YOUR_API_KEY}"
    }
)

result = response.json()
print(result.get("output"))`,

  javascript: (agentName: string) => `// Invoke agent
const response = await fetch(
  'https://api.haggl.tech/agents/${agentName.toLowerCase().replace(/\\s+/g, '-')}/invoke',
  {
    method: 'POST',
    headers: {
      'Authorization': \`Bearer \${YOUR_API_KEY}\`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      input: 'Your agent input here',
      context: {}
    })
  }
);

const result = await response.json();
console.log(result.output);`,

  curl: (agentName: string) => `curl -X POST \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "input": "Your agent input here",
    "context": {}
  }' \\
  https://api.haggl.tech/agents/${agentName.toLowerCase().replace(/\\s+/g, '-')}/invoke`,
};

// Generate OpenAPI-like documentation
const generateApiDocs = (form: any): string => {
  const slug = form.title
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '');

  return `{
  "openapi": "3.0.0",
  "info": {
    "title": "${form.title || 'Agent API'}",
    "description": "${form.description?.substring(0, 100) || 'Agent API'}",
    "version": "1.0.0"
  },
  "servers": [
    {
      "url": "https://api.haggl.tech/agents/${slug}",
      "description": "Production server"
    }
  ],
  "paths": {
    "/invoke": {
      "post": {
        "summary": "Invoke the agent",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": { "type": "string" },
                  "context": { "type": "object" }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Successful response",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "output": { "type": "string" },
                    "metadata": { "type": "object" }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}`;
};

const ROLE_LABELS: Record<string, string> = {
  buyer: 'you',
  seller: 'seller',
  buyer_agent: 'your agent',
  seller_agent: 'agent',
};
const ROLE_COLORS: Record<string, string> = {
  buyer: 'bg-atlas-500/10 border-atlas-500/20 text-atlas-300',
  seller: 'bg-zinc-800/50 border-zinc-700/30 text-zinc-300',
  buyer_agent: 'bg-atlas-500/8 border-atlas-500/15 text-atlas-200',
  seller_agent: 'bg-atlas-500/10 border-atlas-500/15 text-atlas-300',
};

const FIELD_HELP = {
  webhook:
    'Endpoint for AI-to-AI negotiations. Buyers can negotiate directly with your agent through this webhook.',
  category: 'Choose the primary category for better discoverability in the marketplace.',
  keywords:
    'Help people find your agent. Use terms that describe what it does (analytics, nlp, automation).',
  tags: 'Multiple tags increase visibility. Use 4-6 relevant tags separated by commas.',
  price: 'Base price for your agent. Set to 0 for free or use pricing models for flexible pricing.',
  floorPrice: 'Minimum acceptable price. Leave empty to allow any price in negotiations.',
};

// Validators
const validators = {
  url: (url: string): boolean => {
    if (!url.trim()) return true;
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  },
  price: (price: string): boolean => {
    if (!price.trim()) return true;
    const num = parseFloat(price);
    return !isNaN(num) && num >= 0;
  },
  tags: (tags: string): number => {
    return tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean).length;
  },
};

// Tips for users
const getTips = {
  tags: (count: number): string | null => {
    if (count === 0) return 'Add tags to improve discoverability in search';
    if (count < 4)
      return `Add ${4 - count} more tag${4 - count > 1 ? 's' : ''} for optimal visibility (4-6 recommended)`;
    if (count > 6) return `Consider using ${count - 2}-${count - 1} tags for cleaner presentation`;
    return null;
  },
  title: (length: number): string | null => {
    if (length === 0) return 'Give your agent a clear, descriptive name';
    if (length < 10) return 'Make your title more descriptive for better search results';
    return null;
  },
  description: (length: number): string | null => {
    if (length === 0) return 'Describe what your agent does and who should use it';
    if (length < 50) return 'Add more details about features and benefits';
    return null;
  },
};

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Negotiation Modal ──────────────────────────────────────────────────────────

const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// ── Agent Card ────────────────────────────────────────────────────────────────

function AgentCard({
  listing,
  isAuthenticated: _isAuthenticated,
  onBuy: _onBuy,
}: {
  listing: MarketListing;
  isAuthenticated: boolean;
  onBuy: () => void;
}) {
  const hasEndpoint = Boolean(listing.hasAgentEndpoint || listing.agentEndpoint);
  return (
    <AtlasListingCard
      href={`/market/agents/${listing.id}`}
      title={listing.title}
      typeLabel={hasEndpoint ? 'Live agent' : 'Agent'}
      typeIcon={<Bot className="w-2.5 h-2.5" strokeWidth={2.5} />}
      typeAccent={hasEndpoint ? '#22c55e' : 'var(--brand)'}
      tags={listing.tags}
      price={listing.price}
      currency={listing.currency}
      rating={listing.reviewAverage ?? null}
      reviewCount={listing.reviewCount}
      seller={listing.seller}
    />
  );
}

// ── API Key Manager ────────────────────────────────────────────────────────────

function ApiKeyManager({ listing }: { listing: MarketListing }) {
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [generating, setGenerating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<ApiKeyInfo[]>(`/market/${listing.id}/apikeys`)
      .then(setKeys)
      .catch(() => setError('Failed to load API keys'))
      .finally(() => setLoading(false));
  }, [listing.id]);

  const generate = async () => {
    setGenerating(true);
    setError('');
    try {
      const result = await api.post<{ key: string; label: string | null }>(
        `/market/${listing.id}/apikeys`,
        { label: newKeyLabel.trim() || undefined },
      );
      setRevealedKey(result.key);
      setNewKeyLabel('');
      // Refresh list (won't show raw key again)
      const updated = await api.get<ApiKeyInfo[]>(`/market/${listing.id}/apikeys`);
      setKeys(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to generate key');
    } finally {
      setGenerating(false);
    }
  };

  const revoke = async (keyId: string) => {
    setRevokingId(keyId);
    setError('');
    try {
      await api.delete(`/market/apikeys/${keyId}`);
      setKeys((prev) => prev.filter((k) => k.id !== keyId));
      setConfirmRevokeId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to revoke key');
    } finally {
      setRevokingId(null);
    }
  };

  const copyKey = async (key: string) => {
    await navigator.clipboard.writeText(key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="mt-3 rounded-xl border"
      style={{ borderColor: 'rgba(20, 241, 149, 0.15)', background: 'rgba(20, 241, 149, 0.03)' }}
    >
      <div
        className="flex items-center gap-2 px-3 py-2 border-b"
        style={{ borderColor: 'rgba(20, 241, 149, 0.1)' }}
      >
        <Key className="w-3 h-3 text-atlas-400" />
        <span className="text-atlas-400 font-mono text-xs font-light">API Keys</span>
        <span className="text-zinc-600 font-mono text-xs ml-auto">{keys.length}/3</span>
      </div>

      {/* Revealed key banner */}
      {revealedKey && (
        <div
          className="mx-3 mt-3 rounded-lg p-3"
          style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)' }}
        >
          <p className="text-green-400 font-mono text-xs font-light mb-1">
            ✓ New key generated — save it now, it won&apos;t be shown again
          </p>
          <div className="flex items-center gap-2 mt-1">
            <code className="text-green-300 font-mono text-xs flex-1 break-all">{revealedKey}</code>
            <button
              onClick={() => copyKey(revealedKey)}
              className="text-xs font-mono px-2 py-1 rounded shrink-0 transition-all"
              style={{
                background: 'rgba(34,197,94,0.15)',
                border: '1px solid rgba(34,197,94,0.3)',
                color: copied ? '#4ade80' : '#86efac',
              }}
            >
              {copied ? '✓ copied' : <Copy className="w-3 h-3" />}
            </button>
            <button
              onClick={() => setRevealedKey(null)}
              className="text-zinc-500 hover:text-zinc-300"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      {/* Key list */}
      <div className="px-3 pt-2 pb-1 space-y-2">
        {loading && <p className="text-zinc-600 font-mono text-xs py-1">loading...</p>}
        {!loading && keys.length === 0 && (
          <p className="text-zinc-600 font-mono text-xs py-1">no keys yet</p>
        )}
        {keys.map((k) => (
          <div
            key={k.id}
            className="flex items-center gap-2 py-1.5 border-b"
            style={{ borderColor: 'rgba(255,255,255,0.04)' }}
          >
            <div className="flex-1 min-w-0">
              <p className="text-zinc-300 font-mono text-xs font-light">
                {k.label || 'unnamed key'}
              </p>
              <p className="text-zinc-600 font-mono text-xs">
                created {timeAgo(k.createdAt)}
                {k.lastUsedAt ? ` · last used ${timeAgo(k.lastUsedAt)}` : ' · never used'}
              </p>
            </div>
            {confirmRevokeId === k.id ? (
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-zinc-500 font-mono text-xs">revoke?</span>
                <button
                  onClick={() => revoke(k.id)}
                  disabled={revokingId === k.id}
                  className="text-red-400 font-mono text-xs px-2 py-0.5 rounded disabled:opacity-40"
                  style={{
                    border: '1px solid rgba(239,68,68,0.3)',
                    background: 'rgba(239,68,68,0.05)',
                  }}
                >
                  {revokingId === k.id ? '...' : 'yes'}
                </button>
                <button
                  onClick={() => setConfirmRevokeId(null)}
                  className="text-zinc-500 font-mono text-xs px-2 py-0.5 rounded"
                  style={{ border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  no
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmRevokeId(k.id)}
                className="text-zinc-600 hover:text-red-400 transition-colors shrink-0"
                title="Revoke key"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Generate new key */}
      {keys.length < 3 && (
        <div className="flex gap-2 px-3 pb-3 pt-1">
          <input
            type="text"
            value={newKeyLabel}
            onChange={(e) => setNewKeyLabel(e.target.value)}
            placeholder="label (optional)"
            maxLength={40}
            className="flex-1 text-xs px-2 py-1.5 rounded-lg font-mono"
            style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: '#e4e4e7',
              outline: 'none',
            }}
          />
          <button
            onClick={generate}
            disabled={generating}
            className="text-xs font-mono px-3 py-1.5 rounded-lg flex items-center gap-1 disabled:opacity-40 transition-all"
            style={{
              background: 'rgba(20, 241, 149, 0.15)',
              border: '1px solid rgba(20, 241, 149, 0.3)',
              color: '#a7f3d0',
            }}
          >
            {generating ? (
              '...'
            ) : (
              <>
                <Plus className="w-3 h-3" /> generate
              </>
            )}
          </button>
        </div>
      )}
      {error && <p className="text-red-400 font-mono text-xs px-3 pb-2">{error}</p>}
    </div>
  );
}

// ── My Agent Card (publications) ──────────────────────────────────────────────

function MyAgentCard({
  listing,
  onDelete,
}: {
  listing: MarketListing;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const handleDelete = async () => {
    setDeleting(true);
    setDeleteError('');
    try {
      await api.delete(`/market/${listing.id}`);
      onDelete(listing.id);
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
        borderColor: expanded ? 'rgba(20, 241, 149, 0.25)' : 'rgba(255,255,255,0.07)',
        background: 'var(--bg-card)',
      }}
    >
      <div className="flex items-center gap-3 p-3">
        {/* Type icon */}
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
          style={{
            background: 'rgba(20, 241, 149, 0.1)',
            border: '1px solid rgba(20, 241, 149, 0.2)',
          }}
        >
          <Bot className="w-4 h-4 text-atlas-400" strokeWidth={1.5} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-light text-zinc-100 truncate">{listing.title}</h3>
            <Badge
              className={`rounded-full border border-dashed px-2 py-0 text-xs font-mono ${TYPE_COLORS[listing.type] || TYPE_COLORS.OTHER}`}
            >
              {listing.type.toLowerCase().replace('_', ' ')}
            </Badge>
            {listing.status === 'ACTIVE' ? (
              <Badge
                className="rounded-full px-2 py-0 text-[10px] font-mono"
                style={{
                  background: 'rgba(20, 241, 149, 0.12)',
                  boxShadow: 'inset 0 0 0 1px rgba(20, 241, 149, 0.35)',
                  color: '#6EE7B7',
                }}
              >
                <span className="inline-block h-1 w-1 rounded-full bg-emerald-400 mr-1 animate-pulse align-middle" />
                live
              </Badge>
            ) : listing.status === 'REMOVED' ? (
              <Badge
                className="rounded-full px-2 py-0 text-[10px] font-mono inline-flex items-center gap-1"
                style={{
                  background: 'rgba(244,63,94,0.12)',
                  boxShadow: 'inset 0 0 0 1px rgba(244,63,94,0.35)',
                  color: '#FDA4AF',
                }}
                title="Webhook failed health-checks. Fix your endpoint to reactivate."
              >
                <WifiOff className="w-2.5 h-2.5" />
                offline
              </Badge>
            ) : (
              <Badge
                className="rounded-full px-2 py-0 text-[10px] font-mono"
                style={{
                  background: 'rgba(251,191,36,0.12)',
                  boxShadow: 'inset 0 0 0 1px rgba(251,191,36,0.35)',
                  color: '#FCD34D',
                }}
              >
                {listing.status.toLowerCase().replace('_', ' ')}
              </Badge>
            )}
            {listing.agentEndpoint && (
              <Badge className="rounded-full bg-atlas-500/15 border border-atlas-500/25 px-2 py-0 text-xs font-mono text-atlas-400">
                AI endpoint
              </Badge>
            )}
            {listing.fileKey && (
              <Badge className="rounded-full bg-zinc-800/60 border border-white/08 px-2 py-0 text-xs font-mono text-zinc-500">
                file uploaded
              </Badge>
            )}
          </div>
          <p className="text-xs text-zinc-500 mt-0.5">
            <span className="font-mono font-light text-atlas-300">
              {listing.price} {listing.currency}
            </span>
            {listing.minPrice != null && (
              <span className="text-zinc-600"> · floor: {listing.minPrice}</span>
            )}
            <span className="text-zinc-700"> · {timeAgo(listing.createdAt)}</span>
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Link
            href={`/market/agents/${listing.id}`}
            className="text-xs font-mono px-2.5 py-1.5 rounded-lg text-zinc-500 border border-dashed border-zinc-700/40 hover:text-zinc-300 hover:border-zinc-600/60 transition-all"
          >
            view
          </Link>
          <button
            onClick={() => setExpanded((p) => !p)}
            className="text-xs font-mono px-2.5 py-1.5 rounded-lg transition-all"
            style={{
              background: expanded ? 'rgba(20, 241, 149, 0.15)' : 'transparent',
              border: `1px solid ${expanded ? 'rgba(20, 241, 149, 0.3)' : 'rgba(255,255,255,0.08)'}`,
              color: expanded ? '#a7f3d0' : '#71717a',
            }}
          >
            {expanded ? 'collapse' : 'manage'}
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
              title="Delete listing"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
      {deleteError && <p className="text-red-400 font-mono text-xs px-3 pb-2">{deleteError}</p>}
      {expanded && (
        <div className="px-3 pb-3">
          <ApiKeyManager listing={listing} />
        </div>
      )}
    </div>
  );
}

// ── Create Listing Form ────────────────────────────────────────────────────────

// ── SaaS chrome ────────────────────────────────────────────────────────────────

const AGENT_SNIPPETS: Record<'curl' | 'node' | 'python', string> = {
  curl: `curl -X POST https://api.haggl.tech/v1/agents/invoke \\
  -H "Authorization: Bearer $HAGGL_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "agentId": "agt_...",
    "input": { "task": "summarize", "url": "https://..." }
  }'`,
  node: `import { Atlas } from "@haggl/sdk";

const haggl = new Haggl({ apiKey: process.env.HAGGL_API_KEY });

const run = await haggl.agents.invoke({
  agentId: "agt_...",
  input: { task: "summarize", url: "https://..." },
});

console.log(run.output);`,
  python: `from haggl import Haggl

haggl = Haggl(api_key=os.environ["HAGGL_API_KEY"])

run = haggl.agents.invoke(
    agent_id="agt_...",
    input={"task": "summarize", "url": "https://..."},
)

print(run.output)`,
};

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function AgentsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" style={{ background: 'var(--bg)' }} />}>
      <AgentsPageContent />
    </Suspense>
  );
}

type SortKey = 'recent' | 'price-low' | 'price-high' | 'rating';

function AgentsPageContent() {
  const { isAuthenticated, user, refresh } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab = searchParams?.get('tab') === 'mine' ? 'mine' : 'market';

  const [activeTab, setActiveTab] = useState<'market' | 'mine'>(initialTab);
  const [listings, setListings] = useState<MarketListing[]>([]);
  const [myListings, setMyListings] = useState<MarketListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [myLoading, setMyLoading] = useState(false);
  // Hydrate filters from the URL so deep-links and back-nav keep state.
  const [type, setType] = useState<string>(searchParams?.get('type') ?? 'ALL');
  const [search, setSearch] = useState(searchParams?.get('q') ?? '');
  // Debounced mirror — only this value hits the API so typing doesn't
  // fire a request per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [sort, setSort] = useState<SortKey>((searchParams?.get('sort') as SortKey) ?? 'recent');
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);
  const [error, setError] = useState('');
  const [mobileBlock, setMobileBlock] = useState(false);

  // ── Direct buy state ──────────────────────────────────────────────────────
  const { pickWallet, pickerElement: buyWalletPicker } = useWalletPicker();
  const [buyingListing, setBuyingListing] = useState<MarketListing | null>(null);
  const [buyConsentData, setBuyConsentData] = useState<{
    sellerWallet: string;
    buyerAddress: string;
    /** Seller's net amount in SOL (the listing price) — wei is computed at sign time. */
    baseEth: number;
    baseUsd: number;
    hagglDisabled: boolean;
  } | null>(null);
  const [buyPaying, setBuyPaying] = useState(false);
  const [buyError, setBuyError] = useState('');
  const [buySuccess, setBuySuccess] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  useKeyboardFocus(searchRef);

  // Mobile gate for the 6-step deploy wizard — the UI was designed for
  // desktop only (sandbox testing, file picker, long forms). Detect via
  // viewport width so tablets in landscape keep working.
  const isMobile = () => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 767px)').matches;
  };

  const attemptDeploy = () => {
    router.push('/market/agents/publish');
  };

  // Sync tab to URL
  useEffect(() => {
    const tab = searchParams?.get('tab');
    if (tab === 'mine') setActiveTab('mine');
    else setActiveTab('market');
  }, [searchParams]);

  // Open deploy form when other pages redirect with ?new=1. The
  // /publish page is mobile-friendly so no more auto-triggered
  // mobile-block modal for anyone who lands here via a deep link.
  useEffect(() => {
    if (!isAuthenticated) return;
    if (searchParams?.get('new') === '1') {
      router.replace('/market/agents/publish');
    }
  }, [searchParams, isAuthenticated, router]);

  // Debounce the search input → hitting the API per keystroke is wasteful.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Keep the URL in sync with the active filters so deep-links, back
  // nav, and tab restore all work. Only on the market tab — `mine`
  // doesn't filter.
  useEffect(() => {
    if (activeTab !== 'market') return;
    const params = new URLSearchParams();
    if (type !== 'ALL') params.set('type', type);
    if (debouncedSearch) params.set('q', debouncedSearch);
    if (sort !== 'recent') params.set('sort', sort);
    const qs = params.toString();
    router.replace(qs ? `/market/agents?${qs}` : '/market/agents', { scroll: false });
  }, [type, debouncedSearch, sort, activeTab, router]);

  const fetchListings = useCallback(async () => {
    const params = new URLSearchParams();
    // Don't restrict /market/agents to AI_AGENT type only — bots and
    // scripts also surface in the live trades feed and the user expects
    // them here too. REPOs have their own /market/repos page; we filter
    // them client-side after the fetch instead of forcing a server-side
    // type filter that hides bots/scripts.
    if (type !== 'ALL') params.set('type', type);
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (sort) params.set('sortBy', sort);
    const cacheKey = `market:agents:${params.toString()}`;
    // Stale-while-revalidate: seed from cache so the grid paints
    // instantly on back-nav, then refetch in the background. We
    // bump the freshness window to 2 min (vs the global 30 s
    // default) for marketplace lists — listings change slowly and
    // the user feels filter changes far more than 1-min staleness.
    const cached = getCachedWithStatus<MarketListing[]>(cacheKey, 120_000);
    if (cached.data) {
      setListings(cached.data);
      setLoading(false);
      if (cached.fresh) return; // skip refetch; data is < 2 min old
    } else {
      setLoading(true);
    }
    setError('');
    try {
      const data = await api.get<{ data: MarketListing[] } | MarketListing[]>(`/market?${params}`);
      // Tolerate both shapes: legacy {data: []} envelope and the raw
      // array we sometimes get back.
      const all = Array.isArray(data) ? data : (data?.data ?? []);
      const rows = all.filter((r) => {
        // Drop REPO listings — they belong on /market/repos.
        if (r.type === 'REPO') return false;
        // Drop legacy "bolty"-named listings (seed leftovers, etc).
        const title = (r.title || '').toLowerCase();
        const username = (r.seller?.username || '').toLowerCase();
        const tags = (r.tags || []).map((t) => t.toLowerCase());
        if (title.includes('bolty') || username.includes('bolty') || tags.includes('bolty')) {
          return false;
        }
        return true;
      });
      setListings(rows);
      setCachedEntry(cacheKey, rows);
    } catch (err) {
      // 401 → session expired, bounce to login and preserve the URL
      // so they come back here after auth.
      if (err instanceof ApiError && err.status === 401) {
        router.push(`/auth/login?redirect=${encodeURIComponent('/market/agents')}`);
        return;
      }
      // If we had cached data leave it on screen; only flash the empty
      // state + error when we have nothing to show.
      if (!cached.data) {
        const msg =
          err instanceof ApiError
            ? `Couldn't load listings: ${err.message}`
            : 'Network error — check your connection and try again.';
        setError(msg);
        setListings([]);
      }
    } finally {
      setLoading(false);
    }
  }, [type, debouncedSearch, sort, router]);

  const fetchMyListings = useCallback(async () => {
    if (!isAuthenticated || !user) return;
    setMyLoading(true);
    try {
      const data = await api.get<{ data: MarketListing[] }>('/market/my-listings');
      setMyListings(data.data);
    } catch {
      setError('Failed to load your listings');
    } finally {
      setMyLoading(false);
    }
  }, [isAuthenticated, user]);

  useEffect(() => {
    fetchListings();
  }, [fetchListings]);

  useEffect(() => {
    if (activeTab === 'mine' && isAuthenticated) fetchMyListings();
  }, [activeTab, fetchMyListings, isAuthenticated]);

  // Stable, pre-computed stats for the hero — recompute only when
  // the listings array itself changes (not on every keystroke).
  const stats = useMemo(() => {
    const total = listings.length;
    const aiNative = listings.filter((l) => l.type === 'AI_AGENT').length;
    return { total, aiNative };
  }, [listings]);

  // Optional client-side sort — falls back when the server doesn't
  // honour `sortBy`. Keeps the UX consistent across backends.
  const sortedListings = useMemo(() => {
    const rows = [...listings];
    switch (sort) {
      case 'price-low':
        rows.sort((a, b) => a.price - b.price);
        break;
      case 'price-high':
        rows.sort((a, b) => b.price - a.price);
        break;
      case 'rating':
        rows.sort((a, b) => (b.reviewAverage ?? 0) - (a.reviewAverage ?? 0));
        break;
      default:
        rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    return rows;
  }, [listings, sort]);

  const switchTab = (tab: 'market' | 'mine') => {
    setActiveTab(tab);
    router.push(tab === 'mine' ? '/market/agents?tab=mine' : '/market/agents', { scroll: false });
  };

  const handleBuy = async (listing: MarketListing) => {
    setBuyingListing(listing);
    setBuyError('');
    setBuySuccess(false);
    // Free listings — claim directly, no payment needed
    if (listing.price === 0) {
      setBuyPaying(true);
      try {
        await api.post(`/market/${listing.id}/claim-free`, {});
        setBuySuccess(true);
      } catch (err: unknown) {
        const msg =
          err instanceof ApiError ? err.message : (err as Error)?.message || 'Claim failed';
        setBuyError(msg);
      } finally {
        setBuyPaying(false);
      }
      return;
    }
    // Paid listings — fetch seller wallet, open wallet picker, defer wei
    // computation to executeBuy now that we know the chosen payment method.
    setBuyPaying(true);
    try {
      const ethereum = getMetaMaskProvider();
      if (!ethereum) {
        setBuyError('MetaMask not found');
        return;
      }
      const sellerData = await api.get<{ seller?: { walletAddress?: string } }>(
        `/market/${listing.id}`,
      );
      const sellerWallet = sellerData?.seller?.walletAddress;
      if (!sellerWallet) {
        setBuyError('Seller has no wallet linked');
        return;
      }
      let ethPrice = 2000;
      try {
        const p = await api.get<{ price?: number }>('/chart/eth-price');
        if (p.price) ethPrice = p.price;
      } catch {
        /* fallback */
      }
      const buyerAddress = await pickWallet();
      setBuyConsentData({
        sellerWallet,
        buyerAddress,
        baseEth: listing.price,
        baseUsd: listing.price * ethPrice,
        hagglDisabled: !(await loadHagglTokenConfig()),
      });
    } catch (err: unknown) {
      const msg = (err as Error)?.message || String(err);
      setBuyError(msg.includes('rejected') ? 'Payment cancelled' : 'Failed: ' + msg.slice(0, 80));
    } finally {
      setBuyPaying(false);
    }
  };

  const executeBuy = async (
    signature: string,
    consentMessage: string,
    paymentMethod: PaymentMethod,
  ) => {
    if (!buyConsentData || !buyingListing) return;
    const { sellerWallet, buyerAddress, baseEth, baseUsd } = buyConsentData;
    setBuyConsentData(null);
    const ethereum = getMetaMaskProvider();
    if (!ethereum) {
      setBuyError('MetaMask not found');
      return;
    }

    const hagglCfg = paymentMethod === 'ATLAS' ? await loadHagglTokenConfig() : null;
    if (paymentMethod === 'ATLAS' && !hagglCfg) {
      setBuyError('ATLAS payments are not enabled — please retry with SOL');
      return;
    }

    let sellerWei: bigint;
    let platformWei: bigint;
    let totalWei: bigint;
    try {
      if (hagglCfg) {
        sellerWei = usdToTokenUnits(baseUsd, hagglCfg);
      } else {
        sellerWei = BigInt(Math.ceil(baseEth * 1e18));
      }
      platformWei = platformWeiForSeller(sellerWei, paymentMethod);
      totalWei = grossWeiForSeller(sellerWei, paymentMethod);
    } catch (err) {
      setBuyError(err instanceof Error ? err.message : 'Could not compute price');
      return;
    }

    try {
      if (isEscrowEnabled()) {
        // Escrow holds the buyer's gross; the contract releases the
        // seller's net on confirmation and forwards the fee to the
        // platform wallet.
        const orderId = crypto.randomUUID();
        const txHash = await escrowDeposit(orderId, sellerWallet, totalWei);
        await api.post(`/market/${buyingListing.id}/purchase`, {
          txHash,
          amountWei: totalWei.toString(),
          consentSignature: signature,
          consentMessage,
          escrowContract: getEscrowAddress(),
        });
      } else {
        const platformWallet = process.env.NEXT_PUBLIC_PLATFORM_WALLET;
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
        await api.post(`/market/${buyingListing.id}/purchase`, {
          txHash,
          amountWei: sellerWei.toString(),
          platformFeeTxHash,
          consentSignature: signature,
          consentMessage,
        });
      }
      setBuySuccess(true);
    } catch (err: unknown) {
      const msg = (err as Error)?.message || String(err);
      setBuyError(
        msg.includes('rejected')
          ? 'Payment cancelled'
          : err instanceof ApiError
            ? err.message
            : 'Payment failed: ' + msg.slice(0, 80),
      );
    }
  };

  return (
    <div className="mk-agents-page mk-app-page">
      {/* Header — quiet, typography-led. No ambient blobs. The /market
          hero owns the cinematic treatment; secondary pages are
          dashboards and read better flat. */}
      <div className="mk-hero">
        <div className="mk-hero__crumbs">
          <Link href="/market" className="mk-hero__crumb-link">
            Market
          </Link>
          <span className="mk-hero__crumb-sep">/</span>
          <span>Agents</span>
        </div>
        <div className="mk-hero__row">
          <div>
            <h1 className="text-3xl md:text-4xl font-medium tracking-[-0.02em] text-[var(--text)] leading-tight">
              Agents
            </h1>
            <p className="mt-2 text-[14px] text-[var(--text-secondary)] leading-relaxed max-w-2xl">
              Deploy and buy autonomous AI agents. Every listing is health-checked.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isAuthenticated && (
              <button type="button" onClick={attemptDeploy} className="mk-btn mk-btn--primary">
                <Plus className="w-3.5 h-3.5" strokeWidth={2} />
                Deploy agent
              </button>
            )}
          </div>
        </div>

        {/* Live agents / AI-native stats stripped — they showed 0/0
            on a fresh DB and added no value. The hero subtitle already
            communicates what this page is. */}
      </div>

      {/* Tabs */}
      <div className="mk-tabs">
        {(
          [
            ['market', 'Marketplace'],
            ['mine', 'My agents'],
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
          {/* Filter bar — flat, segmented */}
          <div className="mk-toolbar">
            <div className="mk-search">
              <Search className="mk-search__icon" strokeWidth={2} />
              <input
                ref={searchRef}
                type="text"
                placeholder="Search agents"
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

            <button
              type="button"
              onClick={() => setMobileFilterOpen(true)}
              className="mk-btn mk-btn--ghost mk-only-mobile"
            >
              Filters
              <ChevronDown className="w-3 h-3" strokeWidth={2} />
            </button>

            <div className="mk-seg mk-only-desktop">
              {TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`mk-seg__item ${type === t ? 'mk-seg__item--active' : ''}`}
                >
                  {TYPE_LABELS[t]}
                </button>
              ))}
            </div>

            <div className="mk-select">
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                aria-label="Sort"
              >
                <option value="recent">Newest</option>
                <option value="price-low">Price ↑</option>
                <option value="price-high">Price ↓</option>
                <option value="rating">Top rated</option>
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
              <button
                onClick={() => fetchListings()}
                className="rounded-md bg-rose-500/20 px-2 py-0.5 text-[11px] text-rose-100 transition hover:bg-rose-500/30"
              >
                Retry
              </button>
            </div>
          )}
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
              {Array.from({ length: 6 }).map((_, i) => (
                <AtlasListingCardSkeleton key={i} />
              ))}
            </div>
          ) : listings.length === 0 ? (
            <div className="mk-empty-app">
              <div className="mk-empty-app__icon">
                <Bot className="w-5 h-5" strokeWidth={2} />
              </div>
              <div className="mk-empty-app__title">No agents found</div>
              <div className="mk-empty-app__sub">
                Try adjusting your filters, or deploy the first one.
              </div>
              {isAuthenticated && (
                <button
                  type="button"
                  onClick={attemptDeploy}
                  className="mk-btn mk-btn--primary"
                  style={{ marginTop: 16 }}
                >
                  <Plus className="w-3.5 h-3.5" strokeWidth={2} />
                  Deploy an agent
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
              {sortedListings.map((l, idx) => (
                <motion.div
                  key={l.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    delay: Math.min(idx * 0.035, 0.4),
                    duration: 0.32,
                    ease: [0.22, 0.61, 0.36, 1],
                  }}
                  className="h-full"
                >
                  <AgentCard
                    listing={l}
                    isAuthenticated={isAuthenticated}
                    onBuy={() => handleBuy(l)}
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
            <div className="mk-empty">
              <p className="mk-empty__text">Sign in to manage your agents</p>
              <Link href="/auth" className="mk-wizard__primary inline-flex mt-3 max-w-fit">
                Sign in
              </Link>
            </div>
          ) : (
            <div>
              <section>
                <div className="flex items-center justify-between mb-4">
                  <p className="text-[12.5px] text-zinc-500">
                    {myListings.length} agent{myListings.length !== 1 ? 's' : ''} published
                  </p>
                  <button
                    type="button"
                    onClick={attemptDeploy}
                    className="mk-wizard__primary"
                    style={{ flex: '0 0 auto', height: 32, padding: '0 12px', fontSize: 12 }}
                  >
                    <Plus className="w-3 h-3 inline mr-1" />
                    Deploy new
                  </button>
                </div>

                {myLoading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="skeleton h-20 rounded-xl" />
                    ))}
                  </div>
                ) : myListings.length === 0 ? (
                  <div className="mk-empty">
                    <Bot className="w-8 h-8 text-zinc-700 mx-auto mb-3" strokeWidth={1.25} />
                    <p className="mk-empty__text">No agents deployed yet</p>
                    <button
                      type="button"
                      onClick={attemptDeploy}
                      className="mk-wizard__primary inline-flex mt-3 max-w-fit"
                      style={{ height: 32, padding: '0 12px', fontSize: 12 }}
                    >
                      <Plus className="w-3 h-3 inline mr-1" />
                      Deploy your first agent
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {myListings.map((l) => (
                      <MyAgentCard
                        key={l.id}
                        listing={l}
                        onDelete={(id) => setMyListings((p) => p.filter((x) => x.id !== id))}
                      />
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </>
      )}

      {/* Direct buy — wallet picker injected by useWalletPicker */}
      {buyWalletPicker}

      {/* Loading overlay while fetching seller data */}
      {buyPaying && !buyConsentData && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
        >
          <div className="w-5 h-5 rounded-full border-2 border-zinc-700 border-t-[#14F195] animate-spin" />
        </div>
      )}

      {/* Payment consent modal for direct buy */}
      {buyConsentData && buyingListing && (
        <PaymentConsentModal
          listingTitle={buyingListing.title}
          sellerAddress={buyConsentData.sellerWallet}
          baseUsd={buyConsentData.baseUsd}
          buyerAddress={buyConsentData.buyerAddress}
          hagglDisabled={buyConsentData.hagglDisabled}
          onConsent={executeBuy}
          onCancel={() => {
            setBuyConsentData(null);
            setBuyingListing(null);
          }}
        />
      )}

      {/* Buy error overlay */}
      {buyError && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center px-4"
          style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)' }}
        >
          <div
            className="w-full max-w-sm rounded-xl p-6 text-center"
            style={{
              background: 'var(--bg-card)',
              boxShadow: '0 0 0 1px rgba(255,255,255,0.08), 0 20px 40px rgba(0,0,0,0.5)',
            }}
          >
            <p className="text-red-400 text-sm mb-4">{buyError}</p>
            <button
              type="button"
              onClick={() => {
                setBuyError('');
                setBuyingListing(null);
              }}
              className="px-4 py-2 rounded-md text-[12.5px] text-white"
              style={{
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.12)',
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Buy success overlay */}
      {buySuccess && buyingListing && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center px-4"
          style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)' }}
        >
          <div
            className="w-full max-w-sm rounded-xl p-6 text-center"
            style={{
              background: 'var(--bg-card)',
              boxShadow: '0 0 0 1px rgba(255,255,255,0.08), 0 20px 40px rgba(0,0,0,0.5)',
            }}
          >
            <div
              className="mx-auto w-11 h-11 rounded-xl flex items-center justify-center mb-3"
              style={{
                background: 'rgba(20, 241, 149, 0.15)',
                boxShadow: 'inset 0 0 0 1px rgba(20, 241, 149, 0.4)',
              }}
            >
              <ShoppingBag className="w-5 h-5 text-[#b4a7ff]" />
            </div>
            <h3 className="text-base font-light text-white mb-2">
              {buyingListing.price === 0 ? 'Claimed!' : 'Payment sent!'}
            </h3>
            <p className="text-[12.5px] text-zinc-400 font-light leading-relaxed mb-5">
              <span className="text-white">{buyingListing.title}</span> has been added to your
              orders.
            </p>
            <div className="flex gap-2 justify-center">
              <Link
                href="/orders"
                className="px-4 py-2 rounded-md text-[12.5px] text-white"
                style={{
                  background:
                    'linear-gradient(180deg, rgba(20, 241, 149, 0.38), rgba(20, 241, 149, 0.14))',
                  boxShadow: 'inset 0 0 0 1px rgba(20, 241, 149, 0.48)',
                }}
              >
                View Orders
              </Link>
              <button
                type="button"
                onClick={() => {
                  setBuySuccess(false);
                  setBuyingListing(null);
                }}
                className="px-4 py-2 rounded-md text-[12.5px] text-zinc-400 hover:text-white transition-colors"
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                }}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {mobileBlock && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[60] flex items-center justify-center px-4"
          style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)' }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setMobileBlock(false);
          }}
        >
          <div
            className="w-full max-w-sm rounded-xl p-6 text-center"
            style={{
              background: 'var(--bg-card)',
              boxShadow: '0 0 0 1px rgba(255,255,255,0.08), 0 20px 40px rgba(0,0,0,0.5)',
            }}
          >
            <div
              className="mx-auto w-11 h-11 rounded-xl flex items-center justify-center mb-3"
              style={{
                background: 'rgba(20, 241, 149, 0.15)',
                boxShadow: 'inset 0 0 0 1px rgba(20, 241, 149, 0.4)',
              }}
            >
              <Plus className="w-5 h-5 text-[#b4a7ff]" />
            </div>
            <h3 className="text-base font-light text-white mb-2">Deploy from desktop</h3>
            <p className="text-[12.5px] text-zinc-400 font-light leading-relaxed mb-5">
              The agent deploy wizard needs a wider screen for sandbox testing, file uploads and the
              review step. Open Atlas on a desktop or laptop to deploy your agent.
            </p>
            <button
              type="button"
              onClick={() => setMobileBlock(false)}
              className="px-4 py-2 rounded-md text-[12.5px] text-white"
              style={{
                background:
                  'linear-gradient(180deg, rgba(20, 241, 149, 0.38), rgba(20, 241, 149, 0.14))',
                boxShadow: 'inset 0 0 0 1px rgba(20, 241, 149, 0.48)',
              }}
            >
              Got it
            </button>
          </div>
        </div>
      )}

      {/* Mobile filter drawer */}
      {mobileFilterOpen && (
        <div
          className="fixed inset-0 z-50 md:hidden"
          onClick={() => setMobileFilterOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <div
            className="absolute bottom-0 left-0 right-0 rounded-t-2xl p-5 pb-8"
            style={{
              background: 'linear-gradient(180deg, rgba(24,22,38,0.98) 0%, var(--bg) 100%)',
              boxShadow: '0 -10px 40px -10px rgba(0,0,0,0.6)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/10" />
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm text-white font-normal">Filters</h3>
              <button
                onClick={() => setMobileFilterOpen(false)}
                className="text-zinc-500 hover:text-white"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="mb-4">
              <p className="text-[10px] uppercase tracking-[0.22em] text-white/40 mb-2">Type</p>
              <div className="flex flex-wrap gap-2">
                {TYPES.map((t) => {
                  const active = type === t;
                  return (
                    <button
                      key={t}
                      onClick={() => setType(t)}
                      className="text-xs px-3 py-1.5 rounded-lg transition"
                      style={{
                        background: active
                          ? 'linear-gradient(180deg, rgba(20, 241, 149, 0.22), rgba(20, 241, 149, 0.06))'
                          : 'rgba(255,255,255,0.04)',
                        boxShadow: active
                          ? 'inset 0 0 0 1px rgba(20, 241, 149, 0.5)'
                          : 'inset 0 0 0 1px rgba(255,255,255,0.06)',
                        color: active ? '#C9BEFF' : '#a1a1aa',
                      }}
                    >
                      {TYPE_LABELS[t]}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="mb-4">
              <p className="text-[10px] uppercase tracking-[0.22em] text-white/40 mb-2">Sort</p>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="w-full text-sm rounded-lg px-3 py-2 outline-none"
                style={{
                  background: 'rgba(0,0,0,0.4)',
                  boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)',
                  color: '#e4e4e7',
                }}
              >
                <option value="recent">Newest first</option>
                <option value="price-low">Price · low to high</option>
                <option value="price-high">Price · high to low</option>
                <option value="rating">Highest rated</option>
              </select>
            </div>
            <button
              onClick={() => setMobileFilterOpen(false)}
              className="w-full rounded-xl bg-gradient-to-r from-[#14F195] to-[#6B4FE8] py-2.5 text-sm text-white"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
