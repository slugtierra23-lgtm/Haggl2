'use client';

import { motion } from 'framer-motion';
import { TrendingUp, Users, Zap, Shield } from 'lucide-react';
import React from 'react';

import { AnimatedCounter } from '@/components/ui/AnimatedCounter';

interface Stat {
  label: string;
  value: number;
  suffix?: string;
  prefix?: string;
  decimals?: number;
  icon: React.ReactNode;
  color: string;
}

const STATS: Stat[] = [
  {
    label: 'Active Developers',
    value: 12400,
    icon: <Users className="w-6 h-6" />,
    color: 'bg-blue-500/20 text-blue-400',
  },
  {
    label: 'Agents Deployed',
    value: 5847,
    icon: <Zap className="w-6 h-6" />,
    color: 'bg-yellow-500/20 text-yellow-400',
  },
  {
    label: 'Total Transactions',
    value: 48392,
    icon: <TrendingUp className="w-6 h-6" />,
    color: 'bg-green-500/20 text-green-400',
  },
  {
    label: 'Platform Uptime',
    value: 99.98,
    suffix: '%',
    decimals: 2,
    icon: <Shield className="w-6 h-6" />,
    color: 'bg-atlas-500/20 text-atlas-400',
  },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.3,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.5,
      ease: [0.4, 0, 0.2, 1],
    },
  },
};

export function StatsShowcase() {
  return (
    <section className="py-20 px-4 border-t" style={{ borderColor: 'var(--border)' }}>
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-16"
        >
          <h2 className="text-4xl md:text-5xl font-light text-white mb-4">
            Powering the Developer Economy
          </h2>
          <p className="text-zinc-400 text-lg max-w-2xl mx-auto">
            Real-time insights into the Atlas platform&apos;s growth and impact
          </p>
        </motion.div>

        {/* Stats Grid */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-100px' }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"
        >
          {STATS.map((stat, idx) => (
            <motion.div
              key={stat.label}
              variants={itemVariants}
              className={
                'relative group overflow-hidden rounded-lg border border-white/10 p-6 backdrop-blur-sm transition-all duration-300 hover:border-white/20 hover:bg-white/5'
              }
            >
              {/* Gradient background on hover */}
              <div
                className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                style={{
                  background:
                    'linear-gradient(135deg, rgba(20, 241, 149, 0.1), rgba(6,182,212,0.1))',
                }}
              />

              {/* Content */}
              <div className="relative z-10">
                {/* Icon */}
                <div
                  className={`inline-flex items-center justify-center w-12 h-12 rounded-lg mb-4 ${stat.color}`}
                >
                  {stat.icon}
                </div>

                {/* Label */}
                <p className="text-zinc-400 text-sm mb-3">{stat.label}</p>

                {/* Value */}
                <div className="text-3xl font-light text-white mb-2">
                  <motion.span
                    initial={{ opacity: 0, scale: 0.5 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.2 + idx * 0.1, duration: 0.4 }}
                  >
                    {stat.prefix}
                    <AnimatedCounter
                      value={stat.value}
                      suffix={stat.suffix}
                      decimals={stat.decimals}
                      duration={2.5}
                    />
                  </motion.span>
                </div>

                {/* Trend indicator */}
                <div className="flex items-center gap-2 text-xs text-emerald-400">
                  <TrendingUp className="w-3.5 h-3.5" />
                  <span>+12% this month</span>
                </div>
              </div>

              {/* Bottom border accent */}
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-atlas-500/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            </motion.div>
          ))}
        </motion.div>

        {/* Bottom CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.5 }}
          className="text-center mt-16"
        >
          <p className="text-zinc-400 mb-6">Join thousands of developers building the future</p>
          <button className="px-8 py-3 bg-gradient-to-r from-atlas-500 to-atlas-600 text-white rounded-lg font-light hover:shadow-lg hover:shadow-atlas-500/30 transition-all duration-300 hover:-translate-y-1">
            Start Building Today
          </button>
        </motion.div>
      </div>
    </section>
  );
}
