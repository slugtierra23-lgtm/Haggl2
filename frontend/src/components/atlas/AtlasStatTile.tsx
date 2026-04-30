'use client';

import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import React from 'react';

import { cn } from '@/lib/utils';

export interface AtlasStatTileProps {
  label: string;
  value: React.ReactNode;
  caption?: string;
  icon?: React.ReactNode;
  /** Positive value renders green, negative red. */
  delta?: number | null;
  /** Optional sparkline values to render a tiny inline chart. */
  sparkline?: number[];
  /** Accent for the top hairline + sparkline stroke. Default: brand green. */
  accent?: string;
  /** Pulse the tile when this value changes. */
  pulseKey?: number;
  className?: string;
}

const Sparkline = ({ values, color }: { values: number[]; color: string }) => {
  if (!values || values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * 100;
      const y = 100 - ((v - min) / range) * 100;
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="absolute right-3 bottom-3 h-7 w-20 opacity-70"
      aria-hidden
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
};

/**
 * AtlasStatTile — premium KPI tile. Used on /market hero, /profile dashboard,
 * /orders summary etc. Top hairline gradient pulses on `pulseKey` change to
 * signal real-time updates (sales tick, volume change).
 */
export function AtlasStatTile({
  label,
  value,
  caption,
  icon,
  delta,
  sparkline,
  accent = 'var(--brand)',
  pulseKey,
  className,
}: AtlasStatTileProps) {
  const [pulsing, setPulsing] = React.useState(false);
  React.useEffect(() => {
    if (pulseKey == null) return;
    setPulsing(true);
    const t = setTimeout(() => setPulsing(false), 700);
    return () => clearTimeout(t);
  }, [pulseKey]);

  const deltaPositive = delta != null && delta >= 0;

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-lg px-4 py-3.5',
        'bg-[var(--bg-card)] border border-[var(--border)]',
        'transition-colors duration-200',
        pulsing && 'border-[var(--brand)]/45',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--text-muted)]">
          {icon && (
            <span style={{ color: accent }} className="inline-flex">
              {icon}
            </span>
          )}
          {label}
        </div>
        {delta != null && (
          <div
            className={cn(
              'inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums',
              deltaPositive ? 'text-[var(--brand)]' : 'text-red-400',
            )}
          >
            {deltaPositive ? (
              <ArrowUpRight className="w-3 h-3" strokeWidth={2} />
            ) : (
              <ArrowDownRight className="w-3 h-3" strokeWidth={2} />
            )}
            {Math.abs(delta).toFixed(1)}%
          </div>
        )}
      </div>

      <div className="font-mono text-xl md:text-2xl font-medium text-[var(--text)] tabular-nums tracking-tight">
        {value}
      </div>
      {caption && (
        <div className="text-[10.5px] text-[var(--text-muted)] font-light mt-0.5">{caption}</div>
      )}

      {sparkline && sparkline.length >= 2 && <Sparkline values={sparkline} color={accent} />}
    </div>
  );
}

export default AtlasStatTile;
