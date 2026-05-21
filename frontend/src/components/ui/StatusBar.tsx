'use client';

import { motion } from 'framer-motion';
import React from 'react';

const STATS = [
  { value: 'Beta', label: 'Platform Status', indicator: true },
  { value: 'ETH', label: 'On-chain Payments', indicator: true },
  { value: 'Free', label: 'To Join', indicator: false },
  { value: '24/7', label: 'Platform Available', indicator: true },
];

export function StatusBar() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.3 }}
      className="w-full flex items-center justify-center"
    >
      <div className="flex items-center gap-0.5 px-1 py-1 rounded-full border border-white/10 bg-white/5 backdrop-blur-md">
        {STATS.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.4 + i * 0.1 }}
            className={`flex items-center gap-2.5 px-4 py-2 rounded-lg transition-colors ${
              i < STATS.length - 1 ? 'border-r border-white/10' : ''
            }`}
          >
            {stat.indicator && (
              <motion.div
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="w-2 h-2 rounded-full bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.6)]"
              />
            )}
            <div className="text-center">
              <div className="text-sm font-light text-white">{stat.value}</div>
              <div className="text-xs text-white/50">{stat.label}</div>
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
