'use client';

import { CheckCircle2, MessageSquare, X, XCircle, Zap } from 'lucide-react';
import { useRouter } from 'next/navigation';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { WS_URL } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/AuthProvider';
import { io, Socket } from '@/lib/realtime/io';

interface Toast {
  id: string;
  kind: 'started' | 'agreed' | 'rejected' | 'expired' | 'message';
  title: string;
  body: string;
  url: string;
  counterparty: string;
  priceLabel: string | null;
}

interface IncomingNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  url: string | null;
  meta: Record<string, unknown> | null;
}

const AUTO_DISMISS_MS = 9_000;
const MAX_STACK = 3;

function metaKindToToastKind(kind?: unknown): Toast['kind'] | null {
  if (kind === 'negotiation_started') return 'started';
  if (kind === 'negotiation_agreed') return 'agreed';
  if (kind === 'negotiation_rejected') return 'rejected';
  if (kind === 'negotiation_expired') return 'expired';
  if (kind === 'negotiation_message') return 'message';
  return null;
}

/**
 * Premium top-left pop-toast for negotiation lifecycle events. Mounted
 * globally so it appears on any page. Listens to the /notifications
 * socket (same one the bell uses), filters for negotiation events,
 * renders a glassy card with a deep link into the exact modal.
 */
export function NegotiationPopToast() {
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((xs) => xs.filter((t) => t.id !== id));
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (t: Toast) => {
      setToasts((xs) => [t, ...xs].slice(0, MAX_STACK));
      const timer = setTimeout(() => dismiss(t.id), AUTO_DISMISS_MS);
      timers.current.set(t.id, timer);
    },
    [dismiss],
  );

  useEffect(() => {
    if (!isAuthenticated) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      return;
    }

    const socket = io(`${WS_URL}/notifications`, {
      withCredentials: true,
      transports: ['websocket'],
      timeout: 8000,
      reconnectionAttempts: 5,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3000,
    });
    socketRef.current = socket;

    socket.on('notification:new', (n: IncomingNotification) => {
      if (n.type !== 'MARKET_NEGOTIATION_MESSAGE') return;
      const meta = n.meta as { kind?: unknown; negotiationId?: string } | null;
      const kind = metaKindToToastKind(meta?.kind);
      if (!kind) return;
      // Suppress the pop-toast when the user already has the negotiation
      // modal open — they're watching the conversation live and don't
      // need an overlay telling them what they just saw.
      if (typeof document !== 'undefined' && meta?.negotiationId) {
        const open = document.body.getAttribute('data-neg-open');
        if (open && open === meta.negotiationId) return;
      }
      const m = n.meta as {
        counterparty?: string;
        agreedPrice?: number | null;
        currency?: string;
      } | null;
      push({
        id: n.id,
        kind,
        title: n.title,
        body: n.body ?? '',
        url: n.url ?? '/orders',
        counterparty: m?.counterparty ?? '',
        priceLabel: m?.agreedPrice != null ? `${m.agreedPrice} ${m.currency ?? 'SOL'}` : null,
      });
    });

    return () => {
      timers.current.forEach((t) => clearTimeout(t));
      timers.current.clear();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [isAuthenticated, push]);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed z-[70] pointer-events-none"
      style={{ top: 16, left: 16, width: 360, maxWidth: 'calc(100vw - 32px)' }}
      aria-live="polite"
    >
      <div className="flex flex-col gap-2">
        {toasts.map((t) => (
          <ToastCard
            key={t.id}
            toast={t}
            onClick={() => {
              router.push(t.url);
              dismiss(t.id);
            }}
            onClose={() => dismiss(t.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ToastCard({
  toast,
  onClick,
  onClose,
}: {
  toast: Toast;
  onClick: () => void;
  onClose: () => void;
}) {
  const { kind, title, body, priceLabel, counterparty } = toast;
  const accent =
    kind === 'agreed'
      ? '#22c55e'
      : kind === 'rejected'
        ? '#ef4444'
        : kind === 'expired'
          ? '#f59e0b'
          : kind === 'message'
            ? '#06B6D4'
            : '#14F195';
  const Icon = kind === 'agreed' ? CheckCircle2 : kind === 'rejected' ? XCircle : MessageSquare;
  const label =
    kind === 'started'
      ? 'New negotiation'
      : kind === 'agreed'
        ? 'Deal closed'
        : kind === 'rejected'
          ? 'Offer rejected'
          : kind === 'expired'
            ? 'Negotiation expired'
            : 'New message';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className="pointer-events-auto relative rounded-xl cursor-pointer transition-transform hover:-translate-y-0.5"
      style={{
        background: 'linear-gradient(180deg, rgba(16,16,22,0.98), rgba(8,8,12,0.98))',
        boxShadow: `0 0 0 1px ${accent}55, 0 20px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)`,
        animation: 'negToastSlide 260ms cubic-bezier(0.2, 0.8, 0.2, 1) both',
      }}
    >
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-[2px] rounded-t-xl"
        style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }}
      />
      <div className="p-3 pr-8">
        <div className="flex items-start gap-2.5">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: `${accent}1a`, boxShadow: `inset 0 0 0 1px ${accent}55` }}
          >
            <Icon className="w-4 h-4" style={{ color: accent }} strokeWidth={1.8} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span
                className="text-[10px] uppercase tracking-[0.18em] font-mono"
                style={{ color: accent }}
              >
                {label}
              </span>
              {kind === 'started' && (
                <span className="text-[10px] text-zinc-500 font-mono">· AI vs AI</span>
              )}
            </div>
            <p className="text-[13px] text-white font-light leading-tight truncate">{title}</p>
            {body && (
              <p className="text-[11.5px] text-zinc-400 font-light leading-snug mt-1 line-clamp-2">
                {body}
              </p>
            )}
            {priceLabel && (
              <div
                className="mt-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-mono"
                style={{
                  background: `${accent}22`,
                  color: accent,
                  boxShadow: `inset 0 0 0 1px ${accent}66`,
                }}
              >
                <Zap className="w-3 h-3" strokeWidth={2} />
                {priceLabel}
              </div>
            )}
            {counterparty && (kind === 'started' || kind === 'message') && (
              <p className="text-[11px] text-zinc-500 font-mono mt-1">@{counterparty}</p>
            )}
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[10.5px] text-zinc-500 font-light">Click to open the chat</span>
          <span className="text-[10.5px] font-mono" style={{ color: accent }}>
            Open →
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="absolute top-1.5 right-1.5 w-6 h-6 rounded-md flex items-center justify-center text-zinc-500 hover:text-white hover:bg-white/5 transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5" strokeWidth={2} />
      </button>
      <style jsx>{`
        @keyframes negToastSlide {
          0% {
            opacity: 0;
            transform: translate3d(-20px, 0, 0) scale(0.96);
          }
          100% {
            opacity: 1;
            transform: translate3d(0, 0, 0) scale(1);
          }
        }
      `}</style>
    </div>
  );
}
