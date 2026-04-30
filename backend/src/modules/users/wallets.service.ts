import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { WalletProvider } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { invalidateUserCache } from '../auth/strategies/jwt.strategy';

const HEX_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const VALID_PROVIDERS = new Set<WalletProvider>([
  'METAMASK',
  'WALLETCONNECT',
  'COINBASE',
  'RAINBOW',
  'UNISWAP',
  'OTHER',
]);

@Injectable()
export class WalletsService {
  constructor(private readonly prisma: PrismaService) {}

  private normalize(address: string): string {
    if (!HEX_ADDRESS.test(address)) {
      throw new BadRequestException('Invalid wallet address');
    }
    return address.toLowerCase();
  }

  /**
   * Return the user's linked wallets, ordered with the primary first and then
   * by creation time. Also guarantees a row exists for the legacy
   * `users.walletAddress` primary so the UI never has an empty list when a
   * wallet is in fact configured.
   */
  async listWallets(userId: string) {
    const [wallets, user] = await Promise.all([
      this.prisma.userWallet.findMany({
        where: { userId },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { walletAddress: true },
      }),
    ]);

    // Self-heal: backfill the primary row if a user has a walletAddress but no
    // UserWallet row for it yet.
    if (user?.walletAddress && !wallets.some((w) => w.address === user.walletAddress)) {
      const created = await this.prisma.userWallet.create({
        data: {
          userId,
          address: user.walletAddress,
          provider: 'METAMASK',
          isPrimary: wallets.every((w) => !w.isPrimary),
        },
      });
      wallets.unshift(created);
    }

    return wallets;
  }

  async addWallet(
    userId: string,
    input: { address: string; provider?: string; label?: string; makePrimary?: boolean },
  ) {
    const address = this.normalize(input.address);
    const provider: WalletProvider =
      input.provider && VALID_PROVIDERS.has(input.provider.toUpperCase() as WalletProvider)
        ? (input.provider.toUpperCase() as WalletProvider)
        : 'OTHER';

    // Ensure the address isn't already linked to another user — otherwise one
    // person could hijack another's proof-of-ownership.
    const owningUser = await this.prisma.user.findFirst({
      where: {
        OR: [{ walletAddress: address }, { linkedWallets: { some: { address } } }],
        NOT: { id: userId },
      },
      select: { id: true },
    });
    if (owningUser) {
      throw new ConflictException('This wallet is already linked to another account');
    }

    const existing = await this.prisma.userWallet.findUnique({
      where: { userId_address: { userId, address } },
    });
    if (existing) {
      throw new ConflictException('This wallet is already linked to your account');
    }

    const existingCount = await this.prisma.userWallet.count({ where: { userId } });
    const makePrimary = input.makePrimary === true || existingCount === 0;

    const wallet = await this.prisma.$transaction(async (tx) => {
      if (makePrimary) {
        await tx.userWallet.updateMany({
          where: { userId, isPrimary: true },
          data: { isPrimary: false },
        });
        await tx.user.update({
          where: { id: userId },
          data: { walletAddress: address },
        });
      }
      return tx.userWallet.create({
        data: {
          userId,
          address,
          provider,
          label: input.label?.slice(0, 60) || null,
          isPrimary: makePrimary,
        },
      });
    });

    invalidateUserCache(userId);
    return wallet;
  }

  async removeWallet(userId: string, walletId: string) {
    const wallet = await this.prisma.userWallet.findUnique({ where: { id: walletId } });
    if (!wallet || wallet.userId !== userId) {
      throw new NotFoundException('Wallet not found');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.userWallet.delete({ where: { id: walletId } });

      if (wallet.isPrimary) {
        // Promote the next-oldest wallet if any remain; otherwise clear the
        // user's primary walletAddress so the session no longer points at a
        // deleted wallet.
        const next = await tx.userWallet.findFirst({
          where: { userId },
          orderBy: { createdAt: 'asc' },
        });
        if (next) {
          await tx.userWallet.update({
            where: { id: next.id },
            data: { isPrimary: true },
          });
          await tx.user.update({
            where: { id: userId },
            data: { walletAddress: next.address },
          });
        } else {
          await tx.user.update({
            where: { id: userId },
            data: { walletAddress: null },
          });
        }
      }
    });

    invalidateUserCache(userId);
    return { success: true };
  }

  async setPrimary(userId: string, walletId: string) {
    const wallet = await this.prisma.userWallet.findUnique({ where: { id: walletId } });
    if (!wallet || wallet.userId !== userId) {
      throw new NotFoundException('Wallet not found');
    }

    await this.prisma.$transaction([
      this.prisma.userWallet.updateMany({
        where: { userId, isPrimary: true },
        data: { isPrimary: false },
      }),
      this.prisma.userWallet.update({
        where: { id: walletId },
        data: { isPrimary: true },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { walletAddress: wallet.address },
      }),
    ]);

    invalidateUserCache(userId);
    return { success: true };
  }

  async updateLabel(userId: string, walletId: string, label: string | null) {
    const wallet = await this.prisma.userWallet.findUnique({ where: { id: walletId } });
    if (!wallet || wallet.userId !== userId) {
      throw new NotFoundException('Wallet not found');
    }
    return this.prisma.userWallet.update({
      where: { id: walletId },
      data: { label: label?.slice(0, 60) || null },
    });
  }
}
