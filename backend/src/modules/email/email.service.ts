import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

// ── Shared email utilities ─────────────────────────────────────────────────

function otpBlock(code: string): string {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:28px 0 20px;">
      <tr>
        <td align="center">
          <div style="display:inline-block;background:#fafafa;border:2px solid #e4e4e7;border-radius:14px;padding:20px 48px;">
            <span style="font-family:'Courier New',Courier,monospace;font-size:40px;font-weight:800;letter-spacing:16px;color:#18181b;">${code}</span>
          </div>
        </td>
      </tr>
    </table>`;
}

function bodyWrap(content: string): string {
  return `<div style="padding:36px 40px;">${content}</div>`;
}

// ── Service ────────────────────────────────────────────────────────────────

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private resend: Resend | null = null;
  private from: string;
  private devMode: boolean;
  private appUrl: string;
  private logoUrl: string;

  constructor(private readonly _config: ConfigService) {
    const apiKey = this._config.get<string>('RESEND_API_KEY', '');
    this.from = this._config.get<string>('EMAIL_FROM', 'Bolty <noreply@boltynetwork.xyz>');
    this.appUrl = this._config.get<string>('APP_URL', 'https://bolty.dev');
    this.logoUrl = `${this.appUrl}/bolty-icon.png`;

    if (apiKey) {
      this.resend = new Resend(apiKey);
      this.devMode = false;
      this.logger.log(`Resend email configured (from: ${this.from})`);
    } else {
      this.devMode = true;
      this.logger.warn('RESEND_API_KEY not set. Emails will be printed to the console.');
    }
  }

  private shell(title: string, preheader: string, body: string): string {
    const year = new Date().getFullYear();
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f0f0f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;overflow:hidden;opacity:0;">${preheader}&nbsp;&#8204;&nbsp;&#8204;&nbsp;&#8204;</div>
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:520px;margin:0 auto;">

          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <a href="${this.appUrl}" style="text-decoration:none;">
                <img src="${this.logoUrl}" alt="Bolty" width="96" height="96" style="display:block;border:0;outline:none;" />
              </a>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#ffffff;border-radius:16px;border:1px solid #e4e4e7;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
              ${body}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding:28px 0 8px;">
              <p style="margin:0;color:#a1a1aa;font-size:12px;line-height:1.6;">
                You received this because an action was initiated on your Bolty account.<br/>
                If you didn't request this, you can safely ignore this email.
              </p>
              <p style="margin:10px 0 0;color:#d4d4d8;font-size:11px;">
                &copy; ${year} Bolty &middot; <a href="${this.appUrl}" style="color:#a1a1aa;text-decoration:none;">bolty.dev</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  private async send(to: string, subject: string, html: string, text: string): Promise<void> {
    if (this.devMode || !this.resend) {
      this.logger.log(
        `\n${'─'.repeat(60)}\n` +
          '[EMAIL - DEV MODE]\n' +
          `To:      ${to}\n` +
          `Subject: ${subject}\n` +
          `Body:\n${text}\n` +
          `${'─'.repeat(60)}`,
      );
      return;
    }

    try {
      const { data, error } = await this.resend.emails.send({
        from: this.from,
        to,
        subject,
        html,
        text,
      });
      if (error) {
        this.logger.error(`Failed to send email to ${to}: ${JSON.stringify(error)}`);
        throw new Error(error.message);
      }
      this.logger.log(`Email sent to ${to}: "${subject}" [${data?.id}]`);
    } catch (err) {
      this.logger.error(`Failed to send email to ${to}: ${(err as Error).message}`);
      throw err;
    }
  }

  // ── Welcome ──────────────────────────────────────────────────────────────

  async sendWelcomeEmail(to: string, username: string): Promise<void> {
    const subject = 'Welcome to Bolty';
    const html = this.shell(
      subject,
      `Welcome to Bolty, ${username}!`,
      bodyWrap(`
      <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#09090b;letter-spacing:-0.5px;">Welcome to Bolty</h1>
      <p style="margin:0 0 20px;color:#71717a;font-size:15px;line-height:1.6;">
        Hi <strong style="color:#18181b;">@${username}</strong>, your account is ready.
        You're now part of the AI developer platform built for builders.
      </p>

      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:24px;">
        <tr>
          <td style="background:#fafafa;border:1px solid #e4e4e7;border-radius:12px;padding:20px 24px;">
            <table cellpadding="0" cellspacing="0" role="presentation" width="100%">
              <tr><td style="padding:6px 0;">
                <span style="color:#836EF9;font-size:15px;margin-right:10px;">&#10003;</span>
                <span style="color:#18181b;font-size:14px;font-weight:500;">Discover AI agents in the marketplace</span>
              </td></tr>
              <tr><td style="padding:6px 0;">
                <span style="color:#836EF9;font-size:15px;margin-right:10px;">&#10003;</span>
                <span style="color:#18181b;font-size:14px;font-weight:500;">Publish your own bots and AI tools</span>
              </td></tr>
              <tr><td style="padding:6px 0;">
                <span style="color:#836EF9;font-size:15px;margin-right:10px;">&#10003;</span>
                <span style="color:#18181b;font-size:14px;font-weight:500;">Link your GitHub and show your work</span>
              </td></tr>
            </table>
          </td>
        </tr>
      </table>

      <a href="${this.appUrl}" style="display:inline-block;background:#836EF9;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;border-radius:10px;padding:12px 28px;">
        Start exploring &rarr;
      </a>
    `),
    );
    const text = `Welcome to Bolty, @${username}!\n\nYour account is ready. Start exploring at ${this.appUrl}`;
    await this.send(to, subject, html, text);
  }

  // ── 2FA login code ───────────────────────────────────────────────────────

  async send2FACode(to: string, code: string): Promise<void> {
    const subject = `${code} — your Bolty sign-in code`;
    const html = this.shell(
      subject,
      `Your Bolty sign-in code is ${code}`,
      bodyWrap(`
      <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#09090b;letter-spacing:-0.5px;">Complete Your Sign-In</h1>
      <p style="margin:0 0 20px;color:#71717a;font-size:15px;line-height:1.6;">
        Here's your 6-digit verification code to complete your Bolty sign-in.
        This code expires in <strong style="color:#18181b;">10 minutes</strong>.
      </p>
      ${otpBlock(code)}
      <p style="margin:0 0 20px;color:#71717a;font-size:14px;line-height:1.6;text-align:center;">
        Enter the code above to verify your identity
      </p>
      <div style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:10px;padding:14px 18px;">
        <p style="margin:0;font-size:13px;color:#3730a3;">
          <strong>Security tip:</strong> Never share this code with anyone. Bolty will never ask for it by phone or email.
          If you didn't request this sign-in, you can safely ignore this email.
        </p>
      </div>
    `),
    );
    const text = `Your Bolty 2FA sign-in code: ${code}\n\nExpires in 10 minutes. Never share it.`;
    await this.send(to, subject, html, text);
  }

  // ── Email change ─────────────────────────────────────────────────────────

  async sendEmailChangeConfirmation(to: string, code: string): Promise<void> {
    const subject = `${code} — confirm your new Bolty email`;
    const html = this.shell(
      subject,
      `Confirm your email change with code ${code}`,
      bodyWrap(`
      <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#09090b;letter-spacing:-0.5px;">Confirm Email Change</h1>
      <p style="margin:0 0 20px;color:#71717a;font-size:15px;line-height:1.6;">
        You requested to change your Bolty email address to this one.
        Enter the 6-digit code below to confirm the change.
        This code expires in <strong style="color:#18181b;">15 minutes</strong>.
      </p>
      ${otpBlock(code)}
      <p style="margin:0 0 20px;color:#71717a;font-size:14px;line-height:1.6;text-align:center;">
        Enter the code above to complete your email change
      </p>
      <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:10px;padding:14px 18px;">
        <p style="margin:0;font-size:13px;color:#92400e;">
          <strong>Didn't request this?</strong> Your email won't change unless you enter the code. If this wasn't you, sign in and change your password immediately.
        </p>
      </div>
    `),
    );
    const text = `Your Bolty email change code: ${code}\n\nExpires in 15 minutes.`;
    await this.send(to, subject, html, text);
  }

  // ── Password reset ───────────────────────────────────────────────────────

  async sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
    const subject = 'Reset your Bolty password';
    const html = this.shell(
      subject,
      'Reset your Bolty password',
      bodyWrap(`
      <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#09090b;letter-spacing:-0.5px;">Password Reset</h1>
      <p style="margin:0 0 20px;color:#71717a;font-size:15px;line-height:1.6;">
        We received a request to reset your Bolty password.
        Click the button below to set a new one. The link expires in <strong style="color:#18181b;">15 minutes</strong>.
      </p>
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:24px;">
        <tr>
          <td align="center">
            <a href="${resetUrl}" style="display:inline-block;background:#836EF9;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;border-radius:10px;padding:14px 32px;">
              Reset password &rarr;
            </a>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 16px;color:#a1a1aa;font-size:13px;line-height:1.6;">
        Or copy and paste this URL into your browser:<br/>
        <a href="${resetUrl}" style="color:#836EF9;word-break:break-all;">${resetUrl}</a>
      </p>
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:14px 18px;">
        <p style="margin:0;font-size:13px;color:#92400e;">
          <strong>Didn't request a password reset?</strong> You can safely ignore this email — your password won't change.
        </p>
      </div>
    `),
    );
    const text = `Reset your Bolty password\n\nClick the link below (expires in 15 minutes):\n${resetUrl}\n\nIf you didn't request this, ignore this email.`;
    await this.send(to, subject, html, text);
  }

  // ── Enable 2FA confirmation ───────────────────────────────────────────────

  async send2FAEnableCode(to: string, code: string): Promise<void> {
    const subject = `${code} — enable two-factor authentication`;
    const html = this.shell(
      subject,
      `Confirm 2FA activation: ${code}`,
      bodyWrap(`
      <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#09090b;letter-spacing:-0.5px;">Enable Two-Factor Authentication</h1>
      <p style="margin:0 0 20px;color:#71717a;font-size:15px;line-height:1.6;">
        You requested to enable two-factor authentication (2FA) on your Bolty account.
        This adds an extra layer of security to protect your account.
        Enter the 6-digit code below to confirm. This code expires in <strong style="color:#18181b;">10 minutes</strong>.
      </p>
      ${otpBlock(code)}
      <p style="margin:0 0 20px;color:#71717a;font-size:14px;line-height:1.6;text-align:center;">
        Enter the code above to enable 2FA on your account
      </p>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px 18px;">
        <p style="margin:0;font-size:13px;color:#166534;">
          <strong>🔒 Enhancing security:</strong> Two-factor authentication requires a second verification code when you sign in, making your account much more secure.
          If you didn't request this, you can safely ignore this email.
        </p>
      </div>
    `),
    );
    const text = `Your Bolty 2FA activation code: ${code}\n\nExpires in 10 minutes.`;
    await this.send(to, subject, html, text);
  }

  // ── Agent deal notification ──────────────────────────────────────────────

  async sendAgentDealEmail(
    to: string,
    sellerUsername: string,
    listingTitle: string,
    agreedPrice: number,
    currency: string,
    buyerUsername: string,
    negotiationId: string,
  ): Promise<void> {
    const subject = `🤖 Your agent agreed a deal — ${agreedPrice} ${currency}`;
    const dealUrl = `${this.appUrl}/market?neg=${negotiationId}`;
    const html = this.shell(
      subject,
      `Your agent agreed a deal for ${listingTitle}`,
      bodyWrap(`
      <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#09090b;letter-spacing:-0.5px;">Agent Deal Alert</h1>
      <p style="margin:0 0 20px;color:#71717a;font-size:15px;line-height:1.6;">
        Hi <strong style="color:#18181b;">@${sellerUsername}</strong>,<br/>
        Your AI agent negotiated a deal on your listing. Review and confirm to proceed.
      </p>

      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:24px;">
        <tr>
          <td style="background:#f0fdf4;border:1px solid #86efac;border-radius:12px;padding:20px 24px;">
            <p style="margin:0 0 8px;font-size:13px;color:#71717a;font-family:'Courier New',monospace;">LISTING</p>
            <p style="margin:0 0 16px;font-size:16px;font-weight:700;color:#09090b;">${listingTitle}</p>
            <p style="margin:0 0 8px;font-size:13px;color:#71717a;font-family:'Courier New',monospace;">AGREED PRICE</p>
            <p style="margin:0 0 16px;font-size:28px;font-weight:800;color:#16a34a;font-family:'Courier New',monospace;">${agreedPrice} ${currency}</p>
            <p style="margin:0 0 4px;font-size:13px;color:#71717a;font-family:'Courier New',monospace;">BUYER</p>
            <p style="margin:0;font-size:14px;font-weight:600;color:#09090b;">@${buyerUsername}</p>
          </td>
        </tr>
      </table>

      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:20px;">
        <tr>
          <td align="center">
            <a href="${dealUrl}" style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;border-radius:10px;padding:14px 32px;">
              Review &amp; Confirm Deal &rarr;
            </a>
          </td>
        </tr>
      </table>

      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:14px 18px;">
        <p style="margin:0;font-size:13px;color:#92400e;">
          Once you confirm, a direct message chat will open between you and the buyer so you can coordinate the transaction.
        </p>
      </div>
    `),
    );
    const text = `Hi @${sellerUsername},\n\nYour AI agent agreed a deal!\n\nListing: ${listingTitle}\nAgreed price: ${agreedPrice} ${currency}\nBuyer: @${buyerUsername}\n\nReview and confirm at: ${dealUrl}`;
    await this.send(to, subject, html, text);
  }

  // ── Delete account ───────────────────────────────────────────────────────

  async sendDeleteAccountCode(to: string, code: string): Promise<void> {
    const subject = `${code} — confirm account deletion`;
    const html = this.shell(
      subject,
      `Confirm account deletion: ${code}`,
      bodyWrap(`
      <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#09090b;letter-spacing:-0.5px;">⚠️ Account Deletion Request</h1>
      <p style="margin:0 0 20px;color:#71717a;font-size:15px;line-height:1.6;">
        You requested to permanently delete your Bolty account.
        This action <strong style="color:#18181b;">cannot be undone</strong>.
        Enter the 6-digit code below to confirm. This code expires in <strong style="color:#18181b;">10 minutes</strong>.
      </p>
      ${otpBlock(code)}
      <p style="margin:0 0 20px;color:#71717a;font-size:14px;line-height:1.6;text-align:center;">
        Enter the code above to permanently delete your account
      </p>
      <div style="background:#fef2f2;border:2px solid #fecdd3;border-radius:10px;padding:16px 20px;">
        <p style="margin:0 0 8px;font-size:13px;color:#9f1239;font-weight:700;">
          ⚠️ Warning: This will permanently delete:
        </p>
        <ul style="margin:8px 0 0 0;padding-left:20px;color:#9f1239;font-size:13px;">
          <li>Your entire Bolty account and profile</li>
          <li>All your API keys and tokens</li>
          <li>All your listings and agent posts</li>
          <li>All your data and activity history</li>
        </ul>
        <p style="margin:8px 0 0;font-size:13px;color:#9f1239;">
          <strong>If you didn't request this, change your password immediately.</strong>
        </p>
      </div>
    `),
    );
    const text = `Your Bolty account deletion code: ${code}\n\nExpires in 10 minutes. This is PERMANENT and will delete all your data.`;
    await this.send(to, subject, html, text);
  }

  // ── API Key deletion verification ────────────────────────────────────────

  async sendApiKeyDeleteCode(to: string, code: string): Promise<void> {
    const subject = `${code} — revoke your Bolty API key`;
    const html = this.shell(
      subject,
      `Confirm API key revocation: ${code}`,
      bodyWrap(`
      <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#09090b;letter-spacing:-0.5px;">Revoke API Key</h1>
      <p style="margin:0 0 4px;color:#71717a;font-size:15px;line-height:1.6;">
        You requested to revoke an API key on your Bolty account.
        Enter this code to confirm. Expires in <strong style="color:#18181b;">10 minutes</strong>.
      </p>
      ${otpBlock(code)}
      <div style="background:#fef2f2;border:1px solid #fee2e2;border-radius:10px;padding:14px 18px;">
        <p style="margin:0;font-size:13px;color:#7c2d12;">
          <strong>Once revoked, this API key will no longer work.</strong> Any applications or scripts using it will fail to authenticate.
          If you didn't request this, change your password immediately.
        </p>
      </div>
    `),
    );
    const text = `Your Bolty API key revocation code: ${code}\n\nExpires in 10 minutes.`;
    await this.send(to, subject, html, text);
  }

  // ── Notification Emails ────────────────────────────────────────────────────

  async sendApiErrorNotification(
    to: string,
    errors: Array<{ endpoint: string; error: string; timestamp: string }>,
  ): Promise<void> {
    const subject = 'Alert: API Errors Detected on Your Bolty Account';
    const errorsList = errors
      .map(
        (e) => `
      <tr>
        <td style="padding:12px;border-bottom:1px solid #e4e4e7;font-size:13px;">
          <div style="color:#18181b;font-weight:600;">${e.endpoint}</div>
          <div style="color:#71717a;margin-top:4px;">${e.error}</div>
          <div style="color:#a1a1aa;font-size:12px;margin-top:4px;">${new Date(e.timestamp).toLocaleString()}</div>
        </td>
      </tr>
    `,
      )
      .join('');

    const html = this.shell(
      subject,
      'Your API experienced errors in the last hour',
      bodyWrap(`
      <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#09090b;letter-spacing:-0.5px;">⚠️ API Errors Detected</h1>
      <p style="margin:0 0 16px;color:#71717a;font-size:15px;line-height:1.6;">
        Your API experienced ${errors.length} error(s) in the last hour. Details below:
      </p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;">
        ${errorsList}
      </table>
      <p style="margin:16px 0 0;font-size:13px;color:#71717a;">
        <a href="${this.appUrl}/profile?tab=usage" style="color:#a855f7;text-decoration:none;font-weight:600;">View API Dashboard →</a>
      </p>
    `),
    );
    const text = `API Errors: ${errors.length} errors detected. Check your Bolty dashboard for details.`;
    await this.send(to, subject, html, text);
  }

  async sendWeeklyUsageReport(
    to: string,
    username: string,
    stats: {
      totalCalls: number;
      activeAgents: number;
      topEndpoint: string;
      topError?: string;
    },
  ): Promise<void> {
    const subject = `Weekly Usage Report — ${stats.totalCalls} API calls`;
    const html = this.shell(
      subject,
      `${username}, here's your weekly Bolty usage summary`,
      bodyWrap(`
      <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#09090b;letter-spacing:-0.5px;">Weekly Usage Report</h1>
      <p style="margin:0 0 20px;color:#71717a;font-size:15px;line-height:1.6;">
        Hi ${username}, here's a summary of your API usage this week.
      </p>
      <div style="background:#f4f4f5;border-radius:10px;padding:20px;margin-bottom:20px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
          <div>
            <div style="color:#a1a1aa;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Total API Calls</div>
            <div style="color:#09090b;font-size:32px;font-weight:700;margin-top:8px;">${stats.totalCalls.toLocaleString()}</div>
          </div>
          <div>
            <div style="color:#a1a1aa;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Active Agents</div>
            <div style="color:#09090b;font-size:32px;font-weight:700;margin-top:8px;">${stats.activeAgents}</div>
          </div>
        </div>
      </div>
      <div style="background:#f9f5ff;border-left:4px solid #a855f7;padding:16px;border-radius:6px;margin-bottom:20px;">
        <p style="margin:0;color:#5b21b6;font-size:13px;">
          <strong>Top Endpoint:</strong> ${stats.topEndpoint || 'N/A'}
        </p>
        ${stats.topError ? `<p style="margin:8px 0 0;color:#5b21b6;font-size:13px;"><strong>Most Common Error:</strong> ${stats.topError}</p>` : ''}
      </div>
      <p style="margin:0;font-size:13px;color:#71717a;">
        <a href="${this.appUrl}/profile?tab=usage" style="color:#a855f7;text-decoration:none;font-weight:600;">View Full Analytics →</a>
      </p>
    `),
    );
    const text = `Weekly Usage: ${stats.totalCalls} API calls, ${stats.activeAgents} active agents.`;
    await this.send(to, subject, html, text);
  }

  async sendOrderUpdateNotification(
    to: string,
    username: string,
    orderInfo: { orderId: string; status: string; message: string },
  ): Promise<void> {
    const subject = `Order Update: ${orderInfo.status}`;
    const html = this.shell(
      subject,
      `Order #${orderInfo.orderId.substring(0, 8)} ${orderInfo.status.toLowerCase()}`,
      bodyWrap(`
      <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#09090b;letter-spacing:-0.5px;">Order Update</h1>
      <p style="margin:0 0 16px;color:#71717a;font-size:15px;line-height:1.6;">
        Hi ${username}, your order has been updated:
      </p>
      <div style="background:#f4f4f5;border-radius:10px;padding:16px;margin-bottom:20px;">
        <p style="margin:0;color:#09090b;font-weight:600;">Order #${orderInfo.orderId.substring(0, 12)}</p>
        <p style="margin:8px 0 0;color:#71717a;font-size:14px;">${orderInfo.message}</p>
      </div>
      <p style="margin:0;font-size:13px;color:#71717a;">
        <a href="${this.appUrl}/orders/${orderInfo.orderId}" style="color:#a855f7;text-decoration:none;font-weight:600;">View Order →</a>
      </p>
    `),
    );
    const text = `Order #${orderInfo.orderId.substring(0, 8)}: ${orderInfo.status}`;
    await this.send(to, subject, html, text);
  }

  // ── Purchase confirmation ──────────────────────────────────────────────────

  async sendPurchaseConfirmation(
    to: string,
    recipient: 'buyer' | 'seller',
    data: {
      buyerUsername: string;
      sellerUsername: string;
      listingTitle: string;
      orderId: string;
      amountLabel: string; // already formatted, e.g. "0.042 ETH" or "125 HAGGL"
      txHash?: string | null;
      purchaseKind: 'listing' | 'repo';
    },
  ): Promise<void> {
    const isBuyer = recipient === 'buyer';
    const ordersUrl = `${this.appUrl}/orders/${data.orderId}`;
    const subject = isBuyer
      ? `Purchase confirmed — ${data.listingTitle}`
      : `New sale — ${data.listingTitle} (${data.amountLabel})`;
    const preheader = isBuyer
      ? `You bought ${data.listingTitle} for ${data.amountLabel}`
      : `@${data.buyerUsername} bought ${data.listingTitle} for ${data.amountLabel}`;

    const counterpartyLabel = isBuyer ? 'Seller' : 'Buyer';
    const counterpartyHandle = isBuyer ? data.sellerUsername : data.buyerUsername;
    const greeting = isBuyer ? data.buyerUsername : data.sellerUsername;
    const headline = isBuyer ? 'Purchase confirmed' : 'New sale';
    const intro = isBuyer
      ? 'Your payment was verified on-chain. Access is now available in your orders dashboard.'
      : 'A buyer completed payment for one of your listings. Coordinate delivery from the order page.';

    const txBlock = data.txHash
      ? `
        <tr>
          <td style="padding-top:12px;">
            <p style="margin:0 0 4px;font-size:12px;color:#71717a;font-family:'Courier New',monospace;letter-spacing:0.04em;">TRANSACTION</p>
            <p style="margin:0;font-size:12px;color:#18181b;font-family:'Courier New',monospace;word-break:break-all;">${data.txHash}</p>
          </td>
        </tr>`
      : '';

    const html = this.shell(
      subject,
      preheader,
      bodyWrap(`
      <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#09090b;letter-spacing:-0.5px;">${headline}</h1>
      <p style="margin:0 0 20px;color:#71717a;font-size:15px;line-height:1.6;">
        Hi <strong style="color:#18181b;">@${greeting}</strong>,<br/>
        ${intro}
      </p>

      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:24px;">
        <tr>
          <td style="background:#f0fdf4;border:1px solid #86efac;border-radius:12px;padding:20px 24px;">
            <p style="margin:0 0 4px;font-size:12px;color:#71717a;font-family:'Courier New',monospace;letter-spacing:0.04em;">${data.purchaseKind === 'repo' ? 'REPOSITORY' : 'LISTING'}</p>
            <p style="margin:0 0 16px;font-size:16px;font-weight:700;color:#09090b;">${data.listingTitle}</p>
            <p style="margin:0 0 4px;font-size:12px;color:#71717a;font-family:'Courier New',monospace;letter-spacing:0.04em;">AMOUNT</p>
            <p style="margin:0 0 16px;font-size:28px;font-weight:800;color:#16a34a;font-family:'Courier New',monospace;">${data.amountLabel}</p>
            <p style="margin:0 0 4px;font-size:12px;color:#71717a;font-family:'Courier New',monospace;letter-spacing:0.04em;">${counterpartyLabel.toUpperCase()}</p>
            <p style="margin:0 0 16px;font-size:14px;font-weight:600;color:#09090b;">@${counterpartyHandle}</p>
            <p style="margin:0 0 4px;font-size:12px;color:#71717a;font-family:'Courier New',monospace;letter-spacing:0.04em;">ORDER ID</p>
            <p style="margin:0;font-size:13px;color:#18181b;font-family:'Courier New',monospace;">${data.orderId}</p>
            ${txBlock}
          </td>
        </tr>
      </table>

      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:20px;">
        <tr>
          <td align="center">
            <a href="${ordersUrl}" style="display:inline-block;background:#09090b;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;border-radius:10px;padding:14px 32px;">
              ${isBuyer ? 'Open your order' : 'View order details'} &rarr;
            </a>
          </td>
        </tr>
      </table>

      <p style="margin:0;font-size:13px;color:#71717a;">
        Or copy this link: <a href="${ordersUrl}" style="color:#a855f7;text-decoration:none;">${ordersUrl}</a>
      </p>
    `),
    );
    const text =
      `${headline}\n\n` +
      `${isBuyer ? 'You bought' : `@${data.buyerUsername} bought`} ${data.listingTitle} for ${data.amountLabel}.\n` +
      `${counterpartyLabel}: @${counterpartyHandle}\n` +
      `Order: ${data.orderId}\n` +
      (data.txHash ? `Tx: ${data.txHash}\n` : '') +
      `\nOpen your order: ${ordersUrl}`;

    await this.send(to, subject, html, text);
  }

  // ── Negotiation lifecycle (started / agreed / rejected / expired) ──────

  async sendNegotiationEvent(
    to: string,
    data: {
      kind: 'started' | 'agreed' | 'rejected' | 'expired';
      recipient: 'buyer' | 'seller';
      counterparty: string;
      listingTitle: string;
      priceLabel?: string | null;
      url: string;
    },
  ): Promise<void> {
    const openUrl = `${this.appUrl}${data.url}`;
    const headline =
      data.kind === 'started'
        ? data.recipient === 'seller'
          ? 'New negotiation'
          : 'Negotiation opened'
        : data.kind === 'agreed'
          ? 'Deal closed'
          : data.kind === 'rejected'
            ? 'Negotiation rejected'
            : 'Negotiation expired';

    const subject =
      data.kind === 'agreed'
        ? `Deal closed — ${data.listingTitle}${data.priceLabel ? ` · ${data.priceLabel}` : ''}`
        : data.kind === 'started'
          ? `${data.recipient === 'seller' ? `@${data.counterparty} wants to buy` : 'Your agent is negotiating'} "${data.listingTitle}"`
          : `${headline} — ${data.listingTitle}`;

    const intro =
      data.kind === 'started'
        ? data.recipient === 'seller'
          ? `@${data.counterparty} opened a negotiation on your listing. Your agent is replying automatically — take over at any time to negotiate manually.`
          : 'Your buyer agent is negotiating with the seller automatically. You can take over at any time to finalize manually.'
        : data.kind === 'agreed'
          ? data.recipient === 'buyer'
            ? `You reached a deal with @${data.counterparty} at ${data.priceLabel}. Complete payment to release escrow and get the listing.`
            : `You reached a deal with @${data.counterparty} at ${data.priceLabel}. The buyer will complete payment shortly.`
          : data.kind === 'rejected'
            ? 'The negotiation ended without a deal. Open the chat to see the final exchange.'
            : 'The negotiation timed out without an agreement.';

    const html = this.shell(
      subject,
      intro.slice(0, 140),
      bodyWrap(`
      <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#09090b;letter-spacing:-0.5px;">${headline}</h1>
      <p style="margin:0 0 20px;color:#71717a;font-size:15px;line-height:1.6;">${intro}</p>
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:24px;">
        <tr>
          <td style="background:#fafafa;border:1px solid #e4e4e7;border-radius:12px;padding:18px 22px;">
            <p style="margin:0 0 4px;font-size:12px;color:#71717a;font-family:'Courier New',monospace;letter-spacing:0.04em;">LISTING</p>
            <p style="margin:0 0 12px;font-size:16px;font-weight:700;color:#09090b;">${data.listingTitle}</p>
            ${
              data.priceLabel
                ? `<p style="margin:0 0 4px;font-size:12px;color:#71717a;font-family:'Courier New',monospace;letter-spacing:0.04em;">AGREED PRICE</p>
                   <p style="margin:0;font-size:22px;font-weight:800;color:#16a34a;font-family:'Courier New',monospace;">${data.priceLabel}</p>`
                : ''
            }
          </td>
        </tr>
      </table>
      <p style="margin:0 0 20px;">
        <a href="${openUrl}" style="display:inline-block;background:#836ef9;color:#ffffff;padding:12px 20px;border-radius:10px;font-weight:600;font-size:14px;text-decoration:none;">Open the negotiation</a>
      </p>
    `),
    );

    const text =
      `${headline}\n\n` +
      `${intro}\n` +
      `Listing: ${data.listingTitle}\n` +
      (data.priceLabel ? `Price: ${data.priceLabel}\n` : '') +
      `\nOpen: ${openUrl}`;

    await this.send(to, subject, html, text);
  }

  /**
   * Agent-health alert sent when the periodic health-check flips a
   * listing to inactive (kind: 'offline') and when it comes back
   * (kind: 'recovered').
   */
  async sendAgentHealthAlert(
    to: string,
    data: { listingTitle: string; listingId: string; kind: 'offline' | 'recovered' },
  ): Promise<void> {
    const offline = data.kind === 'offline';
    const subject = offline
      ? `Your agent is offline — ${data.listingTitle}`
      : `Your agent is back online — ${data.listingTitle}`;
    const headline = offline ? 'Your agent stopped responding' : 'Your agent is live again';
    const intro = offline
      ? "Our health-checker can no longer reach your agent's webhook. We've paused the listing so nobody tries to buy an offline agent."
      : "Your agent's webhook is responding again. The listing is back on the marketplace.";
    const manageUrl = `${this.appUrl}/market/agents/${data.listingId}`;

    const html = this.shell(
      subject,
      headline,
      bodyWrap(`
        <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#09090b;letter-spacing:-0.4px;">${headline}</h1>
        <p style="margin:0 0 16px;color:#52525b;font-size:14.5px;line-height:1.6;">${intro}</p>
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:16px;">
          <tr>
            <td style="background:${offline ? '#fef2f2' : '#f0fdf4'};border:1px solid ${offline ? '#fecaca' : '#86efac'};border-radius:12px;padding:14px 18px;">
              <p style="margin:0 0 4px;font-size:12px;color:#71717a;font-family:'Courier New',monospace;">LISTING</p>
              <p style="margin:0;font-size:15px;font-weight:700;color:#09090b;">${data.listingTitle}</p>
            </td>
          </tr>
        </table>
        <p style="margin:0 0 24px;">
          <a href="${manageUrl}" style="display:inline-block;background:#836ef9;color:#ffffff;padding:12px 20px;border-radius:10px;font-weight:600;font-size:14px;text-decoration:none;">Manage listing</a>
        </p>
      `),
    );
    const text = `${headline}\n\n${intro}\nListing: ${data.listingTitle}\nManage: ${manageUrl}`;
    await this.send(to, subject, html, text);
  }
}
