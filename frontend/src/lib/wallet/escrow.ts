/**
 * haggl escrow program (Solana) interaction helpers.
 *
 * The contract holds ETH in escrow until the buyer confirms delivery
 * or a dispute is resolved by the admin.
 */

import { getMetaMaskProvider } from './ethereum';

const ESCROW_ABI = [
  'function deposit(string orderId, address seller) payable',
  'function release(string orderId)',
  'function dispute(string orderId)',
  'function resolve(string orderId, bool refundBuyer)',
  'function admin() view returns (address)',
  'function getOrder(string orderId) view returns (address buyer, address seller, uint256 amount, uint256 createdAt, uint8 status)',
  'function isReleasable(string orderId) view returns (bool)',
  'event Deposited(string indexed orderId, address buyer, address seller, uint256 amount)',
  'event Released(string indexed orderId, address seller, uint256 sellerAmount, uint256 platformFee)',
  'event Disputed(string indexed orderId, address disputedBy)',
  'event Resolved(string indexed orderId, bool refundedBuyer, uint256 amount)',
];

// Escrow statuses matching the Solidity enum
export const EscrowStatus = {
  NONE: 0,
  FUNDED: 1,
  RELEASED: 2,
  DISPUTED: 3,
  RESOLVED: 4,
  REFUNDED: 5,
} as const;

/**
 * Get the configured escrow contract address.
 * Returns empty string if escrow is not configured (falls back to direct payment).
 */
export function getEscrowAddress(): string {
  return process.env.NEXT_PUBLIC_ESCROW_CONTRACT || '';
}

/** Check if escrow mode is enabled */
export function isEscrowEnabled(): boolean {
  return !!getEscrowAddress();
}

/**
 * Deposit ETH into the escrow contract for an order.
 * @returns The transaction hash of the deposit.
 */
export async function escrowDeposit(
  orderId: string,
  sellerAddress: string,
  amountWei: bigint,
): Promise<string> {
  const eth = getMetaMaskProvider();
  if (!eth) throw new Error('MetaMask not found');

  const escrowAddress = getEscrowAddress();
  if (!escrowAddress) throw new Error('Escrow contract not configured');

  const { ethers } = await import('ethers');
  const provider = new ethers.BrowserProvider(eth);
  const signer = await provider.getSigner();
  const contract = new ethers.Contract(escrowAddress, ESCROW_ABI, signer);

  const tx = await contract.deposit(orderId, sellerAddress, { value: amountWei });
  const receipt = await tx.wait();
  return receipt.hash;
}

/**
 * Release escrowed funds to the seller (buyer confirms delivery).
 * @returns The transaction hash of the release.
 */
export async function escrowRelease(orderId: string): Promise<string> {
  const eth = getMetaMaskProvider();
  if (!eth) throw new Error('MetaMask not found');

  const escrowAddress = getEscrowAddress();
  if (!escrowAddress) throw new Error('Escrow contract not configured');

  const { ethers } = await import('ethers');
  const provider = new ethers.BrowserProvider(eth);
  const signer = await provider.getSigner();
  const contract = new ethers.Contract(escrowAddress, ESCROW_ABI, signer);

  const tx = await contract.release(orderId);
  const receipt = await tx.wait();
  return receipt.hash;
}

/**
 * Open a dispute on the escrow contract.
 * @returns The transaction hash.
 */
export async function escrowDispute(orderId: string): Promise<string> {
  const eth = getMetaMaskProvider();
  if (!eth) throw new Error('MetaMask not found');

  const escrowAddress = getEscrowAddress();
  if (!escrowAddress) throw new Error('Escrow contract not configured');

  const { ethers } = await import('ethers');
  const provider = new ethers.BrowserProvider(eth);
  const signer = await provider.getSigner();
  const contract = new ethers.Contract(escrowAddress, ESCROW_ABI, signer);

  const tx = await contract.dispute(orderId);
  const receipt = await tx.wait();
  return receipt.hash;
}

/**
 * Admin resolves a disputed escrow order.
 * refundBuyer = true  → full refund to buyer.
 * refundBuyer = false → pay seller (minus platform fee).
 * @returns The transaction hash of the resolution.
 */
export async function escrowResolve(orderId: string, refundBuyer: boolean): Promise<string> {
  const eth = getMetaMaskProvider();
  if (!eth) throw new Error('MetaMask not found');

  const escrowAddress = getEscrowAddress();
  if (!escrowAddress) throw new Error('Escrow contract not configured');

  const { ethers } = await import('ethers');
  const provider = new ethers.BrowserProvider(eth);
  const signer = await provider.getSigner();
  const contract = new ethers.Contract(escrowAddress, ESCROW_ABI, signer);

  const tx = await contract.resolve(orderId, refundBuyer);
  const receipt = await tx.wait();
  return receipt.hash;
}

/**
 * Query escrow state for an order.
 */
export async function getEscrowOrder(orderId: string) {
  const escrowAddress = getEscrowAddress();
  if (!escrowAddress) return null;

  const { ethers } = await import('ethers');
  const rpcUrl = process.env.NEXT_PUBLIC_ETH_RPC_URL || 'https://mainnet.base.org';
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const contract = new ethers.Contract(escrowAddress, ESCROW_ABI, provider);

  const [buyer, seller, amount, createdAt, status] = await contract.getOrder(orderId);
  return {
    buyer,
    seller,
    amount: amount.toString(),
    createdAt: Number(createdAt),
    status: Number(status),
  };
}
