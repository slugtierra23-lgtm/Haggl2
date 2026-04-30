'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Search, X } from 'lucide-react';
import React from 'react';
import { useState, useCallback, useMemo } from 'react';

export interface FilterOption {
  id: string;
  label: string;
  value: unknown;
}

interface SearchFilterProps {
  placeholder?: string;
  onSearch: (query: string) => void;
  onFilterChange?: (filters: string[]) => void;
  suggestions?: string[];
  filters?: FilterOption[];
  debounce?: number;
}

export function SearchFilter({
  placeholder = 'Search...',
  onSearch,
  onFilterChange,
  suggestions = [],
  filters = [],
  debounce = 300,
}: SearchFilterProps) {
  const [query, setQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedFilters, setSelectedFilters] = useState<string[]>([]);
  const [debounceTimer, setDebounceTimer] = useState<NodeJS.Timeout | null>(null);

  const filteredSuggestions = useMemo(() => {
    if (!query) return [];
    return suggestions.filter((s) => s.toLowerCase().includes(query.toLowerCase())).slice(0, 5);
  }, [query, suggestions]);

  const handleSearch = useCallback(
    (value: string) => {
      setQuery(value);
      setShowSuggestions(!!value);

      if (debounceTimer) clearTimeout(debounceTimer);
      const timer = setTimeout(() => {
        onSearch(value);
      }, debounce);
      setDebounceTimer(timer);
    },
    [onSearch, debounce, debounceTimer],
  );

  const handleSuggestionClick = (suggestion: string) => {
    setQuery(suggestion);
    setShowSuggestions(false);
    onSearch(suggestion);
  };

  const handleFilterToggle = (filterId: string) => {
    setSelectedFilters((prev) => {
      const updated = prev.includes(filterId)
        ? prev.filter((f) => f !== filterId)
        : [...prev, filterId];
      onFilterChange?.(updated);
      return updated;
    });
  };

  const handleClearFilters = () => {
    setSelectedFilters([]);
    onFilterChange?.([]);
  };

  const inputStyle = {
    background: 'var(--bg-card)',
    boxShadow: '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.03)',
  };

  return (
    <div className="space-y-4">
      {/* Search Input */}
      <div className="relative">
        <div className="relative flex items-center">
          <Search
            className="absolute left-3 w-3.5 h-3.5 text-zinc-500 pointer-events-none"
            strokeWidth={1.75}
          />
          <input
            type="text"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            onFocus={() => query && setShowSuggestions(true)}
            placeholder={placeholder}
            className="w-full pl-9 pr-9 py-2.5 rounded-lg text-white placeholder-zinc-600 font-light text-[13px] tracking-[0.005em] outline-none transition-all focus:shadow-[0_0_0_3px_rgba(20, 241, 149, 0.12)]"
            style={inputStyle}
          />
          <AnimatePresence>
            {query && (
              <motion.button
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.6 }}
                whileTap={{ scale: 0.85 }}
                whileHover={{ rotate: 90 }}
                transition={{ type: 'spring', stiffness: 360, damping: 22 }}
                onClick={() => {
                  setQuery('');
                  onSearch('');
                  setShowSuggestions(false);
                }}
                className="absolute right-2.5 w-6 h-6 rounded-md flex items-center justify-center text-zinc-500 hover:text-white hover:bg-white/10 transition-colors"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        {/* Search Suggestions */}
        <AnimatePresence>
          {showSuggestions && filteredSuggestions.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15 }}
              className="absolute top-full left-0 right-0 mt-1.5 rounded-xl overflow-hidden z-50"
              style={{
                background: 'var(--bg-card)',
                boxShadow:
                  '0 0 0 1px rgba(20, 241, 149, 0.2), inset 0 1px 0 rgba(255,255,255,0.04), 0 16px 40px -10px rgba(0,0,0,0.5)',
                backdropFilter: 'blur(8px)',
              }}
            >
              {filteredSuggestions.map((suggestion, idx) => (
                <motion.button
                  key={suggestion}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.18, delay: idx * 0.03 }}
                  onClick={() => handleSuggestionClick(suggestion)}
                  className="w-full text-left px-3.5 py-2.5 text-[13px] text-zinc-300 font-light hover:text-white hover:bg-white/[0.03] transition-colors border-b border-white/[0.04] last:border-0 flex items-center gap-2.5 tracking-[0.005em]"
                >
                  <Search className="w-3 h-3 text-zinc-500 flex-shrink-0" strokeWidth={1.75} />
                  {suggestion}
                </motion.button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Filters */}
      {filters.length > 0 && (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <p className="text-[10.5px] uppercase tracking-[0.18em] font-medium text-zinc-500">
              Filters
            </p>
            {selectedFilters.length > 0 && (
              <button
                onClick={handleClearFilters}
                className="text-[11px] text-[#b4a7ff] hover:text-white transition-colors tracking-[0.005em]"
              >
                Clear all
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {filters.map((filter) => {
              const active = selectedFilters.includes(filter.id);
              return (
                <motion.button
                  key={filter.id}
                  onClick={() => handleFilterToggle(filter.id)}
                  whileTap={{ scale: 0.95 }}
                  whileHover={{ y: -1 }}
                  transition={{ type: 'spring', stiffness: 360, damping: 22 }}
                  className={`inline-flex items-center h-7 px-2.5 rounded-full text-[11px] font-medium transition-colors tracking-[0.005em] ${
                    active ? 'text-white' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                  style={
                    active
                      ? {
                          background:
                            'linear-gradient(180deg, rgba(20, 241, 149, 0.22) 0%, rgba(20, 241, 149, 0.08) 100%)',
                          boxShadow:
                            'inset 0 0 0 1px rgba(20, 241, 149, 0.4), 0 0 14px -4px rgba(20, 241, 149, 0.45)',
                        }
                      : {
                          background: 'var(--bg-card)',
                          boxShadow:
                            '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.03)',
                        }
                  }
                >
                  {filter.label}
                </motion.button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
