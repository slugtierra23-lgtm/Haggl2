'use client';

export const dynamic = 'force-dynamic';

import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import React, { useState, useEffect } from 'react';

import { api, ApiError } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/AuthProvider';

export default function ProfileSetupPage() {
  const { user, isLoading, refresh } = useAuth();
  const router = useRouter();

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [twitterUrl, setTwitterUrl] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace('/auth');
      return;
    }
    // Pre-fill with existing data
    if (user.username) setUsername(user.username);
    if (user.displayName) setDisplayName(user.displayName);
    if (user.twitterUrl) setTwitterUrl(user.twitterUrl);
    if (user.linkedinUrl) setLinkedinUrl(user.linkedinUrl);
    if (user.websiteUrl) setWebsiteUrl(user.websiteUrl);
    // Already setup? redirect
    if (user.profileSetup) router.push('/');
  }, [user, isLoading, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      setError('Username is required');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await api.patch('/users/profile', {
        username: username.trim(),
        displayName: displayName.trim() || undefined,
        bio: bio.trim() || undefined,
        twitterUrl: twitterUrl.trim() || undefined,
        linkedinUrl: linkedinUrl.trim() || undefined,
        websiteUrl: websiteUrl.trim() || undefined,
      });
      await refresh();
      router.push('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 rounded-full border-2 border-zinc-700 border-t-atlas-400 animate-spin" />
      </div>
    );
  }

  return (
    <div
      className="relative min-h-screen overflow-hidden flex items-center justify-center px-4 py-16"
      style={{ background: 'var(--bg-page)' }}
    >
      <div
        className="absolute -top-40 -right-20 w-[480px] h-[480px] rounded-full opacity-20 blur-3xl pointer-events-none"
        style={{ background: 'radial-gradient(circle, #14F195 0%, transparent 70%)' }}
      />
      <div
        className="absolute top-40 -left-24 w-[360px] h-[360px] rounded-full opacity-15 blur-3xl pointer-events-none"
        style={{ background: 'radial-gradient(circle, #06B6D4 0%, transparent 70%)' }}
      />
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.42, ease: [0.22, 0.61, 0.36, 1] }}
        className="relative w-full max-w-md rounded-2xl overflow-hidden p-8"
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
        <div className="relative mb-8">
          <div
            className="inline-flex items-center justify-center w-12 h-12 rounded-xl mb-4"
            style={{
              background:
                'linear-gradient(135deg, rgba(20, 241, 149, 0.22) 0%, rgba(20, 241, 149, 0.06) 100%)',
              border: '1px solid rgba(20, 241, 149, 0.35)',
              boxShadow:
                'inset 0 1px 0 rgba(255,255,255,0.08), 0 0 24px -6px rgba(20, 241, 149, 0.45)',
            }}
          >
            <svg
              className="w-6 h-6 text-[#b4a7ff]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-light text-white tracking-[0.005em] mb-1">
            Set up your profile
          </h1>
          <p className="text-sm text-zinc-400 font-light">
            Choose your username and add your social links
          </p>
        </div>

        {error && (
          <div
            className="relative rounded-lg px-4 py-3 mb-4"
            style={{
              background: 'rgba(244,63,94,0.1)',
              boxShadow: 'inset 0 0 0 1px rgba(244,63,94,0.3)',
            }}
          >
            <p className="text-[#fda4af] text-[12.5px]">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="relative space-y-4">
          {/* Username */}
          <div>
            <label className="block text-[10.5px] uppercase tracking-[0.18em] text-zinc-500 font-medium mb-1.5">
              Username <span className="text-[#fda4af]">*</span>
            </label>
            <div
              className="flex items-center gap-2 rounded-lg px-3.5 py-2.5 focus-within:shadow-[0_0_0_3px_rgba(20, 241, 149, 0.12)] transition-all"
              style={{
                background: 'var(--bg-card)',
                boxShadow: '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.03)',
              }}
            >
              <span className="text-[#b4a7ff] font-mono text-sm">@</span>
              <input
                type="text"
                value={username}
                onChange={(e) =>
                  setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))
                }
                placeholder="your_username"
                className="flex-1 bg-transparent text-white text-[13px] font-mono outline-none placeholder:text-zinc-600"
                maxLength={30}
                required
              />
            </div>
            <p className="text-[11px] text-zinc-600 mt-1.5">Letters, numbers, _ and - only</p>
          </div>

          {/* Display Name */}
          <div>
            <label className="block text-[10.5px] uppercase tracking-[0.18em] text-zinc-500 font-medium mb-1.5">
              Display Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your Name"
              className="w-full rounded-lg px-3.5 py-2.5 text-white text-[13px] outline-none transition-all focus:shadow-[0_0_0_3px_rgba(20, 241, 149, 0.12)] placeholder:text-zinc-600"
              style={{
                background: 'var(--bg-card)',
                boxShadow: '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.03)',
              }}
              maxLength={50}
            />
          </div>

          {/* Bio */}
          <div>
            <label className="block text-[10.5px] uppercase tracking-[0.18em] text-zinc-500 font-medium mb-1.5">
              Bio
            </label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Tell us about yourself…"
              rows={3}
              className="w-full rounded-lg px-3.5 py-2.5 text-white text-[13px] outline-none transition-all focus:shadow-[0_0_0_3px_rgba(20, 241, 149, 0.12)] placeholder:text-zinc-600 resize-none"
              style={{
                background: 'var(--bg-card)',
                boxShadow: '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.03)',
              }}
              maxLength={300}
            />
          </div>

          {/* Divider */}
          <div className="pt-2">
            <p className="text-[10.5px] uppercase tracking-[0.18em] text-zinc-500 font-medium mb-3">
              Social links <span className="normal-case tracking-normal">(optional)</span>
            </p>

            {/* Twitter/X */}
            <div className="space-y-2.5">
              <div
                className="flex items-center gap-2.5 rounded-lg px-3.5 py-2.5 focus-within:shadow-[0_0_0_3px_rgba(20, 241, 149, 0.12)] transition-all"
                style={{
                  background: 'var(--bg-card)',
                  boxShadow:
                    '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.03)',
                }}
              >
                <svg
                  className="w-4 h-4 text-zinc-500 shrink-0"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.259 5.631 5.905-5.631zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
                <input
                  type="url"
                  value={twitterUrl}
                  onChange={(e) => setTwitterUrl(e.target.value)}
                  placeholder="https://x.com/yourhandle"
                  className="flex-1 bg-transparent text-white text-[13px] outline-none placeholder:text-zinc-600"
                />
              </div>

              {/* LinkedIn */}
              <div
                className="flex items-center gap-2.5 rounded-lg px-3.5 py-2.5 focus-within:shadow-[0_0_0_3px_rgba(20, 241, 149, 0.12)] transition-all"
                style={{
                  background: 'var(--bg-card)',
                  boxShadow:
                    '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.03)',
                }}
              >
                <svg
                  className="w-4 h-4 text-zinc-500 shrink-0"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                </svg>
                <input
                  type="url"
                  value={linkedinUrl}
                  onChange={(e) => setLinkedinUrl(e.target.value)}
                  placeholder="https://linkedin.com/in/yourprofile"
                  className="flex-1 bg-transparent text-white text-[13px] outline-none placeholder:text-zinc-600"
                />
              </div>

              {/* Website */}
              <div
                className="flex items-center gap-2.5 rounded-lg px-3.5 py-2.5 focus-within:shadow-[0_0_0_3px_rgba(20, 241, 149, 0.12)] transition-all"
                style={{
                  background: 'var(--bg-card)',
                  boxShadow:
                    '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.03)',
                }}
              >
                <svg
                  className="w-4 h-4 text-zinc-500 shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                  />
                </svg>
                <input
                  type="url"
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                  placeholder="https://yourwebsite.com"
                  className="flex-1 bg-transparent text-white text-[13px] outline-none placeholder:text-zinc-600"
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full h-11 rounded-lg text-white font-medium text-[13px] tracking-[0.005em] transition-all hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background:
                'linear-gradient(180deg, rgba(20, 241, 149, 0.35) 0%, rgba(20, 241, 149, 0.12) 100%)',
              boxShadow:
                'inset 0 0 0 1px rgba(20, 241, 149, 0.45), 0 0 22px -4px rgba(20, 241, 149, 0.5)',
            }}
          >
            {saving ? 'Saving…' : 'Save & Continue'}
          </button>

          <button
            type="button"
            onClick={() => router.push('/')}
            className="w-full py-2 text-[11px] uppercase tracking-[0.18em] text-zinc-500 hover:text-zinc-300 transition-colors font-medium"
          >
            Skip for now
          </button>
        </form>
      </motion.div>
    </div>
  );
}
