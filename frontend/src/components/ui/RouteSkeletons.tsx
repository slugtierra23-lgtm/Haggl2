'use client';

import { motion } from 'framer-motion';
import React from 'react';

const FADE = [0.22, 0.61, 0.36, 1] as const;

/**
 * Route-level skeleton helpers for `loading.tsx` files.
 *
 * Next.js shows the matching `loading.tsx` while a server segment is
 * fetching data. Since every list page in this app is client-rendered
 * with a useEffect fetch, the loading.tsx renders during the route
 * transition AND while the bundle hydrates. Net effect: the user
 * always sees something matching the layout instead of the previous
 * page hanging around.
 *
 * Visual language matches the real `.mk-*` classes in globals.css —
 * dark cards with the brand purple #14F195 ambient, shimmer animation
 * via the `.skeleton` utility class.
 */

function Bar({ w, h = '14px', className = '' }: { w: string; h?: string; className?: string }) {
  return <div className={`app-shimmer rounded ${className}`} style={{ width: w, height: h }} />;
}

function PageHero({ crumbs, title }: { crumbs: string[]; title: string }) {
  return (
    <div className="mk-hero">
      <div className="mk-hero__crumbs">
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            <span className="mk-hero__crumb-link" style={{ opacity: 0.5 }}>
              {c}
            </span>
            {i < crumbs.length - 1 && <span className="mk-hero__crumb-sep">/</span>}
          </React.Fragment>
        ))}
      </div>
      <div className="mk-hero__row">
        <div>
          <h1 className="mk-hero__title">{title}</h1>
          <Bar w="320px" h="12px" className="mt-2 opacity-50" />
        </div>
      </div>
      <div className="mk-stats mt-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="mk-stat">
            <Bar w="60px" h="10px" className="mb-1.5 opacity-60" />
            <Bar w="40px" h="14px" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function CardGridSkeleton({
  crumbs,
  title,
  count = 9,
}: {
  crumbs: string[];
  title: string;
  count?: number;
}) {
  return (
    <div className="mk-app-page">
      <PageHero crumbs={crumbs} title={title} />
      <div className="mk-grid mt-4">
        {Array.from({ length: count }).map((_, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i * 0.04, 0.3), duration: 0.26, ease: FADE }}
            className="mk-card"
            style={{ minHeight: 180 }}
          >
            <div className="mk-card__top">
              <div className="mk-card__icon app-shimmer" style={{ width: 28, height: 28 }} />
              <div className="mk-card__title-col" style={{ flex: 1 }}>
                <Bar w="60%" h="14px" />
                <Bar w="40%" h="10px" className="mt-1.5 opacity-60" />
              </div>
            </div>
            <div className="px-3 pb-3 pt-1">
              <Bar w="100%" h="10px" className="opacity-60" />
              <Bar w="80%" h="10px" className="mt-1.5 opacity-60" />
              <div className="flex gap-2 mt-3">
                <Bar w="48%" h="28px" />
                <Bar w="48%" h="28px" />
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

export function TableSkeleton({
  crumbs,
  title,
  rows = 8,
  cols = 5,
}: {
  crumbs: string[];
  title: string;
  rows?: number;
  cols?: number;
}) {
  return (
    <div className="mk-app-page">
      <PageHero crumbs={crumbs} title={title} />
      <div
        className="mt-4 rounded-xl overflow-hidden"
        style={{ border: '1px solid rgba(255,255,255,0.06)' }}
      >
        {Array.from({ length: rows }).map((_, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: Math.min(i * 0.03, 0.25), duration: 0.22, ease: FADE }}
            className="flex items-center gap-3 px-4 py-3"
            style={{ borderBottom: i < rows - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}
          >
            {Array.from({ length: cols }).map((_, j) => (
              <Bar
                key={j}
                w={j === 0 ? '24%' : `${Math.round(76 / (cols - 1))}%`}
                h={j === 0 ? '16px' : '12px'}
                className={j === 0 ? '' : 'opacity-60'}
              />
            ))}
          </motion.div>
        ))}
      </div>
    </div>
  );
}

export function ListSkeleton({
  crumbs,
  title,
  count = 8,
}: {
  crumbs: string[];
  title: string;
  count?: number;
}) {
  return (
    <div className="mk-app-page">
      <PageHero crumbs={crumbs} title={title} />
      <div className="space-y-2 mt-4">
        {Array.from({ length: count }).map((_, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i * 0.04, 0.3), duration: 0.22, ease: FADE }}
            className="flex items-center gap-3 p-3 rounded-lg"
            style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.04)',
            }}
          >
            <div className="app-shimmer rounded-full" style={{ width: 32, height: 32 }} />
            <div style={{ flex: 1 }}>
              <Bar w="55%" h="13px" />
              <Bar w="35%" h="10px" className="mt-1.5 opacity-60" />
            </div>
            <Bar w="60px" h="20px" className="opacity-60" />
          </motion.div>
        ))}
      </div>
    </div>
  );
}

export function ChatSkeleton({ crumbs, title }: { crumbs: string[]; title: string }) {
  return (
    <div className="mk-app-page">
      <PageHero crumbs={crumbs} title={title} />
      <div className="grid gap-3 mt-4" style={{ gridTemplateColumns: '260px 1fr', minHeight: 480 }}>
        <div
          className="space-y-2 p-3 rounded-lg"
          style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.04)',
          }}
        >
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2 p-2 rounded">
              <div className="app-shimmer rounded-full" style={{ width: 28, height: 28 }} />
              <div style={{ flex: 1 }}>
                <Bar w="80%" h="11px" />
                <Bar w="50%" h="9px" className="mt-1 opacity-60" />
              </div>
            </div>
          ))}
        </div>
        <div
          className="p-4 rounded-lg flex flex-col gap-3"
          style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.04)',
          }}
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.05, 0.3), duration: 0.24, ease: FADE }}
              className="flex gap-2"
              style={{ alignSelf: i % 2 === 0 ? 'flex-start' : 'flex-end', maxWidth: '70%' }}
            >
              <div
                className="app-shimmer rounded-2xl"
                style={{ width: i % 3 === 0 ? 220 : 160, height: 38 }}
              />
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
