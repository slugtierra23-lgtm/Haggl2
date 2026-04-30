'use client';

import { Bot, ExternalLink, Loader2, Wallet, X as XIcon } from 'lucide-react';
import Link from 'next/link';
import React, { useCallback, useEffect, useState } from 'react';

import { ConnectXCard } from '@/components/social/ConnectXCard';
import { api, ApiError } from '@/lib/api/client';

/**
 * "Connected accounts" card on the General profile section.
 *
 * Surfaces every external thing the user has tied to their Atlas
 * account in one panel:
 *   • X (Twitter) — full ConnectXCard inline so connect / disconnect /
 *     status all happen here without leaving the page
 *   • Wallets    — count + a deep link to the Wallet tab where the
 *     real management lives (we don't duplicate the disconnect surface
 *     here, that path was buggy enough as a single source of truth)
 *   • AI agents  — listings of type AI_AGENT the user has published.
 *     Each row says which X handle it currently posts as (Phase 1: the
 *     user's X). When per-agent X lands in Phase 2/3 the row gets its
 *     own connect button.
 */

interface AgentRow {
  id: string;
  title: string;
  type: string;
  status: string;
}

interface AgentXStatus {
  configured: boolean;
  connected: boolean;
  screenName?: string | null;
  postsLast24h?: number;
}

interface OwnedAgent {
  listingId: string;
  title: string;
  listingStatus: string;
  createdAt: string;
  x: AgentXStatus;
}

export function ConnectedAccountsPanel({
  userId,
  walletCount,
}: {
  userId: string | null;
  walletCount: number;
}) {
  const [agents, setAgents] = useState<OwnedAgent[] | null>(null);
  const [agentsErr, setAgentsErr] = useState<string | null>(null);
  const [xHandle, setXHandle] = useState<string | null>(null);

  const loadAgents = useCallback(async () => {
    if (!userId) return;
    try {
      // Per-agent X status (BYO X). One row per AI_AGENT listing the
      // user owns, each with its own connected/configured/screenName.
      const rows = await api.get<OwnedAgent[]>('/social/agent-x/owned');
      setAgents(Array.isArray(rows) ? rows : []);
    } catch (err) {
      setAgents([]);
      setAgentsErr(err instanceof ApiError ? err.message : 'Could not load your agents');
    }
  }, [userId]);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  // Watch the X status independently so the row "Posts via @handle"
  // updates without a hard refresh after the user hits Connect /
  // Disconnect inside the embedded ConnectXCard.
  const refreshXHandle = useCallback(async () => {
    try {
      const s = await api.get<{ connected: false } | { connected: true; screenName: string }>(
        '/social/x/status',
      );
      setXHandle(s.connected ? s.screenName : null);
    } catch {
      setXHandle(null);
    }
  }, []);
  useEffect(() => {
    void refreshXHandle();
    // Re-poll every 5 s while this card is mounted so a Connect that
    // happens inside ConnectXCard reflects in the Agent rows quickly.
    // Cheap call, hits the cached endpoint.
    const id = setInterval(refreshXHandle, 5_000);
    return () => clearInterval(id);
  }, [refreshXHandle]);

  return (
    <div className="profile-content-card space-y-4">
      <div>
        <h3 className="text-[14px] text-white font-light">Connected accounts</h3>
        <p className="text-[11.5px] text-zinc-500 mt-0.5">
          External accounts and on-chain identities tied to this profile. Disconnect any of them at
          any time.
        </p>
      </div>

      {/* X (Twitter) — full card */}
      <ConnectXCard returnTo="/profile" />

      {/* Wallets — link to Wallet tab */}
      <div
        className="rounded-xl p-4 flex items-center gap-3"
        style={{
          background: 'var(--bg-card2)',
          border: '1px solid var(--bg-card2)',
        }}
      >
        <div
          className="grid place-items-center w-10 h-10 rounded-lg shrink-0"
          style={{
            background: 'var(--bg-card2)',
            border: '1px solid var(--bg-card2)',
          }}
        >
          <Wallet className="w-4 h-4 text-zinc-300" strokeWidth={1.75} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] text-white font-light">Wallets</div>
          <div className="text-[11.5px] text-zinc-500 font-light">
            {walletCount === 0
              ? 'No wallet connected yet.'
              : walletCount === 1
                ? '1 wallet linked. Manage it in the Wallet tab.'
                : `${walletCount} wallets linked. Manage them in the Wallet tab.`}
          </div>
        </div>
        <Link
          href="/profile?tab=wallet"
          className="text-[12px] font-light px-3 py-1.5 rounded-md text-zinc-300 hover:text-white transition"
          style={{
            background: 'var(--bg-card2)',
            border: '1px solid var(--bg-card2)',
          }}
        >
          Manage
        </Link>
      </div>

      {/* AI agents the user has published — each with its own X status */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] uppercase tracking-[0.16em] text-zinc-500 font-medium">
            Your AI agents
          </div>
        </div>
        {agents === null ? (
          <div
            className="rounded-xl p-3 flex items-center gap-2 text-[12px] text-zinc-500"
            style={{
              background: 'var(--bg-card2)',
              border: '1px solid var(--bg-card2)',
            }}
          >
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Loading your agents…
          </div>
        ) : agents.length === 0 ? (
          <div
            className="rounded-xl p-4 text-center text-[12px] text-zinc-500"
            style={{
              background: 'var(--bg-card2)',
              border: '1px solid var(--bg-card2)',
            }}
          >
            {agentsErr ?? "You haven't published any AI agents yet."}
            <div className="mt-2">
              <Link
                href="/market/agents"
                className="inline-flex items-center gap-1 text-[#b4a7ff] hover:text-white transition"
              >
                Publish one
                <ExternalLink className="w-3 h-3" />
              </Link>
            </div>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {agents.map((a) => {
              const xPill = a.x.connected ? (
                <span className="text-[10.5px] text-emerald-300 font-mono">
                  ✓ @{a.x.screenName}
                </span>
              ) : a.x.configured ? (
                <span className="text-[10.5px] text-amber-300 font-mono">
                  ⚠ keys saved · OAuth pending
                </span>
              ) : (
                <span className="text-[10.5px] text-rose-300 font-mono">⨯ X not configured</span>
              );
              return (
                <li
                  key={a.listingId}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
                  style={{
                    background: 'var(--bg-card2)',
                    border: '1px solid var(--bg-card2)',
                  }}
                >
                  <Bot className="w-3.5 h-3.5 text-zinc-400 shrink-0" strokeWidth={1.75} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] text-white font-light truncate">{a.title}</div>
                    <div className="text-[10.5px] text-zinc-500 truncate">
                      {xPill}
                      {a.listingStatus !== 'ACTIVE' && (
                        <>
                          {' · '}
                          <span className="text-amber-400">{a.listingStatus.toLowerCase()}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <Link
                    href={`/market/agents/${a.listingId}/setup-x`}
                    className="text-[11px] font-light px-2 py-1 rounded text-zinc-300 hover:text-white transition"
                    style={{
                      background: 'var(--bg-card2)',
                      border: '1px solid var(--bg-card2)',
                    }}
                  >
                    {a.x.connected ? 'Manage' : 'Setup X'}
                  </Link>
                  <Link
                    href={`/market/agents/${a.listingId}`}
                    className="text-zinc-500 hover:text-white transition"
                    aria-label="Open agent"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-2 text-[10.5px] text-zinc-600 font-light leading-relaxed">
          Each agent connects its own X Developer App + X account. The agent IS its own brand. Setup
          runs in the per-agent setup-x page after the listing is created.
        </p>
      </div>
      {/* Hide unused noise from React */}
      <span className="sr-only">
        <XIcon className="w-3 h-3" />
      </span>
    </div>
  );
}
