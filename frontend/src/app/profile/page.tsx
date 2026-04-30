'use client';

export const dynamic = 'force-dynamic';

import { motion } from 'framer-motion';
import dynamicImport from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React, { useState, useEffect, useCallback, useRef } from 'react';

// Profile has 5+ sibling tabs but the user only sees one at a time. Defer
// the non-active panels so the initial /profile bundle is the identity form
// plus whichever tab is currently mounted, not every tab's code at once.
// AgentDashboard / IntegrationsSection / NotificationsSection /
// UsageSection were all removed in the April 2026 profile redesign —
// dynamic imports dropped to keep the bundle clean. The component
// files still exist on disk for the moment in case we want to revive
// any of them as a standalone route later.
const APIKeysSection = dynamicImport(
  () => import('@/components/profile/APIKeysSection').then((m) => m.APIKeysSection),
  { ssr: false },
);
const ConnectedAccountsPanel = dynamicImport(
  () => import('@/components/profile/ConnectedAccountsPanel').then((m) => m.ConnectedAccountsPanel),
  { ssr: false },
);
const RanksPanel = dynamicImport(
  () => import('@/components/profile/RanksPanel').then((m) => m.RanksPanel),
  { ssr: false },
);
const FriendsExtras = dynamicImport(
  () => import('@/components/profile/FriendsExtras').then((m) => m.FriendsExtras),
  { ssr: false },
);
const AvatarCropperModal = dynamicImport(
  () => import('@/components/profile/AvatarCropperModal').then((m) => m.AvatarCropperModal),
  { ssr: false },
);
import { AtlasFilterBar, AtlasTabs } from '@/components/atlas';
import { getReputationRank, RANK_TIERS } from '@/components/ui/reputation-badge';
import { UserAvatar as UserAvatarComponent } from '@/components/ui/UserAvatar';
import { VerificationCodeModal } from '@/components/ui/VerificationCodeModal';
import { WalletProviderIcon, walletProviderLabel } from '@/components/ui/WalletIcons';
import { api, ApiError, API_URL } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useStepUp } from '@/lib/auth/useStepUp';
import { getMetaMaskProvider } from '@/lib/wallet/ethereum';
import { isWalletConnectConfigured, linkWalletConnect } from '@/lib/wallet/walletconnect';

// Tabs after the April 2026 redesign:
//   • Removed: 'usage', 'activity', 'integrations', 'notifications', 'agent', 'social'
//   • 'social' folded into 'general' (PR2) — Twitter / LinkedIn / Website
//     fields now live inside the General section as one form
//   • 'ranks' added (PR3) — interactive tier ladder with perks per tier
type Tab = 'general' | 'ranks' | 'wallet' | 'friends' | 'api-keys' | 'security';

interface Friend {
  id: string;
  friend: {
    id: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
    userTag?: string | null;
  };
  since: string;
}

interface FriendRequest {
  id: string;
  from: {
    id: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
    userTag?: string | null;
  };
  createdAt: string;
}

interface SentFriendRequest {
  id: string;
  to: {
    id: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
    userTag?: string | null;
  };
  createdAt: string;
}

interface UserSearchResult {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  userTag: string | null;
}

interface APIKey {
  id: string;
  name: string;
  key: string;
  preview: string;
  createdAt: string;
  lastUsed: string | null;
  scopes: string[];
}

// ── Icons ──────────────────────────────────────────────────────────────────────

function IconUser({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0"
      />
    </svg>
  );
}
function IconGlobe({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418"
      />
    </svg>
  );
}
function IconWallet({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18-3a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3"
      />
    </svg>
  );
}
function IconLink({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"
      />
    </svg>
  );
}
function IconUsers({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
      />
    </svg>
  );
}
function IconTrophy({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M7.73 9.728a6.726 6.726 0 002.748 1.35m8.272-6.842V4.5c0 2.108-.966 3.99-2.48 5.228m2.48-5.492a46.32 46.32 0 012.916.52 6.003 6.003 0 01-5.395 4.972m0 0a6.726 6.726 0 01-2.749 1.35m0 0a6.772 6.772 0 01-3.044 0"
      />
    </svg>
  );
}

function IconShield({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
      />
    </svg>
  );
}
function IconGitHub({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
    </svg>
  );
}
function IconSearch({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
      />
    </svg>
  );
}
function IconCheck({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}
function IconX({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
function IconArrow({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
    </svg>
  );
}

function IconCpu({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25zm.75-12h9v9h-9v-9z"
      />
    </svg>
  );
}

// ── Small UI helpers ───────────────────────────────────────────────────────────

function Alert({ type, msg }: { type: 'success' | 'error'; msg: string }) {
  if (!msg) return null;
  return (
    <div
      className={`flex items-start gap-3 rounded-lg px-4 py-3 mb-6 text-sm font-light animate-[fade-in_0.3s_ease] ${
        type === 'success'
          ? 'bg-green-500/10 border border-green-500/30 text-green-300'
          : 'bg-red-500/10 border border-red-500/30 text-red-300'
      }`}
    >
      {type === 'success' ? (
        <IconCheck className="w-4 h-4 mt-0.5 flex-shrink-0" />
      ) : (
        <IconX className="w-4 h-4 mt-0.5 flex-shrink-0" />
      )}
      <span>{msg}</span>
    </div>
  );
}

function Avatar({
  src,
  name,
  size = 'md',
  userId,
}: {
  src?: string | null;
  name?: string | null;
  size?: 'sm' | 'md' | 'lg';
  userId?: string | null;
}) {
  const px = size === 'sm' ? 32 : size === 'lg' ? 56 : 40;
  return (
    <UserAvatarComponent
      src={src}
      name={name}
      userId={userId}
      size={px}
      className="flex-shrink-0"
    />
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-8 mt-0">
      <h2 className="text-lg font-light text-white tracking-tight">{title}</h2>
      {subtitle && <p className="text-sm text-[var(--text-secondary)] mt-1">{subtitle}</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-light text-[var(--text-secondary)] mb-2.5">
        {label}
      </label>
      {children}
    </div>
  );
}

function Input({ ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full profile-input bg-[var(--bg-elevated)] border border-[var(--border)] rounded-[10px] px-4 py-3 text-sm text-[var(--text)] outline-none transition-all duration-250 focus:border-atlas-500/60 focus:shadow-[0_0_0_3px_rgba(20, 241, 149, 0.1)] placeholder:text-[var(--text-muted)] font-light ${props.className ?? ''}`}
    />
  );
}

function Textarea({ ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full profile-input bg-[var(--bg-elevated)] border border-[var(--border)] rounded-[10px] px-4 py-3 text-sm text-[var(--text)] outline-none transition-all duration-250 focus:border-atlas-500/60 focus:shadow-[0_0_0_3px_rgba(20, 241, 149, 0.1)] placeholder:text-[var(--text-muted)] resize-none font-light ${props.className ?? ''}`}
    />
  );
}

function SaveButton({ loading, label = 'Save changes' }: { loading: boolean; label?: string }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="atlas-cta w-full h-11 rounded-2xl text-[13px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
    >
      {loading ? (
        <>
          <div
            className="w-4 h-4 rounded-full border-2 border-current/30 animate-spin"
            style={{ borderTopColor: 'currentColor' }}
          />
          Saving...
        </>
      ) : (
        label
      )}
    </button>
  );
}

// ── Tab config ─────────────────────────────────────────────────────────────────

// ══════════════════════════════════════════════════════════════════════════════
// Page
// ══════════════════════════════════════════════════════════════════════════════

export default function ProfilePage() {
  const { user, isLoading, refresh } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('general');

  // General
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [genSaving, setGenSaving] = useState(false);
  const [genMsg, setGenMsg] = useState('');
  const [genErr, setGenErr] = useState('');

  // Social
  const [twitterUrl, setTwitterUrl] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [socSaving, setSocSaving] = useState(false);
  const [socMsg, setSocMsg] = useState('');
  const [socErr, setSocErr] = useState('');

  // Wallet
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletMsg, setWalletMsg] = useState('');
  const [walletErr, setWalletErr] = useState('');
  interface LinkedWallet {
    id: string;
    address: string;
    label: string | null;
    provider: string;
    isPrimary: boolean;
    createdAt: string;
  }
  const [linkedWallets, setLinkedWallets] = useState<LinkedWallet[]>([]);
  const [walletActionId, setWalletActionId] = useState<string | null>(null);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const [walletLabelEditingId, setWalletLabelEditingId] = useState<string | null>(null);
  const [walletLabelDraft, setWalletLabelDraft] = useState('');

  // Connections
  const [unlinkingGitHub, setUnlinkingGitHub] = useState(false);
  const [conMsg, setConMsg] = useState('');
  const [conErr, setConErr] = useState('');

  // Friends
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [sentRequests, setSentRequests] = useState<SentFriendRequest[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [friendsErr, setFriendsErr] = useState('');
  const [friendsMsg, setFriendsMsg] = useState('');
  const [friendActionId, setFriendActionId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Security
  const [secMsg, setSecMsg] = useState('');
  const [secErr, setSecErr] = useState('');

  // Avatar upload
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarMsg, setAvatarMsg] = useState('');
  const [avatarErr, setAvatarErr] = useState('');
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [pendingAvatarFile, setPendingAvatarFile] = useState<File | null>(null);

  // Step-up auth (TOTP) for sensitive ops
  const stepUp = useStepUp<unknown>();

  // Agent endpoint
  const [agentEndpoint, setAgentEndpoint] = useState('');
  const [agentSaving, setAgentSaving] = useState(false);
  const [agentMsg, setAgentMsg] = useState('');
  const [agentErr, setAgentErr] = useState('');
  const [agentTestStatus, setAgentTestStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>(
    'idle',
  );
  const [agentTestDetail, setAgentTestDetail] = useState('');
  const [twoFAEnabled, setTwoFAEnabled] = useState(false);
  const [toggling2FA, setToggling2FA] = useState(false);
  const [disable2FAPassword, setDisable2FAPassword] = useState('');
  const [enable2FAStep, setEnable2FAStep] = useState<'idle' | 'scan'>('idle');
  const [enable2FACode, setEnable2FACode] = useState('');
  const [twoFAQrCode, setTwoFAQrCode] = useState<string | null>(null);
  const [twoFASecret, setTwoFASecret] = useState<string | null>(null);
  const [twoFASecretCopied, setTwoFASecretCopied] = useState(false);

  // Password change
  const [pwStep, setPwStep] = useState<'idle' | 'sent'>('idle');
  const [pwLoading, setPwLoading] = useState(false);
  const [pwMsg, setPwMsg] = useState('');
  const [pwErr, setPwErr] = useState('');
  const [emailStep, setEmailStep] = useState<'idle' | 'form' | 'otp'>('idle');
  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailOtp, setEmailOtp] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [deleteStep, setDeleteStep] = useState<'idle' | 'confirm' | 'otp'>('idle');
  const [deleteOtp, setDeleteOtp] = useState('');
  const [requestingDelete, setRequestingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // API Keys
  const [apiKeys, setApiKeys] = useState<APIKey[]>([]);

  // Notifications
  const [notifErrors, setNotifErrors] = useState(true);
  const [notifReports, setNotifReports] = useState(true);
  const [notifMonthly, setNotifMonthly] = useState(false);
  const [notifDeployments, setNotifDeployments] = useState(true);

  // Usage stats
  const [usageStats, setUsageStats] = useState<any>({
    totalCallsThisMonth: 0,
    maxCallsAllowed: 100000,
    activeAgents: 0,
    last24hCalls: 0,
    lastResetDate: new Date().toISOString(),
  });

  // Activity log
  const [activityLog, setActivityLog] = useState<any[]>([]);

  // Integrations
  const [integrations, setIntegrations] = useState<any[]>([]);

  // Init
  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace('/auth');
      return;
    }
    setUsername(user.username || '');
    setDisplayName(user.displayName || '');
    setTwitterUrl((user as { twitterUrl?: string }).twitterUrl || '');
    setLinkedinUrl((user as { linkedinUrl?: string }).linkedinUrl || '');
    setWebsiteUrl((user as { websiteUrl?: string }).websiteUrl || '');
    setTwoFAEnabled(!!(user as { twoFactorEnabled?: boolean }).twoFactorEnabled);
    setAgentEndpoint((user as { agentEndpoint?: string }).agentEndpoint || '');

    // Fire the three initial fetches in parallel. Previously these ran in
    // two separate effects (one sequential pair + a second effect for /bio)
    // which meant three round-trips worth of latency stacked up before the
    // profile page felt ready. Promise.all cuts it to one round-trip.
    let cancelled = false;
    Promise.all([
      api.get<any>('/market/api-keys').catch(() => null),
      api.get<any>('/users/preferences/notifications').catch(() => null),
      api.get<{ bio?: string }>('/users/profile').catch(() => null),
    ]).then(([keys, prefs, profile]) => {
      if (cancelled) return;
      if (Array.isArray(keys)) {
        setApiKeys(
          keys.map((k: any) => ({
            id: k.id,
            name: k.label || k.name || 'Unnamed',
            key: k.key || '',
            preview: k.lastFour ? `blt_••••••••••••••••••••••••${k.lastFour}` : k.preview || '',
            createdAt: k.createdAt,
            lastUsed: k.lastUsedAt || k.lastUsed || null,
            scopes: k.scopes || [],
          })),
        );
      } else if (keys === null) {
        setApiKeys([]);
      }
      if (prefs) {
        setNotifErrors(prefs.emailOnErrors ?? true);
        setNotifReports(prefs.emailWeeklyReport ?? true);
        setNotifMonthly(prefs.emailMonthlyReport ?? false);
        setNotifDeployments(prefs.emailDeploymentAlerts ?? true);
      }
      if (profile?.bio) setBio(profile.bio);
    });
    return () => {
      cancelled = true;
    };
  }, [user, isLoading, router]);

  // ?linked=github redirect  |  ?tab=wallet direct link
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('linked') === 'github') {
      refresh();
      window.history.replaceState({}, '', '/profile');
      // Integrations tab is gone after the redesign — bounce GitHub-linked
      // returns to General where the social block now lives.
      setTab('general');
      setConMsg('GitHub account linked successfully.');
    }
    const tabParam = params.get('tab') as Tab | null;
    if (
      tabParam &&
      ['general', 'ranks', 'wallet', 'friends', 'api-keys', 'security'].includes(tabParam)
    ) {
      setTab(tabParam);
      window.history.replaceState({}, '', '/profile');
    } else if (params.get('tab') === 'social') {
      // Old links to ?tab=social land on General now that Social was folded
      // in. We compare against the raw string here because the Tab union
      // no longer contains 'social'.
      setTab('general');
      window.history.replaceState({}, '', '/profile');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadFriends = useCallback(async () => {
    setFriendsLoading(true);
    setFriendsErr('');
    try {
      const [f, r, s] = await Promise.all([
        api.get<Friend[]>('/social/friends'),
        api.get<FriendRequest[]>('/social/friends/requests'),
        api.get<SentFriendRequest[]>('/social/friends/sent').catch(() => [] as SentFriendRequest[]),
      ]);
      setFriends(f);
      setFriendRequests(r);
      setSentRequests(s);
    } catch (err) {
      setFriendsErr(
        err instanceof ApiError ? err.message : 'Could not load your network right now.',
      );
    } finally {
      setFriendsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) loadFriends();
  }, [user, loadFriends]);

  // Search debounce
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await api.get<UserSearchResult[]>(`/users/search?q=${encodeURIComponent(q)}`);
        setSearchResults(data.filter((u) => u.id !== user?.id));
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  // Per-tab data hooks were used by the old usage/activity/integrations/
  // agent panels; all four tabs were removed in the April 2026 redesign.
  // Nothing left to load on tab change for now.

  // ── Formatting Utilities ──────────────────────────────────────────────────────

  /**
   * Format a number with comma separators (e.g., 2847 -> "2,847")
   */
  const formatNumber = (num: number | undefined): string => {
    if (num === undefined || num === null) return 'N/A';
    return num.toLocaleString();
  };

  /**
   * Format a timestamp to relative time (e.g., "2m ago", "15m ago", "3h ago")
   */
  const formatTimeAgo = (dateString: string | Date | undefined): string => {
    if (!dateString) return 'Unknown';

    const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
    const now = new Date();
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleSaveGeneral = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      setGenErr('Username is required.');
      return;
    }
    setGenSaving(true);
    setGenErr('');
    setGenMsg('');
    try {
      await stepUp.runWithStepUp((twoFactorCode) =>
        api.patch('/users/profile', {
          username: username.trim(),
          displayName: displayName.trim() || undefined,
          bio: bio.trim() || undefined,
          twoFactorCode,
        }),
      );
      await refresh();
      setGenMsg('Profile saved successfully.');
      setTimeout(() => setGenMsg(''), 3000);
    } catch (err) {
      if (err instanceof Error && err.message === 'Cancelled') return;
      setGenErr(err instanceof ApiError ? err.message : 'Failed to save profile.');
    } finally {
      setGenSaving(false);
    }
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (avatarInputRef.current) avatarInputRef.current.value = '';
    if (!file) return;
    setAvatarErr('');
    setAvatarMsg('');
    const MAX_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      setAvatarErr('Image is larger than 10 MB. Please pick a smaller file.');
      return;
    }
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setAvatarErr('Only PNG, JPG or WebP images are allowed.');
      return;
    }
    setPendingAvatarFile(file);
  };

  const handleAvatarSave = async (blob: Blob) => {
    setAvatarUploading(true);
    setAvatarErr('');
    setAvatarMsg('');
    try {
      const form = new FormData();
      form.append('file', blob, 'avatar.jpg');
      await api.upload('/users/upload-avatar', form);
      await refresh();
      setAvatarMsg('Avatar updated.');
      setTimeout(() => setAvatarMsg(''), 3000);
    } catch (err) {
      setAvatarErr(err instanceof Error ? err.message : 'Upload failed');
      throw err;
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleSaveSocial = async (e: React.FormEvent) => {
    e.preventDefault();
    setSocSaving(true);
    setSocErr('');
    setSocMsg('');
    try {
      // Send explicit `null` for cleared fields so the backend persists the
      // removal. Sending `undefined` drops the key from the JSON payload,
      // which the service used to interpret as "leave unchanged".
      await api.patch('/users/profile', {
        twitterUrl: twitterUrl.trim() === '' ? null : twitterUrl.trim(),
        linkedinUrl: linkedinUrl.trim() === '' ? null : linkedinUrl.trim(),
        websiteUrl: websiteUrl.trim() === '' ? null : websiteUrl.trim(),
      });
      await refresh();
      setSocMsg('Social links saved.');
      setTimeout(() => setSocMsg(''), 3000);
    } catch (err) {
      setSocErr(err instanceof ApiError ? err.message : 'Failed to save social links.');
    } finally {
      setSocSaving(false);
    }
  };

  const handleConnectWallet = async () => {
    setWalletLoading(true);
    setWalletErr('');
    setWalletMsg('');
    try {
      const eth = getMetaMaskProvider();
      if (!eth) {
        setWalletErr('MetaMask not detected. Please install the MetaMask extension.');
        return;
      }
      const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
      const address = accounts[0];
      if (!address) {
        setWalletErr('No account selected in MetaMask.');
        return;
      }
      const { nonce, message } = await api.post<{ nonce: string; message: string }>(
        '/auth/link/wallet/nonce',
        { address },
      );
      const signature = (await eth.request({
        method: 'personal_sign',
        params: [message, address],
      })) as string;
      await api.post('/auth/link/wallet', { address, signature, nonce });
      await refresh();
      await loadLinkedWallets();
      setWalletMsg('MetaMask wallet linked to your account.');
    } catch (err) {
      setWalletErr(err instanceof ApiError ? err.message : 'Wallet connection failed.');
    } finally {
      setWalletLoading(false);
    }
  };

  const handleDisconnectWallet = async () => {
    if (!confirm('Remove MetaMask wallet from your account?')) return;
    setWalletLoading(true);
    setWalletErr('');
    setWalletMsg('');
    try {
      await api.delete('/auth/link/wallet');
      await refresh();
      await loadLinkedWallets();
      setWalletMsg('Wallet removed from your account.');
    } catch (err) {
      setWalletErr(err instanceof ApiError ? err.message : 'Failed to remove wallet.');
    } finally {
      setWalletLoading(false);
    }
  };

  const loadLinkedWallets = useCallback(async () => {
    try {
      const data = await api.get<LinkedWallet[]>('/users/wallets');
      setLinkedWallets(Array.isArray(data) ? data : []);
    } catch {
      setLinkedWallets([]);
    }
  }, []);

  const handleAddAdditionalWallet = async () => {
    setWalletLoading(true);
    setWalletErr('');
    setWalletMsg('');
    try {
      const eth = getMetaMaskProvider();
      if (!eth) {
        setWalletErr('MetaMask not detected. Please install the MetaMask extension.');
        return;
      }
      const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
      const address = accounts[0];
      if (!address) {
        setWalletErr('No account selected in MetaMask.');
        return;
      }
      const { nonce, message } = await api.post<{ nonce: string; message: string }>(
        '/auth/link/wallet/nonce',
        { address },
      );
      const signature = (await eth.request({
        method: 'personal_sign',
        params: [message, address],
      })) as string;
      await api.post('/auth/link/wallet/additional', {
        address,
        signature,
        nonce,
        provider: 'METAMASK',
      });
      await loadLinkedWallets();
      await refresh();
      setWalletMsg('Wallet linked to your account.');
    } catch (err) {
      setWalletErr(err instanceof ApiError ? err.message : 'Could not link wallet.');
    } finally {
      setWalletLoading(false);
    }
  };

  const handleConnectWalletConnect = async () => {
    setWalletLoading(true);
    setWalletErr('');
    setWalletMsg('');
    try {
      if (!isWalletConnectConfigured()) {
        setWalletErr(
          'WalletConnect is not configured on this deployment. Ask the admin to set NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID.',
        );
        return;
      }
      // If the user already has a primary wallet linked, add as additional.
      const additional = !!walletAddress;
      await linkWalletConnect({ additional });
      await loadLinkedWallets();
      await refresh();
      setWalletMsg('WalletConnect wallet linked to your account.');
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Could not link WalletConnect wallet.';
      setWalletErr(msg);
    } finally {
      setWalletLoading(false);
    }
  };

  const handleRemoveLinkedWallet = async (walletId: string) => {
    if (!confirm('Remove this wallet from your account?')) return;
    setWalletActionId(walletId);
    setWalletErr('');
    setWalletMsg('');
    // Optimistic removal: drop the row from local state BEFORE the DELETE
    // resolves so the UI updates instantly. The previous version awaited
    // the DELETE then ran a fresh GET — the GET sometimes hit an in-flight
    // dedup of an earlier GET and returned the stale list, leaving the
    // wallet on screen until the user manually refreshed. Roll back on
    // failure.
    const previousWallets = linkedWallets;
    setLinkedWallets((prev) => prev.filter((w) => w.id !== walletId));
    try {
      await api.delete(`/users/wallets/${walletId}`);
      // Auth context owns the canonical user (incl. primary wallet) so we
      // refresh that, but we deliberately do NOT re-run loadLinkedWallets:
      // local state is already correct + matches what the server returned.
      await refresh();
      setWalletMsg('Wallet removed.');
    } catch (err) {
      setLinkedWallets(previousWallets);
      setWalletErr(err instanceof ApiError ? err.message : 'Failed to remove wallet.');
    } finally {
      setWalletActionId(null);
    }
  };

  const handleSetPrimaryWallet = async (walletId: string) => {
    setWalletActionId(walletId);
    setWalletErr('');
    setWalletMsg('');
    try {
      await api.post(`/users/wallets/${walletId}/primary`, {});
      await loadLinkedWallets();
      await refresh();
      setWalletMsg('Primary wallet updated.');
    } catch (err) {
      setWalletErr(err instanceof ApiError ? err.message : 'Failed to set primary wallet.');
    } finally {
      setWalletActionId(null);
    }
  };

  const handleCopyAddress = async (address: string) => {
    try {
      await navigator.clipboard.writeText(address);
      setCopiedAddress(address);
      setTimeout(() => setCopiedAddress(null), 1500);
    } catch {
      /* ignore */
    }
  };

  const handleSaveWalletLabel = async (walletId: string) => {
    setWalletActionId(walletId);
    try {
      const label = walletLabelDraft.trim().slice(0, 60) || null;
      await api.patch(`/users/wallets/${walletId}`, { label });
      await loadLinkedWallets();
      setWalletLabelEditingId(null);
      setWalletLabelDraft('');
    } catch (err) {
      setWalletErr(err instanceof ApiError ? err.message : 'Failed to save label.');
    } finally {
      setWalletActionId(null);
    }
  };

  // Load linked wallets when the Wallet tab is active.
  useEffect(() => {
    if (!user) return;
    if (tab !== 'wallet') return;
    loadLinkedWallets();
  }, [user, tab, loadLinkedWallets]);

  const handleLinkGitHub = () => {
    // Delegate to backend — it knows the client_id + callback URL from env and
    // preserves the access_token cookie so the callback links to the current user.
    window.location.href = `${API_URL}/auth/github`;
  };

  const handleUnlinkGitHub = async () => {
    if (!confirm('Unlink your GitHub account?')) return;
    setUnlinkingGitHub(true);
    setConErr('');
    setConMsg('');
    try {
      await api.delete('/auth/link/github');
      await refresh();
      setConMsg('GitHub account unlinked.');
    } catch (err) {
      setConErr(err instanceof ApiError ? err.message : 'Failed to unlink GitHub.');
    } finally {
      setUnlinkingGitHub(false);
    }
  };

  const handleCopyAPIKey = (key: string) => {
    navigator.clipboard.writeText(key);
  };

  const handleDeleteAPIKey = async (id: string) => {
    try {
      await stepUp.runWithStepUp((twoFactorCode) =>
        api.delete(`/market/api-keys/${id}`, { twoFactorCode }),
      );
      setApiKeys(apiKeys.filter((k) => k.id !== id));
    } catch (err) {
      if (err instanceof Error && err.message === 'Cancelled') return;
      console.error('Failed to delete API key:', err);
    }
  };

  const handleGenerateAPIKey = async (name: string): Promise<APIKey | null> => {
    try {
      const raw = await api.post<{
        id: string;
        key: string;
        label: string | null;
        createdAt: string;
        lastUsedAt: string | null;
        lastFour?: string;
      }>('/market/api-keys', { label: name });
      const newKey: APIKey = {
        id: raw.id,
        name: raw.label || name,
        key: raw.key || '',
        preview: raw.lastFour ? `blt_••••••••••••••••••••••••${raw.lastFour}` : '',
        createdAt: raw.createdAt,
        lastUsed: raw.lastUsedAt || null,
        scopes: [],
      };
      setApiKeys([...apiKeys, newKey]);
      return newKey;
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to generate API key';
      // Bubble up so the modal surfaces the reason (rate limit, auth, etc.)
      throw new Error(msg);
    }
  };

  const handleSaveAgentEndpoint = async (e: React.FormEvent) => {
    e.preventDefault();
    setAgentSaving(true);
    setAgentErr('');
    setAgentMsg('');
    try {
      await api.patch('/users/profile', { agentEndpoint: agentEndpoint.trim() || null });
      await refresh();
      setAgentMsg('Agent endpoint saved.');
      setTimeout(() => setAgentMsg(''), 3000);
    } catch (err) {
      setAgentErr(err instanceof ApiError ? err.message : 'Failed to save endpoint.');
    } finally {
      setAgentSaving(false);
    }
  };

  const handleTestAgentEndpoint = async () => {
    if (!agentEndpoint.trim()) return;
    setAgentTestStatus('testing');
    setAgentTestDetail('');
    try {
      const res = await fetch(agentEndpoint.trim(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Atlas-Event': 'health_check' },
        body: JSON.stringify({ event: 'health_check' }),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        setAgentTestStatus('ok');
        setAgentTestDetail(`HTTP ${res.status} — agent reachable`);
      } else {
        setAgentTestStatus('fail');
        setAgentTestDetail(`HTTP ${res.status} ${res.statusText}`);
      }
    } catch (err: any) {
      setAgentTestStatus('fail');
      setAgentTestDetail(
        err?.message?.includes('timeout')
          ? 'Timeout after 8s — endpoint too slow'
          : err?.message || 'Network error',
      );
    }
  };

  const handleRespondToRequest = async (requestId: string, accept: boolean) => {
    setFriendActionId(requestId);
    setFriendsErr('');
    setFriendsMsg('');
    try {
      await api.post(`/social/friends/respond/${requestId}`, { accept });
      setFriendsMsg(accept ? 'Friend request accepted.' : 'Friend request declined.');
      setTimeout(() => setFriendsMsg(''), 2500);
      await loadFriends();
    } catch (err) {
      setFriendsErr(err instanceof ApiError ? err.message : 'Could not respond to this request.');
    } finally {
      setFriendActionId(null);
    }
  };

  const handleUnfriend = async (targetId: string) => {
    if (!confirm('Remove this connection? You can send a new request later.')) return;
    setFriendActionId(targetId);
    setFriendsErr('');
    setFriendsMsg('');
    try {
      await api.delete(`/social/friends/${targetId}`);
      setFriendsMsg('Connection removed.');
      setTimeout(() => setFriendsMsg(''), 2500);
      await loadFriends();
    } catch (err) {
      setFriendsErr(err instanceof ApiError ? err.message : 'Could not remove connection.');
    } finally {
      setFriendActionId(null);
    }
  };

  const handleCancelSentRequest = async (targetId: string) => {
    setFriendActionId(targetId);
    setFriendsErr('');
    setFriendsMsg('');
    try {
      // Backend exposes DELETE /social/friends/:targetId which removes any
      // friendship row in any state, including PENDING outgoing ones.
      await api.delete(`/social/friends/${targetId}`);
      setFriendsMsg('Friend request cancelled.');
      setTimeout(() => setFriendsMsg(''), 2500);
      await loadFriends();
    } catch (err) {
      setFriendsErr(err instanceof ApiError ? err.message : 'Could not cancel the request.');
    } finally {
      setFriendActionId(null);
    }
  };

  const handleSendFriendRequest = async (targetId: string) => {
    setSendingTo(targetId);
    setFriendsErr('');
    setFriendsMsg('');
    try {
      await api.post('/social/friends/request', { targetId });
      setSearchResults((prev) => prev.filter((u) => u.id !== targetId));
      setFriendsMsg('Friend request sent.');
      setTimeout(() => setFriendsMsg(''), 2500);
      await loadFriends();
    } catch (err) {
      setFriendsErr(err instanceof ApiError ? err.message : 'Could not send friend request.');
    } finally {
      setSendingTo(null);
    }
  };

  const handle2FAToggle = async () => {
    setSecErr('');
    setSecMsg('');
    setToggling2FA(true);
    try {
      if (twoFAEnabled) {
        await api.post('/auth/2fa/disable', { password: disable2FAPassword });
        setTwoFAEnabled(false);
        setDisable2FAPassword('');
        setSecMsg('Two-factor authentication disabled.');
      } else {
        const res = await api.post<{ qrCode?: string; secret?: string }>(
          '/auth/2fa/enable/request',
          {},
        );
        setTwoFAQrCode(res.qrCode || null);
        setTwoFASecret(res.secret || null);
        setEnable2FAStep('scan');
        setSecMsg('Scan the QR code with your authenticator app to continue.');
      }
    } catch (err) {
      setSecErr(err instanceof ApiError ? err.message : 'Failed to update 2FA setting.');
    } finally {
      setToggling2FA(false);
    }
  };

  const handleEnable2FAConfirm = async () => {
    setSecErr('');
    setToggling2FA(true);
    try {
      await api.post('/auth/2fa/enable', { code: enable2FACode });
      setTwoFAEnabled(true);
      setEnable2FAStep('idle');
      setEnable2FACode('');
      setTwoFAQrCode(null);
      setTwoFASecret(null);
      setTwoFASecretCopied(false);
      setSecMsg('2FA enabled. You will be asked for a code from your authenticator at next login.');
    } catch (err) {
      setSecErr(err instanceof ApiError ? err.message : 'Invalid or expired code.');
    } finally {
      setToggling2FA(false);
    }
  };

  const handleCopy2FASecret = async () => {
    if (!twoFASecret) return;
    try {
      await navigator.clipboard.writeText(twoFASecret);
      setTwoFASecretCopied(true);
      setTimeout(() => setTwoFASecretCopied(false), 2000);
    } catch {
      /* silent */
    }
  };

  const handleRequestPasswordReset = async () => {
    const email = (user as { email?: string } | null)?.email;
    if (!email) return;
    setPwErr('');
    setPwMsg('');
    setPwLoading(true);
    try {
      await api.post('/auth/password/forgot', { email });
      setPwStep('sent');
      setPwMsg('Password reset link sent to your email.');
    } catch (err) {
      setPwErr(err instanceof ApiError ? err.message : 'Failed to send reset link.');
    } finally {
      setPwLoading(false);
    }
  };

  const handleRequestEmailChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setSecErr('');
    setSecMsg('');
    setEmailLoading(true);
    try {
      await stepUp.runWithStepUp((twoFactorCode) =>
        api.post('/auth/email/change-request', {
          newEmail,
          password: emailPassword,
          twoFactorCode,
        }),
      );
      setEmailStep('otp');
      setSecMsg(`Verification code sent to ${newEmail}.`);
    } catch (err) {
      if (err instanceof Error && err.message === 'Cancelled') {
        setSecErr('');
      } else {
        setSecErr(err instanceof ApiError ? err.message : 'Failed to send verification code.');
      }
    } finally {
      setEmailLoading(false);
    }
  };

  const handleConfirmEmailChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setSecErr('');
    setSecMsg('');
    setEmailLoading(true);
    try {
      await api.post('/auth/email/confirm', { code: emailOtp });
      await refresh();
      setEmailStep('idle');
      setNewEmail('');
      setEmailPassword('');
      setEmailOtp('');
      setSecMsg('Email address updated successfully.');
    } catch (err) {
      setSecErr(err instanceof ApiError ? err.message : 'Invalid or expired code.');
    } finally {
      setEmailLoading(false);
    }
  };

  const handleRequestDeleteAccount = async () => {
    setSecErr('');
    setSecMsg('');
    setRequestingDelete(true);
    try {
      await stepUp.runWithStepUp((twoFactorCode) =>
        api.post('/auth/account/delete-request', { twoFactorCode }),
      );
      setDeleteStep('otp');
      setSecMsg('A confirmation code has been sent to your email.');
    } catch (err) {
      if (err instanceof Error && err.message === 'Cancelled') {
        setSecErr('');
      } else {
        setSecErr(err instanceof ApiError ? err.message : 'Failed to send confirmation code.');
      }
    } finally {
      setRequestingDelete(false);
    }
  };

  const handleDeleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setSecErr('');
    setDeleting(true);
    try {
      await api.delete('/auth/account', { code: deleteOtp });
      router.push('/');
    } catch (err) {
      setSecErr(err instanceof ApiError ? err.message : 'Invalid or expired code.');
    } finally {
      setDeleting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-5 h-5 rounded-full border-2 border-[var(--border)] border-t-atlas-400 animate-spin" />
      </div>
    );
  }

  const walletAddress = (user as { walletAddress?: string })?.walletAddress;
  const userTag = (user as { userTag?: string })?.userTag;
  const githubLogin = (user as { githubLogin?: string })?.githubLogin;
  const userEmail = (user as { email?: string })?.email;
  const profileUrl = username ? `/u/${username}` : null;

  // App-style sidebar nav. Order = priority. Socials (Twitter, LinkedIn,
  // Website) live inside General now — the user shouldn't have to switch
  // tabs to add a Twitter URL, it's identity data.
  const tabItems = [
    { id: 'general' as Tab, label: 'General', Icon: IconUser },
    { id: 'wallet' as Tab, label: 'Wallet', Icon: IconWallet },
    { id: 'api-keys' as Tab, label: 'API Keys', Icon: IconLink },
    { id: 'security' as Tab, label: 'Security', Icon: IconShield },
    { id: 'friends' as Tab, label: 'Friends', Icon: IconUsers },
  ];

  return (
    <div style={{ background: 'var(--bg)' }} className="min-h-screen pb-20">
      {/* Marketplace-style shell: atlas-hero header → sticky AtlasFilterBar
          with segment tabs → content area. Token-driven so it tracks
          light/dark exactly like /market does. */}
      <header className="atlas-hero relative px-6 pt-12 pb-10 md:px-10 md:pt-20 md:pb-16 overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px"
          style={{
            background:
              'linear-gradient(90deg, transparent 0%, var(--brand) 50%, transparent 100%)',
            opacity: 0.35,
          }}
        />

        <div className="relative mx-auto max-w-[1400px]">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-card)] px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[var(--text-secondary)] font-medium"
          >
            Account
          </motion.div>

          <div className="mt-6 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
            <div>
              <motion.h1
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: [0.22, 0.61, 0.36, 1] }}
                className="text-4xl md:text-5xl xl:text-6xl font-semibold tracking-[-0.025em] text-[var(--text)] leading-[1.05] max-w-3xl"
              >
                {displayName || username || 'Your profile'}
                {username && (
                  <>
                    <br className="hidden md:block" />
                    <span className="text-[var(--brand)]">@{username}</span>
                  </>
                )}
              </motion.h1>
              <motion.p
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.1 }}
                className="mt-4 text-[15px] md:text-base text-[var(--text-secondary)] leading-relaxed max-w-2xl"
              >
                Manage your identity, wallets, API keys, security and friends from a single place.
              </motion.p>
            </div>
            {profileUrl && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.4 }}
                className="self-start md:self-auto md:pb-3"
              >
                <Link
                  href={profileUrl}
                  className="atlas-cta inline-flex items-center gap-2 px-6 h-12 rounded-2xl text-[14px] font-medium tracking-tight"
                >
                  View public profile
                </Link>
              </motion.div>
            )}
          </div>
        </div>
      </header>

      {/* Sticky tab bar — same component pattern as /market. */}
      <section className="px-6 md:px-10 mt-4 mb-4 sticky top-[64px] z-30">
        <div className="mx-auto max-w-[1400px]">
          <AtlasFilterBar
            leftSlot={
              <AtlasTabs
                variant="segment"
                value={tab}
                onChange={(v) => setTab(v as Tab)}
                tabs={tabItems.map(({ id, label, Icon }) => ({
                  value: id,
                  label,
                  icon: <Icon className="w-3.5 h-3.5" />,
                }))}
              />
            }
          />
        </div>
      </section>

      <main className="px-6 md:px-10">
        <div className="mx-auto max-w-[1400px]">
          <div className="profile-content">
            {/* ════════════════════════════════════════════
          GENERAL
      ════════════════════════════════════════════ */}
            {tab === 'general' && (
              <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start">
                <div className="space-y-4 min-w-0">
                  <div className="profile-content-card">
                    <SectionHeader title="Identity" subtitle="Your public information on Atlas." />
                    <Alert type="success" msg={genMsg} />
                    <Alert type="error" msg={genErr} />

                    {/* Avatar upload */}
                    <div className="flex items-center gap-6 p-6 rounded-xl border border-[rgba(20, 241, 149, 0.15)] bg-gradient-to-r from-[rgba(20, 241, 149, 0.05)] to-transparent mb-6">
                      <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
                        <div
                          className="relative group cursor-pointer"
                          onClick={() => avatarInputRef.current?.click()}
                        >
                          <Avatar
                            src={user?.avatarUrl}
                            name={user?.displayName || user?.username}
                            userId={user?.id}
                            size="lg"
                          />
                          {(() => {
                            const pts =
                              (user as { reputationPoints?: number } | null)?.reputationPoints ?? 0;
                            const rank = getReputationRank(pts);
                            const RankIcon = rank.icon;
                            return (
                              <span
                                className="absolute"
                                style={{
                                  right: -2,
                                  bottom: -2,
                                  width: 18,
                                  height: 18,
                                  borderRadius: '9999px',
                                  background: 'var(--bg-card)',
                                  border: `1.5px solid ${rank.color}`,
                                  boxShadow: `0 0 0 1.5px #0a0a0e, 0 0 8px -1px ${rank.color}88`,
                                  display: 'grid',
                                  placeItems: 'center',
                                }}
                                title={`${rank.label} · ${pts.toLocaleString()} rays`}
                                aria-hidden
                              >
                                <RankIcon
                                  style={{ color: rank.color, width: 10, height: 10 }}
                                  strokeWidth={2}
                                />
                              </span>
                            );
                          })()}
                          <div className="absolute inset-0 rounded-full bg-gray-950/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            {avatarUploading ? (
                              <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                            ) : (
                              <svg
                                className="w-5 h-5 text-white"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth="1.5"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z"
                                />
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z"
                                />
                              </svg>
                            )}
                          </div>
                        </div>
                        {(() => {
                          const pts =
                            (user as { reputationPoints?: number } | null)?.reputationPoints ?? 0;
                          const rank = getReputationRank(pts);
                          return (
                            <span
                              className="px-2 py-[2px] rounded-full font-mono whitespace-nowrap"
                              style={{
                                fontSize: 10,
                                background: `${rank.color}12`,
                                color: rank.color,
                                border: `1px solid ${rank.color}38`,
                                letterSpacing: '0.06em',
                              }}
                              title={`${pts.toLocaleString()} rays`}
                            >
                              {rank.label.toUpperCase()}
                            </span>
                          );
                        })()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-light text-[var(--text)] mb-0.5">
                          Profile photo
                        </div>
                        <div className="text-xs text-[var(--text-muted)] mb-2">
                          PNG, JPG or WebP · max 3 MB
                        </div>
                        {avatarMsg && typeof avatarMsg === 'string' && (
                          <div className="text-xs text-emerald-400">{avatarMsg}</div>
                        )}
                        {avatarErr && typeof avatarErr === 'string' && (
                          <div className="text-xs text-red-400">{avatarErr}</div>
                        )}
                        <button
                          type="button"
                          onClick={() => avatarInputRef.current?.click()}
                          disabled={avatarUploading}
                          className="text-xs px-3 py-1.5 rounded-lg border border-[var(--border)] hover:border-atlas-500/30 text-[var(--text-muted)] hover:text-atlas-400 transition-all disabled:opacity-50"
                        >
                          {avatarUploading ? 'Uploading...' : 'Change photo'}
                        </button>
                      </div>
                      <input
                        ref={avatarInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={handleAvatarUpload}
                      />
                      <AvatarCropperModal
                        open={!!pendingAvatarFile}
                        file={pendingAvatarFile}
                        onClose={() => setPendingAvatarFile(null)}
                        onSave={handleAvatarSave}
                      />
                    </div>

                    <form onSubmit={handleSaveGeneral} className="space-y-6">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <Field label="Username">
                          <div className="flex items-center gap-0 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-xl overflow-hidden focus-within:border-atlas-500/50 focus-within:shadow-[0_0_0_3px_rgba(20, 241, 149, 0.08)] transition-all duration-200">
                            <span className="px-3 text-atlas-400 font-mono text-sm select-none">
                              @
                            </span>
                            <input
                              type="text"
                              value={username}
                              onChange={(e) =>
                                setUsername(
                                  e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''),
                                )
                              }
                              className="flex-1 bg-transparent py-2.5 pr-4 text-sm text-[var(--text)] font-mono outline-none placeholder:text-[var(--text-muted)]"
                              maxLength={30}
                              required
                              placeholder="yourhandle"
                            />
                          </div>
                        </Field>
                        <Field label="Display Name">
                          <Input
                            type="text"
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value)}
                            maxLength={50}
                            placeholder="Your full name"
                          />
                        </Field>
                      </div>

                      <Field label="Bio">
                        <Textarea
                          value={bio}
                          onChange={(e) => setBio(e.target.value)}
                          rows={3}
                          maxLength={300}
                          placeholder="A short description about yourself..."
                        />
                        <div className="text-right text-xs text-[var(--text-muted)] mt-1">
                          {bio.length} / 300
                        </div>
                      </Field>

                      {userTag && (
                        <div className="flex items-center justify-between bg-atlas-500/5 border border-atlas-500/15 rounded-xl px-4 py-3">
                          <div>
                            <div className="text-xs text-[var(--text-muted)] uppercase tracking-widest mb-0.5">
                              User ID
                            </div>
                            <div className="font-mono text-atlas-400 font-light">#{userTag}</div>
                          </div>
                          <div className="text-xs text-[var(--text-muted)] text-right leading-relaxed">
                            Others can find you
                            <br />
                            by searching #{userTag}
                          </div>
                        </div>
                      )}

                      <SaveButton loading={genSaving} />
                    </form>

                    {/* Social links live INSIDE the Identity card now (was a
                  separate card below — too much scroll to reach). Same
                  three URL fields + their own Save button, but rendered
                  as a sibling subsection so the user sees both at once. */}
                    <div className="mt-6 pt-5 border-t border-white/[0.06]">
                      <div className="mb-4">
                        <h3 className="text-[14px] text-white font-light">Social links</h3>
                        <p className="text-[11.5px] text-zinc-500 mt-0.5">
                          Where else people can find you.
                        </p>
                      </div>
                      <Alert type="success" msg={socMsg} />
                      <Alert type="error" msg={socErr} />
                      <form onSubmit={handleSaveSocial} className="space-y-3">
                        {(
                          [
                            {
                              key: 'twitter',
                              label: 'X / Twitter',
                              icon: (
                                <svg
                                  className="w-4 h-4 text-[var(--text-muted)]"
                                  fill="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.259 5.631 5.905-5.631zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                                </svg>
                              ),
                              value: twitterUrl,
                              setter: setTwitterUrl,
                              placeholder: 'https://x.com/yourhandle',
                            },
                            {
                              key: 'linkedin',
                              label: 'LinkedIn',
                              icon: (
                                <svg
                                  className="w-4 h-4 text-blue-400"
                                  fill="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                                </svg>
                              ),
                              value: linkedinUrl,
                              setter: setLinkedinUrl,
                              placeholder: 'https://linkedin.com/in/yourprofile',
                            },
                            {
                              key: 'website',
                              label: 'Website',
                              icon: <IconGlobe className="w-4 h-4 text-[var(--text-muted)]" />,
                              value: websiteUrl,
                              setter: setWebsiteUrl,
                              placeholder: 'https://yourwebsite.com',
                            },
                          ] as Array<{
                            key: string;
                            label: string;
                            icon: React.ReactNode;
                            value: string;
                            setter: (v: string) => void;
                            placeholder: string;
                          }>
                        ).map((item) => (
                          <Field key={item.key} label={item.label}>
                            <div className="flex items-center gap-3 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-[10px] px-4 py-3 focus-within:border-atlas-500/60 focus-within:shadow-[0_0_0_3px_rgba(20, 241, 149, 0.1)] transition-all duration-200">
                              {item.icon}
                              <input
                                type="url"
                                value={item.value}
                                onChange={(e) => item.setter(e.target.value)}
                                placeholder={item.placeholder}
                                className="flex-1 bg-transparent text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-muted)] font-light"
                              />
                              {item.value && (
                                <button
                                  type="button"
                                  onClick={() => item.setter('')}
                                  className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
                                >
                                  <IconX className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </Field>
                        ))}
                        <SaveButton loading={socSaving} label="Save social links" />
                      </form>
                    </div>
                  </div>

                  {/* ConnectedAccountsPanel + RankProgressPanel removed —
                rays/reputation surfaces stripped per user request. */}
                </div>
              </div>
            )}

            {/* Ranks tab removed — reputation system gone. */}

            {/* ════════════════════════════════════════════
          WALLET
      ════════════════════════════════════════════ */}
            {tab === 'wallet' && (
              <div className="profile-content-card">
                <SectionHeader
                  title="Wallets"
                  subtitle="Connect and manage the wallets you use to pay, receive earnings, and sign transactions on Atlas."
                />
                <Alert type="success" msg={walletMsg} />
                <Alert type="error" msg={walletErr} />

                {/* Linked wallets list */}
                {linkedWallets.length > 0 ? (
                  <div className="space-y-3 mb-6">
                    {linkedWallets.map((w) => {
                      const short = `${w.address.slice(0, 6)}…${w.address.slice(-4)}`;
                      const copied = copiedAddress === w.address;
                      const isEditing = walletLabelEditingId === w.id;
                      return (
                        <div
                          key={w.id}
                          className={`rounded-xl border ${
                            w.isPrimary
                              ? 'border-emerald-500/30 bg-emerald-500/5'
                              : 'border-[var(--border)] bg-[var(--bg-elevated)]'
                          } p-4 sm:p-5`}
                        >
                          <div className="flex items-start gap-3 sm:gap-4">
                            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center flex-shrink-0">
                              <WalletProviderIcon provider={w.provider} size={28} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-2 mb-1">
                                <span className="text-sm font-light text-white/90">
                                  {walletProviderLabel(w.provider)}
                                </span>
                                {w.isPrimary && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] uppercase tracking-widest border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                                    Primary
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <code className="font-mono text-xs sm:text-sm text-white/80 truncate">
                                  <span className="hidden sm:inline">{w.address}</span>
                                  <span className="sm:hidden">{short}</span>
                                </code>
                                <button
                                  type="button"
                                  onClick={() => handleCopyAddress(w.address)}
                                  className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-white/10 bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-colors flex-shrink-0"
                                  aria-label="Copy address"
                                  title={copied ? 'Copied!' : 'Copy address'}
                                >
                                  {copied ? (
                                    <svg
                                      width="14"
                                      height="14"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    >
                                      <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                  ) : (
                                    <svg
                                      width="14"
                                      height="14"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    >
                                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                    </svg>
                                  )}
                                </button>
                              </div>
                              {/* Label row */}
                              <div className="mt-2">
                                {isEditing ? (
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="text"
                                      value={walletLabelDraft}
                                      onChange={(e) => setWalletLabelDraft(e.target.value)}
                                      placeholder="Label (e.g. Trading, Cold storage)"
                                      maxLength={60}
                                      className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white/90 placeholder-white/40 focus:outline-none focus:border-[#14F195]/50"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => handleSaveWalletLabel(w.id)}
                                      disabled={walletActionId === w.id}
                                      className="text-xs px-3 py-1.5 rounded-lg bg-[#14F195]/80 hover:bg-[#14F195] text-white disabled:opacity-50"
                                    >
                                      Save
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setWalletLabelEditingId(null);
                                        setWalletLabelDraft('');
                                      }}
                                      className="text-xs px-2 py-1.5 rounded-lg border border-white/15 text-white/70 hover:bg-white/5"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setWalletLabelEditingId(w.id);
                                      setWalletLabelDraft(w.label || '');
                                    }}
                                    className="text-xs text-white/50 hover:text-white/80 transition-colors"
                                  >
                                    {w.label ? `“${w.label}”` : '+ Add label'}
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                          {/* Actions */}
                          <div className="mt-3 flex flex-col sm:flex-row gap-2">
                            {!w.isPrimary && (
                              <button
                                type="button"
                                onClick={() => handleSetPrimaryWallet(w.id)}
                                disabled={walletActionId === w.id}
                                className="flex-1 text-xs px-3 py-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10 text-emerald-300 disabled:opacity-50"
                              >
                                {walletActionId === w.id ? 'Updating…' : 'Make primary'}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleRemoveLinkedWallet(w.id)}
                              disabled={
                                walletActionId === w.id ||
                                (w.isPrimary && linkedWallets.length === 1 && !!walletAddress)
                              }
                              title={
                                w.isPrimary && linkedWallets.length === 1
                                  ? 'Use the card above to disconnect your only wallet'
                                  : 'Remove this wallet'
                              }
                              className="flex-1 text-xs px-3 py-2 rounded-lg border border-red-500/25 bg-red-500/5 hover:bg-red-500/10 text-red-400 disabled:opacity-40"
                            >
                              {walletActionId === w.id ? 'Removing…' : 'Remove'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : walletAddress ? (
                  // Primary exists but sidecar hasn't returned yet — keep a clean card
                  <div className="mb-6 flex items-center gap-4 p-4 sm:p-5 rounded-xl border border-emerald-500/20 bg-emerald-500/5">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center flex-shrink-0">
                      <WalletProviderIcon provider="METAMASK" size={28} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-emerald-400 uppercase tracking-widest mb-1">
                        Connected
                      </div>
                      <div className="font-mono text-xs sm:text-sm text-white/90 truncate">
                        {walletAddress}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopyAddress(walletAddress)}
                      className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-white/10 bg-white/5 hover:bg-white/10 text-white/70 flex-shrink-0"
                      aria-label="Copy address"
                    >
                      {copiedAddress === walletAddress ? (
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : (
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                      )}
                    </button>
                  </div>
                ) : null}

                {/* Single connect surface — the supported-wallets grid below.
                  We used to render a duplicate big "Connect MetaMask" / "Link
                  another" button on top of the grid that already had MetaMask
                  + WalletConnect tiles, which confused users into thinking
                  the two paths did different things. Disconnect for the
                  primary wallet is now a small inline link instead of its
                  own large CTA. */}
                {walletAddress && (
                  <div className="mb-5 flex items-center justify-end">
                    <button
                      type="button"
                      onClick={handleDisconnectWallet}
                      disabled={walletLoading}
                      className="text-[11.5px] text-red-400 hover:text-red-300 underline decoration-red-500/30 underline-offset-2 hover:decoration-red-300 transition disabled:opacity-50"
                    >
                      {walletLoading ? 'Disconnecting…' : 'Disconnect primary wallet'}
                    </button>
                  </div>
                )}

                {/* Supported wallets — single source of truth for adding wallets.
                  Each tile branches between "first connect" and "link
                  another" based on whether a primary already exists. */}
                <div className="border-t border-white/8 pt-5">
                  <div className="text-xs uppercase tracking-widest text-white/50 mb-3">
                    {walletAddress ? 'Link another wallet' : 'Connect a wallet'}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {/* MetaMask — browser extension */}
                    <button
                      type="button"
                      onClick={walletAddress ? handleAddAdditionalWallet : handleConnectWallet}
                      disabled={walletLoading}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-white/8 bg-white/[0.02] hover:bg-white/5 hover:border-white/15 transition-all group disabled:opacity-50 text-left"
                    >
                      <WalletProviderIcon provider="METAMASK" size={22} />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs sm:text-sm text-white/80 group-hover:text-white truncate">
                          MetaMask
                        </div>
                        <div className="text-[10px] text-white/40">Browser extension</div>
                      </div>
                    </button>

                    {/* WalletConnect — real SDK flow */}
                    <button
                      type="button"
                      onClick={handleConnectWalletConnect}
                      disabled={walletLoading}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-white/8 bg-white/[0.02] hover:bg-white/5 hover:border-white/15 transition-all group disabled:opacity-50 text-left"
                    >
                      <WalletProviderIcon provider="WALLETCONNECT" size={22} />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs sm:text-sm text-white/80 group-hover:text-white truncate">
                          WalletConnect
                        </div>
                        <div className="text-[10px] text-white/40">Scan QR · mobile wallets</div>
                      </div>
                    </button>
                  </div>
                  <p className="text-[11px] text-white/40 mt-3 leading-relaxed">
                    Click a wallet to link it. MetaMask opens its browser extension. WalletConnect
                    shows a QR you can scan from any compatible mobile wallet.
                  </p>
                </div>
              </div>
            )}

            {/* ════════════════════════════════════════════
          API KEYS
      ════════════════════════════════════════════ */}
            {tab === 'api-keys' && (
              <div className="space-y-4">
                {/* Help banner — surfaces what API keys are, where they're used,
                  and the security rules at all times. The user kept asking
                  the team what each key is for; pin it on screen. */}
                <div
                  className="rounded-xl p-4 space-y-3"
                  style={{
                    background: 'rgba(20, 241, 149, 0.06)',
                    border: '1px solid rgba(20, 241, 149, 0.18)',
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[10.5px] uppercase tracking-[0.16em] text-[var(--brand)] font-medium">
                      What are API keys
                    </span>
                  </div>
                  <p className="text-[12px] text-zinc-300 font-light leading-relaxed">
                    API keys let your code, agents, or third-party tools call the Atlas API on your
                    behalf. Anyone who holds one of your keys can read your data and publish on your
                    account, so treat them like passwords.
                  </p>
                  <ul className="text-[11.5px] text-zinc-400 font-light leading-relaxed space-y-1 list-disc pl-4">
                    <li>
                      <span className="text-zinc-200">Use in:</span> agent webhooks, marketplace
                      automations, internal scripts, CI/CD that pings Atlas.
                    </li>
                    <li>
                      <span className="text-zinc-200">Header:</span>{' '}
                      <code className="text-[var(--brand)] bg-black/30 px-1 rounded">
                        Authorization: Bearer YOUR_KEY
                      </code>
                    </li>
                    <li>
                      <span className="text-zinc-200">Rotate</span> any key you ever paste into a
                      document, screenshot, or shared chat — including this one.
                    </li>
                    <li>
                      <span className="text-zinc-200">Never</span> embed a key in client-side code
                      shipped to a browser or mobile app. Use a server proxy.
                    </li>
                  </ul>
                </div>

                <APIKeysSection
                  apiKeys={apiKeys}
                  onDelete={handleDeleteAPIKey}
                  onGenerate={handleGenerateAPIKey}
                  onCopy={handleCopyAPIKey}
                />
              </div>
            )}

            {/* ════════════════════════════════════════════
          FRIENDS
      ════════════════════════════════════════════ */}
            {tab === 'friends' && (
              <div className="space-y-4">
                {/* Privacy + Suggested users — added in PR4. Sits above the
                  existing search/list/requests panel so the user lands on
                  the active surfaces first. */}
                <FriendsExtras
                  onFriendRequestSent={() => {
                    // Tickle the existing requests-out list so a freshly-sent
                    // request shows up in the parent panel without a reload.
                    void loadFriends();
                  }}
                />

                {/* Search */}
                <div className="profile-content-card">
                  <SectionHeader
                    title="Search"
                    subtitle="Find someone by username, display name, or tag."
                  />
                  <Alert type="success" msg={friendsMsg} />
                  <Alert type="error" msg={friendsErr} />
                  <div className="flex items-center gap-3 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-xl px-4 py-3 focus-within:border-atlas-500/50 focus-within:shadow-[0_0_0_3px_rgba(20, 241, 149, 0.08)] transition-all duration-200">
                    <IconSearch className="w-4 h-4 text-[var(--text-muted)] flex-shrink-0" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search by @username or user ID..."
                      className="flex-1 bg-transparent text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
                    />
                    {searching ? (
                      <div className="w-4 h-4 rounded-full border-2 border-[var(--border)] border-t-atlas-400 animate-spin flex-shrink-0" />
                    ) : (
                      searchQuery && (
                        <button
                          onClick={() => {
                            setSearchQuery('');
                            setSearchResults([]);
                          }}
                          className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
                        >
                          <IconX className="w-4 h-4" />
                        </button>
                      )
                    )}
                  </div>

                  {searchResults.length > 0 && (
                    <div className="mt-3 rounded-xl border border-[var(--border)] overflow-hidden">
                      {searchResults.map((u, i) => (
                        <div
                          key={u.id}
                          className={`flex items-center gap-3 px-4 py-3 hover:bg-white/3 transition-colors ${i > 0 ? 'border-t border-[var(--border)]' : ''}`}
                        >
                          <Avatar
                            src={u.avatarUrl}
                            name={u.displayName || u.username}
                            userId={u.id}
                            size="sm"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-light text-[var(--text)] truncate">
                              {u.displayName || u.username}
                            </div>
                            <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] font-mono">
                              {u.username && <span>@{u.username}</span>}
                              {u.userTag && <span className="text-atlas-400/70">#{u.userTag}</span>}
                            </div>
                          </div>
                          <button
                            onClick={() => handleSendFriendRequest(u.id)}
                            disabled={sendingTo === u.id}
                            className="text-xs text-atlas-400 border border-atlas-500/30 hover:border-atlas-400/60 hover:bg-atlas-500/8 px-3 py-1.5 rounded-lg transition-all duration-200 disabled:opacity-50 shrink-0"
                          >
                            {sendingTo === u.id ? '...' : '+ Add'}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {searchQuery.trim() && !searching && searchResults.length === 0 && (
                    <div className="mt-3 text-center py-6 text-xs text-[var(--text-muted)] font-mono border border-[var(--border)] rounded-xl">
                      No users found for &quot;{searchQuery}&quot;
                    </div>
                  )}
                </div>

                {/* Requests + list */}
                <div className="profile-content-card">
                  {friendsLoading ? (
                    <div className="flex items-center gap-2 py-6 justify-center text-xs text-[var(--text-muted)]">
                      <div className="w-4 h-4 rounded-full border-2 border-[var(--border)] border-t-atlas-400 animate-spin" />
                      Loading...
                    </div>
                  ) : (
                    <div className="space-y-5">
                      {/* Pending requests */}
                      {friendRequests.length > 0 && (
                        <div>
                          <div className="flex items-center gap-2 mb-3">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                            <span className="text-xs font-mono text-amber-400 uppercase tracking-widest">
                              {friendRequests.length} pending request
                              {friendRequests.length !== 1 ? 's' : ''}
                            </span>
                          </div>
                          <div className="space-y-2">
                            {friendRequests.map((req) => (
                              <div
                                key={req.id}
                                className="flex items-center gap-3 bg-amber-500/5 border border-amber-500/15 rounded-xl px-4 py-3"
                              >
                                <Avatar
                                  src={req.from.avatarUrl}
                                  name={req.from.displayName || req.from.username}
                                  userId={req.from.id}
                                  size="sm"
                                />
                                <div className="flex-1 min-w-0">
                                  <Link
                                    href={`/u/${req.from.username}`}
                                    className="text-sm font-light text-[var(--text)] hover:text-atlas-300 transition-colors"
                                  >
                                    {req.from.displayName || req.from.username}
                                  </Link>
                                  <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] font-mono">
                                    {req.from.username && <span>@{req.from.username}</span>}
                                    {req.from.userTag && (
                                      <span className="text-atlas-400/60">#{req.from.userTag}</span>
                                    )}
                                  </div>
                                </div>
                                <div className="flex gap-2 shrink-0">
                                  <button
                                    onClick={() => handleRespondToRequest(req.id, true)}
                                    disabled={friendActionId === req.id}
                                    className="text-xs text-emerald-400 border border-emerald-500/25 hover:border-emerald-400/50 hover:bg-emerald-500/8 px-3 py-1.5 rounded-lg transition-all duration-200 disabled:opacity-50"
                                  >
                                    Accept
                                  </button>
                                  <button
                                    onClick={() => handleRespondToRequest(req.id, false)}
                                    disabled={friendActionId === req.id}
                                    className="text-xs text-[var(--text-muted)] border border-[var(--border)] hover:border-zinc-500 px-3 py-1.5 rounded-lg transition-all duration-200 disabled:opacity-50"
                                  >
                                    Decline
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Sent / outgoing requests */}
                      {sentRequests.length > 0 && (
                        <div>
                          <div className="flex items-center gap-2 mb-3">
                            <span className="w-1.5 h-1.5 rounded-full bg-atlas-400" />
                            <span className="text-xs font-mono text-atlas-300 uppercase tracking-widest">
                              {sentRequests.length} sent request
                              {sentRequests.length !== 1 ? 's' : ''}
                            </span>
                          </div>
                          <div className="space-y-2">
                            {sentRequests.map((req) => (
                              <div
                                key={req.id}
                                className="flex items-center gap-3 bg-atlas-500/5 border border-atlas-500/15 rounded-xl px-4 py-3"
                              >
                                <Avatar
                                  src={req.to.avatarUrl}
                                  name={req.to.displayName || req.to.username}
                                  userId={req.to.id}
                                  size="sm"
                                />
                                <div className="flex-1 min-w-0">
                                  <Link
                                    href={`/u/${req.to.username}`}
                                    className="text-sm font-light text-[var(--text)] hover:text-atlas-300 transition-colors"
                                  >
                                    {req.to.displayName || req.to.username}
                                  </Link>
                                  <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] font-mono">
                                    {req.to.username && <span>@{req.to.username}</span>}
                                    {req.to.userTag && (
                                      <span className="text-atlas-400/60">#{req.to.userTag}</span>
                                    )}
                                    <span className="text-white/30">· awaiting response</span>
                                  </div>
                                </div>
                                <button
                                  onClick={() => handleCancelSentRequest(req.to.id)}
                                  disabled={friendActionId === req.to.id}
                                  className="text-xs text-[var(--text-muted)] border border-[var(--border)] hover:border-red-400/25 hover:text-red-400 px-3 py-1.5 rounded-lg transition-all duration-200 disabled:opacity-50 shrink-0"
                                >
                                  {friendActionId === req.to.id ? '...' : 'Cancel'}
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Friends list */}
                      {friends.length === 0 &&
                      friendRequests.length === 0 &&
                      sentRequests.length === 0 ? (
                        <div className="text-center py-10">
                          <IconUsers className="w-8 h-8 text-[var(--text-muted)] mx-auto mb-2 opacity-30" />
                          <p className="text-sm text-[var(--text-muted)]">
                            Start building your network — search for developers to connect with.
                          </p>
                        </div>
                      ) : friends.length > 0 ? (
                        <div>
                          {friendRequests.length > 0 && (
                            <div className="border-t border-[var(--border)] pt-4" />
                          )}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {friends.map((f) => (
                              <div
                                key={f.id}
                                className="flex items-center gap-3 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-xl px-3 py-2.5 group hover:border-atlas-500/40 hover:shadow-lg transition-all duration-200"
                              >
                                <Avatar
                                  src={f.friend.avatarUrl}
                                  name={f.friend.displayName || f.friend.username}
                                  userId={f.friend.id}
                                  size="sm"
                                />
                                <div className="flex-1 min-w-0">
                                  <Link
                                    href={`/u/${f.friend.username}`}
                                    className="text-xs font-light text-[var(--text)] hover:text-atlas-300 transition-colors truncate block"
                                  >
                                    {f.friend.displayName || f.friend.username}
                                  </Link>
                                  <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] font-mono">
                                    {f.friend.username && <span>@{f.friend.username}</span>}
                                    {f.friend.userTag && (
                                      <span className="text-atlas-300">#{f.friend.userTag}</span>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button
                                    onClick={() => handleUnfriend(f.friend.id)}
                                    disabled={friendActionId === f.friend.id}
                                    className="text-xs text-[var(--text-muted)] hover:text-red-400 border border-[var(--border)] hover:border-red-400/25 px-2 py-1 rounded-lg transition-all duration-200 disabled:opacity-50"
                                    title="Remove friend"
                                  >
                                    <IconX className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ════════════════════════════════════════════
          SECURITY
      ════════════════════════════════════════════ */}
            {tab === 'security' && (
              <div className="space-y-4">
                {/* ── Email address ── */}
                <div className="profile-content-card">
                  <SectionHeader
                    title="Email Address"
                    subtitle="Update the email address associated with your account."
                  />
                  <Alert type="success" msg={secMsg} />
                  <Alert type="error" msg={secErr} />

                  <div className="flex items-center justify-between p-4 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border)] mb-4">
                    <div>
                      <div className="text-xs text-[var(--text-muted)] uppercase tracking-widest mb-0.5">
                        Current email
                      </div>
                      <div className="text-sm font-light text-[var(--text)]">
                        {userEmail || '—'}
                      </div>
                    </div>
                    {emailStep === 'idle' && (
                      <button
                        type="button"
                        onClick={() => setEmailStep('form')}
                        className="text-xs px-3 py-1.5 rounded-lg border border-[var(--border)] hover:border-atlas-500/40 text-[var(--text-muted)] hover:text-atlas-400 transition-all"
                      >
                        Change
                      </button>
                    )}
                  </div>

                  {emailStep === 'form' && (
                    <form onSubmit={handleRequestEmailChange} className="space-y-4">
                      <Field label="New Email Address">
                        <Input
                          type="email"
                          value={newEmail}
                          onChange={(e) => setNewEmail(e.target.value)}
                          required
                          placeholder="new@example.com"
                        />
                      </Field>
                      <Field label="Current Password">
                        <Input
                          type="password"
                          value={emailPassword}
                          onChange={(e) => setEmailPassword(e.target.value)}
                          required
                          placeholder="••••••••"
                        />
                      </Field>
                      <div className="flex gap-2">
                        <button
                          type="submit"
                          disabled={emailLoading}
                          className="flex-1 py-3 rounded-xl text-sm font-light disabled:opacity-50 text-white transition-all"
                          style={{
                            background:
                              'linear-gradient(180deg, rgba(20, 241, 149, 0.38) 0%, rgba(20, 241, 149, 0.14) 100%)',
                            boxShadow:
                              'inset 0 0 0 1px rgba(20, 241, 149, 0.48), inset 0 1px 0 rgba(255,255,255,0.08)',
                          }}
                        >
                          {emailLoading ? 'Sending...' : 'Send verification code'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEmailStep('idle');
                            setNewEmail('');
                            setEmailPassword('');
                          }}
                          className="px-4 py-3 rounded-xl text-sm font-light border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] transition-all"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}

                  {emailStep === 'otp' && (
                    <form onSubmit={handleConfirmEmailChange} className="space-y-4">
                      <p className="text-sm text-[var(--text-secondary)] font-light">
                        A 6-digit code was sent to{' '}
                        <span className="text-atlas-400">{newEmail}</span>.
                      </p>
                      <Field label="Verification Code">
                        <Input
                          type="text"
                          value={emailOtp}
                          onChange={(e) =>
                            setEmailOtp(e.target.value.replace(/\D/g, '').slice(0, 6))
                          }
                          placeholder="000000"
                          maxLength={6}
                        />
                      </Field>
                      <div className="flex gap-2">
                        <button
                          type="submit"
                          disabled={emailLoading || emailOtp.length !== 6}
                          className="flex-1 py-3 rounded-xl text-sm font-light disabled:opacity-50 text-white transition-all"
                          style={{
                            background:
                              'linear-gradient(180deg, rgba(20, 241, 149, 0.38) 0%, rgba(20, 241, 149, 0.14) 100%)',
                            boxShadow:
                              'inset 0 0 0 1px rgba(20, 241, 149, 0.48), inset 0 1px 0 rgba(255,255,255,0.08)',
                          }}
                        >
                          {emailLoading ? 'Confirming...' : 'Confirm email change'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEmailStep('idle')}
                          className="px-4 py-3 rounded-xl text-sm font-light border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] transition-all"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}
                </div>

                {/* ── Two-Factor Authentication ── */}
                <div className="profile-content-card">
                  <SectionHeader
                    title="Two-Factor Authentication"
                    subtitle="Add an extra layer of security to your account."
                  />

                  <div className="flex items-center justify-between p-4 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border)] mb-4">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-2 h-2 rounded-full ${twoFAEnabled ? 'bg-emerald-400' : 'bg-zinc-500'}`}
                      />
                      <div>
                        <div className="text-sm font-light text-[var(--text)]">
                          {twoFAEnabled ? '2FA is enabled' : '2FA is disabled'}
                        </div>
                        <div className="text-xs text-[var(--text-muted)]">
                          {twoFAEnabled
                            ? 'Your account is protected with two-factor authentication.'
                            : 'Enable 2FA to secure your account with a verification code.'}
                        </div>
                      </div>
                    </div>
                    {enable2FAStep === 'idle' && (
                      <button
                        type="button"
                        onClick={handle2FAToggle}
                        disabled={toggling2FA || (twoFAEnabled && !disable2FAPassword)}
                        className={`text-xs px-3 py-1.5 rounded-lg border transition-all disabled:opacity-50 ${
                          twoFAEnabled
                            ? 'border-red-500/25 text-red-400 hover:border-red-500/40 hover:bg-red-500/5'
                            : 'border-emerald-500/25 text-emerald-400 hover:border-emerald-500/40 hover:bg-emerald-500/5'
                        }`}
                      >
                        {toggling2FA ? '...' : twoFAEnabled ? 'Disable' : 'Enable'}
                      </button>
                    )}
                  </div>

                  {twoFAEnabled && enable2FAStep === 'idle' && (
                    <Field label="Password required to disable 2FA">
                      <Input
                        type="password"
                        value={disable2FAPassword}
                        onChange={(e) => setDisable2FAPassword(e.target.value)}
                        placeholder="Enter your password"
                      />
                    </Field>
                  )}

                  {enable2FAStep === 'scan' && (
                    <div className="space-y-5 mt-2">
                      <div className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-5 items-center p-5 rounded-xl border border-atlas-500/20 bg-gradient-to-br from-atlas-500/5 to-transparent">
                        {twoFAQrCode ? (
                          <div className="flex justify-center md:justify-start">
                            <div
                              className="p-3 rounded-xl bg-white"
                              style={{
                                boxShadow:
                                  '0 0 0 1px rgba(20, 241, 149, 0.3), 0 0 32px -8px rgba(20, 241, 149, 0.45)',
                              }}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={twoFAQrCode}
                                alt="2FA QR code"
                                width={180}
                                height={180}
                                className="block w-[180px] h-[180px]"
                              />
                            </div>
                          </div>
                        ) : (
                          <div className="w-[180px] h-[180px] rounded-xl bg-[var(--bg-elevated)] border border-[var(--border)] flex items-center justify-center">
                            <div className="w-5 h-5 rounded-full border-2 border-[var(--border)] border-t-atlas-400 animate-spin" />
                          </div>
                        )}
                        <div className="space-y-3 min-w-0">
                          <div>
                            <div className="text-xs uppercase tracking-widest text-atlas-300/80 mb-1">
                              Step 1 · Scan
                            </div>
                            <p className="text-sm text-[var(--text-secondary)] font-light leading-relaxed">
                              Open an authenticator app (Google Authenticator, 1Password, Authy…)
                              and scan this QR code.
                            </p>
                          </div>
                          {twoFASecret && (
                            <div>
                              <div className="text-xs uppercase tracking-widest text-[var(--text-muted)] mb-1">
                                Can&apos;t scan? Manual key
                              </div>
                              <div className="flex items-center gap-2 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2">
                                <code className="flex-1 font-mono text-[11px] text-[var(--text)] break-all">
                                  {twoFASecret}
                                </code>
                                <button
                                  type="button"
                                  onClick={handleCopy2FASecret}
                                  className="text-[11px] px-2 py-1 rounded-md border border-atlas-500/25 hover:border-atlas-400/50 text-atlas-300 hover:text-atlas-200 transition-all shrink-0"
                                >
                                  {twoFASecretCopied ? 'Copied' : 'Copy'}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="space-y-3">
                        <div className="text-xs uppercase tracking-widest text-atlas-300/80">
                          Step 2 · Verify
                        </div>
                        <Field label="6-digit code from your authenticator">
                          <Input
                            type="text"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            value={enable2FACode}
                            onChange={(e) =>
                              setEnable2FACode(e.target.value.replace(/\D/g, '').slice(0, 6))
                            }
                            placeholder="000000"
                            maxLength={6}
                          />
                        </Field>
                      </div>

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleEnable2FAConfirm}
                          disabled={toggling2FA || enable2FACode.length !== 6}
                          className="flex-1 py-3 rounded-xl text-sm font-light disabled:opacity-50 text-white transition-all"
                          style={{
                            background:
                              'linear-gradient(180deg, rgba(20, 241, 149, 0.38) 0%, rgba(20, 241, 149, 0.14) 100%)',
                            boxShadow:
                              'inset 0 0 0 1px rgba(20, 241, 149, 0.48), inset 0 1px 0 rgba(255,255,255,0.08)',
                          }}
                        >
                          {toggling2FA ? 'Verifying...' : 'Verify & Enable 2FA'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEnable2FAStep('idle');
                            setEnable2FACode('');
                            setTwoFAQrCode(null);
                            setTwoFASecret(null);
                          }}
                          className="px-4 py-3 rounded-xl text-sm font-light border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] transition-all"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Password ── */}
                <div className="profile-content-card">
                  <SectionHeader
                    title="Password"
                    subtitle="Change your password via a secure email reset link."
                  />
                  <Alert type="success" msg={pwMsg} />
                  <Alert type="error" msg={pwErr} />

                  <div className="flex items-center justify-between p-4 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border)]">
                    <div className="min-w-0">
                      <div className="text-sm font-light text-[var(--text)] mb-0.5">
                        {pwStep === 'sent' ? 'Reset link sent' : 'Password reset'}
                      </div>
                      <div className="text-xs text-[var(--text-muted)]">
                        {pwStep === 'sent'
                          ? `Check ${userEmail || 'your inbox'} for instructions.`
                          : 'We will email you a one-time link to set a new password.'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleRequestPasswordReset}
                      disabled={pwLoading || !userEmail}
                      className="text-xs px-3 py-1.5 rounded-lg border border-atlas-500/25 hover:border-atlas-500/50 text-atlas-300 hover:text-atlas-200 bg-atlas-500/5 hover:bg-atlas-500/10 transition-all disabled:opacity-50 shrink-0"
                    >
                      {pwLoading
                        ? 'Sending...'
                        : pwStep === 'sent'
                          ? 'Resend link'
                          : 'Send reset link'}
                    </button>
                  </div>
                </div>

                {/* ── Delete Account ── */}
                <div className="profile-content-card">
                  <SectionHeader
                    title="Delete Account"
                    subtitle="Permanently delete your account and all associated data."
                  />

                  {deleteStep === 'idle' && (
                    <div className="space-y-4">
                      <div className="p-4 rounded-xl border border-red-500/15 bg-red-500/5 text-sm text-red-300/80 font-light leading-relaxed">
                        This action is irreversible. All your data, agents, listings, and
                        transaction history will be permanently removed.
                      </div>
                      <button
                        type="button"
                        onClick={() => setDeleteStep('confirm')}
                        className="w-full py-3 rounded-xl border border-red-500/25 hover:border-red-500/40 bg-red-500/5 hover:bg-red-500/10 text-red-400 text-sm font-light transition-all duration-200"
                      >
                        Delete my account
                      </button>
                    </div>
                  )}

                  {deleteStep === 'confirm' && (
                    <div className="space-y-4">
                      <p className="text-sm text-[var(--text-secondary)] font-light">
                        Are you sure? We will send a confirmation code to your email.
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleRequestDeleteAccount}
                          disabled={requestingDelete}
                          className="flex-1 py-3 rounded-xl border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm font-light disabled:opacity-50 transition-all"
                        >
                          {requestingDelete ? 'Sending code...' : 'Yes, send confirmation code'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteStep('idle')}
                          className="px-4 py-3 rounded-xl text-sm font-light border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] transition-all"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {deleteStep === 'otp' && (
                    <form onSubmit={handleDeleteAccount} className="space-y-4">
                      <p className="text-sm text-[var(--text-secondary)] font-light">
                        Enter the confirmation code sent to your email to permanently delete your
                        account.
                      </p>
                      <Alert type="error" msg={secErr} />
                      <Field label="Confirmation Code">
                        <Input
                          type="text"
                          value={deleteOtp}
                          onChange={(e) =>
                            setDeleteOtp(e.target.value.replace(/\D/g, '').slice(0, 6))
                          }
                          placeholder="000000"
                          maxLength={6}
                        />
                      </Field>
                      <div className="flex gap-2">
                        <button
                          type="submit"
                          disabled={deleting || deleteOtp.length !== 6}
                          className="flex-1 py-3 rounded-xl border border-red-500/40 bg-red-500/15 hover:bg-red-500/25 text-red-300 text-sm font-light disabled:opacity-50 transition-all"
                        >
                          {deleting ? 'Deleting...' : 'Permanently delete account'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteStep('idle');
                            setDeleteOtp('');
                          }}
                          className="px-4 py-3 rounded-xl text-sm font-light border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] transition-all"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              </div>
            )}
          </div>
          {/* end profile-content */}
        </div>
      </main>
      <VerificationCodeModal
        open={stepUp.stepUpOpen}
        source={stepUp.stepUpSource}
        onClose={stepUp.dismiss}
        onSubmit={stepUp.submit}
        title="Confirm with your authenticator"
        subtitle={
          stepUp.stepUpMessage ||
          'Enter the 6-digit code from your authenticator app to confirm this change.'
        }
      />
    </div>
  );
}

/**
 * Sidebar panel on the General tab showing the user's rank, total rays,
 * a gradient progress bar to the next threshold, and the full ranked
 * ladder so they can see where the next tier starts.
 */
function RankProgressPanel({ points }: { points: number }) {
  const current = getReputationRank(points);
  const CurrentIcon = current.icon;
  const nextTier = RANK_TIERS[current.tier + 1];
  const nextPoints = nextTier ? nextTier.threshold : null;
  const span = nextPoints ? nextPoints - current.threshold : 0;
  const progress =
    nextPoints && span > 0
      ? Math.min(100, Math.max(0, ((points - current.threshold) / span) * 100))
      : 100;

  return (
    <aside
      className="rounded-xl p-5 sticky top-20"
      style={{
        background: 'var(--bg-card)',
        boxShadow: '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.03)',
      }}
    >
      <div className="flex items-center gap-2 text-[10.5px] uppercase tracking-[0.22em] text-zinc-500 mb-3">
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: current.color, boxShadow: `0 0 6px ${current.color}` }}
        />
        Rank progress
      </div>

      <div className="flex items-center gap-3">
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center"
          style={{
            background: `${current.color}18`,
            boxShadow: `inset 0 0 0 1px ${current.color}55`,
          }}
        >
          <CurrentIcon className="w-5 h-5" style={{ color: current.color }} strokeWidth={1.75} />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
            {nextTier ? 'Current rank' : 'Max rank'}
          </div>
          <div className="text-lg font-light text-white">{current.label}</div>
        </div>
      </div>

      <div className="mt-4 flex items-baseline justify-between">
        <span className="font-mono tabular-nums text-xl text-white">{points.toLocaleString()}</span>
        <span className="text-[11px] text-zinc-500 font-light">rays total</span>
      </div>

      <div className="mt-2">
        <div
          className="h-2 rounded-full overflow-hidden"
          style={{ background: 'rgba(255,255,255,0.05)' }}
        >
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${progress}%`,
              background: 'linear-gradient(90deg, #06B6D4 0%, #14F195 50%, #EC4899 100%)',
              boxShadow: '0 0 10px rgba(20, 241, 149, 0.5)',
            }}
          />
        </div>
        {nextTier ? (
          <div className="mt-1.5 flex items-center justify-between text-[11px] font-light text-zinc-500">
            <span className="text-zinc-400">
              {Math.floor(progress)}% to {nextTier.label}
            </span>
            <span className="font-mono tabular-nums">
              {(nextTier.threshold - points).toLocaleString()} rays to go
            </span>
          </div>
        ) : (
          <div className="mt-1.5 text-[11px] font-light text-[#fbbf24]">
            You&apos;ve hit the top of the ladder.
          </div>
        )}
      </div>

      <div className="mt-5 border-t border-white/[0.06] pt-3 space-y-1">
        {RANK_TIERS.map((tier, i) => {
          const TierIcon = tier.icon;
          const reached = points >= tier.threshold;
          const isCurrent = i === current.tier;
          return (
            <div
              key={tier.rank}
              className="flex items-center gap-2.5 py-1"
              style={{ opacity: reached ? 1 : 0.4 }}
            >
              <div
                className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
                style={{
                  background: isCurrent ? `${tier.color}22` : 'rgba(255,255,255,0.03)',
                  boxShadow: isCurrent
                    ? `inset 0 0 0 1px ${tier.color}`
                    : 'inset 0 0 0 1px rgba(255,255,255,0.06)',
                }}
              >
                <TierIcon
                  className="w-3 h-3"
                  style={{ color: reached ? tier.color : 'var(--text-muted)' }}
                  strokeWidth={2}
                />
              </div>
              <span
                className="text-[11.5px] font-light flex-1"
                style={{
                  color: isCurrent ? 'var(--text)' : reached ? '#d4d4d8' : 'var(--text-muted)',
                }}
              >
                {tier.label}
              </span>
              <span className="text-[10.5px] font-mono tabular-nums text-zinc-500">
                {tier.threshold.toLocaleString()}
              </span>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
