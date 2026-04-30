'use client';

import { Bot, Plus, X, Zap } from 'lucide-react';
import Link from 'next/link';
import React, { useEffect, useState } from 'react';

import { UserAvatar } from '@/components/ui/UserAvatar';
import { api } from '@/lib/api/client';

interface MyAgent {
  id: string;
  title: string;
  description?: string | null;
  price?: number;
  currency?: string;
  agentEndpoint?: string | null;
  fileKey?: string | null;
  tags?: string[];
}

/**
 * Gate that fires when the user clicks Negotiate. Lets them pick one
 * of their own published AI agents to negotiate on their behalf — the
 * picked agent's endpoint/sandbox takes over the buyer side of the
 * AI-vs-AI loop. "Default" falls back to the platform's Claude
 * auto-negotiator (previous behaviour).
 */
export function AgentPickerModal({
  listingTitle,
  listingPrice,
  listingCurrency,
  onCancel,
  onConfirm,
}: {
  listingTitle: string;
  listingPrice: number;
  listingCurrency: string;
  onCancel: () => void;
  /** Called with the chosen agent id (null = default Atlas auto-negotiator). */
  onConfirm: (agentListingId: string | null) => void;
}) {
  const [agents, setAgents] = useState<MyAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<{
          data: Array<{
            id: string;
            title: string;
            description?: string;
            type: string;
            price: number;
            currency: string;
            agentEndpoint?: string | null;
            fileKey?: string | null;
            tags?: string[];
          }>;
        }>('/market/my-listings');
        if (cancelled) return;
        setAgents(
          (res.data || [])
            .filter((l) => l.type === 'AI_AGENT')
            .map((l) => ({
              id: l.id,
              title: l.title,
              description: l.description,
              price: l.price,
              currency: l.currency,
              agentEndpoint: l.agentEndpoint,
              fileKey: l.fileKey,
              tags: l.tags,
            })),
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(14px)' }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-md rounded-2xl overflow-hidden relative"
        style={{
          background: 'linear-gradient(180deg, rgba(20,20,28,0.96), rgba(10,10,16,0.96))',
          boxShadow:
            '0 0 0 1px rgba(255,255,255,0.06), 0 30px 80px -10px rgba(20, 241, 149, 0.35), inset 0 1px 0 rgba(255,255,255,0.05)',
        }}
      >
        <span
          aria-hidden
          className="absolute -top-8 -left-8 w-40 h-40 rounded-full pointer-events-none"
          style={{
            background: 'radial-gradient(circle, rgba(20, 241, 149, 0.22), transparent 70%)',
            filter: 'blur(14px)',
          }}
        />

        <div className="flex items-start gap-3 p-5 relative">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{
              background: 'linear-gradient(135deg, rgba(20, 241, 149, 0.3), rgba(6,182,212,0.25))',
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)',
            }}
          >
            <Zap className="w-5 h-5 text-white" strokeWidth={1.6} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-[14.5px] font-light text-white tracking-[-0.005em]">
              Pick your negotiator
            </h3>
            <p className="text-[12px] text-zinc-500 font-light mt-0.5">
              Buying <span className="text-zinc-300">{listingTitle}</span> · listed at{' '}
              <span className="text-zinc-300">
                {listingPrice} {listingCurrency}
              </span>
            </p>
          </div>
          <button
            onClick={onCancel}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/5 transition-colors flex-shrink-0"
            aria-label="Cancel"
          >
            <X className="w-4 h-4" strokeWidth={1.8} />
          </button>
        </div>

        <div className="px-5 pb-3 max-h-[48vh] overflow-y-auto space-y-2">
          {/* Default option */}
          <button
            type="button"
            onClick={() => setPicked(null)}
            className={`w-full text-left rounded-xl p-3 transition-all ${
              picked === null ? 'ring-2' : ''
            }`}
            style={{
              background:
                picked === null
                  ? 'linear-gradient(180deg, rgba(20, 241, 149, 0.18), rgba(20, 241, 149, 0.06))'
                  : 'rgba(255,255,255,0.02)',
              boxShadow:
                picked === null
                  ? 'inset 0 0 0 1px rgba(20, 241, 149, 0.5)'
                  : 'inset 0 0 0 1px rgba(255,255,255,0.06)',
            }}
          >
            <div className="flex items-center gap-3">
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{
                  background: 'rgba(20, 241, 149, 0.18)',
                  boxShadow: 'inset 0 0 0 1px rgba(20, 241, 149, 0.35)',
                }}
              >
                <Zap className="w-4 h-4 text-[#b4a7ff]" strokeWidth={1.8} />
              </div>
              <div className="min-w-0">
                <div className="text-[13px] font-light text-white">Atlas auto-negotiator</div>
                <p className="text-[11px] text-zinc-500 font-light line-clamp-1">
                  Default · tries for ~25% discount, quick
                </p>
              </div>
            </div>
          </button>

          {loading && (
            <div className="text-center py-6">
              <div className="w-4 h-4 rounded-full border-2 border-zinc-800 border-t-[#14F195] animate-spin mx-auto" />
            </div>
          )}

          {!loading && agents.length === 0 && (
            <div
              className="rounded-xl p-4 text-center"
              style={{
                background: 'rgba(255,255,255,0.02)',
                boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)',
              }}
            >
              <Bot className="w-5 h-5 text-zinc-600 mx-auto mb-2" strokeWidth={1.5} />
              <p className="text-[12px] text-zinc-400 font-light">
                You don&apos;t own any AI agents yet
              </p>
              <Link
                href="/market/agents?tab=mine&new=1"
                className="inline-flex items-center gap-1 mt-2 text-[11.5px] text-[#b4a7ff] hover:text-white"
              >
                <Plus className="w-3 h-3" />
                Deploy one
              </Link>
            </div>
          )}

          {agents.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setPicked(a.id)}
              className={`w-full text-left rounded-xl p-3 transition-all ${
                picked === a.id ? 'ring-2' : ''
              }`}
              style={{
                background:
                  picked === a.id
                    ? 'linear-gradient(180deg, rgba(6,182,212,0.18), rgba(6,182,212,0.06))'
                    : 'rgba(255,255,255,0.02)',
                boxShadow:
                  picked === a.id
                    ? 'inset 0 0 0 1px rgba(6,182,212,0.55)'
                    : 'inset 0 0 0 1px rgba(255,255,255,0.06)',
              }}
            >
              <div className="flex items-center gap-3">
                <UserAvatar src={undefined} name={a.title} userId={a.id} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-light text-white truncate">{a.title}</div>
                  <p className="text-[11px] text-zinc-500 font-light line-clamp-1">
                    {a.description || 'Your agent'}
                  </p>
                </div>
                {(a.agentEndpoint || a.fileKey) && (
                  <span
                    className="text-[9.5px] uppercase tracking-[0.14em] font-mono px-1.5 py-0.5 rounded-md"
                    style={{
                      color: '#6ee7b7',
                      background: 'rgba(20, 241, 149, 0.08)',
                      boxShadow: 'inset 0 0 0 1px rgba(20, 241, 149, 0.3)',
                    }}
                  >
                    Live
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>

        <div
          className="px-5 py-4 flex items-center justify-between gap-3 relative"
          style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
        >
          <button
            type="button"
            onClick={onCancel}
            className="text-[12.5px] text-zinc-400 hover:text-white px-3 py-2 rounded-lg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(picked)}
            className="text-[13px] text-white py-2 px-5 rounded-lg transition-all hover:brightness-110"
            style={{
              background:
                'linear-gradient(180deg, rgba(20, 241, 149, 0.45), rgba(20, 241, 149, 0.18))',
              boxShadow:
                'inset 0 0 0 1px rgba(20, 241, 149, 0.55), 0 0 22px -4px rgba(20, 241, 149, 0.55)',
            }}
          >
            Start negotiation
          </button>
        </div>
      </div>
    </div>
  );
}
