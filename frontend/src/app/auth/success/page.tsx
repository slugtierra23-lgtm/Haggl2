'use client';

import { motion } from 'framer-motion';
import { CheckCircle2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import React from 'react';
import { useEffect } from 'react';

import { useAuth } from '@/lib/auth/AuthProvider';

export default function AuthSuccessPage() {
  const router = useRouter();
  const { refresh, user, isLoading } = useAuth();

  useEffect(() => {
    refresh().then(() => {
      // handled by the second useEffect once user is loaded
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace('/auth');
      return;
    }
    if (!user.profileSetup) {
      router.push('/profile/setup');
    } else {
      router.push('/');
    }
  }, [user, isLoading, router]);

  return (
    <div
      className="relative flex items-center justify-center min-h-screen overflow-hidden"
      style={{ background: 'var(--bg-page)' }}
    >
      <div
        className="absolute -top-40 left-1/2 -translate-x-1/2 w-[480px] h-[480px] rounded-full opacity-25 blur-3xl pointer-events-none"
        style={{ background: 'radial-gradient(circle, #14F195 0%, transparent 70%)' }}
      />
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.42, ease: [0.22, 0.61, 0.36, 1] }}
        className="relative text-center"
      >
        <motion.div
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.12, type: 'spring', stiffness: 260, damping: 18 }}
          className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mx-auto mb-5"
          style={{
            background:
              'linear-gradient(135deg, rgba(20, 241, 149, 0.25) 0%, rgba(20, 241, 149, 0.06) 100%)',
            border: '1px solid rgba(20, 241, 149, 0.4)',
            boxShadow:
              'inset 0 1px 0 rgba(255,255,255,0.1), 0 0 32px -6px rgba(20, 241, 149, 0.55)',
          }}
        >
          <CheckCircle2 className="w-8 h-8 text-[#b4a7ff]" strokeWidth={1.5} />
        </motion.div>
        <div className="text-white text-lg font-light tracking-[0.005em] mb-1.5">
          Authentication successful
        </div>
        <div className="text-zinc-500 text-[13px] font-light">Redirecting…</div>
      </motion.div>
    </div>
  );
}
