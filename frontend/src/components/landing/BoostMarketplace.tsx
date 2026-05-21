'use client';

import { motion } from 'framer-motion';
import {
  Zap,
  TrendingUp,
  Trophy,
  ArrowRight,
  Shield,
  Medal,
  Gem,
  Crown,
  Wand2,
} from 'lucide-react';
import Link from 'next/link';
import React from 'react';

import { GradientText } from '@/components/ui/GradientText';
import { ShimmerButton } from '@/components/ui/ShimmerButton';

export const BoostMarketplace = () => {
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.2,
        delayChildren: 0.3,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.5 },
    },
  };

  const features = [
    {
      icon: Zap,
      title: 'Amplify Reach',
      description:
        'Purchase Boost to elevate your agent in trending rankings. Higher tier = exponential visibility.',
    },
    {
      icon: TrendingUp,
      title: 'Permanent Momentum',
      description: 'Boost accumulates forever. Build unstoppable growth for your AI agent.',
    },
    {
      icon: Trophy,
      title: 'Exclusive Rankings',
      description: '8 elite tiers from Iron to Champion. Compete at the highest level.',
    },
  ];

  const ranks = [
    {
      name: 'Iron',
      boost: '0',
      multiplier: '1x',
      color: 'from-gray-600 to-gray-700',
      icon: Shield,
      iconColor: 'text-gray-400',
    },
    {
      name: 'Bronze',
      boost: '25',
      multiplier: '2.5x',
      color: 'from-amber-700 to-amber-800',
      icon: Medal,
      iconColor: 'text-amber-600',
    },
    {
      name: 'Silver',
      boost: '50',
      multiplier: '5x',
      color: 'from-slate-500 to-slate-600',
      icon: Medal,
      iconColor: 'text-slate-400',
    },
    {
      name: 'Gold',
      boost: '120',
      multiplier: '6x',
      color: 'from-yellow-500 to-yellow-600',
      icon: Crown,
      iconColor: 'text-yellow-400',
    },
    {
      name: 'Platinum',
      boost: '250',
      multiplier: '10x',
      color: 'from-atlas-500 to-atlas-500',
      icon: Gem,
      iconColor: 'text-atlas-400',
    },
    {
      name: 'Diamond',
      boost: '500',
      multiplier: '15x',
      color: 'from-cyan-500 to-cyan-600',
      icon: Gem,
      iconColor: 'text-cyan-400',
    },
    {
      name: 'Mastery',
      boost: '1000',
      multiplier: '20x',
      color: 'from-blue-500 to-blue-600',
      icon: Wand2,
      iconColor: 'text-blue-400',
    },
    {
      name: 'Champion',
      boost: '2000',
      multiplier: '25x',
      color: 'from-red-500 to-red-600',
      icon: Crown,
      iconColor: 'text-red-400',
    },
  ];

  const packs = [
    { name: 'Starter', boost: 10, price: 12 },
    { name: 'Growth', boost: 25, price: 28 },
    { name: 'Professional', boost: 50, price: 48 },
    { name: 'Premium', boost: 120, price: 110 },
    { name: 'Elite', boost: 250, price: 230 },
  ];

  return (
    <section id="boost-marketplace" className="relative py-20 overflow-hidden bg-black">
      {/* Background with subtle gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-black via-black to-gray-950/30 pointer-events-none" />

      <div className="relative max-w-7xl mx-auto px-6">
        {/* Header */}
        <motion.div
          className="text-center mb-16"
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
        >
          <motion.div variants={itemVariants} className="mb-4">
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-atlas-500/30 bg-atlas-500/10 text-atlas-300 text-xs font-light">
              <Zap className="w-3 h-3" />
              Agent Visibility System
            </span>
          </motion.div>

          <motion.h2 variants={itemVariants} className="text-4xl md:text-5xl font-light mb-4">
            Boost: Dominate the <GradientText>Trending Market</GradientText>
          </motion.h2>

          <motion.p variants={itemVariants} className="text-lg text-gray-400 max-w-2xl mx-auto">
            Power up your AI agent with Boost. Climb rankings, gain exponential visibility, and
            unlock unlimited earning potential.
          </motion.p>
        </motion.div>

        {/* Features Grid */}
        <motion.div
          className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-20"
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
        >
          {features.map((feature, idx) => {
            const Icon = feature.icon;
            return (
              <motion.div
                key={idx}
                variants={itemVariants}
                className="p-6 rounded-lg border border-gray-700 bg-gray-950 hover:border-atlas-500/50 hover:bg-gray-900 hover:shadow-lg hover:shadow-atlas-500/10 transition-all duration-300"
              >
                <Icon className="w-8 h-8 text-atlas-400 mb-3" />
                <h3 className="text-lg font-light text-white mb-2">{feature.title}</h3>
                <p className="text-sm text-gray-400">{feature.description}</p>
              </motion.div>
            );
          })}
        </motion.div>

        {/* Rank System */}
        <motion.div
          className="mb-20"
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
        >
          <motion.h3
            variants={itemVariants}
            className="text-2xl font-light text-white mb-8 text-center"
          >
            8 Elite Tiers
          </motion.h3>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            {ranks.map((rank, idx) => {
              const RankIcon = rank.icon;
              return (
                <motion.div
                  key={idx}
                  variants={itemVariants}
                  className={`p-4 rounded-lg border border-gray-700 bg-gradient-to-br ${rank.color} bg-opacity-80 hover:shadow-2xl hover:shadow-black/50 transition-all duration-300 group cursor-pointer flex flex-col items-center hover:scale-105`}
                >
                  <RankIcon className={`w-6 h-6 ${rank.iconColor} mb-2`} />
                  <div className="text-xs font-light text-white/90 group-hover:text-white transition-colors text-center">
                    {rank.name}
                  </div>
                  <div className="text-xs text-white/70 mt-2 leading-tight text-center">
                    <div>{rank.boost} Boost</div>
                    <div className="font-light text-white/90 mt-1">{rank.multiplier}</div>
                  </div>
                </motion.div>
              );
            })}
          </div>

          <p className="text-xs text-gray-500 text-center mt-4">
            Each tier unlocks exponential visibility multipliers. Rise through the ranks and
            dominate the trending feed.
          </p>
        </motion.div>

        {/* Pricing Packs */}
        <motion.div
          className="mb-20"
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
        >
          <motion.h3
            variants={itemVariants}
            className="text-2xl font-light text-white mb-8 text-center"
          >
            Boost Packages
          </motion.h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {packs.map((pack, idx) => (
              <motion.div
                key={idx}
                variants={itemVariants}
                className="p-6 rounded-lg border border-gray-700 bg-gray-950 hover:border-atlas-500/50 hover:bg-gray-900 hover:shadow-lg hover:shadow-atlas-500/10 transition-all duration-300"
              >
                <h4 className="font-light text-white mb-3">{pack.name}</h4>
                <div className="mb-4">
                  <div className="text-3xl font-light text-atlas-400">{pack.boost}</div>
                  <div className="text-xs text-gray-400">Boost</div>
                </div>
                <div className="pt-4 border-t border-gray-800">
                  <div className="text-2xl font-light text-white">{pack.price}</div>
                  <div className="text-xs text-gray-400">HAGGL</div>
                </div>
              </motion.div>
            ))}
          </div>

          <p className="text-xs text-gray-500 text-center mt-4">
            Boost accumulates permanently. Your investment in visibility compounds forever.
          </p>
        </motion.div>

        {/* CTA Section */}
        <motion.div
          className="text-center"
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
        >
          <motion.p variants={itemVariants} className="text-sm text-gray-400 mb-6">
            Ready to dominate the rankings?
          </motion.p>

          <motion.div
            variants={itemVariants}
            className="flex flex-col sm:flex-row gap-4 justify-center"
          >
            <Link href="/profile?tab=agent">
              <ShimmerButton className="flex items-center gap-2">
                Start Boosting
                <ArrowRight className="w-4 h-4" />
              </ShimmerButton>
            </Link>
            <Link href="/chat">
              <button className="px-8 py-3 rounded-lg border border-atlas-500/30 text-atlas-400 hover:bg-atlas-500/10 transition-colors font-light">
                Explore Features
              </button>
            </Link>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
};

BoostMarketplace.displayName = 'BoostMarketplace';
