'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import React, { useState, useEffect } from 'react';

interface RenderHeroProps {
  isAuthenticated?: boolean;
}

export function RenderHero({ isAuthenticated = false }: RenderHeroProps) {
  const [wordIndex, setWordIndex] = useState(0);
  const words = ['AI agents', 'code repos', 'paid APIs', 'trading bots', 'dev tools', 'scripts'];

  useEffect(() => {
    const interval = setInterval(() => {
      setWordIndex((prev) => (prev + 1) % words.length);
    }, 2200);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      className="relative overflow-hidden border-b grid grid-cols-1 lg:grid-cols-[1fr_minmax(0,1fr)] gap-8 lg:gap-0 px-6 sm:px-10 lg:px-0 min-h-[calc(100vh-64px)] lg:min-h-[calc(100vh-90px)]"
      style={{
        background:
          'linear-gradient(to left bottom, rgba(26,11,61,0.55), rgba(0,0,0,0) 45%), #0a0a0f',
        borderColor: 'rgba(39,39,39)',
      }}
    >
      {/* Grid lines overlay */}
      <div
        className="absolute inset-0 pointer-events-none hidden lg:block"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.04) 1px, transparent 1px)',
          backgroundSize: 'calc(100% / 16) 100px',
        }}
      />

      {/* LEFT COLUMN - Text Content */}
      <motion.div
        initial={{ opacity: 0, x: -30 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.8 }}
        className="relative z-10 flex flex-col justify-center gap-8 sm:gap-10 py-14 sm:py-20 lg:py-20 lg:pl-[6.25%] lg:pr-[4%]"
      >
        {/* Hero Text Group */}
        <div className="flex flex-col gap-5 sm:gap-6">
          <h1
            className="text-white font-light text-[clamp(36px,9vw,80px)] leading-[1.02] tracking-[-0.03em]"
            style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
          >
            The on-chain
            <br />
            marketplace for
            <span className="block relative mt-1 sm:mt-2 min-h-[1.3em] pb-[0.15em] overflow-visible">
              <motion.span
                key={wordIndex}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.5 }}
                className="absolute left-0 top-0 inline-flex items-baseline gap-1.5"
              >
                <span
                  className="font-light text-[clamp(36px,9vw,80px)] leading-[1.15] tracking-[-0.03em] pb-[0.08em]"
                  style={{
                    background: 'linear-gradient(to right, #a7f3d0, #14F195)',
                    backgroundClip: 'text',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}
                >
                  {words[wordIndex]}
                </span>
                <motion.span
                  animate={{ opacity: [1, 1, 0, 0] }}
                  transition={{ duration: 1.1, repeat: Infinity }}
                  className="inline-flex items-center text-[clamp(36px,9vw,80px)] leading-[1.15]"
                  style={{
                    height: '1em',
                    width: '0.6ch',
                    background: 'linear-gradient(to top, #a78bfa, rgba(167,139,250,0.5))',
                    backgroundClip: 'text',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}
                >
                  ▌
                </motion.span>
              </motion.span>
            </span>
          </h1>

          <p className="text-white/70 text-base sm:text-lg lg:text-xl leading-relaxed max-w-[560px] text-pretty">
            Publish your code, deploy AI agents, and negotiate deals. Settled in ETH and secured by
            on-chain escrow.
          </p>
        </div>

        {/* Buttons */}
        <div className="flex flex-wrap gap-3">
          <Link
            href={isAuthenticated ? '/market' : '/auth?tab=register'}
            className="hover:opacity-85 transition-opacity inline-flex items-center gap-2.5 bg-white text-[#0a0a0f] px-5 sm:px-6 py-3.5 sm:py-5 text-base sm:text-lg lg:text-xl whitespace-nowrap"
            style={{ fontWeight: 700 }}
          >
            {isAuthenticated ? 'Open marketplace' : 'Start selling'}
            <span className="text-[0.9em]">›</span>
          </Link>
          <Link
            href="/market"
            className="inline-flex items-center gap-2.5 px-5 sm:px-6 py-3.5 sm:py-5 text-base sm:text-lg lg:text-xl text-white whitespace-nowrap transition-all hover:brightness-110"
            style={{
              background: 'rgba(20, 241, 149, 0.08)',
              boxShadow:
                'inset 0 0 0 1px rgba(20, 241, 149, 0.32), 0 0 22px -6px rgba(20, 241, 149, 0.4)',
            }}
          >
            Browse the market
          </Link>
        </div>
      </motion.div>

      {/* RIGHT COLUMN - Visual/Lottie */}
      <motion.div
        initial={{ opacity: 0, x: 30 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.8, delay: 0.2 }}
        className="relative hidden lg:flex items-center justify-center pr-[6.25%]"
      >
        {/* Ambient blur blobs removed — produced a hazy seam against
            the crisp content below. */}
      </motion.div>
    </div>
  );
}
