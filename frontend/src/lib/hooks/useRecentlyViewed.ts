'use client';

import { useCallback, useEffect, useState } from 'react';

const KEY = 'haggl.market.recent.v1';
const MAX_RECENT = 24;

export interface RecentListing {
  id: string;
  title: string;
  type: string;
  seller: string | null;
  viewedAt: number;
}

function readStore(): RecentListing[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is RecentListing =>
        x && typeof x.id === 'string' && typeof x.title === 'string' && typeof x.type === 'string',
    );
  } catch {
    return [];
  }
}

function writeStore(items: RecentListing[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX_RECENT)));
    window.dispatchEvent(new CustomEvent('haggl:recent-changed'));
  } catch {
    /* storage full or disabled */
  }
}

export function useRecentlyViewed() {
  const [items, setItems] = useState<RecentListing[]>([]);

  useEffect(() => {
    setItems(readStore());
    const onChange = () => setItems(readStore());
    window.addEventListener('haggl:recent-changed', onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener('haggl:recent-changed', onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);

  const record = useCallback((entry: Omit<RecentListing, 'viewedAt'>) => {
    const current = readStore().filter((x) => x.id !== entry.id);
    writeStore([{ ...entry, viewedAt: Date.now() }, ...current]);
  }, []);

  const clear = useCallback(() => {
    writeStore([]);
  }, []);

  const remove = useCallback((id: string) => {
    writeStore(readStore().filter((x) => x.id !== id));
  }, []);

  return { items, record, clear, remove };
}
