import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EscrowStatus, OrderStatus } from '@prisma/client';
import { ethers } from 'ethers';

import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

// Mirrors the on-chain enum ordering in HagglEscrow (Solana program — TBD)
// NONE=0, FUNDED=1, RELEASED=2, DISPUTED=3, RESOLVED=4, REFUNDED=5
enum OnChainStatus {
  NONE = 0,
  FUNDED = 1,
  RELEASED = 2,
  DISPUTED = 3,
  RESOLVED = 4,
  REFUNDED = 5,
}

const ESCROW_ABI = [
  'function release(string orderId)',
  'function dispute(string orderId)',
  'function resolve(string orderId, bool refundBuyer)',
  'function getOrder(string orderId) view returns (address buyer, address seller, uint256 amount, uint256 createdAt, uint8 status)',
  'function admin() view returns (address)',
];

const ORDER_INCLUDE = {
  buyer: { select: { id: true, username: true, avatarUrl: true, walletAddress: true } },
  seller: { select: { id: true, username: true, avatarUrl: true, walletAddress: true } },
  listing: { select: { id: true, title: true, type: true, price: true, currency: true } },
} as const;

interface DisputeReason {
  reason?: string;
}

@Injectable()
export class EscrowService {
  private readonly logger = new Logger(EscrowService.name);
  private readonly iface = new ethers.Interface(ESCROW_ABI);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Internal helpers ─────────────────────────────────────────────────────

  private getProvider(): ethers.JsonRpcProvider {
    const rpcUrl = this.config.get<string>('ETH_RPC_URL', 'https://mainnet.base.org');
    return new ethers.JsonRpcProvider(rpcUrl);
  }

  /**
   * Read the escrow contract's on-chain order state.
   * Returns null if the contract has no record for this orderId (status === NONE).
   */
  private async readOnChainOrder(escrowContract: string, orderId: string) {
    const provider = this.getProvider();
    const contract = new ethers.Contract(escrowContract, ESCROW_ABI, provider);
    const [buyer, seller, amount, createdAt, status] = await contract.getOrder(orderId);
    return {
      buyer: String(buyer),
      seller: String(seller),
      amount: BigInt(amount),
      createdAt: Number(createdAt),
      status: Number(status) as OnChainStatus,
    };
  }

  /**
   * Verify that a given tx hash targeted `expectedContract` and called a specific method
   * with the given orderId as its first argument. Returns the decoded args.
   */
  private async verifyTx(params: {
    txHash: string;
    expectedContract: string;
    expectedMethod: 'release' | 'dispute' | 'resolve';
    orderId: string;
    expectedSender?: string; // optional sender check (lowercased comparison)
  }): Promise<{ from: string; args: ethers.Result }> {
    const { txHash, expectedContract, expectedMethod, orderId, expectedSender } = params;
    const provider = this.getProvider();

    const [receipt, tx] = await Promise.all([
      provider.getTransactionReceipt(txHash),
      provider.getTransaction(txHash),
    ]);
    if (!receipt || receipt.status !== 1) {
      throw new BadRequestException('Transaction failed or not found on chain');
    }
    if (!tx) throw new BadRequestException('Transaction not found');

    if (!tx.to || tx.to.toLowerCase() !== expectedContract.toLowerCase()) {
      throw new BadRequestException('Transaction was not sent to the escrow contract');
    }

    let parsed: ethers.TransactionDescription | null = null;
    try {
      parsed = this.iface.parseTransaction({ data: tx.data, value: tx.value });
    } catch {
      /* parsed stays null */
    }
    if (!parsed || parsed.name !== expectedMethod) {
      throw new BadRequestException(
        `Transaction does not call ${expectedMethod}() on the escrow contract`,
      );
    }

    const calledOrderId = String(parsed.args[0] ?? '');
    if (calledOrderId !== orderId) {
      throw new BadRequestException('Transaction is for a different orderId');
    }

    if (expectedSender && tx.from.toLowerCase() !== expectedSender.toLowerCase()) {
      throw new BadRequestException('Transaction was not signed by the expected wallet');
    }

    return { from: tx.from, args: parsed.args };
  }

  private async loadOrder(orderId: string) {
    const order = await this.prisma.marketPurchase.findUnique({
      where: { id: orderId },
      include: ORDER_INCLUDE,
    });
    if (!order) throw new NotFoundException('Order not found');
    if (!order.escrowContract || order.escrowStatus === 'NONE') {
      throw new BadRequestException('Order is not using escrow');
    }
    return order;
  }

  // ── Public: release ──────────────────────────────────────────────────────

  /**
   * Buyer has already called escrow.release() on chain. We verify the tx and
   * promote the order to COMPLETED + RELEASED.
   */
  async confirmRelease(orderId: string, userId: string, txHash: string) {
    if (!txHash) throw new BadRequestException('Release tx hash is required');

    const order = await this.loadOrder(orderId);
    if (order.buyerId !== userId) {
      throw new ForbiddenException('Only the buyer can release escrow');
    }
    if (order.escrowStatus !== 'FUNDED') {
      throw new BadRequestException(`Escrow is not FUNDED (current: ${order.escrowStatus})`);
    }

    await this.verifyTx({
      txHash,
      expectedContract: order.escrowContract as string,
      expectedMethod: 'release',
      orderId,
    });

    // Double-check on-chain state landed as RELEASED
    const onChain = await this.readOnChainOrder(order.escrowContract as string, orderId);
    if (onChain.status !== OnChainStatus.RELEASED) {
      throw new BadRequestException(
        `On-chain escrow status is ${OnChainStatus[onChain.status]}, expected RELEASED`,
      );
    }

    const updated = await this.prisma.marketPurchase.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.COMPLETED,
        escrowStatus: EscrowStatus.RELEASED,
        escrowReleaseTx: txHash,
        escrowResolvedAt: new Date(),
        completedAt: new Date(),
      },
      include: ORDER_INCLUDE,
    });

    try {
      await this.notifications.create({
        userId: updated.sellerId,
        type: 'MARKET_ORDER_COMPLETED',
        title: `Escrow released for "${updated.listing.title}"`,
        body: 'Funds are on their way to your wallet.',
        url: `/orders/${updated.id}`,
        meta: { orderId: updated.id, listingId: updated.listingId, txHash },
      });
    } catch {
      /* notifications must never block the flow */
    }

    return updated;
  }

  // ── Public: dispute ──────────────────────────────────────────────────────

  /**
   * Either party has called escrow.dispute() on chain. We verify and flag the order.
   */
  async confirmDispute(
    orderId: string,
    userId: string,
    txHash: string,
    payload: DisputeReason = {},
  ) {
    if (!txHash) throw new BadRequestException('Dispute tx hash is required');

    const order = await this.loadOrder(orderId);
    if (order.buyerId !== userId && order.sellerId !== userId) {
      throw new ForbiddenException('Only the buyer or seller can dispute');
    }
    if (order.escrowStatus !== 'FUNDED') {
      throw new BadRequestException(`Escrow is not FUNDED (current: ${order.escrowStatus})`);
    }
    if (order.status === 'COMPLETED' || order.status === 'DISPUTED') {
      throw new BadRequestException(`Order is already ${order.status}`);
    }

    await this.verifyTx({
      txHash,
      expectedContract: order.escrowContract as string,
      expectedMethod: 'dispute',
      orderId,
    });

    const onChain = await this.readOnChainOrder(order.escrowContract as string, orderId);
    if (onChain.status !== OnChainStatus.DISPUTED) {
      throw new BadRequestException(
        `On-chain escrow status is ${OnChainStatus[onChain.status]}, expected DISPUTED`,
      );
    }

    const reason = payload.reason?.trim().slice(0, 2000);

    const updated = await this.prisma.marketPurchase.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.DISPUTED,
        escrowStatus: EscrowStatus.DISPUTED,
        escrowDisputedAt: new Date(),
      },
      include: ORDER_INCLUDE,
    });

    if (reason) {
      await this.prisma.orderMessage.create({
        data: {
          orderId,
          senderId: userId,
          content: `[DISPUTE OPENED] ${reason}`,
        },
      });
    }

    const recipientId = userId === updated.buyerId ? updated.sellerId : updated.buyerId;
    try {
      await this.notifications.create({
        userId: recipientId,
        type: 'SYSTEM',
        title: `Dispute opened on "${updated.listing.title}"`,
        body: reason
          ? `Reason: ${reason.slice(0, 160)}`
          : 'The other party opened a dispute. An admin will review.',
        url: `/orders/${updated.id}`,
        meta: { orderId: updated.id, listingId: updated.listingId, openedBy: userId, txHash },
      });
    } catch {
      /* ignore */
    }

    return updated;
  }

  // ── Public: admin resolve ────────────────────────────────────────────────

  async listDisputes() {
    return this.prisma.marketPurchase.findMany({
      where: { escrowStatus: EscrowStatus.DISPUTED },
      orderBy: { escrowDisputedAt: 'desc' },
      include: ORDER_INCLUDE,
    });
  }

  /**
   * Admin resolves a disputed order.
   * The admin must have already called escrow.resolve(orderId, refundBuyer) on chain.
   */
  async resolveDispute(params: {
    orderId: string;
    adminId: string;
    refundBuyer: boolean;
    txHash: string;
    note?: string;
  }) {
    const { orderId, adminId, refundBuyer, txHash, note } = params;
    if (!txHash) throw new BadRequestException('Resolution tx hash is required');

    const order = await this.loadOrder(orderId);
    if (order.escrowStatus !== 'DISPUTED') {
      throw new BadRequestException(`Order is not DISPUTED (current: ${order.escrowStatus})`);
    }

    // Verify the admin called resolve(orderId, refundBuyer) on the correct contract.
    const { args } = await this.verifyTx({
      txHash,
      expectedContract: order.escrowContract as string,
      expectedMethod: 'resolve',
      orderId,
    });

    const chainRefundBuyer = Boolean(args[1]);
    if (chainRefundBuyer !== refundBuyer) {
      throw new BadRequestException(
        `refundBuyer mismatch: tx decoded ${chainRefundBuyer}, body says ${refundBuyer}`,
      );
    }

    // Optional: verify the sender matches the contract's admin address.
    try {
      const provider = this.getProvider();
      const contract = new ethers.Contract(order.escrowContract as string, ESCROW_ABI, provider);
      const onChainAdmin: string = await contract.admin();
      const tx = await provider.getTransaction(txHash);
      if (tx && onChainAdmin.toLowerCase() !== tx.from.toLowerCase()) {
        throw new BadRequestException('Resolve tx was not sent by the escrow admin wallet');
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.warn(`Could not cross-check escrow admin address: ${(err as Error).message}`);
    }

    const onChain = await this.readOnChainOrder(order.escrowContract as string, orderId);
    const expected = refundBuyer ? OnChainStatus.REFUNDED : OnChainStatus.RESOLVED;
    if (onChain.status !== expected) {
      throw new BadRequestException(
        `On-chain status is ${OnChainStatus[onChain.status]}, expected ${OnChainStatus[expected]}`,
      );
    }

    const updated = await this.prisma.marketPurchase.update({
      where: { id: orderId },
      data: {
        escrowStatus: refundBuyer ? EscrowStatus.REFUNDED : EscrowStatus.RESOLVED,
        escrowReleaseTx: txHash,
        escrowResolvedAt: new Date(),
        // Seller wins → order moves to COMPLETED. Buyer wins (refund) → keep DISPUTED flag off
        // and close the order as COMPLETED so it drops out of active queues either way.
        status: OrderStatus.COMPLETED,
        completedAt: new Date(),
      },
      include: ORDER_INCLUDE,
    });

    if (note?.trim()) {
      await this.prisma.orderMessage.create({
        data: {
          orderId,
          senderId: adminId,
          content: `[ADMIN RESOLUTION] ${refundBuyer ? 'Refunded buyer.' : 'Paid seller.'} ${note.trim().slice(0, 1800)}`,
        },
      });
    }

    const title = refundBuyer
      ? `Dispute resolved: refund issued for "${updated.listing.title}"`
      : `Dispute resolved: payment released on "${updated.listing.title}"`;

    const body = refundBuyer
      ? 'The admin refunded the buyer. Funds have been returned on chain.'
      : 'The admin released funds to the seller.';

    await Promise.all(
      [updated.buyerId, updated.sellerId].map(async (uid) => {
        try {
          await this.notifications.create({
            userId: uid,
            type: 'SYSTEM',
            title,
            body,
            url: `/orders/${updated.id}`,
            meta: {
              orderId: updated.id,
              listingId: updated.listingId,
              refundBuyer,
              resolvedBy: adminId,
              txHash,
            },
          });
        } catch {
          /* ignore */
        }
      }),
    );

    return updated;
  }
}
