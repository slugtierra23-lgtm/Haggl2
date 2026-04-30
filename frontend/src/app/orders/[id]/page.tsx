'use client';

import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Send,
  Package,
  CheckCircle2,
  AlertTriangle,
  Truck,
  Copy,
  Check,
  FileText,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import React, { useEffect, useState, useRef, useCallback } from 'react';

import { api, API_URL, WS_URL } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/AuthProvider';
import { io, Socket } from '@/lib/realtime/io';

const API = API_URL;

type OrderStatus = 'PENDING_DELIVERY' | 'IN_PROGRESS' | 'DELIVERED' | 'COMPLETED' | 'DISPUTED';

interface OrderMessage {
  id: string;
  content: string;
  senderId: string;
  senderUsername: string | null;
  senderAvatar: string | null;
  createdAt: string;
}

interface Order {
  id: string;
  createdAt: string;
  status: OrderStatus;
  amountWei: string;
  txHash: string;
  deliveryNote: string | null;
  completedAt: string | null;
  listing: { id: string; title: string; type: string; price: number; currency: string };
  buyer: { id: string; username: string | null; avatarUrl: string | null };
  seller: { id: string; username: string | null; avatarUrl: string | null };
}

const STATUS_STEPS: OrderStatus[] = ['PENDING_DELIVERY', 'IN_PROGRESS', 'DELIVERED', 'COMPLETED'];

const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING_DELIVERY: 'Pending Delivery',
  IN_PROGRESS: 'In Progress',
  DELIVERED: 'Delivered',
  COMPLETED: 'Completed',
  DISPUTED: 'Disputed',
};

const STATUS_COLOR: Record<OrderStatus, string> = {
  PENDING_DELIVERY: '#f59e0b',
  IN_PROGRESS: '#14F195',
  DELIVERED: '#6ee7b7',
  COMPLETED: '#71717a',
  DISPUTED: '#f87171',
};

const BRAND = '#14F195';

function Avatar({
  user,
  size = 32,
}: {
  user: { username: string | null; avatarUrl: string | null } | null;
  size?: number;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: 'rgba(20, 241, 149, 0.15)',
        border: '1px solid rgba(20, 241, 149, 0.2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      {user?.avatarUrl ? (
        <img
          src={user.avatarUrl}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <span style={{ fontSize: size * 0.35, color: BRAND }}>
          {(user?.username || '?')[0].toUpperCase()}
        </span>
      )}
    </div>
  );
}

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [order, setOrder] = useState<Order | null>(null);
  const [messages, setMessages] = useState<OrderMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [deliveryNote, setDeliveryNote] = useState('');
  const [showDeliverForm, setShowDeliverForm] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const isSeller = order && user && order.seller.id === user.id;
  const isBuyer = order && user && order.buyer.id === user.id;

  // ── Fetch initial data ──────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    try {
      const [orderData, msgData] = await Promise.all([
        api.get<Order>(`/orders/${id}`).catch(() => null),
        api.get<OrderMessage[]>(`/orders/${id}/messages`).catch(() => null),
      ]);
      if (orderData) setOrder(orderData);
      if (msgData) setMessages(msgData);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── WebSocket ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user || !id) return;

    const socket = io(`${WS_URL}/orders`, {
      transports: ['websocket'],
      withCredentials: true,
      timeout: 8000,
      reconnectionAttempts: 5,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('joinOrder', { orderId: id });
    });

    socket.on('newOrderMessage', (msg: OrderMessage) => {
      setMessages((prev) => [...prev, msg]);
    });

    socket.on('orderStatusChanged', ({ status }: { orderId: string; status: OrderStatus }) => {
      setOrder((prev) => (prev ? { ...prev, status } : prev));
    });

    return () => {
      socket.disconnect();
    };
  }, [user, id]);

  // ── Scroll to bottom ────────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Send message ────────────────────────────────────────────────────────
  const sendMessage = async () => {
    if (!input.trim() || sending) return;
    setSending(true);
    try {
      socketRef.current?.emit('orderMessage', { orderId: id, content: input.trim() });
      setInput('');
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // ── Status actions ──────────────────────────────────────────────────────
  const doAction = async (endpoint: string, body?: object) => {
    setActionLoading(true);
    try {
      const updated = await api.post<Order>(`/orders/${id}/${endpoint}`, body);
      setOrder(updated);
      setShowDeliverForm(false);
    } finally {
      setActionLoading(false);
    }
  };

  const copyTx = () => {
    if (!order?.txHash) return;
    navigator.clipboard.writeText(order.txHash);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: 'var(--bg)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            border: `2px solid ${BRAND}`,
            borderTopColor: 'transparent',
            animation: 'spin 0.8s linear infinite',
          }}
        />
      </div>
    );
  }

  if (!order) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: 'var(--bg)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
        }}
      >
        <p style={{ color: 'var(--text-muted)' }}>Order not found</p>
        <button
          onClick={() => router.push('/orders')}
          style={{
            background: BRAND,
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '0.5rem 1rem',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Back to Orders
        </button>
      </div>
    );
  }

  const ethAmount = order.amountWei ? (parseFloat(order.amountWei) / 1e18).toFixed(6) : '—';
  const statusIdx = STATUS_STEPS.indexOf(order.status);
  const peer = isSeller ? order.buyer : order.seller;

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg)',
        color: 'var(--text)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* ── Header ── */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 30,
          background: 'var(--bg)',
          borderBottom: '1px solid var(--border)',
          padding: '0.875rem 1.5rem',
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
        }}
      >
        <button
          onClick={() => router.push('/orders')}
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '0.4rem 0.7rem',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.35rem',
            color: 'var(--text-muted)',
            fontSize: '0.82rem',
          }}
        >
          <ArrowLeft style={{ width: 14, height: 14 }} strokeWidth={2} /> Orders
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: '0.95rem',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {order.listing.title}
          </div>
          <div
            style={{
              fontSize: '0.72rem',
              color: 'var(--text-muted)',
              fontFamily: "'JetBrains Mono', monospace' ",
            }}
          >
            #{order.id.slice(0, 8)}
          </div>
        </div>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.3rem',
            fontSize: '0.72rem',
            fontWeight: 700,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            color: order.status === 'DISPUTED' ? '#f87171' : STATUS_COLOR[order.status],
            background: `${STATUS_COLOR[order.status]}18`,
            border: `1px solid ${STATUS_COLOR[order.status]}30`,
            padding: '0.2rem 0.65rem',
            borderRadius: 999,
          }}
        >
          {STATUS_LABEL[order.status]}
        </span>
        <Link
          href={`/orders/${order.id}/receipt`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
            fontSize: '0.72rem',
            fontWeight: 500,
            color: 'var(--text-muted)',
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '0.4rem 0.7rem',
            textDecoration: 'none',
            transition: 'all 0.15s',
          }}
        >
          <FileText style={{ width: 13, height: 13 }} strokeWidth={2} /> Receipt
        </Link>
      </div>

      <div
        style={{
          flex: 1,
          display: 'flex',
          overflow: 'hidden',
          maxWidth: 1100,
          width: '100%',
          margin: '0 auto',
          padding: '1.5rem',
          gap: '1.5rem',
          alignItems: 'flex-start',
        }}
      >
        {/* ── LEFT — Chat ── */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 16,
            overflow: 'hidden',
            height: 'calc(100vh - 9rem)',
          }}
        >
          {/* Chat header */}
          <div
            style={{
              padding: '1rem 1.2rem',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              background: 'var(--bg-elevated)',
            }}
          >
            <Avatar user={peer} size={36} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>
                @{peer?.username || 'Unknown'}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                {isSeller ? 'Buyer' : 'Seller'}
              </div>
            </div>
          </div>

          {/* Messages */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '1rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
            }}
          >
            {messages.length === 0 && (
              <div
                style={{
                  textAlign: 'center',
                  color: 'var(--text-muted)',
                  fontSize: '0.85rem',
                  padding: '2rem 0',
                }}
              >
                No messages yet. Start the conversation!
              </div>
            )}
            {messages.map((msg) => {
              const isMe = msg.senderId === user?.id;
              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  style={{
                    display: 'flex',
                    gap: '0.6rem',
                    alignItems: 'flex-end',
                    flexDirection: isMe ? 'row-reverse' : 'row',
                  }}
                >
                  {!isMe && (
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        background: 'rgba(20, 241, 149, 0.15)',
                        border: '1px solid rgba(20, 241, 149, 0.2)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        overflow: 'hidden',
                        fontSize: '0.7rem',
                        color: BRAND,
                      }}
                    >
                      {msg.senderAvatar ? (
                        <img
                          src={msg.senderAvatar}
                          alt=""
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : (
                        (msg.senderUsername || '?')[0].toUpperCase()
                      )}
                    </div>
                  )}
                  <div
                    style={{
                      maxWidth: '70%',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.15rem',
                      alignItems: isMe ? 'flex-end' : 'flex-start',
                    }}
                  >
                    <div
                      style={{
                        background: isMe
                          ? 'linear-gradient(135deg, #14F195, #00A046)'
                          : 'var(--bg-elevated)',
                        border: isMe ? 'none' : '1px solid var(--border)',
                        borderRadius: isMe ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                        padding: '0.6rem 0.9rem',
                        fontSize: '0.875rem',
                        lineHeight: 1.5,
                        color: isMe ? '#fff' : 'var(--text)',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    >
                      {msg.content}
                    </div>
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                      {new Date(msg.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                </motion.div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          {order.status !== 'COMPLETED' && (
            <div
              style={{
                padding: '0.75rem 1rem',
                borderTop: '1px solid var(--border)',
                display: 'flex',
                gap: '0.6rem',
                alignItems: 'flex-end',
                background: 'var(--bg-elevated)',
              }}
            >
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message… (Enter to send)"
                rows={1}
                style={{
                  flex: 1,
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  padding: '0.6rem 0.8rem',
                  color: 'var(--text)',
                  fontSize: '0.875rem',
                  resize: 'none',
                  outline: 'none',
                  fontFamily: 'inherit',
                  lineHeight: 1.5,
                  maxHeight: 120,
                }}
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || sending}
                style={{
                  background: input.trim()
                    ? 'linear-gradient(135deg, #14F195, #00A046)'
                    : 'var(--bg-card)',
                  border: `1px solid ${input.trim() ? 'transparent' : 'var(--border)'}`,
                  borderRadius: 10,
                  padding: '0.6rem 0.75rem',
                  cursor: input.trim() ? 'pointer' : 'default',
                  color: input.trim() ? '#fff' : 'var(--text-muted)',
                  transition: 'all 0.15s',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <Send style={{ width: 16, height: 16 }} strokeWidth={2} />
              </button>
            </div>
          )}
        </div>

        {/* ── RIGHT — Order Info ── */}
        <div
          style={{
            width: 300,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
          }}
        >
          {/* Progress tracker */}
          {order.status !== 'DISPUTED' && (
            <div
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: 16,
                padding: '1.25rem',
              }}
            >
              <div
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                  marginBottom: '1rem',
                }}
              >
                Order Progress
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {STATUS_STEPS.map((s, i) => {
                  const done = statusIdx >= i;
                  const current = statusIdx === i;
                  return (
                    <div key={s} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <div
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: '50%',
                          background: done ? BRAND : 'var(--bg-elevated)',
                          border: `2px solid ${done ? BRAND : 'var(--border)'}`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          transition: 'all 0.2s',
                        }}
                      >
                        {done && (
                          <Check style={{ width: 11, height: 11, color: '#fff' }} strokeWidth={3} />
                        )}
                      </div>
                      <span
                        style={{
                          fontSize: '0.82rem',
                          fontWeight: current ? 700 : 400,
                          color: done ? 'var(--text)' : 'var(--text-muted)',
                        }}
                      >
                        {STATUS_LABEL[s]}
                      </span>
                      {current && (
                        <span
                          style={{
                            marginLeft: 'auto',
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            color: BRAND,
                            background: 'rgba(20, 241, 149, 0.1)',
                            padding: '0.1rem 0.4rem',
                            borderRadius: 999,
                          }}
                        >
                          NOW
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {order.status === 'DISPUTED' && (
            <div
              style={{
                background: 'rgba(248,113,113,0.08)',
                border: '1px solid rgba(248,113,113,0.25)',
                borderRadius: 16,
                padding: '1.25rem',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.75rem',
              }}
            >
              <AlertTriangle
                style={{ width: 18, height: 18, color: '#f87171', flexShrink: 0, marginTop: 1 }}
                strokeWidth={1.5}
              />
              <div>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: '0.875rem',
                    color: '#f87171',
                    marginBottom: '0.25rem',
                  }}
                >
                  Order Disputed
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  This order is under review. Our team will reach out shortly.
                </div>
              </div>
            </div>
          )}

          {/* Order details */}
          <div
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 16,
              padding: '1.25rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
            }}
          >
            <div
              style={{
                fontSize: '0.72rem',
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--text-muted)',
              }}
            >
              Order Details
            </div>

            {[
              { label: 'Listing', value: order.listing.title, mono: false },
              { label: 'Type', value: order.listing.type, mono: false },
              { label: 'Amount', value: `${ethAmount} SOL`, mono: true },
              { label: 'Date', value: new Date(order.createdAt).toLocaleDateString(), mono: false },
            ].map(({ label, value, mono }) => (
              <div
                key={label}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: '0.5rem',
                }}
              >
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{label}</span>
                <span
                  style={{
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    textAlign: 'right',
                    fontFamily: mono ? "'JetBrains Mono', monospace" : 'inherit',
                    color: mono ? BRAND : 'var(--text)',
                    maxWidth: 160,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {value}
                </span>
              </div>
            ))}

            {/* TX Hash */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>TX Hash</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <span
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '0.7rem',
                    color: BRAND,
                  }}
                >
                  {order.txHash.slice(0, 8)}…
                </span>
                <button
                  onClick={copyTx}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 2,
                    color: 'var(--text-muted)',
                    display: 'flex',
                  }}
                >
                  {copied ? (
                    <Check style={{ width: 12, height: 12, color: '#6ee7b7' }} />
                  ) : (
                    <Copy style={{ width: 12, height: 12 }} />
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Delivery note (if delivered) */}
          {order.deliveryNote && (
            <div
              style={{
                background: 'rgba(52,211,153,0.06)',
                border: '1px solid rgba(52,211,153,0.2)',
                borderRadius: 14,
                padding: '1rem',
              }}
            >
              <div
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: '#6ee7b7',
                  marginBottom: '0.5rem',
                }}
              >
                Delivery Note
              </div>
              <p
                style={{
                  fontSize: '0.82rem',
                  color: 'var(--text-muted)',
                  lineHeight: 1.55,
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {order.deliveryNote}
              </p>
            </div>
          )}

          {/* ── Seller Actions ── */}
          {isSeller && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {order.status === 'PENDING_DELIVERY' && (
                <button
                  disabled={actionLoading}
                  onClick={() => doAction('in-progress')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    background: 'rgba(20, 241, 149, 0.1)',
                    border: '1px solid rgba(20, 241, 149, 0.3)',
                    borderRadius: 10,
                    padding: '0.7rem',
                    cursor: 'pointer',
                    color: BRAND,
                    fontWeight: 600,
                    fontSize: '0.85rem',
                    transition: 'all 0.15s',
                  }}
                >
                  <Package style={{ width: 15, height: 15 }} strokeWidth={2} />
                  Mark as In Progress
                </button>
              )}

              {['PENDING_DELIVERY', 'IN_PROGRESS'].includes(order.status) && (
                <>
                  {showDeliverForm ? (
                    <div
                      style={{
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border)',
                        borderRadius: 12,
                        padding: '1rem',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.6rem',
                      }}
                    >
                      <textarea
                        value={deliveryNote}
                        onChange={(e) => setDeliveryNote(e.target.value)}
                        placeholder="Delivery note (optional) — link, instructions, etc."
                        rows={3}
                        style={{
                          background: 'var(--bg-elevated)',
                          border: '1px solid var(--border)',
                          borderRadius: 8,
                          padding: '0.5rem 0.7rem',
                          color: 'var(--text)',
                          fontSize: '0.82rem',
                          resize: 'vertical',
                          outline: 'none',
                          fontFamily: 'inherit',
                        }}
                      />
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                          onClick={() => setShowDeliverForm(false)}
                          style={{
                            flex: 1,
                            background: 'var(--bg-elevated)',
                            border: '1px solid var(--border)',
                            borderRadius: 8,
                            padding: '0.5rem',
                            cursor: 'pointer',
                            color: 'var(--text-muted)',
                            fontSize: '0.82rem',
                            fontWeight: 600,
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          disabled={actionLoading}
                          onClick={() => doAction('deliver', { deliveryNote })}
                          style={{
                            flex: 2,
                            background: 'linear-gradient(135deg, #6ee7b7, #00C853)',
                            border: 'none',
                            borderRadius: 8,
                            padding: '0.5rem',
                            cursor: 'pointer',
                            color: '#fff',
                            fontSize: '0.82rem',
                            fontWeight: 700,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.4rem',
                          }}
                        >
                          <Truck style={{ width: 13, height: 13 }} strokeWidth={2} /> Confirm
                          Delivery
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowDeliverForm(true)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.5rem',
                        background: 'linear-gradient(135deg, #6ee7b7, #00C853)',
                        border: 'none',
                        borderRadius: 10,
                        padding: '0.7rem',
                        cursor: 'pointer',
                        color: '#fff',
                        fontWeight: 700,
                        fontSize: '0.85rem',
                        boxShadow: '0 4px 12px rgba(52,211,153,0.25)',
                      }}
                    >
                      <Truck style={{ width: 15, height: 15 }} strokeWidth={2} />
                      Mark as Delivered
                    </button>
                  )}
                </>
              )}

              {!['COMPLETED', 'DISPUTED'].includes(order.status) && (
                <button
                  disabled={actionLoading}
                  onClick={() => doAction('dispute')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    background: 'rgba(248,113,113,0.08)',
                    border: '1px solid rgba(248,113,113,0.25)',
                    borderRadius: 10,
                    padding: '0.6rem',
                    cursor: 'pointer',
                    color: '#f87171',
                    fontWeight: 600,
                    fontSize: '0.8rem',
                  }}
                >
                  <AlertTriangle style={{ width: 13, height: 13 }} strokeWidth={2} />
                  Open Dispute
                </button>
              )}
            </div>
          )}

          {/* ── Buyer Actions ── */}
          {isBuyer && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {order.status === 'DELIVERED' && (
                <button
                  disabled={actionLoading}
                  onClick={() => doAction('complete')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    background: 'linear-gradient(135deg, #14F195, #00A046)',
                    border: 'none',
                    borderRadius: 10,
                    padding: '0.7rem',
                    cursor: 'pointer',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    boxShadow: '0 4px 16px rgba(20, 241, 149, 0.3)',
                  }}
                >
                  <CheckCircle2 style={{ width: 15, height: 15 }} strokeWidth={2} />
                  Confirm & Complete Order
                </button>
              )}

              {!['COMPLETED', 'DISPUTED'].includes(order.status) && (
                <button
                  disabled={actionLoading}
                  onClick={() => doAction('dispute')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    background: 'rgba(248,113,113,0.08)',
                    border: '1px solid rgba(248,113,113,0.25)',
                    borderRadius: 10,
                    padding: '0.6rem',
                    cursor: 'pointer',
                    color: '#f87171',
                    fontWeight: 600,
                    fontSize: '0.8rem',
                  }}
                >
                  <AlertTriangle style={{ width: 13, height: 13 }} strokeWidth={2} />
                  Open Dispute
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <style jsx global>{`
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}
