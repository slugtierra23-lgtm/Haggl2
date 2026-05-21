'use client';

import { BrowserProvider, Eip1193Provider } from 'ethers';

import { api } from '@/lib/api/client';

interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener: (event: string, handler: (...args: unknown[]) => void) => void;
  isMetaMask?: boolean;
  isPhantom?: boolean;
  providers?: EthereumProvider[];
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
    phantom?: { ethereum?: EthereumProvider };
  }
}

/**
 * Returns the MetaMask-specific provider, even when multiple wallets are installed.
 * When Phantom + MetaMask coexist, both inject into window.ethereum. The EIP-5749
 * multi-provider standard exposes them in window.ethereum.providers[].
 * We pick the one that is MetaMask (isMetaMask=true) and NOT Phantom (isPhantom!=true).
 */
export function getMetaMaskProvider(): EthereumProvider | null {
  if (typeof window === 'undefined' || !window.ethereum) return null;

  const eth = window.ethereum;

  // Multi-wallet scenario: providers array present (EIP-5749)
  if (eth.providers && eth.providers.length > 0) {
    const mm = eth.providers.find((p) => p.isMetaMask && !p.isPhantom);
    return mm ?? null;
  }

  // Single wallet: ensure it's MetaMask and not Phantom masquerading
  if (eth.isMetaMask && !eth.isPhantom) return eth;

  return null;
}

function parseMetaMaskError(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as { code?: number }).code;
    if (code === 4001) return 'Connection rejected. You cancelled the request in MetaMask.';
    if (code === -32603) return 'MetaMask internal error. Make sure your wallet is unlocked.';
    if (code === 4100) return 'MetaMask is locked. Please unlock your wallet and try again.';
    if (err.message.includes('User rejected'))
      return 'Connection rejected. You cancelled the request in MetaMask.';
    if (err.message.includes('pending'))
      return 'MetaMask has a pending request. Open MetaMask and resolve it.';
    if (err.message.includes('Cannot connect')) return err.message;
    return err.message;
  }
  return 'Unknown MetaMask error.';
}

export async function connectMetaMask(): Promise<void> {
  const mmProvider = getMetaMaskProvider();
  if (!mmProvider) {
    throw new Error('MetaMask is not installed.');
  }

  const provider = new BrowserProvider(mmProvider as Eip1193Provider);

  let accounts: string[];
  try {
    accounts = (await provider.send('eth_requestAccounts', [])) as string[];
  } catch (err) {
    throw new Error(parseMetaMaskError(err));
  }

  if (!accounts || accounts.length === 0) {
    throw new Error('No accounts found. Create an account in MetaMask first.');
  }

  const address = accounts[0];

  let nonceData: { nonce: string; message: string };
  try {
    nonceData = await api.post<{ nonce: string; message: string }>('/auth/nonce/ethereum', {
      address,
    });
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Failed to get nonce from server.');
  }

  let signature: string;
  try {
    const signer = await provider.getSigner();
    signature = await signer.signMessage(nonceData.message);
  } catch (err) {
    throw new Error(parseMetaMaskError(err));
  }

  try {
    await api.post('/auth/verify/ethereum', {
      address,
      signature,
      nonce: nonceData.nonce,
    });
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Signature verification failed.');
  }
}

export function isMetaMaskInstalled(): boolean {
  return getMetaMaskProvider() !== null;
}

/**
 * Phantom — its EVM provider is published on `window.phantom.ethereum`
 * (and can also coexist on `window.ethereum` via EIP-5749). We grab the
 * dedicated namespaced one when available so the choice is explicit.
 * On haggl we use Phantom in EVM mode to sign Base transactions.
 */
export function getPhantomProvider(): EthereumProvider | null {
  if (typeof window === 'undefined') return null;

  if (window.phantom?.ethereum) return window.phantom.ethereum;

  const eth = window.ethereum;
  if (!eth) return null;
  if (eth.providers && eth.providers.length > 0) {
    const ph = eth.providers.find((p) => p.isPhantom);
    return ph ?? null;
  }
  if (eth.isPhantom) return eth;
  return null;
}

function parsePhantomError(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as { code?: number }).code;
    if (code === 4001) return 'Connection rejected. You cancelled the request in Phantom.';
    if (code === -32603) return 'Phantom internal error. Make sure your wallet is unlocked.';
    if (err.message.includes('User rejected'))
      return 'Connection rejected. You cancelled the request in Phantom.';
    return err.message;
  }
  return 'Unknown Phantom error.';
}

export async function connectPhantom(): Promise<void> {
  const phProvider = getPhantomProvider();
  if (!phProvider) {
    throw new Error('Phantom is not installed.');
  }

  const provider = new BrowserProvider(phProvider as Eip1193Provider);

  let accounts: string[];
  try {
    accounts = (await provider.send('eth_requestAccounts', [])) as string[];
  } catch (err) {
    throw new Error(parsePhantomError(err));
  }

  if (!accounts || accounts.length === 0) {
    throw new Error('No accounts found. Unlock Phantom and switch to an EVM account first.');
  }

  const address = accounts[0];

  let nonceData: { nonce: string; message: string };
  try {
    nonceData = await api.post<{ nonce: string; message: string }>('/auth/nonce/ethereum', {
      address,
    });
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Failed to get nonce from server.');
  }

  let signature: string;
  try {
    const signer = await provider.getSigner();
    signature = await signer.signMessage(nonceData.message);
  } catch (err) {
    throw new Error(parsePhantomError(err));
  }

  try {
    await api.post('/auth/verify/ethereum', {
      address,
      signature,
      nonce: nonceData.nonce,
    });
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Signature verification failed.');
  }
}

export function isPhantomInstalled(): boolean {
  return getPhantomProvider() !== null;
}
