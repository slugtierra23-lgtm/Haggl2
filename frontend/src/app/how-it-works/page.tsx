'use client';

import { motion } from 'framer-motion';
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  Box,
  Code2,
  Compass,
  HelpCircle,
  KeyRound,
  Layers,
  LifeBuoy,
  Rocket,
  Search,
  ShieldCheck,
  Sparkles,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import React, { useMemo, useState } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────

interface DocSection {
  id: string;
  title: string;
  icon: LucideIcon;
  /** Short tag-style label for filter chips. */
  group: 'Start' | 'Product' | 'Technical' | 'Support';
  /** Free-text body — rendered as paragraphs, lists, key-value blocks. */
  body: React.ReactNode;
  /** Keywords used by the search filter. */
  keywords?: string[];
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function HowItWorksPage() {
  const [query, setQuery] = useState('');
  const [activeGroup, setActiveGroup] = useState<DocSection['group'] | 'All'>('All');

  const sections = SECTIONS;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sections.filter((s) => {
      if (activeGroup !== 'All' && s.group !== activeGroup) return false;
      if (!q) return true;
      const blob = `${s.title} ${s.group} ${s.keywords?.join(' ') ?? ''}`.toLowerCase();
      return blob.includes(q);
    });
  }, [sections, activeGroup, query]);

  return (
    <div className="mk-app-page min-h-screen pb-20" style={{ maxWidth: 'none', padding: 0 }}>
      <Hero />

      <section className="px-6 md:px-10 mt-6">
        <div className="mx-auto max-w-[1400px] grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-8">
          {/* ── Sidebar (sticky, filter + section list) ── */}
          <aside className="lg:sticky lg:top-20 lg:self-start space-y-4">
            <div className="relative">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)] pointer-events-none"
                strokeWidth={2}
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter docs…"
                className="w-full pl-9 pr-3 h-9 rounded-lg text-[13px] bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--brand)]/45"
              />
            </div>

            {/* Group chips */}
            <div className="flex flex-wrap gap-1.5">
              {(['All', 'Start', 'Product', 'Technical', 'Support'] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setActiveGroup(g)}
                  className={
                    'inline-flex items-center px-2.5 h-7 rounded-full text-[11px] font-semibold tracking-tight transition-colors ' +
                    (activeGroup === g
                      ? 'bg-[var(--brand-dim)] text-[var(--brand)] border border-[var(--brand)]/40'
                      : 'bg-[var(--bg-card2)] text-[var(--text-secondary)] border border-[var(--border)] hover:text-[var(--text)]')
                  }
                >
                  {g}
                </button>
              ))}
            </div>

            {/* Section nav */}
            <nav
              className="rounded-xl bg-[var(--bg-card)] border border-[var(--border)] py-1"
              aria-label="Documentation sections"
            >
              {filtered.length === 0 ? (
                <div className="px-3 py-3 text-[12px] text-[var(--text-muted)]">No matches.</div>
              ) : (
                filtered.map((s) => {
                  const Icon = s.icon;
                  return (
                    <a
                      key={s.id}
                      href={`#${s.id}`}
                      className="flex items-center gap-2.5 px-3 py-2 text-[13px] text-[var(--text-secondary)] hover:text-[var(--text)] hover:bg-[var(--bg-card2)] transition-colors"
                    >
                      <Icon
                        className="w-3.5 h-3.5 shrink-0 text-[var(--brand)]"
                        strokeWidth={1.75}
                      />
                      <span className="truncate">{s.title}</span>
                    </a>
                  );
                })
              )}
            </nav>
          </aside>

          {/* ── Content column ── */}
          <main className="space-y-3 min-w-0">
            {filtered.length === 0 ? (
              <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border)] p-10 text-center">
                <HelpCircle
                  className="w-8 h-8 text-[var(--text-muted)] mx-auto mb-3"
                  strokeWidth={1.5}
                />
                <p className="text-[14px] text-[var(--text)]">Nothing matches that filter.</p>
                <p className="text-[12.5px] text-[var(--text-muted)] mt-1">
                  Try a different keyword or clear the search.
                </p>
              </div>
            ) : (
              filtered.map((s, i) => <DocCard key={s.id} section={s} index={i} />)
            )}
          </main>
        </div>
      </section>
    </div>
  );
}

// ── Hero ───────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <header className="atlas-hero relative px-6 pt-12 pb-8 md:px-10 md:pt-20 md:pb-10 overflow-hidden">
      {/* Ambient blur layers removed — they made the hero look hazy
          compared to the crisp content below. */}
      <div aria-hidden className="atlas-hero__dots pointer-events-none absolute inset-0" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px"
        style={{
          background: 'linear-gradient(90deg, transparent 0%, var(--brand) 50%, transparent 100%)',
          opacity: 0.35,
        }}
      />

      <div className="relative mx-auto max-w-[1400px]">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-card)]/60 backdrop-blur-md px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[var(--text-secondary)] font-semibold"
        >
          <BookOpen className="w-3 h-3 text-[var(--brand)]" strokeWidth={2} />
          haggl docs
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 0.61, 0.36, 1] }}
          className="mt-6 text-4xl md:text-5xl xl:text-6xl font-semibold tracking-[-0.025em] text-[var(--text)] leading-[1.05] max-w-3xl"
        >
          Instructions, references
          <br className="hidden md:block" />
          <span className="text-[var(--brand)]"> and answers.</span>
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="mt-4 text-[15px] md:text-base text-[var(--text-secondary)] leading-relaxed max-w-2xl"
        >
          Everything you need to use haggl — buyer flow, seller flow, the technical stack that
          powers it, and what to do when something goes wrong. Filter by topic on the left or search
          by keyword.
        </motion.p>
      </div>
    </header>
  );
}

// ── Doc card ───────────────────────────────────────────────────────────────

function DocCard({ section, index }: { section: DocSection; index: number }) {
  const Icon = section.icon;
  return (
    <motion.article
      id={section.id}
      initial={{ opacity: 0, y: 6 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ delay: Math.min(index * 0.04, 0.3), duration: 0.3 }}
      className="rounded-xl bg-[var(--bg-card)] border border-[var(--border)] p-6 scroll-mt-24"
    >
      <header className="flex items-start gap-3 mb-4 pb-4 border-b border-[var(--border)]">
        <div
          className="w-10 h-10 rounded-lg grid place-items-center shrink-0"
          style={{
            background: 'var(--brand-dim)',
            border: '1px solid rgba(20, 241, 149, 0.32)',
          }}
        >
          <Icon className="w-4 h-4 text-[var(--brand)]" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
            {section.group}
          </div>
          <h2 className="mt-1 text-xl md:text-2xl font-semibold tracking-tight text-[var(--text)]">
            {section.title}
          </h2>
        </div>
      </header>
      <div className="docs-prose space-y-3 text-[14px] text-[var(--text-secondary)] leading-relaxed">
        {section.body}
      </div>
    </motion.article>
  );
}

// ── Helpers used in the body content ──────────────────────────────────────

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[14px] text-[var(--text-secondary)] leading-relaxed">{children}</p>;
}

function UL({ children }: { children: React.ReactNode }) {
  return (
    <ul className="space-y-1.5 text-[14px] text-[var(--text-secondary)] leading-relaxed pl-4 list-disc marker:text-[var(--brand)]">
      {children}
    </ul>
  );
}

function KV({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-x-4 gap-y-2 text-[13px]">
      {children}
    </div>
  );
}

function Term({ children }: { children: React.ReactNode }) {
  return <div className="text-[var(--text-muted)] font-medium">{children}</div>;
}

function Def({ children }: { children: React.ReactNode }) {
  return <div className="text-[var(--text)]">{children}</div>;
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="px-1.5 py-0.5 rounded font-mono text-[12.5px] bg-[var(--bg-card2)] border border-[var(--border)] text-[var(--text)]">
      {children}
    </code>
  );
}

function Where({ children, href }: { children: React.ReactNode; href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-[var(--brand)] hover:brightness-125 font-semibold"
    >
      {children}
      <ArrowRight className="w-3 h-3" strokeWidth={2.25} />
    </Link>
  );
}

// ── Content ───────────────────────────────────────────────────────────────

const SECTIONS: DocSection[] = [
  // ============================ START ====================================
  {
    id: 'quick-start',
    group: 'Start',
    title: 'Quick start (5 min)',
    icon: Rocket,
    keywords: ['getting started', 'first time', 'onboarding', 'connect', 'wallet'],
    body: (
      <>
        <P>
          Five steps from landing on haggl to publishing your first listing. No email, no password —
          your wallet IS your account.
        </P>
        <UL>
          <li>
            <strong className="text-[var(--text)]">1. Connect a wallet.</strong> Click{' '}
            <em>Sign in</em> top-right. Phantom for Solana, MetaMask + WalletConnect for EVM. You
            sign one short message — no transaction, no fee.
          </li>
          <li>
            <strong className="text-[var(--text)]">2. Set a username.</strong> Go to{' '}
            <Where href="/profile">Profile → General</Where> and pick a handle. This is how
            buyers/sellers see you.
          </li>
          <li>
            <strong className="text-[var(--text)]">3. Fund your wallet</strong> with a small amount
            of SOL (devnet during beta) so you can pay gas + the listing price.
          </li>
          <li>
            <strong className="text-[var(--text)]">4. Browse</strong> the live screener on{' '}
            <Where href="/market">/market</Where>. Click a row to see details, seller history, and
            buy.
          </li>
          <li>
            <strong className="text-[var(--text)]">5. Publish</strong> via{' '}
            <Where href="/market/agents/publish">Deploy agent</Where> or list a repo on{' '}
            <Where href="/market/repos">/market/repos</Where>.
          </li>
        </UL>
      </>
    ),
  },
  {
    id: 'buyer-flow',
    group: 'Start',
    title: 'How to buy a listing',
    icon: Wallet,
    keywords: ['buy', 'purchase', 'pay', 'escrow', 'order'],
    body: (
      <>
        <UL>
          <li>
            On any listing page, click <Code>Buy now</Code>. A consent modal shows the gross price,
            the platform fee, and the seller&apos;s wallet address.
          </li>
          <li>
            Approve in your wallet. Funds go to the <Code>HagglEscrow</Code> contract, NOT directly
            to the seller — they can&apos;t walk off with your money.
          </li>
          <li>
            The order shows up on <Where href="/orders">/orders</Where> in{' '}
            <Code>PENDING_DELIVERY</Code> status. The seller is notified and ships the goods
            (private GitHub access, agent invocation key, file download, etc.).
          </li>
          <li>
            When the seller marks delivered, you confirm or dispute. Confirm = funds released to
            seller. Dispute = funds frozen until admin resolves.
          </li>
          <li>
            Auto-release: if you neither confirm nor dispute within 14 days of delivery, funds go to
            the seller automatically.
          </li>
        </UL>
      </>
    ),
  },
  {
    id: 'seller-flow',
    group: 'Start',
    title: 'How to sell on haggl',
    icon: Sparkles,
    keywords: ['sell', 'publish', 'list', 'agent', 'repo'],
    body: (
      <>
        <P>Three listing types, one publish flow.</P>
        <UL>
          <li>
            <strong className="text-[var(--text)]">AI Agent</strong> — provide an HTTPS webhook URL.
            Buyers invoke it from the listing page. We sandbox the request and rate-limit per buyer.
          </li>
          <li>
            <strong className="text-[var(--text)]">Repo</strong> — connect GitHub on{' '}
            <Where href="/profile">Profile</Where>. Pick a repo, set a price. We grant collaborator
            access on purchase.
          </li>
          <li>
            <strong className="text-[var(--text)]">Bot / Script</strong> — upload a zip or paste a
            webhook. Same escrow flow, different delivery channel.
          </li>
        </UL>
        <P>
          Pricing is in SOL. Set a floor price for negotiable listings, a fixed price for one-click
          buys.
        </P>
      </>
    ),
  },

  // ============================ PRODUCT ==================================
  {
    id: 'site-map',
    group: 'Product',
    title: 'Where to find each thing',
    icon: Compass,
    keywords: ['navigation', 'menu', 'sitemap', 'pages', 'routes'],
    body: (
      <>
        <P>The whole product, mapped to the URL it lives at.</P>
        <KV>
          <Term>/market</Term>
          <Def>Live screener — every listing, ranked by 24h activity.</Def>
          <Term>/market/agents</Term>
          <Def>AI agents grid + your own published agents under "My agents".</Def>
          <Term>/market/repos</Term>
          <Def>Code repositories — vote, download, monetise.</Def>
          <Term>/market/agents/publish</Term>
          <Def>Deploy a new agent (the publish form).</Def>
          <Term>/inventory</Term>
          <Def>Everything you&apos;ve published + everything you&apos;ve bought.</Def>
          <Term>/orders</Term>
          <Def>Buying orders, selling orders, negotiations.</Def>
          <Term>/profile</Term>
          <Def>Identity, wallet links, API keys, security (2FA).</Def>
          <Term>/api-keys</Term>
          <Def>Programmatic access tokens for the haggl API.</Def>
          <Term>/notifications</Term>
          <Def>Inbox of platform events — sales, deliveries, disputes.</Def>
          <Term>/auth</Term>
          <Def>Wallet sign-in (no email/password).</Def>
        </KV>
      </>
    ),
  },
  {
    id: 'glossary',
    group: 'Product',
    title: 'Glossary — what every term means',
    icon: Box,
    keywords: ['terms', 'definitions', 'glossary', 'concepts'],
    body: (
      <>
        <KV>
          <Term>Listing</Term>
          <Def>An item for sale: an agent, a repo, a bot, a script.</Def>
          <Term>Agent endpoint</Term>
          <Def>An HTTPS URL where your agent receives invocations.</Def>
          <Term>Escrow</Term>
          <Def>The on-chain contract that holds buyer funds until delivery.</Def>
          <Term>Order</Term>
          <Def>A purchase record. Lives in PENDING / DELIVERED / COMPLETED / DISPUTED.</Def>
          <Term>Negotiation</Term>
          <Def>A back-and-forth on price before purchase. Optional.</Def>
          <Term>Floor price</Term>
          <Def>The minimum you&apos;ll accept on a negotiable listing.</Def>
          <Term>Live agent</Term>
          <Def>An agent that responds to a health check within 30s. Gets a green badge.</Def>
          <Term>Stuck payment</Term>
          <Def>Funds in escrow with no progress for &gt;14 days. See recovery section.</Def>
        </KV>
      </>
    ),
  },

  // ============================ TECHNICAL ================================
  {
    id: 'tech-stack',
    group: 'Technical',
    title: 'Technologies we use',
    icon: Layers,
    keywords: ['stack', 'tech', 'tools', 'framework', 'next.js', 'solana'],
    body: (
      <>
        <KV>
          <Term>Frontend</Term>
          <Def>
            Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS, framer-motion,
            socket.io-client.
          </Def>
          <Term>Backend</Term>
          <Def>
            NestJS 10, Prisma ORM, PostgreSQL 16, Redis (BullMQ + cache), Helmet, Zod validation,
            JWT auth, WebSockets.
          </Def>
          <Term>Blockchain</Term>
          <Def>
            Solana (mainnet + devnet during beta). HagglEscrow program for trade settlement. Phantom
            + MetaMask + WalletConnect for sign-in.
          </Def>
          <Term>AI providers</Term>
          <Def>Anthropic Claude (default), OpenAI-compatible adapter for custom agents.</Def>
          <Term>Email</Term>
          <Def>Resend for transactional notifications.</Def>
          <Term>Hosting</Term>
          <Def>
            Frontend on Vercel (edge cache), backend on Render (Web Service + Postgres + Redis).
          </Def>
        </KV>
      </>
    ),
  },
  {
    id: 'api-reference',
    group: 'Technical',
    title: 'API reference',
    icon: Code2,
    keywords: ['api', 'rest', 'endpoint', 'webhook', 'integrate'],
    body: (
      <>
        <P>
          Every page in the dashboard is also reachable via REST. Authenticate with an API key from{' '}
          <Where href="/api-keys">/api-keys</Where>.
        </P>
        <UL>
          <li>
            <strong className="text-[var(--text)]">Base URL:</strong>{' '}
            <Code>https://api.haggl.tech/api/v1</Code>
          </li>
          <li>
            <strong className="text-[var(--text)]">Auth header:</strong>{' '}
            <Code>Authorization: Bearer YOUR_API_KEY</Code>
          </li>
          <li>
            <strong className="text-[var(--text)]">Rate limits:</strong> 120 req/min by default,
            30/min on AI endpoints, 60/min on chat.
          </li>
          <li>
            <strong className="text-[var(--text)]">WebSocket:</strong>{' '}
            <Code>wss://api.haggl.tech</Code> for live trade events.
          </li>
        </UL>
        <P>
          Top routes: <Code>/market</Code>, <Code>/market/pulse</Code>, <Code>/orders</Code>,{' '}
          <Code>/agents/{'{id}'}/invoke</Code>, <Code>/auth/wallet/nonce</Code>. Full Swagger spec
          at <Code>/api-docs</Code>.
        </P>
      </>
    ),
  },
  {
    id: 'agent-webhook',
    group: 'Technical',
    title: 'Agent webhook spec',
    icon: KeyRound,
    keywords: ['webhook', 'agent', 'endpoint', 'invoke', 'spec'],
    body: (
      <>
        <P>
          To list an AI agent, expose an HTTPS endpoint that accepts a POST and returns JSON. We
          send a signed payload, you respond.
        </P>
        <UL>
          <li>
            <strong className="text-[var(--text)]">Request:</strong> POST with body{' '}
            <Code>{'{ task, input, agentKey, signature }'}</Code>.
          </li>
          <li>
            <strong className="text-[var(--text)]">Verify</strong> the HMAC signature against your{' '}
            <Code>AGENT_HMAC_SECRET</Code> before processing.
          </li>
          <li>
            <strong className="text-[var(--text)]">Respond</strong> within 30s with{' '}
            <Code>{'{ ok: true, output: ... }'}</Code> or{' '}
            <Code>{'{ ok: false, error: "..." }'}</Code>.
          </li>
          <li>
            <strong className="text-[var(--text)]">Health check:</strong> we GET{' '}
            <Code>/healthz</Code> on your endpoint every 5 min. 200 = green badge.
          </li>
        </UL>
      </>
    ),
  },
  {
    id: 'security',
    group: 'Technical',
    title: 'Security model',
    icon: ShieldCheck,
    keywords: ['security', 'auth', 'jwt', 'csrf', '2fa', 'audit'],
    body: (
      <>
        <UL>
          <li>
            <strong className="text-[var(--text)]">Sign-in:</strong> wallet signature only
            (SIWE-style nonce). No password stored on our side ever.
          </li>
          <li>
            <strong className="text-[var(--text)]">Session:</strong> short-lived JWT access token
            (15 min) + 30-day refresh token in HttpOnly cookies.
          </li>
          <li>
            <strong className="text-[var(--text)]">2FA:</strong> optional TOTP for high-value
            actions. Configure in <Where href="/profile?tab=security">Profile → Security</Where>.
          </li>
          <li>
            <strong className="text-[var(--text)]">CSRF:</strong> double-submit cookie pattern on
            all mutating routes.
          </li>
          <li>
            <strong className="text-[var(--text)]">Rate limiting:</strong> Redis-backed, per-IP and
            per-user.
          </li>
          <li>
            <strong className="text-[var(--text)]">Audit:</strong> security review report available
            at <Code>SECURITY_AUDIT_REPORT.md</Code> in the repo.
          </li>
        </UL>
      </>
    ),
  },

  // ============================ SUPPORT ==================================
  {
    id: 'recover-stuck-payment',
    group: 'Support',
    title: 'Recover stuck payment',
    icon: AlertCircle,
    keywords: ['stuck', 'recover', 'refund', 'escrow', 'dispute', 'support'],
    body: (
      <>
        <P>
          A "stuck payment" = funds locked in <Code>HagglEscrow</Code> with the counterparty
          unresponsive. Two paths to recover:
        </P>
        <UL>
          <li>
            <strong className="text-[var(--text)]">Auto-release (no action):</strong> if the seller
            marked delivery and you didn&apos;t respond in 14 days, the contract releases the funds
            to the seller. Conversely, if the seller never ships within 14 days of order, you (the
            buyer) can claim refund directly from the contract.
          </li>
          <li>
            <strong className="text-[var(--text)]">Open a dispute:</strong> on the order page, click{' '}
            <Code>Dispute</Code>. Funds freeze, an admin reviews both sides on{' '}
            <Where href="/admin/disputes">/admin/disputes</Where> and either:
            <UL>
              <li>Refunds the buyer (if seller didn&apos;t deliver)</li>
              <li>Releases to seller (if delivery is verifiable)</li>
              <li>Splits 50/50 (if it&apos;s genuinely ambiguous)</li>
            </UL>
          </li>
          <li>
            <strong className="text-[var(--text)]">Direct on-chain refund:</strong> the escrow
            program exposes a <Code>refundIfExpired</Code> instruction. Anyone can call it after the
            deadline — no admin needed. Pay the gas, get your money back.
          </li>
        </UL>
        <P>
          Email <Code>support@haggl.tech</Code> if none of the above resolves your case within 48
          hours. Include your order ID, the tx hash, and a screenshot of the order page.
        </P>
      </>
    ),
  },
  {
    id: 'troubleshooting',
    group: 'Support',
    title: 'Troubleshooting common issues',
    icon: LifeBuoy,
    keywords: ['troubleshoot', 'error', 'help', 'fix', 'broken'],
    body: (
      <>
        <UL>
          <li>
            <strong className="text-[var(--text)]">"Wallet connection failed"</strong> — your wallet
            extension is locked or on the wrong network. Unlock, switch to Solana mainnet (or devnet
            during beta), refresh.
          </li>
          <li>
            <strong className="text-[var(--text)]">Order stuck on PENDING_DELIVERY</strong> — the
            seller hasn&apos;t marked the order as delivered yet. DM them through the order page, or
            wait for the 14-day auto-resolve.
          </li>
          <li>
            <strong className="text-[var(--text)]">Agent shows offline</strong> — your health check
            at <Code>/healthz</Code> is failing. Check your server logs; we send a request every 5
            min.
          </li>
          <li>
            <strong className="text-[var(--text)]">"Insufficient funds" on buy</strong> — you need
            the listing price PLUS the platform fee (3% with $HAGGL token, 7% with native SOL) PLUS
            network gas.
          </li>
          <li>
            <strong className="text-[var(--text)]">Light/dark mode not switching</strong> — click
            the sun/moon icon top-right. Preference persists per-browser.
          </li>
        </UL>
      </>
    ),
  },
  {
    id: 'contact',
    group: 'Support',
    title: 'Get human help',
    icon: HelpCircle,
    keywords: ['contact', 'support', 'help', 'discord', 'email'],
    body: (
      <>
        <UL>
          <li>
            <strong className="text-[var(--text)]">Email:</strong> <Code>support@haggl.tech</Code> —
            for account, payment, dispute issues. Reply within 24h on weekdays.
          </li>
          <li>
            <strong className="text-[var(--text)]">X (Twitter):</strong>{' '}
            <a
              href="https://x.com/hagglhq"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--brand)] hover:brightness-125 font-semibold"
            >
              @hagglhq
            </a>{' '}
            — public announcements + DMs open.
          </li>
          <li>
            <strong className="text-[var(--text)]">Status page:</strong>{' '}
            <Code>status.haggl.tech</Code> — uptime + incident history.
          </li>
          <li>
            <strong className="text-[var(--text)]">GitHub:</strong> file bugs and feature requests
            at <Code>github.com/hagglhq/haggl/issues</Code>.
          </li>
        </UL>
      </>
    ),
  },
];
