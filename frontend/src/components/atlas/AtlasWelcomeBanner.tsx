'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, Bot, FileCode, Plus, Sparkles, X } from 'lucide-react';
import Link from 'next/link';
import React from 'react';

const STORAGE_KEY = 'haggl-welcome-dismissed-v1';

/**
 * AtlasWelcomeBanner — first-visit overlay shown above the /market hero.
 * Three quick paths (browse, publish, learn) so a brand-new user is
 * never staring at a feed without context. Dismiss persists in
 * localStorage so it never re-appears for the same browser.
 */
export function AtlasWelcomeBanner() {
  const [dismissed, setDismissed] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    setDismissed(window.localStorage.getItem(STORAGE_KEY) === '1');
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      /* private mode etc. — non-fatal */
    }
  };

  // Hold render until we know the dismissed state to avoid a flash of
  // the banner for returning users.
  if (dismissed !== false) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.3, ease: [0.22, 0.61, 0.36, 1] }}
        className="relative mx-6 md:mx-10 mt-3 mb-2 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-card)]"
      >
        <div className="relative flex flex-col md:flex-row items-start md:items-center gap-4 px-5 py-3.5 mx-auto max-w-[1400px]">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div
              className="grid place-items-center w-10 h-10 rounded-xl shrink-0"
              style={{
                background: 'var(--brand-dim)',
                border: '1px solid rgba(20, 241, 149, 0.32)',
              }}
            >
              <Sparkles className="w-4 h-4 text-[var(--brand)]" strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <h3 className="text-[14px] font-medium text-[var(--text)] tracking-tight">
                Welcome to haggl
              </h3>
              <p className="text-[12.5px] text-[var(--text-muted)] font-light mt-0.5">
                The on-chain marketplace for AI agents. Browse what's selling, publish your own, or
                read the playbook.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap shrink-0">
            <WelcomeChip href="#screener" icon={<Bot className="w-3.5 h-3.5" />}>
              Browse
            </WelcomeChip>
            <WelcomeChip href="/market/agents/publish" icon={<Plus className="w-3.5 h-3.5" />}>
              Publish
            </WelcomeChip>
            <WelcomeChip
              href="/how-it-works"
              icon={<FileCode className="w-3.5 h-3.5" />}
              variant="ghost"
            >
              How it works
            </WelcomeChip>
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss welcome banner"
            className="absolute top-2 right-2 grid place-items-center w-7 h-7 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-card2)] transition-colors"
          >
            <X className="w-3.5 h-3.5" strokeWidth={2} />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function WelcomeChip({
  href,
  icon,
  children,
  variant = 'default',
}: {
  href: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  variant?: 'default' | 'ghost';
}) {
  if (variant === 'ghost') {
    return (
      <Link
        href={href}
        className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text)] transition-colors px-2 h-8"
      >
        {icon}
        {children}
        <ArrowRight className="w-3 h-3" strokeWidth={2.25} />
      </Link>
    );
  }
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-[12px] font-medium bg-[var(--bg-card2)] border border-[var(--border)] text-[var(--text)] hover:border-[var(--brand)]/45 hover:bg-[var(--bg-elevated)] transition-colors"
    >
      {icon}
      {children}
    </Link>
  );
}

export default AtlasWelcomeBanner;
