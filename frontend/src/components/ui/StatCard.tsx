'use client';

import React from 'react';

export interface StatCardProps {
  /** Small uppercase eyebrow (e.g. "Volume 24h"). */
  label: string;
  /** Primary value, rendered large with tabular-nums. */
  value: React.ReactNode;
  /** Optional delta text (e.g. "+12.4%"). Rendered in the brand green.
   *  Pass `null`/`undefined` to omit when there is no real delta — never
   *  fake a number. */
  delta?: React.ReactNode;
  /** Optional accent color override for the delta line. Defaults to brand. */
  accent?: string;
  /** Optional leading icon (16-18px Lucide). Rendered top-right of the
   *  card in muted color, brand-green on hover. */
  icon?: React.ReactNode;
  /** Optional caption rendered below the value, e.g. "across 100 listings". */
  caption?: React.ReactNode;
  /** Optional className appended to the outer card. */
  className?: string;
}

/**
 * Premium dashboard stat tile — Vercel/Render-grade.
 * Surface uses var(--bg-card) so it sits flush with the rest of the app.
 * On hover the border lights brand-green and a soft radial wash appears,
 * giving each tile a light source. Numbers are tabular and tracked in.
 */
export function StatCard({
  label,
  value,
  delta,
  accent,
  icon,
  caption,
  className = '',
}: StatCardProps) {
  return (
    <div
      className={
        'group relative overflow-hidden ' +
        'rounded-[var(--radius-lg)] bg-[var(--bg-card)] border border-[var(--border)] ' +
        'px-5 pt-4 pb-5 ' +
        'hover:border-[rgba(20,241,149,0.32)] ' +
        'hover:shadow-[0_1px_0_rgba(255,255,255,0.04)_inset,0_18px_44px_-18px_rgba(20,241,149,0.18)] ' +
        'transition-all duration-[var(--duration-base)] ease-[var(--ease-out-expo)] ' +
        className
      }
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-[var(--duration-slow)]"
        style={{
          background: 'radial-gradient(circle at 100% 0%, rgba(20,241,149,0.08), transparent 55%)',
        }}
      />

      <div className="relative flex items-start justify-between gap-3">
        <p className="text-[10.5px] uppercase tracking-[0.14em] text-[var(--text-muted)] font-medium">
          {label}
        </p>
        {icon ? (
          <span className="text-[var(--text-muted)] group-hover:text-[var(--brand)] transition-colors duration-[var(--duration-base)]">
            {icon}
          </span>
        ) : null}
      </div>

      <p className="relative mt-3 text-[34px] leading-[1.05] font-medium tabular-nums text-[var(--text)] tracking-[-0.02em]">
        {value}
      </p>

      {(delta != null && delta !== '') || caption ? (
        <div className="relative mt-2 flex items-center gap-2 text-[11.5px]">
          {delta != null && delta !== '' ? (
            <span className="font-medium" style={{ color: accent ?? 'var(--brand)' }}>
              {delta}
            </span>
          ) : null}
          {caption ? <span className="text-[var(--text-muted)] font-light">{caption}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

export default StatCard;
