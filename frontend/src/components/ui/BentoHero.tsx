'use client';

import { motion } from 'framer-motion';
import { CheckCircle2, Activity } from 'lucide-react';
import React from 'react';

import { AnimatedSparkline } from './AnimatedSparkline';
import { BentoCard } from './BentoCard';

export function BentoHero() {
  const agentDeployData = [0.3, 0.5, 0.4, 0.7, 0.6, 0.8, 0.7, 0.75, 0.8];
  const paymentNodeData = [0.4, 0.45, 0.42, 0.48, 0.44, 0.46, 0.42, 0.5, 0.48];

  return (
    <div className="relative">
      {/* Subtle grid background */}
      <div className="absolute inset-0 pointer-events-none">
        <svg width="100%" height="100%" className="absolute">
          <defs>
            <pattern
              id="bento-grid"
              x="0"
              y="0"
              width="60"
              height="60"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 60 0 L 0 0 0 60"
                fill="none"
                stroke="rgba(255, 255, 255, 0.05)"
                strokeWidth="1"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#bento-grid)" />
        </svg>
      </div>

      {/* Bento Grid */}
      <div className="max-w-7xl mx-auto px-4 py-20 relative z-10">
        {/* Main title section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mb-16 space-y-4 max-w-3xl"
        >
          <h1 className="text-5xl md:text-6xl lg:text-7xl font-light leading-tight text-white">
            Build, ship, and earn <span className="text-atlas-500">with AI agents</span>
          </h1>
          <p className="text-lg text-gray-400">
            The developer platform for publishing code, deploying AI agents, and earning from your
            work. Connect your stack, reach buyers, get paid in ETH.
          </p>
        </motion.div>

        {/* Bento Grid Layout */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 auto-rows-[300px] md:auto-rows-[320px]">
          {/* Card 1: AI Agent Deploy (2x1) */}
          <BentoCard colSpan={2} delay={0}>
            <div className="h-full flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Activity className="w-4 h-4 text-green-400" />
                  <span className="text-xs uppercase tracking-wider text-gray-500">
                    AI Agent Deploy
                  </span>
                </div>
                <div className="text-sm text-green-400 font-light">Available</div>
              </div>
              <div className="h-16">
                <AnimatedSparkline data={agentDeployData} color="#14F195" width={200} height={60} />
              </div>
            </div>
          </BentoCard>

          {/* Card 2: CPU Usage (1x1) */}
          <BentoCard delay={0.1}>
            <div className="h-full flex flex-col justify-between">
              <span className="text-xs uppercase tracking-wider text-gray-500">CPU Usage</span>
              <div className="text-3xl font-light text-white">28%</div>
              <div className="h-12">
                <AnimatedSparkline
                  data={[0.2, 0.25, 0.28, 0.26, 0.32, 0.28, 0.3]}
                  color="#ec4899"
                  width={100}
                  height={40}
                />
              </div>
            </div>
          </BentoCard>

          {/* Card 3: ETH Payment Node (2x1) — Base L2 */}
          <BentoCard colSpan={2} delay={0.2}>
            <div className="h-full flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Activity className="w-4 h-4 text-green-400" />
                  <span className="text-xs uppercase tracking-wider text-gray-500">
                    ETH Payment Node
                  </span>
                </div>
                <div className="text-sm text-green-400 font-light">Available</div>
              </div>
              <div className="h-16">
                <AnimatedSparkline data={paymentNodeData} color="#06b6d4" width={200} height={60} />
              </div>
            </div>
          </BentoCard>

          {/* Card 4: Memory (1x1) */}
          <BentoCard delay={0.3}>
            <div className="h-full flex flex-col justify-between">
              <span className="text-xs uppercase tracking-wider text-gray-500">Memory</span>
              <div className="text-3xl font-light text-white">42%</div>
              <div className="h-12">
                <AnimatedSparkline
                  data={[0.4, 0.42, 0.45, 0.42, 0.48, 0.44, 0.46]}
                  color="#22c55e"
                  width={100}
                  height={40}
                />
              </div>
            </div>
          </BentoCard>

          {/* Card 5: Services Status (3x1) */}
          <BentoCard colSpan={3} delay={0.4}>
            <div className="h-full space-y-4">
              <span className="text-xs uppercase tracking-wider text-gray-500 block">
                Active Services
              </span>
              <div className="grid grid-cols-4 gap-4 flex-1">
                {[
                  { name: 'Web Service', status: true },
                  { name: 'API Layer', status: true },
                  { name: 'Database', status: true },
                  { name: 'Queue Worker', status: true },
                ].map((service) => (
                  <div key={service.name} className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-400" />
                    <span className="text-sm text-gray-300">{service.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </BentoCard>
        </div>

        {/* Stats Bar */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.5 }}
          className="mt-16 grid grid-cols-4 gap-4"
        >
          {[
            { value: 'Beta', label: 'Platform Status' },
            { value: 'ETH', label: 'On-chain Payments' },
            { value: 'Free', label: 'To Join' },
            { value: '24/7', label: 'Available' },
          ].map((stat, i) => (
            <div
              key={i}
              className="text-center p-4 rounded-lg border border-white/10"
              style={{ background: 'rgba(0, 0, 0, 0.3)' }}
            >
              <div className="text-lg font-light text-white">{stat.value}</div>
              <div className="text-xs text-gray-500 mt-1">{stat.label}</div>
            </div>
          ))}
        </motion.div>

        {/* CTA Buttons */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.6 }}
          className="mt-12 flex gap-4 justify-center"
        >
          <button className="btn-primary text-sm px-6 py-2.5 rounded-lg">Start building</button>
          <button className="btn-secondary text-sm px-6 py-2.5 rounded-lg">
            Explore marketplace
          </button>
        </motion.div>
      </div>
    </div>
  );
}
