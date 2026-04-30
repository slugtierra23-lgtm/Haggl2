'use client';

import { Interface, parseUnits } from 'ethers';

import { api } from '@/lib/api/client';

// Minimal ERC-20 Transfer ABI fragment — just enough to encode the
// single call we need from the repo / listing purchase flow.
const ERC20_TRANSFER_IFACE = new Interface([
  'function transfer(address to, uint256 amount) returns (bool)',
]);

export interface HagglTokenConfig {
  /** ERC-20 contract address on Base (0x…). */
  address: string;
  /** USD price per 1 ATLAS — used to convert USD listing prices to token units. */
  usdPrice: number;
  /** Token decimals. Defaults to 18 if unset (most ERC-20s on Base). */
  decimals?: number;
}

/**
 * Synchronous fast-path: read ATLAS token config from NEXT_PUBLIC_*
 * env vars. Returns null when any var is missing or malformed —
 * callers should fall back to {@link loadHagglTokenConfig}, which
 * additionally fetches the backend's live config when env is not set.
 *
 * Kept for any caller that runs before async work is OK (none exist
 * today, but the export stays as a stable API).
 */
export function getHagglTokenConfig(): HagglTokenConfig | null {
  const address = process.env.NEXT_PUBLIC_HAGGL_TOKEN_CONTRACT;
  const usdPriceRaw = process.env.NEXT_PUBLIC_HAGGL_USD_PRICE;
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
  const usdPrice = usdPriceRaw ? Number(usdPriceRaw) : NaN;
  if (!Number.isFinite(usdPrice) || usdPrice <= 0) return null;
  const decimalsRaw = process.env.NEXT_PUBLIC_HAGGL_TOKEN_DECIMALS;
  const decimals = decimalsRaw ? Number(decimalsRaw) : 18;
  return {
    address,
    usdPrice,
    decimals: Number.isFinite(decimals) && decimals > 0 ? decimals : 18,
  };
}

// ─── Async loader with backend fallback ─────────────────────────────────
//
// When the NEXT_PUBLIC_* env vars aren't set on the deploy (the
// common case — we'd rather single-source the contract on Render),
// fetch the live config from the backend's /token/haggl endpoint.
// That endpoint already returns the deployed contract address and
// the live DexScreener priceUsd, both of which we need to quote
// purchases in ATLAS units.
//
// Module-scoped promise cache keeps us to a single round-trip for
// the lifetime of the page, even if multiple callsites await
// concurrently (modal opens fire 1–2 calls per purchase flow).

interface HagglStatsResponse {
  contract?: string | null;
  priceUsd?: number | null;
}

const REMOTE_TTL_MS = 60_000;
let remoteCache: { value: HagglTokenConfig | null; at: number } | null = null;
let inflight: Promise<HagglTokenConfig | null> | null = null;

async function fetchRemoteConfig(): Promise<HagglTokenConfig | null> {
  try {
    const stats = await api.get<HagglStatsResponse>('/token/haggl');
    const address = stats?.contract ?? null;
    const priceUsd = typeof stats?.priceUsd === 'number' ? stats.priceUsd : null;
    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
    if (!priceUsd || !(priceUsd > 0)) return null;
    return { address, usdPrice: priceUsd, decimals: 18 };
  } catch {
    return null;
  }
}

/**
 * Resolve the ATLAS token config. Order of precedence:
 *   1. NEXT_PUBLIC_* env vars (sync, no network)
 *   2. Backend /token/haggl endpoint (cached for 60s in-process)
 *
 * Returns null when neither source has a valid contract + price —
 * callers must hide the ATLAS payment option in that case so the
 * user only sees ETH.
 */
export async function loadHagglTokenConfig(): Promise<HagglTokenConfig | null> {
  const fromEnv = getHagglTokenConfig();
  if (fromEnv) return fromEnv;

  const cached = remoteCache;
  if (cached && Date.now() - cached.at < REMOTE_TTL_MS) {
    return cached.value;
  }

  if (inflight) return inflight;

  inflight = fetchRemoteConfig().then((value) => {
    remoteCache = { value, at: Date.now() };
    inflight = null;
    return value;
  });
  return inflight;
}

/**
 * Compute the token amount in base units for a given USD price.
 * `usd / usdPrice` tokens, rounded up in the last base unit so the
 * seller never receives fractionally less than quoted due to rounding.
 */
export function usdToTokenUnits(usd: number, cfg: HagglTokenConfig): bigint {
  if (!Number.isFinite(usd) || usd <= 0) {
    throw new Error('Invalid USD amount');
  }
  const tokens = usd / cfg.usdPrice;
  // Represent tokens with 12 digits of precision before parseUnits to
  // avoid losing fractional pennies in the conversion.
  const asString = tokens.toFixed(12);
  return parseUnits(asString, cfg.decimals ?? 18);
}

/** Encode `transfer(to, amount)` calldata for eth_sendTransaction. */
export function encodeErc20Transfer(to: string, amount: bigint): string {
  return ERC20_TRANSFER_IFACE.encodeFunctionData('transfer', [to, amount]);
}
