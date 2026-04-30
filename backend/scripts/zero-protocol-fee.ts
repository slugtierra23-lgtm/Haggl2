/**
 * One-shot script: flip the Flaunch RevenueManager's protocol fee
 * to 0% on Base mainnet, so the on-chain split actually matches
 * the "haggl takes 0%" promise the UI now shows.
 *
 * Usage (from backend/):
 *
 *   REVENUE_MANAGER=0xYourRevenueManager \
 *   OWNER_PRIVATE_KEY=0xabc...                       # the deployer / admin
 *   ETH_RPC_URL=https://mainnet.base.org             # or your alchemy url
 *   npx ts-node scripts/zero-protocol-fee.ts
 *
 * Set DRY_RUN=1 first to simulate without sending.
 *
 * The script:
 *   1. Reads the current protocolFeePercent from the contract.
 *   2. Bails early if it's already 0.
 *   3. Calls setProtocolFeePercent(0). Refuses to run if the wallet
 *      isn't the contract owner.
 *   4. Waits for receipt and prints the tx hash.
 *
 * Owner-only and irreversible per call — double-check the address
 * before running.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  formatUnits,
  parseAbi,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

const ABI = parseAbi([
  'function protocolFeePercent() view returns (uint256)',
  'function owner() view returns (address)',
  'function setProtocolFeePercent(uint256 newFee)',
]);

async function main() {
  const rmAddr = process.env.REVENUE_MANAGER as `0x${string}` | undefined;
  const pk = process.env.OWNER_PRIVATE_KEY as `0x${string}` | undefined;
  const rpc = process.env.ETH_RPC_URL ?? 'https://mainnet.base.org';
  const dryRun = process.env.DRY_RUN === '1';

  if (!rmAddr || !/^0x[0-9a-fA-F]{40}$/.test(rmAddr)) {
    throw new Error('REVENUE_MANAGER env var must be a 0x-prefixed address');
  }
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    throw new Error('OWNER_PRIVATE_KEY env var must be a 0x-prefixed 32-byte hex');
  }

  const account = privateKeyToAccount(pk);
  const publicClient = createPublicClient({ chain: base, transport: http(rpc) });
  const walletClient = createWalletClient({
    chain: base,
    transport: http(rpc),
    account,
  });

  console.log('[zero-protocol-fee] target:', rmAddr);
  console.log('[zero-protocol-fee] caller:', account.address);
  console.log('[zero-protocol-fee] rpc:   ', rpc);
  console.log('[zero-protocol-fee] dry  :', dryRun);

  const [owner, current] = await Promise.all([
    publicClient.readContract({ address: rmAddr, abi: ABI, functionName: 'owner' }),
    publicClient.readContract({
      address: rmAddr,
      abi: ABI,
      functionName: 'protocolFeePercent',
    }),
  ]);

  console.log('[zero-protocol-fee] owner :', owner);
  console.log('[zero-protocol-fee] fee   :', current.toString());

  if (owner.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(
      `caller ${account.address} is not the owner ${owner}. Refusing to send.`,
    );
  }

  if (current === 0n) {
    console.log('[zero-protocol-fee] already 0. Nothing to do.');
    return;
  }

  if (dryRun) {
    console.log('[zero-protocol-fee] DRY_RUN — would call setProtocolFeePercent(0)');
    return;
  }

  console.log('[zero-protocol-fee] sending tx…');
  const hash = await walletClient.writeContract({
    address: rmAddr,
    abi: ABI,
    functionName: 'setProtocolFeePercent',
    args: [0n],
  });
  console.log('[zero-protocol-fee] tx     :', hash);
  console.log('[zero-protocol-fee] waiting for confirmation…');

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log('[zero-protocol-fee] block  :', receipt.blockNumber.toString());
  console.log('[zero-protocol-fee] status :', receipt.status);
  console.log(
    '[zero-protocol-fee] gas    :',
    formatUnits(receipt.gasUsed * (receipt.effectiveGasPrice ?? 0n), 18),
    'ETH',
  );

  const after = await publicClient.readContract({
    address: rmAddr,
    abi: ABI,
    functionName: 'protocolFeePercent',
  });
  console.log('[zero-protocol-fee] new fee:', after.toString());
}

main().catch((err) => {
  console.error('[zero-protocol-fee] failed:', err);
  process.exit(1);
});
