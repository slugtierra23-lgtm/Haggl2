'use client';

import { motion } from 'framer-motion';
import React from 'react';

import { cn } from '@/lib/utils';

/**
 * DotPattern — dotted grid masked to a centered radial fade. The
 * 21st.dev "ambient screener" backdrop. Sits behind hero copy without
 * dominating it.
 */
export function DotPattern({
  className,
  size = 22,
  color = 'rgba(20, 241, 149, 0.18)',
  maskShape = 'top',
}: {
  className?: string;
  size?: number;
  color?: string;
  /** Where the visible region lives. Default: top-centred. */
  maskShape?: 'top' | 'center';
}) {
  const mask =
    maskShape === 'center'
      ? 'radial-gradient(ellipse 50% 50% at 50% 50%, #000 30%, transparent 70%)'
      : 'radial-gradient(ellipse 55% 50% at 50% 0%, #000 25%, transparent 75%)';
  return (
    <div
      aria-hidden
      className={cn('pointer-events-none absolute inset-0', className)}
      style={{
        backgroundImage: `radial-gradient(circle at center, ${color} 1px, transparent 1.6px)`,
        backgroundSize: `${size}px ${size}px`,
        maskImage: mask,
        WebkitMaskImage: mask,
        opacity: 0.85,
      }}
    />
  );
}

/**
 * AmbientGlow — disabled. Previously rendered two large blurred blobs behind
 * heroes; the resulting haze made the top of every page look lower-quality
 * than the rest. Kept as a no-op so existing call sites still typecheck.
 */
export function AmbientGlow(_props: { className?: string; primary?: string; secondary?: string }) {
  return null;
}

/**
 * WordReveal — splits children-as-string into words and fades each in with a
 * blur, Aceternity-style. Use only with plain string children.
 */
export function WordReveal({
  children,
  className,
  baseDelay = 0,
  step = 0.07,
}: {
  children: string;
  className?: string;
  baseDelay?: number;
  step?: number;
}) {
  const words = children.split(' ');
  return (
    <span className={className}>
      {words.map((word, i) => (
        <motion.span
          key={`${word}-${i}`}
          initial={{ opacity: 0, filter: 'blur(6px)', y: 8 }}
          animate={{ opacity: 1, filter: 'blur(0px)', y: 0 }}
          transition={{
            duration: 0.4,
            delay: baseDelay + i * step,
            ease: 'easeOut',
          }}
          className="mr-2.5 inline-block"
        >
          {word}
        </motion.span>
      ))}
    </span>
  );
}

/**
 * BorderBeam — gradient hairline along a side. Used at the bottom of hero
 * sections to mark the seam to the content below without hard rules.
 */
export function BorderBeam({
  side = 'bottom',
  color = 'var(--brand)',
  opacity = 0.4,
  className,
}: {
  side?: 'top' | 'bottom' | 'left' | 'right';
  color?: string;
  opacity?: number;
  className?: string;
}) {
  const horizontal = side === 'top' || side === 'bottom';
  const positionClass =
    side === 'top'
      ? 'inset-x-0 top-0 h-px'
      : side === 'bottom'
        ? 'inset-x-0 bottom-0 h-px'
        : side === 'left'
          ? 'inset-y-0 left-0 w-px'
          : 'inset-y-0 right-0 w-px';

  const gradient = horizontal
    ? `linear-gradient(90deg, transparent 0%, ${color} 50%, transparent 100%)`
    : `linear-gradient(180deg, transparent 0%, ${color} 50%, transparent 100%)`;

  return (
    <div
      aria-hidden
      className={cn('pointer-events-none absolute', positionClass, className)}
      style={{ background: gradient, opacity }}
    />
  );
}
