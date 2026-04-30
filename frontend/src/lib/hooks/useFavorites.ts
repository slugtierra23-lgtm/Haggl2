'use client';

import { useCallback, useEffect, useState } from 'react';

const LISTING_KEY = 'haggl.market.favorites.v1';
const REPO_KEY = 'haggl.repo.favorites.v1';
const MAX_FAVORITES = 200;
const EVENT = 'haggl:favorites-changed';

function readStore(key: string): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeStore(key: string, ids: string[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(ids.slice(0, MAX_FAVORITES)));
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    /* storage full or disabled */
  }
}

function useStoredIds(key: string) {
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => {
    setIds(readStore(key));
    const onChange = () => setIds(readStore(key));
    window.addEventListener(EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener('storage', onChange);
    };
  }, [key]);

  const add = useCallback(
    (id: string) => {
      const current = readStore(key);
      if (current.includes(id)) return;
      writeStore(key, [id, ...current]);
    },
    [key],
  );

  const remove = useCallback(
    (id: string) => {
      writeStore(
        key,
        readStore(key).filter((x) => x !== id),
      );
    },
    [key],
  );

  const toggle = useCallback(
    (id: string) => {
      const current = readStore(key);
      if (current.includes(id)) {
        writeStore(
          key,
          current.filter((x) => x !== id),
        );
      } else {
        writeStore(key, [id, ...current]);
      }
    },
    [key],
  );

  const has = useCallback((id: string) => ids.includes(id), [ids]);

  return { ids, add, remove, toggle, has };
}

/** Listing favorites (agents, bots, scripts, etc). */
export function useFavorites() {
  return useStoredIds(LISTING_KEY);
}

/** Repo favorites — separate keyspace so IDs don't collide with listings. */
export function useFavoriteRepos() {
  return useStoredIds(REPO_KEY);
}
