'use client';

import type EthereumProviderCls from '@walletconnect/ethereum-provider';

type IEthereumProvider = InstanceType<typeof EthereumProviderCls>;

import { api } from '@/lib/api/client';

// Cached singleton so we don't spin up a new WalletConnect session every time
// the user opens the modal.
let providerPromise: Promise<IEthereumProvider> | null = null;

function getProjectId(): string {
  const id = process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID || '';
  return id.trim();
}

/**
 * Returns true when the app has a valid WalletConnect Cloud project id. The
 * UI uses this to decide whether to offer WalletConnect or fall back to an
 * informative message (the SDK refuses to even open without a project id).
 */
export function isWalletConnectConfigured(): boolean {
  return getProjectId().length > 0;
}

async function loadProvider(): Promise<IEthereumProvider> {
  const projectId = getProjectId();
  if (!projectId) {
    throw new Error(
      'WalletConnect is not configured. Set NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID to enable it.',
    );
  }
  // Dynamic import keeps the ~400 KB SDK out of the critical bundle.
  const mod = await import('@walletconnect/ethereum-provider');
  const provider = await mod.EthereumProvider.init({
    projectId,
    // Base mainnet (primary chain for Atlas payments).
    chains: [8453],
    optionalChains: [1, 10, 137, 42161],
    showQrModal: true,
    metadata: {
      name: 'Atlas',
      description: 'Atlas — AI agent + repo marketplace on Base.',
      url: typeof window !== 'undefined' ? window.location.origin : 'https://haggl.tech',
      icons: ['/icon.png'],
    },
  });
  return provider;
}

export async function getWalletConnectProvider(): Promise<IEthereumProvider> {
  if (!providerPromise) providerPromise = loadProvider();
  return providerPromise;
}

export interface WalletConnectLinkOptions {
  /** Existing account? Use the additional-wallet endpoint. */
  additional?: boolean;
  /** Optional user-supplied label for the wallet row. */
  label?: string;
}

/**
 * Triggers the WalletConnect modal, asks the user to sign the standard
 * Atlas nonce message, and posts to the link endpoint. Mirrors the
 * MetaMask flow in `ethereum.ts`.
 */
export async function linkWalletConnect(
  opts: WalletConnectLinkOptions = {},
): Promise<{ address: string }> {
  const provider = await getWalletConnectProvider();

  // Ensure a session exists (triggers QR modal if not).
  if (!provider.session) {
    await provider.connect();
  }

  const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
  const address = accounts?.[0];
  if (!address) throw new Error('No account returned by WalletConnect.');

  const { nonce, message } = await api.post<{ nonce: string; message: string }>(
    '/auth/link/wallet/nonce',
    { address },
  );

  const signature = (await provider.request({
    method: 'personal_sign',
    params: [message, address],
  })) as string;

  if (opts.additional) {
    await api.post('/auth/link/wallet/additional', {
      address,
      signature,
      nonce,
      provider: 'WALLETCONNECT',
      label: opts.label,
    });
  } else {
    await api.post('/auth/link/wallet', { address, signature, nonce });
  }
  return { address };
}

/** Tear down the WalletConnect session (used by "disconnect" actions). */
export async function disconnectWalletConnect(): Promise<void> {
  try {
    const provider = await getWalletConnectProvider();
    if (provider.session) await provider.disconnect();
  } catch {
    /* ignore — user may just be re-linking after losing the session. */
  }
}
