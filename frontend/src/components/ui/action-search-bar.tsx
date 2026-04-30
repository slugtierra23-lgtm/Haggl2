'use client';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Send } from 'lucide-react';
import React from 'react';
import { useState, useEffect } from 'react';

import { Input } from '@/components/ui/input';

function useDebounce<T>(value: T, delay: number = 200): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debouncedValue;
}

export interface Action {
  id: string;
  label: string;
  icon: React.ReactNode;
  description?: string;
  short?: string;
  end?: string;
}

interface SearchResult {
  actions: Action[];
}

const container = {
  hidden: { opacity: 0, height: 0 },
  show: {
    opacity: 1,
    height: 'auto',
    transition: { height: { duration: 0.3 }, staggerChildren: 0.05 },
  },
  exit: {
    opacity: 0,
    height: 0,
    transition: { height: { duration: 0.25 }, opacity: { duration: 0.15 } },
  },
};

const item = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.2 } },
  exit: { opacity: 0, y: -4, transition: { duration: 0.15 } },
};

function ActionSearchBar({
  actions = [],
  placeholder = 'Search...',
  label,
  onSelect,
}: {
  actions?: Action[];
  placeholder?: string;
  label?: string;
  onSelect?: (action: Action) => void;
}) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [selectedAction, setSelectedAction] = useState<Action | null>(null);
  const debouncedQuery = useDebounce(query, 200);

  useEffect(() => {
    if (!isFocused) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResult(null);
      return;
    }
    if (!debouncedQuery) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResult({ actions });
      return;
    }
    const q = debouncedQuery.toLowerCase().trim();
    setResult({ actions: actions.filter((a) => a.label.toLowerCase().includes(q)) });
  }, [debouncedQuery, isFocused, actions]);

  const handleSelect = (action: Action) => {
    setSelectedAction(action);
    setQuery(action.label);
    setIsFocused(false);
    onSelect?.(action);
  };

  return (
    <div className="w-full">
      <div className="relative flex flex-col items-start">
        {label && (
          <label className="text-[10.5px] uppercase tracking-[0.18em] font-medium text-zinc-500 mb-2 block">
            {label}
          </label>
        )}
        <div className="relative w-full">
          <Input
            type="text"
            placeholder={placeholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedAction(null);
            }}
            onFocus={() => {
              setSelectedAction(null);
              setIsFocused(true);
            }}
            onBlur={() => setTimeout(() => setIsFocused(false), 180)}
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none">
            <AnimatePresence mode="popLayout">
              {query.length > 0 ? (
                <motion.div
                  key="send"
                  initial={{ y: -8, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: 8, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <Send className="w-3.5 h-3.5 text-[#b4a7ff]" strokeWidth={1.75} />
                </motion.div>
              ) : (
                <motion.div
                  key="search"
                  initial={{ y: -8, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: 8, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <Search className="w-3.5 h-3.5 text-zinc-500" strokeWidth={1.75} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="w-full">
          <AnimatePresence>
            {isFocused && result && !selectedAction && (
              <motion.div
                className="w-full rounded-xl overflow-hidden mt-1.5"
                style={{
                  background: 'var(--bg-card)',
                  boxShadow:
                    '0 0 0 1px rgba(20, 241, 149, 0.2), inset 0 1px 0 rgba(255,255,255,0.04), 0 16px 40px -10px rgba(0,0,0,0.5)',
                  backdropFilter: 'blur(8px)',
                }}
                variants={container}
                initial="hidden"
                animate="show"
                exit="exit"
              >
                <motion.ul className="max-h-64 overflow-y-auto">
                  {result.actions.length === 0 && (
                    <li className="px-4 py-3.5 text-[12px] text-zinc-500 text-center tracking-[0.005em]">
                      No results
                    </li>
                  )}
                  {result.actions.map((action) => (
                    <motion.li
                      key={action.id}
                      className="px-3.5 py-2.5 flex items-center justify-between cursor-pointer transition-colors hover:bg-white/[0.03] border-b border-white/[0.04] last:border-0"
                      variants={item}
                      onClick={() => handleSelect(action)}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-[#b4a7ff] flex-shrink-0 flex items-center">
                          {action.icon}
                        </span>
                        <span className="text-[13px] font-light text-zinc-200 truncate tracking-[0.005em]">
                          {action.label}
                        </span>
                        {action.description && (
                          <span className="text-[11px] text-zinc-500 truncate hidden sm:block tracking-[0.005em]">
                            {action.description}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                        {action.short && (
                          <span className="text-[10.5px] text-zinc-600 font-mono">
                            {action.short}
                          </span>
                        )}
                        {action.end && (
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded text-[#b4a7ff] font-mono tracking-[0.02em]"
                            style={{
                              background:
                                'linear-gradient(180deg, rgba(20, 241, 149, 0.12) 0%, rgba(20, 241, 149, 0.03) 100%)',
                              boxShadow: 'inset 0 0 0 1px rgba(20, 241, 149, 0.25)',
                            }}
                          >
                            {action.end}
                          </span>
                        )}
                      </div>
                    </motion.li>
                  ))}
                </motion.ul>
                {result.actions.length > 0 && (
                  <div
                    className="px-4 py-2 flex items-center justify-between text-[10.5px] text-zinc-600 font-mono uppercase tracking-[0.18em]"
                    style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
                  >
                    <span>
                      {result.actions.length} result{result.actions.length !== 1 ? 's' : ''}
                    </span>
                    <span>ESC to close</span>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

export { ActionSearchBar };
