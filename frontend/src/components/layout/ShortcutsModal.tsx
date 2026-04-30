'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Command, Keyboard, Slash, X } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

import { GOTO_SHORTCUTS } from '@/lib/hooks/useGoToShortcuts';

interface Shortcut {
  keys: string[];
  description: string;
}

interface ShortcutGroup {
  title: string;
  items: Shortcut[];
}

const GROUPS: ShortcutGroup[] = [
  {
    title: 'Search & navigation',
    items: [
      { keys: ['⌘', 'K'], description: 'Open command palette' },
      { keys: ['Ctrl', 'K'], description: 'Open command palette (Windows/Linux)' },
      { keys: ['/'], description: 'Focus the page search input' },
      { keys: ['Esc'], description: 'Close palette, dialog, or dropdown' },
    ],
  },
  {
    title: 'Inside the palette',
    items: [
      { keys: ['↑'], description: 'Move up' },
      { keys: ['↓'], description: 'Move down' },
      { keys: ['↵'], description: 'Run selected command' },
    ],
  },
  {
    title: 'Jump to page',
    items: GOTO_SHORTCUTS,
  },
  {
    title: 'Global',
    items: [{ keys: ['?'], description: 'Show this keyboard cheatsheet' }],
  },
];

function KeyBadge({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      className="inline-flex items-center justify-center min-w-[24px] h-[22px] px-1.5 rounded-md text-[10.5px] font-medium text-zinc-200 leading-none"
      style={{
        background:
          'linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)',
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04)',
        letterSpacing: 0,
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      }}
    >
      {children}
    </kbd>
  );
}

export function ShortcutsModal() {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable)
          return;
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    // Programmatic open — triggered by the "? Shortcuts" button in
    // PowerNavbar so mobile / mouse-only users can find the modal too.
    const openHandler = () => setOpen(true);
    window.addEventListener('keydown', handler);
    window.addEventListener('haggl:open-shortcuts', openHandler);
    return () => {
      window.removeEventListener('keydown', handler);
      window.removeEventListener('haggl:open-shortcuts', openHandler);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const getFocusable = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute('inert'));

    const focusables = getFocusable();
    focusables[0]?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const list = getFocusable();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener('keydown', onKeyDown);
    return () => {
      dialog.removeEventListener('keydown', onKeyDown);
      previouslyFocusedRef.current?.focus?.();
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[100] flex items-center justify-center px-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="absolute inset-0 backdrop-blur-md"
            style={{ background: 'rgba(3, 3, 8, 0.72)' }}
          />
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="shortcuts-modal-title"
            initial={{ opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 12 }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md rounded-2xl overflow-hidden"
            style={{
              background: 'var(--bg-card)',
              boxShadow:
                '0 30px 80px -20px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.05)',
            }}
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 h-px"
              style={{
                background:
                  'linear-gradient(90deg, transparent 0%, rgba(20, 241, 149, 0.5) 50%, transparent 100%)',
              }}
            />
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
              <div className="flex items-center gap-2.5">
                <span
                  className="inline-flex items-center justify-center w-7 h-7 rounded-lg"
                  style={{
                    background: 'rgba(20, 241, 149, 0.12)',
                    border: '1px solid rgba(20, 241, 149, 0.22)',
                  }}
                >
                  <Keyboard className="w-3.5 h-3.5 text-[#a89dff]" strokeWidth={1.75} />
                </span>
                <p
                  id="shortcuts-modal-title"
                  className="text-[13px] font-medium text-white tracking-[0.005em]"
                >
                  Keyboard shortcuts
                </p>
              </div>
              <motion.button
                onClick={() => setOpen(false)}
                aria-label="Close shortcuts"
                whileHover={{ rotate: 90 }}
                whileTap={{ scale: 0.88 }}
                transition={{ type: 'spring', stiffness: 320, damping: 20 }}
                className="w-7 h-7 rounded-md flex items-center justify-center text-zinc-500 hover:text-white hover:bg-white/5 transition-colors"
              >
                <X className="w-4 h-4" strokeWidth={1.75} />
              </motion.button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto divide-y divide-white/[0.04]">
              {GROUPS.map((group) => (
                <div key={group.title} className="px-5 py-4">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-medium mb-3">
                    {group.title}
                  </p>
                  <ul className="space-y-2">
                    {group.items.map((item) => (
                      <li
                        key={item.description}
                        className="flex items-center justify-between gap-3 py-1"
                      >
                        <span className="text-[13px] font-normal text-zinc-300 leading-relaxed">
                          {item.description}
                        </span>
                        <span className="flex items-center gap-1 shrink-0">
                          {item.keys.map((k, i) => (
                            <React.Fragment key={i}>
                              {i > 0 && (
                                <span className="text-[10px] text-zinc-600 px-0.5">then</span>
                              )}
                              <KeyBadge>{k}</KeyBadge>
                            </React.Fragment>
                          ))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <div
              className="flex items-center justify-between px-5 py-3 border-t border-white/[0.06] text-[11px] text-zinc-500"
              style={{ background: 'rgba(255,255,255,0.015)' }}
            >
              <span className="flex items-center gap-1.5 flex-wrap">
                <span>Press</span>
                <KeyBadge>
                  <Slash className="w-3 h-3" />
                </KeyBadge>
                <span>to search,</span>
                <KeyBadge>
                  <Command className="w-3 h-3" />K
                </KeyBadge>
                <span>for everything.</span>
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
