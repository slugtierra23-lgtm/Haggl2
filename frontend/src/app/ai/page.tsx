'use client';

import { Bot, Loader2, MessageSquare, Plus, Send, Sparkles, User } from 'lucide-react';
import { useRouter } from 'next/navigation';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { GradientText } from '@/components/ui/GradientText';
import { Markdown } from '@/components/ui/Markdown';
import { api, ApiError } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/AuthProvider';

// ── Types ──────────────────────────────────────────────────────────────────────

interface AiMessage {
  id: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  createdAt: string;
}

interface AiSession {
  id: string;
  createdAt: string;
  messages: AiMessage[];
  _count?: { messages: number };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const SUGGESTED_PROMPTS = [
  'What is Atlas and how does it work?',
  'Explain on-chain escrow in one paragraph.',
  'What are the risks of holding memecoins?',
  'How do I link my GitHub account to publish a repo?',
];

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function sessionTitle(s: AiSession) {
  const first = s.messages?.[0];
  if (!first) return 'New chat';
  return first.content.slice(0, 40) + (first.content.length > 40 ? '…' : '');
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function AiPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  const [sessions, setSessions] = useState<AiSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [streamBuf, setStreamBuf] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.replace('/auth');
  }, [authLoading, isAuthenticated, router]);

  const loadSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const data = await api.get<AiSession[]>('/ai/sessions');
      setSessions(data);
    } catch {
      setError('Failed to load chat history');
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) loadSessions();
  }, [isAuthenticated, loadSessions]);

  const loadSession = useCallback(async (sessionId: string) => {
    try {
      const data = await api.get<AiSession>(`/ai/sessions/${sessionId}`);
      setActiveId(sessionId);
      setMessages(data.messages || []);
      setStreamBuf('');
    } catch {
      setError('Failed to open chat');
    }
  }, []);

  const newChat = () => {
    setActiveId(null);
    setMessages([]);
    setStreamBuf('');
    setError(null);
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamBuf]);

  const send = async (message: string) => {
    const text = message.trim();
    if (!text || sending) return;

    setSending(true);
    setError(null);
    setInput('');

    const optimistic: AiMessage = {
      id: `temp-${Date.now()}`,
      role: 'USER',
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setStreamBuf('');

    let sessionId = activeId;
    try {
      if (!sessionId) {
        const created = await api.post<{ sessionId: string }>('/ai/sessions', {});
        sessionId = created.sessionId;
        setActiveId(sessionId);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to start a session');
      setSending(false);
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      return;
    }

    let buffer = '';
    await api.stream(
      `/ai/sessions/${sessionId}/chat`,
      { message: text },
      (chunk) => {
        buffer += chunk;
        setStreamBuf(buffer);
      },
      () => {
        const final: AiMessage = {
          id: `asst-${Date.now()}`,
          role: 'ASSISTANT',
          content: buffer,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, final]);
        setStreamBuf('');
        setSending(false);
        loadSessions();
      },
      (err) => {
        setError(err);
        setStreamBuf('');
        setSending(false);
      },
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  if (authLoading || !isAuthenticated) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: 'var(--bg)' }}
      >
        <div className="w-5 h-5 rounded-full border-2 border-zinc-800 border-t-atlas-500 animate-spin" />
      </div>
    );
  }

  const showEmpty = messages.length === 0 && !streamBuf;

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Header */}
        <header className="mb-6 sm:mb-8">
          <div className="flex items-center gap-3 mb-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{
                background:
                  'linear-gradient(135deg, rgba(20, 241, 149, 0.22) 0%, rgba(20, 241, 149, 0.04) 100%)',
                boxShadow:
                  'inset 0 0 0 1px rgba(20, 241, 149, 0.38), 0 0 22px -4px rgba(20, 241, 149, 0.5)',
              }}
            >
              <Sparkles className="w-5 h-5 text-[#b4a7ff]" strokeWidth={1.75} />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-light tracking-tight leading-none">
                <GradientText>Atlas AI</GradientText>
              </h1>
              <p className="text-xs text-zinc-500 mt-1 font-mono">gemini-2.0-flash · 10 msgs/min</p>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
          {/* Sessions sidebar */}
          <aside className="hidden lg:block space-y-3 lg:sticky lg:top-20 lg:self-start">
            <button
              onClick={newChat}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-white text-[13px] font-light tracking-[0.005em] transition-all hover:brightness-110"
              style={{
                background:
                  'linear-gradient(180deg, rgba(20, 241, 149, 0.38) 0%, rgba(20, 241, 149, 0.14) 100%)',
                boxShadow:
                  'inset 0 0 0 1px rgba(20, 241, 149, 0.48), inset 0 1px 0 rgba(255,255,255,0.08), 0 0 22px -4px rgba(20, 241, 149, 0.55)',
              }}
            >
              <Plus className="w-4 h-4" /> New chat
            </button>

            <div
              className="rounded-xl overflow-hidden"
              style={{
                background: 'var(--bg-card)',
                boxShadow: '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.03)',
              }}
            >
              <p className="text-[10.5px] uppercase tracking-[0.18em] font-medium text-zinc-500 px-3 pt-3">
                Recent
              </p>
              {loadingSessions ? (
                <div className="p-3 text-xs text-zinc-600 font-mono">loading…</div>
              ) : sessions.length === 0 ? (
                <p className="p-3 text-xs text-zinc-500 italic">No chats yet.</p>
              ) : (
                <ul className="py-1">
                  {sessions.map((s) => {
                    const active = s.id === activeId;
                    return (
                      <li key={s.id}>
                        <button
                          onClick={() => loadSession(s.id)}
                          className="w-full text-left px-3 py-2 flex items-start gap-2 transition-colors"
                          style={{
                            background: active ? 'rgba(20, 241, 149, 0.1)' : 'transparent',
                            borderLeft: active
                              ? '2px solid rgba(20, 241, 149, 0.6)'
                              : '2px solid transparent',
                          }}
                        >
                          <MessageSquare
                            className="w-3.5 h-3.5 mt-0.5 shrink-0"
                            style={{ color: active ? '#b4a7ff' : '#52525b' }}
                          />
                          <div className="min-w-0 flex-1">
                            <p
                              className={`text-xs truncate ${active ? 'text-white' : 'text-zinc-300'}`}
                            >
                              {sessionTitle(s)}
                            </p>
                            <p className="text-[10px] text-zinc-600 mt-0.5">
                              {timeAgo(s.createdAt)}
                            </p>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </aside>

          {/* Chat area */}
          <div className="flex flex-col min-h-[60vh]">
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto rounded-xl p-4 sm:p-6 space-y-5 min-h-[50vh] max-h-[65vh]"
              style={{
                background: 'var(--bg-card)',
                boxShadow: '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.03)',
              }}
            >
              {showEmpty ? (
                <div className="h-full flex flex-col items-center justify-center text-center py-10">
                  <div
                    className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
                    style={{
                      background:
                        'linear-gradient(135deg, rgba(20, 241, 149, 0.22) 0%, rgba(20, 241, 149, 0.04) 100%)',
                      boxShadow:
                        'inset 0 0 0 1px rgba(20, 241, 149, 0.38), 0 0 22px -4px rgba(20, 241, 149, 0.5)',
                    }}
                  >
                    <Bot className="w-7 h-7 text-[#b4a7ff]" strokeWidth={1.5} />
                  </div>
                  <p className="text-lg text-white font-light tracking-tight mb-1">
                    Ask me anything about Atlas
                  </p>
                  <p className="text-xs text-zinc-500 mb-6 max-w-sm">
                    I can help with the platform, escrow, crypto basics, and more. I won&apos;t give
                    financial advice.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-xl">
                    {SUGGESTED_PROMPTS.map((p) => (
                      <button
                        key={p}
                        onClick={() => send(p)}
                        disabled={sending}
                        className="text-left text-xs text-zinc-300 hover:text-white px-3 py-2.5 rounded-lg transition-all hover:brightness-110 disabled:opacity-40"
                        style={{
                          background: 'var(--bg-card)',
                          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)',
                        }}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {messages.map((m) => (
                    <MessageBubble key={m.id} message={m} />
                  ))}
                  {streamBuf && (
                    <MessageBubble
                      message={{
                        id: 'streaming',
                        role: 'ASSISTANT',
                        content: streamBuf,
                        createdAt: new Date().toISOString(),
                      }}
                      streaming
                    />
                  )}
                  {sending && !streamBuf && (
                    <div className="flex items-center gap-2 text-xs text-zinc-500 font-mono">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      thinking…
                    </div>
                  )}
                </>
              )}
            </div>

            {error && (
              <p className="mt-3 text-xs text-red-400 font-mono" role="alert">
                {error}
              </p>
            )}

            {/* Composer */}
            <div
              className="mt-4 rounded-xl p-3"
              style={{
                background: 'var(--bg-card)',
                boxShadow: '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.03)',
              }}
            >
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value.slice(0, 2000))}
                onKeyDown={handleKeyDown}
                placeholder="Message Atlas AI — ↵ to send, ⇧+↵ for newline"
                rows={2}
                className="w-full bg-transparent text-sm text-zinc-200 placeholder-zinc-600 resize-none outline-none"
                disabled={sending}
              />
              <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-white/[0.06]">
                <p className="text-[10px] text-zinc-600 font-mono">{input.length}/2000</p>
                <button
                  onClick={() => send(input)}
                  disabled={!input.trim() || sending}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md disabled:opacity-40 disabled:cursor-not-allowed text-[12px] text-white font-light tracking-[0.005em] transition-all hover:brightness-110"
                  style={{
                    background:
                      'linear-gradient(180deg, rgba(20, 241, 149, 0.38) 0%, rgba(20, 241, 149, 0.14) 100%)',
                    boxShadow:
                      'inset 0 0 0 1px rgba(20, 241, 149, 0.48), inset 0 1px 0 rgba(255,255,255,0.08), 0 0 18px -6px rgba(20, 241, 149, 0.5)',
                  }}
                >
                  {sending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                  Send
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Message bubble ─────────────────────────────────────────────────────────────

function MessageBubble({
  message,
  streaming = false,
}: {
  message: AiMessage;
  streaming?: boolean;
}) {
  const isUser = message.role === 'USER';
  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
        style={
          isUser
            ? {
                background: 'rgba(255,255,255,0.05)',
                boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)',
              }
            : {
                background:
                  'linear-gradient(135deg, rgba(20, 241, 149, 0.22) 0%, rgba(20, 241, 149, 0.04) 100%)',
                boxShadow:
                  'inset 0 0 0 1px rgba(20, 241, 149, 0.38), 0 0 16px -4px rgba(20, 241, 149, 0.4)',
              }
        }
      >
        {isUser ? (
          <User className="w-4 h-4 text-zinc-300" strokeWidth={1.75} />
        ) : (
          <Bot className="w-4 h-4 text-[#b4a7ff]" strokeWidth={1.75} />
        )}
      </div>
      <div
        className={`max-w-[80%] rounded-xl px-4 py-2.5 ${
          isUser ? 'text-zinc-100' : 'text-zinc-200'
        }`}
        style={
          isUser
            ? {
                background:
                  'linear-gradient(180deg, rgba(20, 241, 149, 0.2) 0%, rgba(20, 241, 149, 0.06) 100%)',
                boxShadow:
                  'inset 0 0 0 1px rgba(20, 241, 149, 0.3), inset 0 1px 0 rgba(255,255,255,0.05)',
              }
            : {
                background:
                  'linear-gradient(180deg, rgba(30,30,36,0.8) 0%, rgba(18,18,24,0.8) 100%)',
                boxShadow:
                  'inset 0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.03)',
              }
        }
      >
        {isUser ? (
          <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
            {message.content}
          </p>
        ) : (
          <div className="text-sm leading-relaxed break-words">
            <Markdown source={message.content} />
            {streaming && (
              <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-atlas-400 animate-pulse align-middle" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
