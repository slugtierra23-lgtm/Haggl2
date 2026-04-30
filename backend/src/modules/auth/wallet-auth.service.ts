import { Injectable, UnauthorizedException, ConflictException, Logger } from '@nestjs/common';
import { WalletProvider } from '@prisma/client';
import { ethers } from 'ethers';

import { PrismaService } from '../../common/prisma/prisma.service';

import { AuthService } from './auth.service';
import { AuthTokens } from './auth.service';
import { invalidateUserCache } from './strategies/jwt.strategy';

const VALID_PROVIDERS = new Set<WalletProvider>([
  'METAMASK',
  'WALLETCONNECT',
  'COINBASE',
  'RAINBOW',
  'UNISWAP',
  'OTHER',
]);

@Injectable()
export class WalletAuthService {
  private readonly logger = new Logger(WalletAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

  // ── MetaMask (Ethereum) Auth ──────────────────────────────────────────────

  async getNonce(address: string): Promise<{ nonce: string; message: string }> {
    const normalized = address.toLowerCase();

    // Validate Ethereum address format
    if (!ethers.isAddress(address)) {
      throw new UnauthorizedException('Invalid Ethereum address');
    }

    const nonce = await this.authService.generateNonce(normalized);
    const message = this.buildSignMessage(normalized, nonce, 'ethereum');

    return { nonce, message };
  }

  async verifyEthereum(
    address: string,
    signature: string,
    nonce: string,
    ipAddress?: string,
  ): Promise<AuthTokens> {
    const normalized = address.toLowerCase();

    if (!ethers.isAddress(address)) {
      throw new UnauthorizedException('Invalid Ethereum address');
    }

    // Verify nonce (also deletes it — replay attack prevention)
    const nonceValid = await this.authService.verifyAndConsumeNonce(normalized, nonce);
    if (!nonceValid) {
      throw new UnauthorizedException('Invalid or expired nonce');
    }

    // Reconstruct the signed message
    const message = this.buildSignMessage(normalized, nonce, 'ethereum');

    // Verify signature
    let recoveredAddress: string;
    try {
      recoveredAddress = ethers.verifyMessage(message, signature);
    } catch {
      throw new UnauthorizedException('Invalid signature');
    }

    if (recoveredAddress.toLowerCase() !== normalized) {
      throw new UnauthorizedException('Signature verification failed');
    }

    // Find or create user
    const user = await this.findOrCreateWalletUser(normalized);

    await this.authService.createAuditLog({
      action: 'LOGIN',
      resource: 'AUTH',
      userId: user.id,
      ipAddress,
      metadata: { method: 'metamask', address: normalized.slice(0, 8) + '...' },
    });

    return this.authService.generateTokens(user.id);
  }

  // ── Link wallet to existing account ──────────────────────────────────────

  async linkWalletToUser(
    userId: string,
    address: string,
    signature: string,
    nonce: string,
  ): Promise<void> {
    if (!userId) throw new UnauthorizedException('Authentication required');
    const normalized = address.toLowerCase();
    if (!ethers.isAddress(address)) throw new UnauthorizedException('Invalid Ethereum address');

    const nonceValid = await this.authService.verifyAndConsumeNonce(normalized, nonce);
    if (!nonceValid) throw new UnauthorizedException('Invalid or expired nonce');

    const message = this.buildSignMessage(normalized, nonce, 'ethereum');
    let recovered: string;
    try {
      recovered = ethers.verifyMessage(message, signature);
    } catch {
      throw new UnauthorizedException('Invalid signature');
    }
    if (recovered.toLowerCase() !== normalized)
      throw new UnauthorizedException('Signature verification failed');

    // Ensure wallet isn't already linked to another account — use transaction to prevent race
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { walletAddress: normalized } });
      if (existing && existing.id !== userId) {
        const isWalletOnly = !existing.email && !existing.githubId;
        if (!isWalletOnly) {
          throw new ConflictException('This wallet is already linked to another account');
        }
        await tx.user.update({ where: { id: existing.id }, data: { walletAddress: null } });
        await tx.userWallet.deleteMany({
          where: { userId: existing.id, address: normalized },
        });
        this.logger.log(
          `Transferred wallet ${normalized.slice(0, 8)}... from wallet-only account ${existing.id} to user ${userId}`,
        );
      }
      await tx.user.update({ where: { id: userId }, data: { walletAddress: normalized } });

      // Keep the UserWallet sidecar in sync so the profile listing always
      // reflects the primary wallet without a second roundtrip.
      await tx.userWallet.updateMany({
        where: { userId, isPrimary: true },
        data: { isPrimary: false },
      });
      await tx.userWallet.upsert({
        where: { userId_address: { userId, address: normalized } },
        create: { userId, address: normalized, provider: 'METAMASK', isPrimary: true },
        update: { isPrimary: true },
      });
    });
    invalidateUserCache(userId);
    this.logger.log(`Wallet linked: ${normalized.slice(0, 8)}... → user ${userId}`);
  }

  /**
   * Link a second (or third...) wallet to an account that already has a
   * primary. Does signature verification but does NOT change the primary
   * walletAddress on the user — the user promotes it explicitly via
   * WalletsService.setPrimary.
   */
  async linkAdditionalWallet(
    userId: string,
    address: string,
    signature: string,
    nonce: string,
    provider?: string,
    label?: string,
  ) {
    if (!userId) throw new UnauthorizedException('Authentication required');
    const normalized = address.toLowerCase();
    if (!ethers.isAddress(address)) throw new UnauthorizedException('Invalid Ethereum address');

    const nonceValid = await this.authService.verifyAndConsumeNonce(normalized, nonce);
    if (!nonceValid) throw new UnauthorizedException('Invalid or expired nonce');

    const message = this.buildSignMessage(normalized, nonce, 'ethereum');
    let recovered: string;
    try {
      recovered = ethers.verifyMessage(message, signature);
    } catch {
      throw new UnauthorizedException('Invalid signature');
    }
    if (recovered.toLowerCase() !== normalized) {
      throw new UnauthorizedException('Signature verification failed');
    }

    const owningUser = await this.prisma.user.findFirst({
      where: {
        OR: [{ walletAddress: normalized }, { linkedWallets: { some: { address: normalized } } }],
        NOT: { id: userId },
      },
      select: { id: true },
    });
    if (owningUser) {
      throw new ConflictException('This wallet is already linked to another account');
    }

    const existing = await this.prisma.userWallet.findUnique({
      where: { userId_address: { userId, address: normalized } },
    });
    if (existing) {
      throw new ConflictException('This wallet is already linked to your account');
    }

    const providerEnum: WalletProvider =
      provider && VALID_PROVIDERS.has(provider.toUpperCase() as WalletProvider)
        ? (provider.toUpperCase() as WalletProvider)
        : 'METAMASK';

    const wallet = await this.prisma.userWallet.create({
      data: {
        userId,
        address: normalized,
        provider: providerEnum,
        label: label?.slice(0, 60) || null,
        isPrimary: false,
      },
    });
    invalidateUserCache(userId);
    this.logger.log(`Additional wallet linked: ${normalized.slice(0, 8)}... → user ${userId}`);
    return wallet;
  }

  async unlinkWallet(userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { walletAddress: true },
      });
      await tx.user.update({ where: { id: userId }, data: { walletAddress: null } });
      if (user?.walletAddress) {
        await tx.userWallet.deleteMany({
          where: { userId, address: user.walletAddress },
        });
      }
    });
    invalidateUserCache(userId);
  }

  // ── Helper Methods ────────────────────────────────────────────────────────

  private async generateUserTag(): Promise<string> {
    for (let i = 0; i < 20; i++) {
      const tag = String(Math.floor(1000 + Math.random() * 9000));
      const existing = await this.prisma.user.findUnique({ where: { userTag: tag } });
      if (!existing) return tag;
    }
    for (let i = 0; i < 10; i++) {
      const tag = String(Math.floor(10000 + Math.random() * 90000));
      const existing = await this.prisma.user.findUnique({ where: { userTag: tag } });
      if (!existing) return tag;
    }
    throw new ConflictException('Unable to generate user tag — please try again');
  }

  private buildSignMessage(address: string, nonce: string, chain: string): string {
    return `Welcome to haggl!\n\nPlease sign this message to authenticate.\n\nChain: ${chain}\nAddress: ${address}\nNonce: ${nonce}\n\nThis request will not trigger any blockchain transaction.`;
  }

  private async findOrCreateWalletUser(address: string) {
    let user = await this.prisma.user.findUnique({
      where: { walletAddress: address },
    });

    if (!user) {
      const userTag = await this.generateUserTag();
      user = await this.prisma.user.create({
        data: {
          walletAddress: address,
          username: `eth_${address.slice(0, 6)}`,
          lastLoginAt: new Date(),
          userTag,
        },
      });
      this.logger.log(`New ethereum wallet user: ${address.slice(0, 8)}...`);
    } else {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });
    }

    if (user.isBanned) {
      throw new UnauthorizedException('Account is banned');
    }

    return user;
  }
}
