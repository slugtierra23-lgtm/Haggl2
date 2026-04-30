'use client';
import React from 'react';

import { cn } from '@/lib/utils';

interface FlipCardProps extends React.HTMLAttributes<HTMLDivElement> {
  icon: React.ReactNode;
  title: string;
  description: string;
  subtitle?: string;
  rotate?: 'x' | 'y';
  accentColor?: string;
}

export default function FlipCard({
  icon,
  title,
  description,
  subtitle,
  rotate = 'y',
  accentColor = 'rgba(20, 241, 149, 0.15)',
  className,
}: FlipCardProps) {
  const rotationClass = {
    x: ['group-hover:[transform:rotateX(180deg)]', '[transform:rotateX(180deg)]'],
    y: ['group-hover:[transform:rotateY(180deg)]', '[transform:rotateY(180deg)]'],
  };
  const self = rotationClass[rotate];

  return (
    <div
      className={cn('group h-72 w-full [perspective:1000px] cursor-default select-none', className)}
    >
      <div
        className={cn(
          'relative h-full rounded-2xl transition-all duration-700 [transform-style:preserve-3d]',
          self[0],
        )}
      >
        {/* Front */}
        <div
          className="absolute inset-0 h-full w-full rounded-2xl [backface-visibility:hidden] flex flex-col items-center justify-center gap-5 px-6"
          style={{
            background: 'linear-gradient(135deg, rgba(13,11,24,0.95) 0%, rgba(8,6,18,0.98) 100%)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          {/* Corner decorators */}
          <div className="absolute top-3 left-3 w-4 h-4 border-t border-l border-atlas-400/30" />
          <div className="absolute top-3 right-3 w-4 h-4 border-t border-r border-atlas-400/30" />
          <div className="absolute bottom-3 left-3 w-4 h-4 border-b border-l border-atlas-400/30" />
          <div className="absolute bottom-3 right-3 w-4 h-4 border-b border-r border-atlas-400/30" />
          {/* Glow */}
          <div
            className="absolute inset-0 rounded-2xl pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500"
            style={{
              background:
                'radial-gradient(ellipse at center, rgba(20, 241, 149, 0.08) 0%, transparent 70%)',
            }}
          />
          {/* Icon */}
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{ background: accentColor, border: '1px solid rgba(20, 241, 149, 0.25)' }}
          >
            {icon}
          </div>
          <div className="text-center">
            <div className="text-lg font-light text-white mb-1">{title}</div>
            {subtitle && (
              <div className="text-xs font-mono text-atlas-400 uppercase tracking-widest">
                {subtitle}
              </div>
            )}
          </div>
          {/* Hint */}
          <div className="absolute bottom-5 text-[10px] font-mono text-zinc-700 tracking-widest">
            HOVER TO LEARN MORE
          </div>
        </div>

        {/* Back */}
        <div
          className={cn(
            'absolute inset-0 h-full w-full rounded-2xl [backface-visibility:hidden] flex flex-col justify-between p-7',
            self[1],
          )}
          style={{
            background:
              'linear-gradient(135deg, rgba(20, 241, 149, 0.12) 0%, rgba(8,6,18,0.98) 60%)',
            border: '1px solid rgba(20, 241, 149, 0.25)',
          }}
        >
          {/* Corner decorators */}
          <div className="absolute top-3 left-3 w-4 h-4 border-t border-l border-atlas-400/50" />
          <div className="absolute top-3 right-3 w-4 h-4 border-t border-r border-atlas-400/50" />
          <div className="absolute bottom-3 left-3 w-4 h-4 border-b border-l border-atlas-400/50" />
          <div className="absolute bottom-3 right-3 w-4 h-4 border-b border-r border-atlas-400/50" />
          <div>
            <div className="text-xs font-mono text-atlas-400 uppercase tracking-widest mb-3">
              {subtitle}
            </div>
            <h3 className="text-xl font-light text-white mb-4 leading-tight">{title}</h3>
            <div className="w-8 h-px mb-4" style={{ background: 'rgba(20, 241, 149, 0.6)' }} />
            <p className="text-sm text-zinc-300 leading-relaxed">{description}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-atlas-400 animate-pulse" />
            <span className="text-[10px] font-mono text-atlas-400 uppercase tracking-widest">
              Active
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
