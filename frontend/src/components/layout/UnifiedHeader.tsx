'use client';

import { motion, AnimatePresence } from 'framer-motion';
import {
  Menu,
  X,
  ChevronDown,
  Sparkles,
  Bot,
  GitBranch,
  User,
  KeyRound,
  Settings,
  LogOut,
  LogIn,
  ArrowRight,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React, { useState, useRef, useEffect } from 'react';

import { HagglLogoSVG } from '@/components/ui/HagglLogo';
import { getReputationRank } from '@/components/ui/reputation-badge';
import { ShimmerButton } from '@/components/ui/ShimmerButton';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { useAuth } from '@/lib/auth/AuthProvider';

// Top nav for the public landing pages.
const NAV_LINKS = [
  { href: '/market/agents', label: 'Agents', icon: Bot },
  { href: '/market/repos', label: 'Repos', icon: GitBranch },
];

export function UnifiedHeader() {
  const { user, isAuthenticated, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Close drawer on route change + lock body scroll while open
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (mobileMenuOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [mobileMenuOpen]);

  return (
    <>
      <nav
        className="fixed top-0 left-0 right-0 z-50 transition-colors duration-300"
        style={{
          background: scrolled ? 'rgba(6,6,15,0.82)' : 'rgba(6,6,15,0.55)',
          borderBottom: `1px solid rgba(255,255,255,${scrolled ? 0.06 : 0.03})`,
          backdropFilter: 'blur(14px) saturate(140%)',
          WebkitBackdropFilter: 'blur(14px) saturate(140%)',
        }}
      >
        <div className="w-full pl-12 md:pl-20 pr-4 md:pr-8 h-16 flex items-center justify-between">
          {/* Logo: CSS wordmark — replace with image asset later */}
          <Link
            href="/"
            className="flex items-center gap-2.5 hover:opacity-85 transition-opacity relative"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/haggl-logo.png"
              alt="haggl"
              width={36}
              height={36}
              className="rounded-lg shrink-0"
              style={{ display: 'block' }}
            />
            <span
              className="text-xl md:text-2xl hidden sm:inline text-[var(--text)] font-semibold"
              style={{ letterSpacing: '0.04em' }}
            >
              HAGGL
            </span>
          </Link>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-1">
            {NAV_LINKS.map((link) => {
              const active = pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className="relative px-3 py-2 rounded-lg text-[13px] tracking-[0.005em] transition-colors"
                  style={{
                    color: active ? 'var(--text)' : 'rgb(212,212,216)',
                    fontWeight: 700,
                  }}
                >
                  {active && (
                    <motion.span
                      layoutId="header-pill"
                      className="absolute inset-0 rounded-lg -z-0"
                      style={{
                        background:
                          'linear-gradient(180deg, rgba(20, 241, 149, 0.14) 0%, rgba(20, 241, 149, 0.04) 100%)',
                        boxShadow: 'inset 0 0 0 1px rgba(20, 241, 149, 0.25)',
                      }}
                      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                    />
                  )}
                  <span className="relative z-10" style={{ fontWeight: 700 }}>
                    {link.label}
                  </span>
                </Link>
              );
            })}
          </div>

          {/* Right: Auth/Profile */}
          <div className="flex items-center gap-2 md:gap-4">
            <a
              href="https://x.com/hagglhq"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="haggl on X"
              title="haggl on X"
              className="hidden sm:flex items-center justify-center w-8 h-8 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.05] transition-colors"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor" aria-hidden="true">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </a>
            {!isAuthenticated ? (
              <>
                <Link
                  href="/auth"
                  className="hidden sm:block text-[13px] text-zinc-300 hover:text-white transition-colors px-2"
                  style={{ fontWeight: 700 }}
                >
                  Sign in
                </Link>
                <ShimmerButton
                  as={Link}
                  href="/auth?tab=register"
                  className="text-white text-xs md:text-[13px] px-3.5 md:px-4 py-2 rounded-lg transition-all"
                  style={{
                    background:
                      'linear-gradient(180deg, rgba(20, 241, 149, 0.22) 0%, rgba(20, 241, 149, 0.08) 100%)',
                    border: '1px solid rgba(20, 241, 149, 0.35)',
                    fontWeight: 700,
                  }}
                >
                  Get started
                </ShimmerButton>
              </>
            ) : (
              <div ref={profileRef} className="relative hidden md:block">
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setProfileOpen(!profileOpen)}
                  className="flex items-center gap-2 px-1.5 py-1 rounded-lg hover:bg-white/[0.04] transition-colors"
                  style={{ overflow: 'visible' }}
                >
                  <span className="relative inline-flex" style={{ overflow: 'visible' }}>
                    <UserAvatar
                      src={user?.avatarUrl}
                      name={user?.displayName || user?.username}
                      userId={user?.id}
                      size={28}
                    />
                    {(() => {
                      const rank = getReputationRank(user?.reputationPoints ?? 0);
                      const RankIcon = rank.icon;
                      return (
                        <span
                          className="absolute grid place-items-center rounded-full"
                          style={{
                            bottom: -2,
                            right: -2,
                            width: 14,
                            height: 14,
                            background: 'var(--bg)',
                            border: `1.5px solid ${rank.color}`,
                            boxShadow: `0 0 0 1.5px var(--bg), 0 0 8px -1px ${rank.color}88`,
                            zIndex: 1,
                          }}
                          title={user?.username || ''}
                        >
                          <RankIcon
                            style={{ color: rank.color, width: 8, height: 8 }}
                            strokeWidth={2.5}
                            aria-hidden="true"
                          />
                        </span>
                      );
                    })()}
                  </span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 text-zinc-500 transition-transform duration-200 ${
                      profileOpen ? 'rotate-180' : ''
                    }`}
                  />
                </motion.button>

                <AnimatePresence>
                  {profileOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -6, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -6, scale: 0.98 }}
                      transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
                      className="absolute right-0 top-full mt-2 w-60 rounded-xl overflow-hidden"
                      style={{
                        background: 'var(--bg-card)',
                        boxShadow:
                          '0 0 0 1px rgba(20, 241, 149, 0.18), inset 0 1px 0 rgba(255,255,255,0.04), 0 16px 40px -10px rgba(0,0,0,0.5)',
                        backdropFilter: 'blur(8px)',
                      }}
                    >
                      <div
                        className="px-4 py-3.5 border-b"
                        style={{ borderColor: 'rgba(255,255,255,0.05)' }}
                      >
                        <p className="text-[13px] font-light text-white truncate">
                          {user?.displayName || user?.username}
                        </p>
                        <p className="text-[11px] text-zinc-500 truncate mt-0.5">{user?.email}</p>
                      </div>
                      <div className="py-1">
                        <ProfileMenuItem
                          href="/profile"
                          icon={User}
                          label="Profile"
                          onClick={() => setProfileOpen(false)}
                        />
                        <ProfileMenuItem
                          href="/api-keys"
                          icon={KeyRound}
                          label="API Keys"
                          onClick={() => setProfileOpen(false)}
                        />
                        <ProfileMenuItem
                          href="/profile?tab=notifications"
                          icon={Settings}
                          label="Settings"
                          onClick={() => setProfileOpen(false)}
                        />
                      </div>
                      <button
                        onClick={() => {
                          logout();
                          setProfileOpen(false);
                        }}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[13px] font-light text-red-400 hover:text-red-300 transition-colors border-t"
                        style={{ borderColor: 'rgba(255,255,255,0.05)' }}
                      >
                        <LogOut className="w-3.5 h-3.5" strokeWidth={1.75} />
                        Sign out
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* Mobile menu toggle */}
            <motion.button
              whileTap={{ scale: 0.92 }}
              aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileMenuOpen}
              className="md:hidden relative w-9 h-9 flex items-center justify-center rounded-lg transition-colors"
              onClick={() => setMobileMenuOpen((v) => !v)}
              style={{
                background: 'rgba(255,255,255,0.025)',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <AnimatePresence mode="wait">
                {mobileMenuOpen ? (
                  <motion.span
                    key="x"
                    initial={{ rotate: -90, opacity: 0 }}
                    animate={{ rotate: 0, opacity: 1 }}
                    exit={{ rotate: 90, opacity: 0 }}
                    transition={{ duration: 0.18 }}
                  >
                    <X className="w-4 h-4 text-white" strokeWidth={1.75} />
                  </motion.span>
                ) : (
                  <motion.span
                    key="m"
                    initial={{ rotate: 90, opacity: 0 }}
                    animate={{ rotate: 0, opacity: 1 }}
                    exit={{ rotate: -90, opacity: 0 }}
                    transition={{ duration: 0.18 }}
                  >
                    <Menu className="w-4 h-4 text-zinc-300" strokeWidth={1.75} />
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>
          </div>
        </div>
      </nav>

      {/* Mobile Drawer */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            <motion.div
              key="drawer-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setMobileMenuOpen(false)}
              className="md:hidden fixed inset-0 z-40 bg-black/70 backdrop-blur-sm"
            />
            <motion.aside
              key="drawer"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 340, damping: 34 }}
              className="md:hidden fixed top-0 right-0 bottom-0 z-50 w-[86%] max-w-[360px] flex flex-col overflow-hidden"
              style={{
                height: '100dvh',
                background:
                  'linear-gradient(180deg, rgba(14,14,18,0.98) 0%, rgba(8,8,11,0.98) 100%)',
                borderLeft: '1px solid rgba(20, 241, 149, 0.18)',
                boxShadow: '-24px 0 60px -10px rgba(0,0,0,0.6)',
              }}
            >
              {/* Ambient glow */}
              <div
                aria-hidden
                className="absolute -top-24 -right-24 w-64 h-64 rounded-full opacity-40 pointer-events-none"
                style={{
                  background:
                    'radial-gradient(closest-side, rgba(20, 241, 149, 0.28), transparent 70%)',
                  filter: 'blur(10px)',
                }}
              />

              {/* Drawer header */}
              <div
                className="relative flex items-center justify-between px-5 pt-5 pb-4 border-b"
                style={{ borderColor: 'rgba(255,255,255,0.06)' }}
              >
                <div className="flex items-center gap-2.5">
                  <HagglLogoSVG size={22} />
                  <div className="flex flex-col leading-none">
                    <span className="text-[13px] font-semibold text-white">haggl</span>
                    <span className="text-[10px] text-zinc-500 mt-1 tracking-[0.18em] uppercase">
                      Network
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  aria-label="Close menu"
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/[0.04] transition-colors"
                >
                  <X className="w-4 h-4" strokeWidth={1.75} />
                </button>
              </div>

              {/* Identity card */}
              {isAuthenticated ? (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.06, duration: 0.25 }}
                  className="relative mx-5 mt-5 p-4 rounded-xl"
                  style={{
                    background:
                      'linear-gradient(135deg, rgba(20, 241, 149, 0.1) 0%, rgba(20, 241, 149, 0.02) 100%)',
                    border: '1px solid rgba(20, 241, 149, 0.22)',
                  }}
                >
                  <div className="flex items-center gap-3">
                    <UserAvatar
                      src={user?.avatarUrl}
                      name={user?.displayName || user?.username}
                      userId={user?.id}
                      size={44}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-light text-white truncate">
                        {user?.displayName || user?.username}
                      </p>
                      <p className="text-[11px] text-zinc-500 truncate mt-0.5">{user?.email}</p>
                    </div>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.06, duration: 0.25 }}
                  className="relative mx-5 mt-5 p-4 rounded-xl"
                  style={{
                    background:
                      'linear-gradient(135deg, rgba(20, 241, 149, 0.08) 0%, rgba(20, 241, 149, 0.02) 100%)',
                    border: '1px solid rgba(20, 241, 149, 0.2)',
                  }}
                >
                  <div className="flex items-center gap-2.5 mb-2.5">
                    <Sparkles className="w-3.5 h-3.5 text-[#b4a7ff]" strokeWidth={1.75} />
                    <span className="text-[10.5px] uppercase tracking-[0.18em] font-medium text-zinc-400">
                      Join haggl
                    </span>
                  </div>
                  <p className="text-[13px] font-light text-zinc-300 leading-relaxed">
                    Publish agents, earn reputation, and grow your revenue on-chain.
                  </p>
                  <div className="flex items-center gap-2 mt-3">
                    <Link
                      href="/auth"
                      className="flex-1 text-center py-2 rounded-lg text-[12px] font-light text-zinc-300 border border-white/10 hover:border-white/20 hover:text-white transition-all"
                    >
                      <LogIn className="w-3.5 h-3.5 inline mr-1.5" strokeWidth={1.75} />
                      Sign in
                    </Link>
                    <Link
                      href="/auth?tab=register"
                      className="flex-1 text-center py-2 rounded-lg text-[12px] font-light text-white transition-all"
                      style={{
                        background:
                          'linear-gradient(180deg, rgba(20, 241, 149, 0.28) 0%, rgba(20, 241, 149, 0.12) 100%)',
                        border: '1px solid rgba(20, 241, 149, 0.45)',
                      }}
                    >
                      Get started
                      <ArrowRight className="w-3 h-3 inline ml-1" strokeWidth={1.75} />
                    </Link>
                  </div>
                </motion.div>
              )}

              {/* Nav */}
              <div className="relative flex-1 overflow-y-auto px-3 py-4 mt-2">
                <p className="text-[10px] uppercase tracking-[0.22em] font-medium text-zinc-600 px-3 pb-2">
                  Navigate
                </p>
                <div className="space-y-0.5">
                  {NAV_LINKS.map((link, idx) => {
                    const Icon = link.icon;
                    const active = pathname.startsWith(link.href);
                    return (
                      <motion.div
                        key={link.href}
                        initial={{ opacity: 0, x: 16 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.08 + idx * 0.04, duration: 0.22 }}
                      >
                        <Link
                          href={link.href}
                          className="group flex items-center gap-3 px-3 py-2.5 rounded-lg text-[14px] font-light transition-colors relative"
                          style={
                            active
                              ? {
                                  color: 'var(--text)',
                                  background:
                                    'linear-gradient(90deg, rgba(20, 241, 149, 0.14) 0%, rgba(20, 241, 149, 0.04) 100%)',
                                  boxShadow: 'inset 0 0 0 1px rgba(20, 241, 149, 0.22)',
                                }
                              : { color: 'rgb(212,212,216)' }
                          }
                        >
                          <span
                            className="inline-flex w-8 h-8 items-center justify-center rounded-lg flex-shrink-0"
                            style={{
                              background: active
                                ? 'linear-gradient(135deg, rgba(20, 241, 149, 0.2) 0%, rgba(20, 241, 149, 0.04) 100%)'
                                : 'rgba(255,255,255,0.025)',
                              border: `1px solid ${active ? 'rgba(20, 241, 149, 0.3)' : 'rgba(255,255,255,0.05)'}`,
                            }}
                          >
                            <Icon
                              className={`w-3.5 h-3.5 ${active ? 'text-[#b4a7ff]' : 'text-zinc-400 group-hover:text-zinc-200'}`}
                              strokeWidth={1.75}
                            />
                          </span>
                          <span className="flex-1">{link.label}</span>
                          <ArrowRight
                            className="w-3.5 h-3.5 text-zinc-600 group-hover:text-zinc-400 transition-all group-hover:translate-x-0.5"
                            strokeWidth={1.75}
                          />
                        </Link>
                      </motion.div>
                    );
                  })}
                </div>

                {isAuthenticated && (
                  <>
                    <p className="text-[10px] uppercase tracking-[0.22em] font-medium text-zinc-600 px-3 pt-6 pb-2">
                      Account
                    </p>
                    <div className="space-y-0.5">
                      {[
                        { href: '/profile', label: 'Profile', icon: User },
                        { href: '/api-keys', label: 'API Keys', icon: KeyRound },
                        {
                          href: '/profile?tab=notifications',
                          label: 'Settings',
                          icon: Settings,
                        },
                      ].map((link, idx) => {
                        const Icon = link.icon;
                        return (
                          <motion.div
                            key={link.href}
                            initial={{ opacity: 0, x: 16 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.28 + idx * 0.04, duration: 0.22 }}
                          >
                            <Link
                              href={link.href}
                              className="group flex items-center gap-3 px-3 py-2.5 rounded-lg text-[14px] font-light text-zinc-300 hover:text-white hover:bg-white/[0.035] transition-colors"
                            >
                              <span
                                className="inline-flex w-8 h-8 items-center justify-center rounded-lg flex-shrink-0"
                                style={{
                                  background: 'rgba(255,255,255,0.025)',
                                  border: '1px solid rgba(255,255,255,0.05)',
                                }}
                              >
                                <Icon
                                  className="w-3.5 h-3.5 text-zinc-400 group-hover:text-zinc-200"
                                  strokeWidth={1.75}
                                />
                              </span>
                              <span className="flex-1">{link.label}</span>
                            </Link>
                          </motion.div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>

              {/* Footer */}
              {isAuthenticated && (
                <div
                  className="relative px-5 py-4 border-t"
                  style={{ borderColor: 'rgba(255,255,255,0.06)' }}
                >
                  <button
                    onClick={() => {
                      logout();
                      setMobileMenuOpen(false);
                    }}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-[13px] font-light text-red-400 hover:text-red-300 transition-colors"
                    style={{
                      background: 'rgba(239,68,68,0.04)',
                      border: '1px solid rgba(239,68,68,0.18)',
                    }}
                  >
                    <LogOut className="w-3.5 h-3.5" strokeWidth={1.75} />
                    Sign out
                  </button>
                </div>
              )}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

function ProfileMenuItem({
  href,
  icon: Icon,
  label,
  onClick,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="flex items-center gap-2.5 px-4 py-2 text-[13px] font-light text-zinc-300 hover:text-white hover:bg-white/[0.03] transition-colors"
    >
      <Icon className="w-3.5 h-3.5 text-zinc-500" strokeWidth={1.75} />
      {label}
    </Link>
  );
}
