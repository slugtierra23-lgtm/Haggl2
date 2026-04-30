import { randomInt } from 'crypto';

import {
  Injectable,
  UnauthorizedException,
  Logger,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as QRCode from 'qrcode';
import * as speakeasy from 'speakeasy';
import { v4 as uuidv4 } from 'uuid';

import { encryptToken } from '../../common/crypto/token-cipher.util';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { EmailService } from '../email/email.service';
import { UsersService } from '../users/users.service';

import { StepUpService } from './step-up.service';
import { invalidateUserCache } from './strategies/jwt.strategy';

export interface JwtPayload {
  sub: string;
  username?: string;
  role: string;
  iat?: number;
  exp?: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly NONCE_TTL = 300; // 5 minutes
  private readonly JWT_SECRET: string;

  /**
   * Grace cache for refresh-token rotation.
   *
   * When a user has multiple tabs open (or the client retries a flaky network
   * call), two concurrent /auth/refresh requests arrive carrying the same jti.
   * The first rotates the token; the second used to see a hash mismatch and
   * revoke the whole session, which is exactly what was kicking users out on
   * reload. Instead, we remember the last rotation for each user for a short
   * window and replay it for any follower that presents the same now-retired
   * jti — nobody has to log in again.
   */
  private readonly refreshGrace = new Map<
    string,
    { retiredJti: string; tokens: AuthTokens; expiresAt: number }
  >();
  private readonly REFRESH_GRACE_MS = 30_000;
  private readonly refreshLocks = new Map<string, Promise<AuthTokens>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    _usersService: UsersService,
    private readonly emailService: EmailService,
    private readonly stepUp: StepUpService,
  ) {
    // Validate JWT_SECRET exists and has minimum length (security-critical)
    const jwtSecret = this.config.get<string>('JWT_SECRET');
    if (!jwtSecret || jwtSecret.length < 32) {
      throw new Error(
        'CRITICAL: JWT_SECRET environment variable must be set and at least 32 characters. Current state is insecure.',
      );
    }
    this.JWT_SECRET = jwtSecret;
  }

  // ── Nonce generation (wallet auth) ────────────────────────────────────────

  async generateNonce(address: string): Promise<string> {
    const nonce = uuidv4();
    const key = `nonce:${address.toLowerCase()}`;
    await this.redis.set(key, nonce, this.NONCE_TTL);
    this.logger.log(`Nonce generated for ${address.slice(0, 8)}...`);
    return nonce;
  }

  async verifyAndConsumeNonce(address: string, nonce: string): Promise<boolean> {
    const key = `nonce:${address.toLowerCase()}`;
    const stored = await this.redis.get(key);

    if (!stored || stored !== nonce) {
      return false;
    }

    // Delete immediately after use (replay attack prevention)
    await this.redis.del(key);
    return true;
  }

  // ── JWT Token Management ─────────────────────────────────────────────────

  async generateTokens(userId: string): Promise<AuthTokens> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const payload: JwtPayload = {
      sub: user.id,
      username: user.username ?? undefined,
      role: user.role,
    };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: this.config.get<string>('JWT_EXPIRES_IN', '15m'),
    });

    // Refresh token is a signed JWT so userId is self-contained (no access_token needed at refresh time)
    const jti = uuidv4();
    const refreshToken = this.jwtService.sign(
      { sub: userId, jti, type: 'refresh' },
      { secret: this.JWT_SECRET, expiresIn: '7d' },
    );
    const hashed = await bcrypt.hash(jti, 10);

    // Store hashed jti for rotation detection
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: hashed },
    });

    this.logger.log(`Tokens generated for user ${userId}`);
    return { accessToken, refreshToken };
  }

  async refreshAccessToken(refreshToken: string): Promise<AuthTokens> {
    // Decode the self-contained refresh JWT to get userId without needing the access_token cookie
    let payload: { sub: string; jti: string; type: string };
    try {
      payload = this.jwtService.verify(refreshToken, { secret: this.JWT_SECRET });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const userId = payload.sub;

    // If another tab just rotated with this exact jti, replay that rotation's
    // result so we don't nuke the session in a concurrent-refresh race.
    const grace = this.refreshGrace.get(userId);
    if (grace && grace.retiredJti === payload.jti && grace.expiresAt > Date.now()) {
      return grace.tokens;
    }

    // Serialize concurrent refreshes for the same user — only the first does
    // the DB work, followers await the same promise.
    const inflight = this.refreshLocks.get(userId);
    if (inflight) return inflight;

    const work = (async () => {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user || !user.refreshToken) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const isValid = await bcrypt.compare(payload.jti, user.refreshToken);
      if (!isValid) {
        // Jti doesn't match AND it's not a replayable race — treat as stale
        // and force a re-login, but don't revoke other active sessions.
        throw new UnauthorizedException('Invalid refresh token');
      }

      const tokens = await this.generateTokens(userId);
      this.refreshGrace.set(userId, {
        retiredJti: payload.jti,
        tokens,
        expiresAt: Date.now() + this.REFRESH_GRACE_MS,
      });
      return tokens;
    })();

    this.refreshLocks.set(userId, work);
    try {
      return await work;
    } finally {
      this.refreshLocks.delete(userId);
    }
  }

  async revokeAllTokens(userId: string): Promise<void> {
    // updateMany is a no-op when the user was already deleted instead of
    // throwing P2025 — logout should never 500 on a missing-user edge case.
    await this.prisma.user.updateMany({
      where: { id: userId },
      data: { refreshToken: null },
    });
    this.refreshGrace.delete(userId);
    this.refreshLocks.delete(userId);
    this.logger.warn(`All tokens revoked for user ${userId}`);
  }

  async validateToken(token: string): Promise<JwtPayload> {
    try {
      return this.jwtService.verify<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Generate a unique 4-digit user tag (#1000–#9999) */
  private async generateUserTag(): Promise<string> {
    for (let i = 0; i < 20; i++) {
      const tag = String(randomInt(1000, 10000));
      const existing = await this.prisma.user.findUnique({ where: { userTag: tag } });
      if (!existing) return tag;
    }
    // Fallback to 5 digits if 4-digit pool is saturated
    for (let i = 0; i < 10; i++) {
      const tag = String(randomInt(10000, 100000));
      const existing = await this.prisma.user.findUnique({ where: { userTag: tag } });
      if (!existing) return tag;
    }
    throw new ConflictException('Unable to generate user tag — please try again');
  }

  // ── Email / Password Auth ─────────────────────────────────────────────────

  async registerWithEmail(data: {
    email: string;
    username: string;
    password: string;
    gender?: string;
    occupation?: string;
  }): Promise<AuthTokens> {
    const email = data.email.toLowerCase().trim();
    const username = data.username.toLowerCase().trim();

    const passwordHash = await bcrypt.hash(data.password, 12);
    const userTag = await this.generateUserTag();

    let user: { id: string };
    try {
      user = await this.prisma.user.create({
        data: {
          email,
          username,
          passwordHash,
          displayName: username,
          userTag,
          gender: data.gender,
          occupation: data.occupation,
        },
      });
    } catch (err: unknown) {
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code: string }).code === 'P2002'
      ) {
        const target = (err as { meta?: { target?: string[] } }).meta?.target;
        if (target?.includes('email')) throw new ConflictException('Email already in use');
        if (target?.includes('username')) throw new ConflictException('Username already taken');
        if (target?.includes('userTag')) throw new ConflictException('Please try again');
        throw new ConflictException('Account already exists');
      }
      throw err;
    }

    this.logger.log(`New email user registered: ${username}`);

    // Send welcome email (fire and forget — don't block registration)
    this.emailService
      .sendWelcomeEmail(email, username)
      .catch((err: Error) =>
        this.logger.warn(`Welcome email failed for ${username}: ${err.message}`),
      );

    return this.generateTokens(user.id);
  }

  async loginWithEmail(data: {
    identifier: string;
    password: string;
  }): Promise<AuthTokens | { twoFactorRequired: true; tempToken: string }> {
    const identifier = data.identifier.toLowerCase().trim();
    const isEmail = identifier.includes('@');
    const user = await (isEmail
      ? this.prisma.user.findUnique({ where: { email: identifier } })
      : this.prisma.user.findUnique({ where: { username: identifier } }));

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(data.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    if (user.isBanned) throw new UnauthorizedException('Account is banned');

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // 2FA required — using TOTP (Authenticator app)
    if (user.twoFactorEnabled) {
      // Single-use jti: verifyLogin2FA atomically deletes it on success,
      // so a stolen/copied tempToken can only mint tokens once.
      const jti = uuidv4();
      await this.redis.set(`2fa_jti:${jti}`, user.id, 600);
      const tempToken = this.jwtService.sign(
        { sub: user.id, scope: 'pending_2fa', jti },
        { expiresIn: '10m' },
      );
      return { twoFactorRequired: true, tempToken };
    }

    return this.generateTokens(user.id);
  }

  async verifyLogin2FA(tempToken: string, code: string): Promise<AuthTokens> {
    let payload: { sub: string; scope: string; jti?: string };
    try {
      payload = this.jwtService.verify<{ sub: string; scope: string; jti?: string }>(tempToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    if (payload.scope !== 'pending_2fa') {
      throw new UnauthorizedException('Invalid token scope');
    }

    // Reject replay: the jti is burnt only on successful verification
    // (see below). A missing/mismatched jti means this tempToken was
    // already consumed or never issued by us.
    if (!payload.jti) {
      throw new UnauthorizedException('Invalid token');
    }
    const jtiKey = `2fa_jti:${payload.jti}`;
    const jtiOwner = await this.redis.get(jtiKey);
    if (!jtiOwner || jtiOwner !== payload.sub) {
      throw new UnauthorizedException('Token has already been used');
    }

    // Get user and their TOTP secret
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { twoFactorSecret: true },
    });

    if (!user || !user.twoFactorSecret) {
      throw new UnauthorizedException('2FA not configured for this user');
    }

    // Brute-force protection: max 5 attempts within the 10-minute code window
    const attemptsKey = `2fa_attempts:${payload.sub}`;
    const attemptsRaw = await this.redis.get(attemptsKey);
    const attempts = attemptsRaw ? parseInt(attemptsRaw, 10) : 0;
    if (attempts >= 5) {
      throw new UnauthorizedException('Too many attempts. Request a new code.');
    }
    await this.redis.set(attemptsKey, String(attempts + 1), 600);

    // Verify TOTP code
    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token: code,
      window: 2,
    });

    if (!verified) {
      throw new UnauthorizedException('Invalid or expired verification code');
    }

    // Burn the jti so the tempToken cannot be replayed, then clear
    // brute-force counter.
    await this.redis.del(jtiKey);
    await this.redis.del(attemptsKey);
    return this.generateTokens(payload.sub);
  }

  // ── 2FA Management ────────────────────────────────────────────────────────

  async request2FAEnable(userId: string): Promise<{ qrCode: string; secret: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.twoFactorEnabled) throw new BadRequestException('2FA is already enabled');

    // Generate TOTP secret
    const secret = speakeasy.generateSecret({
      name: `haggl (${user.email || user.id})`,
      issuer: 'haggl',
      length: 32,
    });

    // Generate QR code
    const qrCode = await QRCode.toDataURL(secret.otpauth_url!);

    // Store secret temporarily in Redis for verification
    await this.redis.set(`2fa_secret:${userId}`, secret.base32, 600); // 10 min

    this.logger.log(`2FA setup initiated for user ${userId}`);
    return { qrCode, secret: secret.base32 };
  }

  async enable2FA(userId: string, code: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.twoFactorEnabled) throw new BadRequestException('2FA is already enabled');

    const secret = await this.redis.get(`2fa_secret:${userId}`);
    if (!secret) throw new BadRequestException('No 2FA setup in progress or code expired');

    // Verify TOTP code
    const verified = speakeasy.totp.verify({
      secret: secret,
      encoding: 'base32',
      token: code,
      window: 2,
    });

    if (!verified) throw new UnauthorizedException('Invalid authenticator code');

    // Store secret in database
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: true,
        twoFactorSecret: secret,
      },
    });

    invalidateUserCache(userId);
    await this.redis.del(`2fa_secret:${userId}`);
    this.logger.log(`2FA enabled for user ${userId}`);
  }

  async disable2FA(userId: string, password: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (!user.twoFactorEnabled) throw new BadRequestException('2FA is not enabled');

    if (user.passwordHash) {
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) throw new UnauthorizedException('Invalid password');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
      },
    });
    invalidateUserCache(userId);
    this.logger.log(`2FA disabled for user ${userId}`);
  }

  // ── Email Change ──────────────────────────────────────────────────────────

  async requestEmailChange(
    userId: string,
    newEmail: string,
    password: string,
    twoFactorCode?: string,
  ): Promise<void> {
    // 2FA step-up before touching the recovery channel. Without this, a
    // compromised password + an unlocked session can silently pivot the
    // account email to an attacker-controlled address.
    await this.stepUp.assert(userId, twoFactorCode);

    const email = newEmail.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (user.passwordHash) {
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) throw new UnauthorizedException('Invalid password');
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('This email is already in use');

    const code = randomInt(100000, 1000000).toString();
    await this.redis.set(`email_change:${userId}`, JSON.stringify({ newEmail: email, code }), 900); // 15 min
    await this.emailService.sendEmailChangeConfirmation(email, code);
    this.logger.log(`Email change requested for user ${userId} → ${email}`);
  }

  async confirmEmailChange(userId: string, code: string): Promise<void> {
    const raw = await this.redis.get(`email_change:${userId}`);
    if (!raw) throw new BadRequestException('No email change pending or code expired');

    let parsed: { newEmail: string; code: string };
    try {
      parsed = JSON.parse(raw) as { newEmail: string; code: string };
    } catch {
      throw new BadRequestException('Invalid email change data — please request a new code');
    }
    const { newEmail, code: stored } = parsed;
    if (stored !== code) throw new UnauthorizedException('Invalid verification code');

    const existing = await this.prisma.user.findUnique({ where: { email: newEmail } });
    if (existing) throw new ConflictException('This email is already in use');

    await this.prisma.user.update({ where: { id: userId }, data: { email: newEmail } });
    invalidateUserCache(userId);
    await this.redis.del(`email_change:${userId}`);
    this.logger.log(`Email changed for user ${userId} → ${newEmail}`);
  }

  // ── Delete Account ────────────────────────────────────────────────────────

  async requestDeleteAccount(userId: string, twoFactorCode?: string): Promise<void> {
    // Require 2FA step-up — account deletion is irreversible, and an
    // email-OTP-only flow lets anyone with brief inbox access nuke
    // the account (which would also release the username for squatting).
    await this.stepUp.assert(userId, twoFactorCode);

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (!user.email)
      throw new BadRequestException('No email address on this account — contact support');

    const code = randomInt(100000, 1000000).toString();
    await this.redis.set(`delete_account:${userId}`, code, 600); // 10 min
    await this.emailService.sendDeleteAccountCode(user.email, code);
    this.logger.log(`Delete account code sent for user ${userId}`);
  }

  async deleteAccount(userId: string, code: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // Verify OTP
    const stored = await this.redis.get(`delete_account:${userId}`);
    if (!stored || stored !== code) {
      throw new UnauthorizedException('Invalid or expired verification code');
    }
    await this.redis.del(`delete_account:${userId}`);

    await this.revokeAllTokens(userId);
    await this.prisma.user.delete({ where: { id: userId } });
    this.logger.warn(`Account deleted: ${userId}`);
  }

  // ── Password Reset ────────────────────────────────────────────────────────

  async requestPasswordReset(identifier: string): Promise<void> {
    const id = identifier.toLowerCase().trim();
    const isEmail = id.includes('@');
    const user = await (isEmail
      ? this.prisma.user.findUnique({ where: { email: id } })
      : this.prisma.user.findUnique({ where: { username: id } }));

    // Always return silently — don't reveal whether the account exists
    if (!user?.email || !user.passwordHash) return;

    const token = uuidv4();
    await this.redis.set(`pwd_reset:${token}`, user.id, 15 * 60); // 15 min

    const frontendUrl = this.config.get<string>('FRONTEND_URL', 'http://localhost:3000');
    const resetUrl = `${frontendUrl}/auth/reset-password?token=${token}`;

    this.emailService
      .sendPasswordResetEmail(user.email, resetUrl)
      .catch((err: Error) =>
        this.logger.warn(`Password reset email failed for ${user.email}: ${err.message}`),
      );
    this.logger.log(`Password reset requested for user ${user.id}`);
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const userId = await this.redis.get(`pwd_reset:${token}`);
    if (!userId) throw new BadRequestException('Invalid or expired reset token');

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    await this.redis.del(`pwd_reset:${token}`);

    // Revoke all existing sessions so old tokens are invalidated
    await this.revokeAllTokens(userId);
    this.logger.log(`Password reset completed for user ${userId}`);
  }

  // ── GitHub Linking ────────────────────────────────────────────────────────

  async linkGitHubToUser(
    userId: string,
    githubProfile: { id: string; login: string; avatar_url: string; accessToken?: string },
  ): Promise<void> {
    const existing = await this.prisma.user.findUnique({
      where: { githubId: githubProfile.id },
    });
    if (existing && existing.id !== userId) {
      throw new ConflictException('This GitHub account is already linked to another user');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        githubId: githubProfile.id,
        githubLogin: githubProfile.login,
        avatarUrl: githubProfile.avatar_url,
        githubToken: githubProfile.accessToken
          ? encryptToken(githubProfile.accessToken)
          : undefined,
      },
    });
    invalidateUserCache(userId);
    this.logger.log(`GitHub linked for user ${userId}: @${githubProfile.login}`);
  }

  async unlinkGitHub(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { githubId: null, githubLogin: null, githubToken: null },
    });
    invalidateUserCache(userId);
    this.logger.log(`GitHub unlinked for user ${userId}`);
  }

  // ── GitHub OAuth ──────────────────────────────────────────────────────────

  async handleGitHubCallback(githubProfile: {
    id: string;
    login: string;
    avatar_url: string;
    bio?: string;
    accessToken?: string;
  }): Promise<AuthTokens> {
    let user = await this.prisma.user.findUnique({
      where: { githubId: githubProfile.id },
    });

    if (!user) {
      // NO auto-linking by username. Previously, if an email-registered
      // user "alice" existed on haggl and someone signed in with GitHub
      // user "alice", we merged the GitHub identity into that account and
      // handed the OAuth caller a session for it — straightforward account
      // takeover (GitHub username != proof of haggl identity).
      //
      // Policy: new githubId → always create a new account. Username
      // collisions get a suffix so the existing account is untouched.
      // Linking an existing haggl account to GitHub must happen via the
      // authenticated /auth/link-github flow.
      let username = githubProfile.login;
      const clash = await this.prisma.user.findUnique({ where: { username } });
      if (clash) {
        // Try a handful of deterministic suffixes before falling back to random
        for (let i = 0; i < 5; i++) {
          const candidate = `${githubProfile.login}-gh${Math.floor(Math.random() * 10000)
            .toString()
            .padStart(4, '0')}`;
          const exists = await this.prisma.user.findUnique({ where: { username: candidate } });
          if (!exists) {
            username = candidate;
            break;
          }
        }
        if (username === githubProfile.login) {
          username = `gh-${githubProfile.id}`;
        }
      }
      const userTag = await this.generateUserTag();
      user = await this.prisma.user.create({
        data: {
          githubId: githubProfile.id,
          githubLogin: githubProfile.login,
          username,
          avatarUrl: githubProfile.avatar_url,
          bio: githubProfile.bio,
          githubToken: githubProfile.accessToken ? encryptToken(githubProfile.accessToken) : null,
          userTag,
        },
      });
      this.logger.log(`New GitHub user created: ${githubProfile.login} (username=${username})`);
    } else {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          githubLogin: githubProfile.login,
          avatarUrl: githubProfile.avatar_url,
          githubToken: githubProfile.accessToken
            ? encryptToken(githubProfile.accessToken)
            : undefined,
          lastLoginAt: new Date(),
        },
      });
    }

    if (user.isBanned) {
      throw new UnauthorizedException('Account is banned');
    }

    return this.generateTokens(user.id);
  }

  // ── Audit Log Helper ──────────────────────────────────────────────────────

  async createAuditLog(params: {
    action: string;
    resource: string;
    resourceId?: string;
    userId?: string;
    ipAddress?: string;
    userAgent?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        action: params.action,
        resource: params.resource,
        resourceId: params.resourceId,
        userId: params.userId,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        metadata: params.metadata as Prisma.InputJsonValue,
      },
    });
  }
}
