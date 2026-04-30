'use client';

import { motion } from 'framer-motion';
import { LucideIcon } from 'lucide-react';
import React from 'react';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
    href?: string;
  };
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  const primaryStyle = {
    background:
      'linear-gradient(180deg, rgba(20, 241, 149, 0.38) 0%, rgba(20, 241, 149, 0.14) 100%)',
    boxShadow:
      'inset 0 0 0 1px rgba(20, 241, 149, 0.48), inset 0 1px 0 rgba(255,255,255,0.08), 0 0 22px -4px rgba(20, 241, 149, 0.55)',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.36, ease: [0.22, 0.61, 0.36, 1] }}
      className="relative flex flex-col items-center justify-center py-16 px-4 rounded-2xl overflow-hidden"
      style={{
        background: 'var(--bg-card)',
        boxShadow:
          '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.04), 0 12px 36px -20px rgba(0,0,0,0.55)',
      }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          background:
            'linear-gradient(90deg, transparent 0%, rgba(20, 241, 149, 0.45) 50%, transparent 100%)',
        }}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-64 h-64 rounded-full blur-3xl opacity-40"
        style={{ background: 'rgba(20, 241, 149, 0.18)' }}
      />
      {Icon && (
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.08, type: 'spring', stiffness: 260, damping: 20 }}
          className="relative w-12 h-12 rounded-xl mb-4 flex items-center justify-center"
          style={{
            background:
              'linear-gradient(135deg, rgba(20, 241, 149, 0.22) 0%, rgba(20, 241, 149, 0.06) 100%)',
            boxShadow:
              'inset 0 0 0 1px rgba(20, 241, 149, 0.38), inset 0 1px 0 rgba(255,255,255,0.06), 0 0 24px -6px rgba(20, 241, 149, 0.45)',
          }}
        >
          <Icon className="w-5 h-5 text-[#b4a7ff]" strokeWidth={1.5} />
        </motion.div>
      )}
      <h3 className="relative text-lg font-light text-white tracking-[-0.005em] mb-1.5">{title}</h3>
      <p className="relative text-[13px] text-zinc-400 text-center max-w-sm mb-6 tracking-[0.005em] leading-relaxed">
        {description}
      </p>
      {action &&
        (action.href ? (
          <motion.a
            href={action.href}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 360, damping: 22 }}
            className="relative inline-flex items-center gap-2 h-10 px-4 rounded-lg font-light text-[13px] text-white hover:brightness-110 tracking-[0.005em]"
            style={primaryStyle}
          >
            {action.label}
          </motion.a>
        ) : (
          <motion.button
            onClick={action.onClick}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 360, damping: 22 }}
            className="relative inline-flex items-center gap-2 h-10 px-4 rounded-lg font-light text-[13px] text-white hover:brightness-110 tracking-[0.005em]"
            style={primaryStyle}
          >
            {action.label}
          </motion.button>
        ))}
    </motion.div>
  );
}
