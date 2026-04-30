'use client';

import { motion, AnimatePresence } from 'framer-motion';
import React from 'react';
import { useState } from 'react';
import { ReactNode } from 'react';

interface EnhancedTooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
  className?: string;
}

export function EnhancedTooltip({
  content,
  children,
  side = 'top',
  delay = 0.2,
  className = '',
}: EnhancedTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);

  const offsetMap = {
    top: { x: 0, y: -40 },
    bottom: { x: 0, y: 40 },
    left: { x: -40, y: 0 },
    right: { x: 40, y: 0 },
  };

  const arrowMap = {
    top: 'bottom-full translate-y-1',
    bottom: 'top-full translate-y-1',
    left: 'right-full translate-x-1',
    right: 'left-full translate-x-1',
  };

  const offset = offsetMap[side];
  const arrowPos = arrowMap[side];

  const tooltipStyle = {
    background: 'var(--bg-card)',
    boxShadow:
      '0 0 0 1px rgba(20, 241, 149, 0.25), inset 0 1px 0 rgba(255,255,255,0.04), 0 12px 28px -10px rgba(0,0,0,0.6)',
    backdropFilter: 'blur(8px)',
  };

  return (
    <div
      className="relative inline-block"
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      {children}

      <AnimatePresence>
        {isVisible && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, ...offset }}
            animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, ...offset }}
            transition={{ delay, duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
            className={`absolute z-50 px-3 py-2 text-[12px] rounded-lg whitespace-nowrap pointer-events-none tracking-[0.005em] ${className}`}
            style={{
              ...tooltipStyle,
              left: side === 'right' ? '100%' : side === 'left' ? 'auto' : '50%',
              right: side === 'left' ? '100%' : 'auto',
              top: side === 'bottom' ? '100%' : side === 'top' ? 'auto' : '50%',
              bottom: side === 'top' ? '100%' : 'auto',
              transform:
                side === 'left' || side === 'right'
                  ? `translate${side === 'left' ? 'X' : 'X'}(-${side === 'left' ? 'calc(100% + 8px)' : 'calc(-100% - 8px)'}) translateY(-50%)`
                  : 'translateX(-50%)',
            }}
          >
            <div className="text-zinc-200 font-light">{content}</div>

            {/* Arrow */}
            <div
              className={`absolute w-2 h-2 transform rotate-45 ${arrowPos}`}
              style={{
                background: 'var(--bg-card)',
                boxShadow: '0 0 0 1px rgba(20, 241, 149, 0.25)',
                left: side === 'left' || side === 'right' ? 'auto' : '50%',
                right: side === 'left' ? '-6px' : 'auto',
                marginLeft: side === 'left' || side === 'right' ? 0 : '-4px',
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
