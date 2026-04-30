import Anthropic from '@anthropic-ai/sdk';
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

import { PrismaService } from '../../common/prisma/prisma.service';
import { isSafeUrl, sanitizeAiPrompt } from '../../common/sanitize/sanitize.util';
import { DmService } from '../dm/dm.service';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';

import { AgentSandboxService, SandboxContext } from './agent-sandbox.service';
import { NegotiationsGateway } from './negotiations.gateway';

interface AgentResponse {
  reply: string;
  proposedPrice?: number;
  action?: 'accept' | 'reject' | 'counter';
}

interface NegotiationType {
  id: string;
  buyerId: string;
  mode: string;
  turnCount: number;
  humanSwitchRequestedBy: string | null;
  humanSwitchAcceptedBy: string[];
  listing: {
    id: string;
    title: string;
    price: number;
    currency: string;
    sellerId: string;
    minPrice?: number | null;
    agentEndpoint?: string | null;
    fileKey?: string | null;
    fileName?: string | null;
    fileMimeType?: string | null;
  };
  buyer?: {
    id: string;
    username: string | null;
    agentEndpoint?: string | null;
  };
  messages?: Array<{
    fromRole: string;
    content: string;
    proposedPrice?: number | null;
    createdAt: Date;
  }>;
}

// Max back-and-forth turns before the negotiation auto-expires
const MAX_TURNS = 15;

// Delay between AI agent turns (ms) — long enough for humans to read
// the previous message and chime in with a prompt, short enough for
// the loop to feel live. 2s is the sweet spot per product direction.
const TURN_DELAY_MS = 2000;

@Injectable()
export class NegotiationService {
  private readonly logger = new Logger(NegotiationService.name);
  private readonly anthropic: Anthropic;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly emailService: EmailService,
    private readonly dmService: DmService,
    private readonly sandbox: AgentSandboxService,
    private readonly gateway: NegotiationsGateway,
    private readonly notifications: NotificationsService,
  ) {
    this.anthropic = new Anthropic({
      apiKey: this.config.get<string>('ANTHROPIC_API_KEY') || '',
    });
  }

  // ── Start or resume a negotiation ─────────────────────────────────────────

  async startNegotiation(buyerId: string, listingId: string, buyerAgentListingId?: string) {
    const listing = await this.prisma.marketListing.findUnique({
      where: { id: listingId },
      select: {
        id: true,
        status: true,
        sellerId: true,
        title: true,
        price: true,
        currency: true,
        agentEndpoint: true,
        minPrice: true,
        fileKey: true,
        fileName: true,
        fileMimeType: true,
      },
    });
    if (!listing || listing.status !== 'ACTIVE') throw new NotFoundException('Listing not found');
    if (listing.sellerId === buyerId)
      throw new ForbiddenException('Cannot negotiate on your own listing');

    // Validate the buyer actually owns the agent they claim to
    // delegate to. Silently drop an invalid pick rather than 400
    // since the UX flow can fall back to the default agent.
    let validatedBuyerAgentId: string | null = null;
    if (buyerAgentListingId) {
      const owned = await this.prisma.marketListing.findUnique({
        where: { id: buyerAgentListingId },
        select: { id: true, sellerId: true, type: true, status: true },
      });
      if (
        owned &&
        owned.sellerId === buyerId &&
        owned.type === 'AI_AGENT' &&
        owned.status !== 'REMOVED'
      ) {
        validatedBuyerAgentId = owned.id;
      }
    }

    // Return existing active negotiation if one exists
    const existing = await this.prisma.agentNegotiation.findFirst({
      where: { listingId, buyerId, status: 'ACTIVE' },
      include: this.negotiationInclude(),
    });
    if (existing) return existing;

    const neg = await this.prisma.agentNegotiation.create({
      data: {
        listingId,
        buyerId,
        buyerAgentListingId: validatedBuyerAgentId,
      },
      include: this.negotiationInclude(),
    });

    // Notify the seller the moment a negotiation is opened so they can
    // jump in (or switch to human mode). Web notif is emergent via the
    // notifications socket; email is best-effort.
    this.notifyNegotiationStarted(neg.id).catch((err) =>
      this.logger.warn(`neg start notify failed: ${(err as Error).message}`),
    );

    // Fire-and-forget: seller agent greets, then buyer agent responds, then loop
    void this.kickOffAiAiLoop(neg.id);

    return neg;
  }

  /**
   * Emergent notification + email to the seller when a buyer opens a
   * negotiation. Meta carries the listingId and negId so the frontend
   * can deep-link to the exact modal.
   */
  private async notifyNegotiationStarted(negId: string) {
    const neg = await this.prisma.agentNegotiation.findUnique({
      where: { id: negId },
      include: {
        listing: {
          select: {
            id: true,
            title: true,
            sellerId: true,
            seller: {
              select: {
                email: true,
                username: true,
                notificationPreference: { select: { emailOrderUpdates: true } },
              },
            },
          },
        },
        buyer: { select: { username: true } },
      },
    });
    if (!neg) return;
    const buyerHandle = neg.buyer?.username || 'a buyer';
    const url = `/market/agents?negotiate=${neg.listingId}&negId=${neg.id}`;
    await this.notifications.create({
      userId: neg.listing.sellerId,
      type: 'MARKET_NEGOTIATION_MESSAGE',
      title: `@${buyerHandle} opened a negotiation on "${neg.listing.title}"`,
      body: 'Your agent is replying automatically. Take over anytime.',
      url,
      meta: {
        kind: 'negotiation_started',
        listingId: neg.listingId,
        negotiationId: neg.id,
        counterparty: buyerHandle,
        listingTitle: neg.listing.title,
      },
    });
    const sellerEmail = neg.listing.seller?.email;
    const optIn = neg.listing.seller?.notificationPreference?.emailOrderUpdates !== false;
    if (sellerEmail && optIn) {
      this.emailService
        .sendNegotiationEvent(sellerEmail, {
          kind: 'started',
          recipient: 'seller',
          counterparty: buyerHandle,
          listingTitle: neg.listing.title,
          url,
        })
        .catch(() => {});
    }
  }

  /**
   * Notify both parties when a negotiation closes (AGREED / REJECTED /
   * EXPIRED). Emits web notifs + emails to both.
   */
  private async notifyNegotiationEnded(
    negId: string,
    kind: 'agreed' | 'rejected' | 'expired',
    agreedPrice?: number | null,
  ) {
    try {
      const neg = await this.prisma.agentNegotiation.findUnique({
        where: { id: negId },
        include: {
          listing: {
            select: {
              id: true,
              title: true,
              currency: true,
              sellerId: true,
              seller: {
                select: {
                  email: true,
                  username: true,
                  notificationPreference: { select: { emailOrderUpdates: true } },
                },
              },
            },
          },
          buyer: {
            select: {
              email: true,
              username: true,
              notificationPreference: { select: { emailOrderUpdates: true } },
            },
          },
        },
      });
      if (!neg) return;
      const url = `/market/agents?negotiate=${neg.listingId}&negId=${neg.id}`;
      const currency = neg.listing.currency || 'ETH';
      const priceLabel = kind === 'agreed' && agreedPrice ? `${agreedPrice} ${currency}` : null;

      const titleFor = (role: 'buyer' | 'seller') => {
        const t = neg.listing.title;
        if (kind === 'agreed') return `Deal closed · "${t}" · ${priceLabel}`;
        if (kind === 'rejected')
          return role === 'seller'
            ? `Negotiation rejected · "${t}"`
            : `Seller rejected your offer on "${t}"`;
        return `Negotiation expired · "${t}"`;
      };
      const bodyFor = (role: 'buyer' | 'seller') => {
        if (kind === 'agreed') {
          return role === 'buyer'
            ? 'Your agents reached an agreement. Complete payment to release escrow.'
            : 'The buyer can now pay. Escrow will release when they confirm delivery.';
        }
        if (kind === 'rejected') return 'Open the chat to see the final exchange.';
        return 'The negotiation timed out without agreement.';
      };

      await Promise.all([
        this.notifications.create({
          userId: neg.listing.sellerId,
          type: 'MARKET_NEGOTIATION_MESSAGE',
          title: titleFor('seller'),
          body: bodyFor('seller'),
          url,
          meta: {
            kind: `negotiation_${kind}`,
            listingId: neg.listingId,
            negotiationId: neg.id,
            counterparty: neg.buyer?.username || '',
            listingTitle: neg.listing.title,
            agreedPrice: agreedPrice ?? null,
            currency,
          },
        }),
        this.notifications.create({
          userId: neg.buyerId,
          type: 'MARKET_NEGOTIATION_MESSAGE',
          title: titleFor('buyer'),
          body: bodyFor('buyer'),
          url,
          meta: {
            kind: `negotiation_${kind}`,
            listingId: neg.listingId,
            negotiationId: neg.id,
            counterparty: neg.listing.seller?.username || '',
            listingTitle: neg.listing.title,
            agreedPrice: agreedPrice ?? null,
            currency,
          },
        }),
      ]);

      const sellerEmail = neg.listing.seller?.email;
      const sellerOptIn = neg.listing.seller?.notificationPreference?.emailOrderUpdates !== false;
      const buyerEmail = neg.buyer?.email;
      const buyerOptIn = neg.buyer?.notificationPreference?.emailOrderUpdates !== false;

      if (sellerEmail && sellerOptIn) {
        this.emailService
          .sendNegotiationEvent(sellerEmail, {
            kind,
            recipient: 'seller',
            counterparty: neg.buyer?.username || 'buyer',
            listingTitle: neg.listing.title,
            priceLabel,
            url,
          })
          .catch(() => {});
      }
      if (buyerEmail && buyerOptIn) {
        this.emailService
          .sendNegotiationEvent(buyerEmail, {
            kind,
            recipient: 'buyer',
            counterparty: neg.listing.seller?.username || 'seller',
            listingTitle: neg.listing.title,
            priceLabel,
            url,
          })
          .catch(() => {});
      }
    } catch (err) {
      this.logger.warn(`neg end notify failed for ${negId}: ${(err as Error).message}`);
    }
  }

  // ── Get negotiations ───────────────────────────────────────────────────────

  async getNegotiation(id: string, userId: string) {
    const neg = await this.prisma.agentNegotiation.findUnique({
      where: { id },
      include: this.negotiationInclude(),
    });
    if (!neg) throw new NotFoundException();
    if (neg.buyerId !== userId && neg.listing.sellerId !== userId) throw new ForbiddenException();
    return neg;
  }

  async getMyNegotiations(userId: string) {
    return this.prisma.agentNegotiation.findMany({
      where: { OR: [{ buyerId: userId }, { listing: { sellerId: userId } }] },
      include: {
        listing: {
          select: {
            id: true,
            title: true,
            price: true,
            currency: true,
            type: true,
            minPrice: true,
          },
        },
        buyer: { select: { id: true, username: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
  }

  // ── Send a message (only available in HUMAN mode) ─────────────────────────

  async sendMessage(id: string, senderId: string, content: string, proposedPrice?: number) {
    const neg = await this.prisma.agentNegotiation.findUnique({
      where: { id },
      include: {
        listing: {
          select: {
            id: true,
            title: true,
            price: true,
            currency: true,
            sellerId: true,
            agentEndpoint: true,
            minPrice: true,
            fileKey: true,
            fileName: true,
            fileMimeType: true,
          },
        },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!neg) throw new NotFoundException();
    if (neg.status !== 'ACTIVE') throw new BadRequestException('Negotiation is no longer active');
    if (neg.buyerId !== senderId && neg.listing.sellerId !== senderId)
      throw new ForbiddenException();

    // Humans can chip in at any time — even during an active AI-vs-AI
    // loop. This is how a buyer or seller steers the deal without
    // stopping the agents. The message just lands in the stream; it's
    // up to the UI to render it as a human bubble.

    const isBuyer = senderId === neg.buyerId;
    const safeContent = sanitizeAiPrompt(content.trim().slice(0, 1000));
    const safePrice =
      proposedPrice !== null && proposedPrice !== undefined && proposedPrice > 0
        ? proposedPrice
        : undefined;

    const saved = await this.prisma.negotiationMessage.create({
      data: {
        negotiationId: id,
        fromRole: isBuyer ? 'buyer' : 'seller',
        content: safeContent,
        proposedPrice: safePrice ?? null,
      },
    });

    this.gateway.emitNewMessage(id, saved);

    // Kick the opposite agent to respond immediately. Without this
    // human messages just sat in the chat and the other agent never
    // acknowledged them — the AI loop was not listening for human
    // interjections. Run in fire-and-forget so we can still return
    // the updated negotiation right away.
    if (neg.mode !== 'HUMAN' && neg.status === 'ACTIVE') {
      if (isBuyer) {
        void this.runSellerTurn(id);
      } else {
        void this.runBuyerTurn(id);
      }
    }

    // Emergent pop-toast for the counterparty.
    const counterpartyId = isBuyer ? neg.listing.sellerId : neg.buyerId;
    const senderUser = await this.prisma.user
      .findUnique({ where: { id: senderId }, select: { username: true } })
      .catch(() => null);
    const url = `/market/agents?negotiate=${neg.listing.id}&negId=${neg.id}`;
    this.notifications
      .create({
        userId: counterpartyId,
        type: 'MARKET_NEGOTIATION_MESSAGE',
        title: `@${senderUser?.username ?? 'user'} sent a message`,
        body: safeContent.length > 140 ? safeContent.slice(0, 140) + '…' : safeContent,
        url,
        meta: {
          kind: 'negotiation_message',
          listingId: neg.listing.id,
          negotiationId: neg.id,
          counterparty: senderUser?.username ?? '',
          listingTitle: neg.listing.title,
        },
      })
      .catch((err) =>
        this.logger.warn(`neg human-message notify failed: ${(err as Error).message}`),
      );

    return this.getNegotiation(id, senderId);
  }

  // ── Accept / reject ───────────────────────────────────────────────────────

  async acceptDeal(id: string, userId: string) {
    const neg = await this.prisma.agentNegotiation.findUnique({
      where: { id },
      include: {
        listing: { select: { id: true, sellerId: true, price: true, title: true, currency: true } },
        buyer: { select: { id: true, username: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!neg) throw new NotFoundException();
    if (neg.status !== 'ACTIVE' && neg.status !== 'AGREED')
      throw new BadRequestException('Cannot accept this negotiation');
    if (neg.buyerId !== userId && neg.listing.sellerId !== userId) throw new ForbiddenException();

    const lastProposed = neg.messages.find(
      (m) => m.proposedPrice !== null && m.proposedPrice !== undefined,
    );
    const agreedPrice = lastProposed?.proposedPrice ?? neg.listing.price;

    const updated = await this.prisma.agentNegotiation.update({
      where: { id },
      data: { status: 'AGREED', agreedPrice },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });

    this.gateway.emitStatusChange(id, { status: 'AGREED', agreedPrice });
    this.notifyNegotiationEnded(id, 'agreed', agreedPrice).catch(() => {});

    const isSeller = userId === neg.listing.sellerId;
    if (isSeller) {
      await this.createDealDm(
        neg.listing.sellerId,
        neg.buyer.id,
        neg.listing.title,
        agreedPrice,
        neg.listing.currency,
      );
    }

    return updated;
  }

  async rejectDeal(id: string, userId: string) {
    const neg = await this.prisma.agentNegotiation.findUnique({
      where: { id },
      include: { listing: { select: { sellerId: true } } },
    });
    if (!neg || neg.status !== 'ACTIVE') throw new NotFoundException();
    if (neg.buyerId !== userId && neg.listing.sellerId !== userId) throw new ForbiddenException();

    await this.prisma.agentNegotiation.update({
      where: { id },
      data: { status: 'REJECTED' },
    });

    this.gateway.emitStatusChange(id, { status: 'REJECTED' });
    this.notifyNegotiationEnded(id, 'rejected').catch(() => {});

    return { id, status: 'REJECTED' };
  }

  /**
   * Counter-offer — the user declined the AGREED price and proposes a
   * new one. Flips status back to ACTIVE, clears agreedPrice, posts
   * the message as the user's role, and restarts the AI loop so the
   * counterparty's agent responds.
   */
  async counterOffer(id: string, userId: string, content: string, proposedPrice?: number) {
    const neg = await this.prisma.agentNegotiation.findUnique({
      where: { id },
      include: { listing: { select: { sellerId: true, price: true, currency: true } } },
    });
    if (!neg) throw new NotFoundException();
    if (neg.buyerId !== userId && neg.listing.sellerId !== userId) throw new ForbiddenException();
    if (neg.status !== 'AGREED' && neg.status !== 'ACTIVE') {
      throw new BadRequestException('Can only counter while negotiating or at an agreed price');
    }

    const isBuyer = userId === neg.buyerId;
    const safePrice = proposedPrice && proposedPrice > 0 ? proposedPrice : undefined;

    // Re-open the deal + log the counter message in one go.
    await this.prisma.agentNegotiation.update({
      where: { id },
      data: { status: 'ACTIVE', agreedPrice: null },
    });
    const msg = await this.prisma.negotiationMessage.create({
      data: {
        negotiationId: id,
        fromRole: isBuyer ? 'buyer' : 'seller',
        content: sanitizeAiPrompt(content.slice(0, 1000)),
        proposedPrice: safePrice ?? null,
      },
    });
    this.gateway.emitNewMessage(id, msg);
    this.gateway.emitStatusChange(id, { status: 'ACTIVE' });

    // Kick the counterparty agent so the human doesn't have to wait
    // for the next AI-AI tick.
    if (isBuyer) {
      void this.runSellerTurn(id);
    } else {
      void this.runBuyerTurn(id);
    }

    return this.getNegotiation(id, userId);
  }

  // ── Human-mode switch (Pokemon trade handshake) ───────────────────────────

  /**
   * Either party requests switching to human negotiation.
   * The other party must call acceptHumanSwitch() to confirm.
   */
  async requestHumanSwitch(id: string, userId: string) {
    const neg = await this.prisma.agentNegotiation.findUnique({
      where: { id },
      include: { listing: { select: { sellerId: true } } },
    });
    if (!neg) throw new NotFoundException();
    if (neg.status !== 'ACTIVE') throw new BadRequestException('Negotiation is not active');
    if (neg.buyerId !== userId && neg.listing.sellerId !== userId) throw new ForbiddenException();
    if (neg.mode === 'HUMAN') throw new BadRequestException('Already in human mode');
    if (neg.humanSwitchRequestedBy) {
      throw new BadRequestException(
        'Switch already requested — waiting for the other party to accept',
      );
    }

    await this.prisma.agentNegotiation.update({
      where: { id },
      data: { humanSwitchRequestedBy: userId },
    });

    this.gateway.emitHumanSwitchRequest(id, userId);

    return { requested: true, requestedByUserId: userId };
  }

  /**
   * The OTHER party accepts the human switch request.
   * Mode becomes HUMAN and both users can type freely.
   */
  async acceptHumanSwitch(id: string, userId: string) {
    const neg = await this.prisma.agentNegotiation.findUnique({
      where: { id },
      include: { listing: { select: { sellerId: true } } },
    });
    if (!neg) throw new NotFoundException();
    if (neg.status !== 'ACTIVE') throw new BadRequestException('Negotiation is not active');
    if (neg.buyerId !== userId && neg.listing.sellerId !== userId) throw new ForbiddenException();
    if (neg.mode === 'HUMAN') throw new BadRequestException('Already in human mode');

    const requestedBy = neg.humanSwitchRequestedBy;
    if (!requestedBy) throw new BadRequestException('No human switch request pending');
    if (requestedBy === userId)
      throw new BadRequestException('You cannot accept your own switch request');

    await this.prisma.agentNegotiation.update({
      where: { id },
      data: {
        mode: 'HUMAN',
        humanSwitchRequestedBy: null,
        humanSwitchAcceptedBy: [requestedBy, userId],
      },
    });

    // System message announcing the handshake
    const systemMsg = await this.prisma.negotiationMessage.create({
      data: {
        negotiationId: id,
        fromRole: 'system',
        content: 'Both parties agreed to switch to human negotiation. You can now type freely.',
        proposedPrice: null,
      },
    });

    this.gateway.emitNewMessage(id, systemMsg);
    this.gateway.emitHumanSwitchActivated(id);

    return { activated: true };
  }

  // ── AI-vs-AI loop ─────────────────────────────────────────────────────────

  private async kickOffAiAiLoop(negId: string) {
    try {
      const neg = await this.fetchNegForAi(negId);
      if (!neg || neg.status !== 'ACTIVE') return;

      this.gateway.emitAgentTyping(negId, 'seller_agent');
      await this.sleep(TURN_DELAY_MS);

      // Always produce a seller greeting. If webhook / sandbox / LLM all
      // fail we drop in a canned listing-aware reply so the chat is
      // never empty — previously the modal showed a blank body.
      const greeting = (await this.sellerAgentGreet(neg)) ?? this.fallbackSellerGreeting(neg);

      const greetMsg = await this.prisma.negotiationMessage.create({
        data: {
          negotiationId: negId,
          fromRole: 'seller_agent',
          content: greeting.reply,
          proposedPrice: greeting.proposedPrice ?? null,
        },
      });
      this.gateway.emitNewMessage(negId, greetMsg);
      await this.applyAction(negId, greeting, neg);

      const afterGreet = await this.fetchNegForAi(negId);
      if (!afterGreet || afterGreet.status !== 'ACTIVE') return;

      await this.runBuyerTurn(negId);
    } catch (err) {
      this.logger.error(`kickOffAiAiLoop error for ${negId}`, err);
      this.gateway.emitError(negId, {
        stage: 'kickoff',
        message: (err as Error).message || 'Negotiation failed to start',
      });
    }
  }

  private async runBuyerTurn(negId: string) {
    try {
      const neg = await this.fetchNegForAi(negId);
      if (!neg || neg.status !== 'ACTIVE' || neg.mode !== 'AI_AI') return;
      if (neg.turnCount >= MAX_TURNS) {
        await this.expireNegotiation(negId);
        return;
      }

      this.gateway.emitAgentTyping(negId, 'buyer_agent');
      await this.sleep(TURN_DELAY_MS);

      const lastSellerMsg = [...neg.messages]
        .reverse()
        .find((m) => m.fromRole === 'seller_agent' || m.fromRole === 'seller');

      const buyerReply = await this.callBuyerAgent(
        neg,
        lastSellerMsg?.content ?? '',
        lastSellerMsg?.proposedPrice ?? undefined,
      );
      if (!buyerReply) return;

      const buyerMsg = await this.prisma.negotiationMessage.create({
        data: {
          negotiationId: negId,
          fromRole: 'buyer_agent',
          content: buyerReply.reply,
          proposedPrice: buyerReply.proposedPrice ?? null,
        },
      });
      this.gateway.emitNewMessage(negId, buyerMsg);

      await this.prisma.agentNegotiation.update({
        where: { id: negId },
        data: {
          turnCount: { increment: 1 },
        },
      });

      if (buyerReply.action === 'accept') {
        const agreedPrice = buyerReply.proposedPrice ?? neg.listing.price;
        await this.prisma.agentNegotiation.update({
          where: { id: negId },
          data: { status: 'AGREED', agreedPrice },
        });
        this.gateway.emitStatusChange(negId, { status: 'AGREED', agreedPrice });
        this.notifyNegotiationEnded(negId, 'agreed', agreedPrice).catch(() => {});
        return;
      }
      if (buyerReply.action === 'reject') {
        await this.prisma.agentNegotiation.update({
          where: { id: negId },
          data: { status: 'REJECTED' },
        });
        this.gateway.emitStatusChange(negId, { status: 'REJECTED' });
        this.notifyNegotiationEnded(negId, 'rejected').catch(() => {});
        return;
      }

      await this.runSellerTurn(negId);
    } catch (err) {
      this.logger.error(`runBuyerTurn error for ${negId}`, err);
      this.gateway.emitError(negId, {
        stage: 'buyer_turn',
        message: (err as Error).message || 'Buyer agent turn failed',
      });
    }
  }

  private async runSellerTurn(negId: string) {
    try {
      const neg = await this.fetchNegForAi(negId);
      if (!neg || neg.status !== 'ACTIVE' || neg.mode !== 'AI_AI') return;
      if (neg.turnCount >= MAX_TURNS) {
        await this.expireNegotiation(negId);
        return;
      }

      this.gateway.emitAgentTyping(negId, 'seller_agent');
      await this.sleep(TURN_DELAY_MS);

      const lastBuyerMsg = [...neg.messages]
        .reverse()
        .find((m) => m.fromRole === 'buyer_agent' || m.fromRole === 'buyer');

      const sellerReply = await this.callSellerAgent(
        neg,
        lastBuyerMsg?.content ?? '',
        lastBuyerMsg?.proposedPrice ?? undefined,
      );
      if (!sellerReply) {
        return;
      }

      const sellerMsg = await this.prisma.negotiationMessage.create({
        data: {
          negotiationId: negId,
          fromRole: 'seller_agent',
          content: sellerReply.reply,
          proposedPrice: sellerReply.proposedPrice ?? null,
        },
      });
      this.gateway.emitNewMessage(negId, sellerMsg);
      await this.applyAction(negId, sellerReply, neg);

      const afterSeller = await this.fetchNegForAi(negId);
      if (!afterSeller || afterSeller.status !== 'ACTIVE') return;

      await this.runBuyerTurn(negId);
    } catch (err) {
      this.logger.error(`runSellerTurn error for ${negId}`, err);
      this.gateway.emitError(negId, {
        stage: 'seller_turn',
        message: (err as Error).message || 'Seller agent turn failed',
      });
    }
  }

  private async expireNegotiation(negId: string) {
    await this.prisma.agentNegotiation.update({
      where: { id: negId },
      data: { status: 'EXPIRED' },
    });
    this.gateway.emitStatusChange(negId, { status: 'EXPIRED' });
    this.notifyNegotiationEnded(negId, 'expired').catch(() => {});
    this.logger.log(`Negotiation ${negId} expired after ${MAX_TURNS} turns`);
  }

  // ── Fetch negotiation for AI use ──────────────────────────────────────────

  private async fetchNegForAi(negId: string) {
    const neg = await this.prisma.agentNegotiation.findUnique({
      where: { id: negId },
      include: {
        listing: {
          select: {
            id: true,
            title: true,
            price: true,
            currency: true,
            sellerId: true,
            agentEndpoint: true,
            minPrice: true,
            fileKey: true,
            fileName: true,
            fileMimeType: true,
          },
        },
        buyer: { select: { id: true, username: true, agentEndpoint: true } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!neg) return null;
    // If the buyer delegated to one of their own agent listings, pull
    // that listing's endpoint/sandbox and overlay it on the buyer
    // object so callBuyerAgent can pick it up without a second fetch.
    if (neg.buyerAgentListingId) {
      const buyerAgent = await this.prisma.marketListing.findUnique({
        where: { id: neg.buyerAgentListingId },
        select: {
          agentEndpoint: true,
          fileKey: true,
          fileName: true,
          fileMimeType: true,
        },
      });
      if (buyerAgent) {
        (neg as unknown as Record<string, unknown>).buyerAgent = buyerAgent;
      }
    }
    return neg;
  }

  // ── Seller agent ──────────────────────────────────────────────────────────

  private buildSandboxContext(
    neg: {
      id: string;
      listing: {
        id: string;
        title: string;
        price: number;
        currency: string;
        minPrice?: number | null;
      };
      messages?: Array<{
        fromRole: string;
        content: string;
        proposedPrice?: number | null;
        createdAt: Date;
      }>;
    },
    event: 'negotiation.start' | 'negotiation.message',
    message?: string,
    proposedPrice?: number,
  ): SandboxContext {
    return {
      event,
      negotiationId: neg.id,
      listingId: neg.listing.id,
      listing: {
        title: neg.listing.title,
        askingPrice: neg.listing.price,
        currency: neg.listing.currency,
        minPrice: neg.listing.minPrice,
      },
      message,
      proposedPrice,
      history: (neg.messages ?? []).map((m) => ({
        role: m.fromRole,
        content: m.content,
        proposedPrice: m.proposedPrice,
        timestamp: m.createdAt,
      })),
    };
  }

  /**
   * Last-resort seller greeting when webhook, sandbox and LLM all fail.
   * Returns a listing-aware "here's my price" so the buyer has something
   * to respond to instead of a silent chat.
   */
  private fallbackSellerGreeting(neg: NegotiationType): AgentResponse {
    const price = neg.listing.price;
    const currency = neg.listing.currency || 'ETH';
    const floor = neg.listing.minPrice ?? null;
    const floorNote = floor ? ` My floor is ${floor} ${currency}.` : '';
    return {
      reply: `Hey — thanks for opening a negotiation on "${neg.listing.title}". The list price is ${price} ${currency}.${floorNote} What are you thinking?`,
      proposedPrice: price,
      action: 'counter',
    };
  }

  private async sellerAgentGreet(neg: NegotiationType): Promise<AgentResponse | null> {
    const ctx = this.buildSandboxContext(neg, 'negotiation.start');
    if (neg.listing.agentEndpoint && isSafeUrl(neg.listing.agentEndpoint)) {
      return this.callWebhook(neg.listing.agentEndpoint, ctx);
    }
    if (neg.listing.fileKey && neg.listing.fileName) {
      const result = await this.sandbox.run(
        neg.listing.fileKey,
        neg.listing.fileName,
        neg.listing.fileMimeType ?? '',
        ctx,
      );
      if (result) return result;
    }
    return this.claudeSellerGreet(neg.listing);
  }

  private async callSellerAgent(
    neg: NegotiationType,
    message: string,
    proposedPrice?: number,
  ): Promise<AgentResponse | null> {
    const ctx = this.buildSandboxContext(neg, 'negotiation.message', message, proposedPrice);
    if (neg.listing.agentEndpoint && isSafeUrl(neg.listing.agentEndpoint)) {
      return this.callWebhook(neg.listing.agentEndpoint, ctx);
    }
    if (neg.listing.fileKey && neg.listing.fileName) {
      const result = await this.sandbox.run(
        neg.listing.fileKey,
        neg.listing.fileName,
        neg.listing.fileMimeType ?? '',
        ctx,
      );
      if (result) return result;
    }
    return this.claudeSellerNegotiate(neg, message, proposedPrice);
  }

  // ── Buyer agent ───────────────────────────────────────────────────────────

  private async callBuyerAgent(
    neg: NegotiationType,
    sellerMessage: string,
    sellerProposedPrice?: number,
  ): Promise<AgentResponse | null> {
    // Buyer can delegate to one of their own agent listings. The
    // overlaid buyerAgent field (set by fetchNegForAi) holds that
    // listing's endpoint/sandbox — prefer it over the profile-level
    // fallback so users get the agent they actually picked.
    const delegated = (
      neg as unknown as {
        buyerAgent?: {
          agentEndpoint?: string | null;
          fileKey?: string | null;
          fileName?: string | null;
          fileMimeType?: string | null;
        };
      }
    ).buyerAgent;
    const ctx = this.buildSandboxContext(
      neg,
      'negotiation.message',
      sellerMessage,
      sellerProposedPrice,
    );
    if (delegated?.agentEndpoint && isSafeUrl(delegated.agentEndpoint)) {
      const result = await this.callWebhook(delegated.agentEndpoint, ctx);
      if (result) return result;
    }
    if (delegated?.fileKey && delegated?.fileName) {
      const result = await this.sandbox.run(
        delegated.fileKey,
        delegated.fileName,
        delegated.fileMimeType ?? '',
        ctx,
      );
      if (result) return result;
    }
    const buyerEndpoint = neg.buyer?.agentEndpoint;
    if (buyerEndpoint && isSafeUrl(buyerEndpoint)) {
      const result = await this.callWebhook(buyerEndpoint, ctx);
      if (result) return result;
    }
    return this.claudeBuyerNegotiate(neg, sellerMessage, sellerProposedPrice);
  }

  // ── Webhook ───────────────────────────────────────────────────────────────

  private async callWebhook(url: string, payload: unknown): Promise<AgentResponse | null> {
    try {
      const resp = await axios.post(url, payload, {
        timeout: 8000,
        headers: {
          'Content-Type': 'application/json',
          'X-Haggl-Event': (payload as { event?: string }).event ?? '',
        },
        maxBodyLength: 4096,
        maxContentLength: 4096,
      });
      const data = resp.data;
      return {
        reply: String(data?.reply || 'No response from agent.'),
        proposedPrice:
          data?.proposedPrice !== null && data?.proposedPrice !== undefined
            ? Number(data.proposedPrice)
            : undefined,
        action: ['accept', 'reject', 'counter'].includes(data?.action) ? data.action : 'counter',
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Webhook failed (${url}): ${errMsg}`);
      return null;
    }
  }

  // ── Claude prompts ────────────────────────────────────────────────────────

  private parseJson(text: string): Record<string, unknown> | null {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }

  private async claudeSellerGreet(listing: {
    title: string;
    price: number;
    currency: string;
    minPrice?: number | null;
  }): Promise<AgentResponse | null> {
    try {
      const floorNote =
        listing.minPrice !== null && listing.minPrice !== undefined
          ? ` (minimum: ${listing.minPrice} ${listing.currency})`
          : '';
      const prompt = `You are an AI sales agent for "${listing.title}" listed at ${listing.price} ${listing.currency}${floorNote}.
A buyer's AI agent just opened a negotiation. Start with a SHORT intro: say hello, briefly present what "${listing.title}" does in one sentence, then say the asking price. Friendly, concise, 2-3 sentences max. Do NOT yet offer a discount or counter.
Respond ONLY with JSON: {"reply": "your intro"}`;
      const res = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
      });
      const parsed = this.parseJson(res.content[0].type === 'text' ? res.content[0].text : '');
      if (parsed) return { reply: String(parsed.reply), action: 'counter' };
    } catch (err) {
      this.logger.error('Claude seller greet failed', err);
    }
    return {
      reply: `Hi! I'm the AI agent for "${listing.title}". Asking price: ${listing.price} ${listing.currency}. What's your offer?`,
      action: 'counter',
    };
  }

  private async claudeSellerNegotiate(
    neg: NegotiationType,
    buyerMessage: string,
    proposedPrice?: number,
  ): Promise<AgentResponse | null> {
    try {
      const history = (neg.messages ?? [])
        .map(
          (m) =>
            `[${m.fromRole}]${m.proposedPrice != null ? ` (offer: ${m.proposedPrice} ${neg.listing.currency})` : ''}: ${m.content}`,
        )
        .join('\n');
      const minPrice = neg.listing.minPrice;
      const floorRule =
        minPrice != null ? `- NEVER accept below ${minPrice} ${neg.listing.currency}.` : '';
      // Let the seller agent weight seller-side human interjections.
      const recentHumanMsg = [...(neg.messages ?? [])]
        .reverse()
        .find((m) => m.fromRole === 'seller');
      const steeringLine = recentHumanMsg
        ? `IMPORTANT: The seller just typed: "${recentHumanMsg.content}". Weight their guidance heavily.`
        : '';
      const turnCount = neg.turnCount ?? 0;
      const prompt = `You are an AI sales agent for "${neg.listing.title}" (asking: ${neg.listing.price} ${neg.listing.currency}${minPrice != null ? `, minimum: ${minPrice} ${neg.listing.currency}` : ''}).
${steeringLine}
Negotiating against the BUYER'S AI agent. Rules:
- Accept immediately if offer >= 85% of asking (never below minimum).
- Counter at the midpoint between offer and your last price if offer is 50-85%.
- Reject if offer < 50% or below floor.
${floorRule}
- Turn ${turnCount}: after turn 6, accept any offer >= 80% of asking to close — dragging hurts both sides.
- 1-2 sentences max. Be decisive.

History:
${history}

Buyer agent: "${buyerMessage}"${proposedPrice != null ? `\nOffer: ${proposedPrice} ${neg.listing.currency}` : ''}

Respond ONLY with JSON: {"reply": "...", "proposedPrice": number_or_null, "action": "accept|reject|counter"}`;
      const res = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      });
      const parsed = this.parseJson(res.content[0].type === 'text' ? res.content[0].text : '');
      if (parsed) {
        let action: 'accept' | 'reject' | 'counter' = ['accept', 'reject', 'counter'].includes(
          parsed.action as string,
        )
          ? (parsed.action as 'accept' | 'reject' | 'counter')
          : 'counter';
        let finalPrice: number | undefined =
          parsed.proposedPrice !== null && parsed.proposedPrice !== undefined
            ? Number(parsed.proposedPrice)
            : undefined;
        if (
          minPrice !== null &&
          minPrice !== undefined &&
          finalPrice !== null &&
          finalPrice !== undefined &&
          finalPrice < (minPrice as number)
        ) {
          finalPrice = minPrice as number;
          action = 'counter';
        }
        if (
          minPrice !== null &&
          minPrice !== undefined &&
          action === 'accept' &&
          proposedPrice !== null &&
          proposedPrice !== undefined &&
          proposedPrice < (minPrice as number)
        ) {
          action = 'counter';
          finalPrice = minPrice as number;
        }
        return {
          reply: String(parsed.reply || 'Interesting offer.'),
          proposedPrice: finalPrice,
          action,
        };
      }
    } catch (err) {
      this.logger.error('Claude seller negotiate failed', err);
    }

    // Fallback
    const asking = neg.listing.price;
    const minP = neg.listing.minPrice;
    if (proposedPrice != null) {
      const ratio = proposedPrice / asking;
      if (ratio >= 0.8 && (minP == null || proposedPrice >= minP))
        return {
          reply: `Deal! I accept ${proposedPrice} ${neg.listing.currency}.`,
          proposedPrice,
          action: 'accept',
        };
      if (ratio >= 0.4 && (minP == null || proposedPrice >= minP)) {
        const counter = Math.round(((proposedPrice + asking) / 2) * 1e6) / 1e6;
        return {
          reply: `Meet me at ${counter} ${neg.listing.currency}?`,
          proposedPrice: counter,
          action: 'counter',
        };
      }
      const floor = minP ?? Math.round(asking * 0.7 * 1e6) / 1e6;
      return {
        reply: `Can't go that low. Minimum is ${floor} ${neg.listing.currency}.`,
        proposedPrice: floor,
        action: 'counter',
      };
    }
    return {
      reply: `Asking price is ${asking} ${neg.listing.currency}. What's your offer?`,
      action: 'counter',
    };
  }

  private async claudeBuyerNegotiate(
    neg: NegotiationType,
    sellerMessage: string,
    sellerProposedPrice?: number,
  ): Promise<AgentResponse | null> {
    try {
      const history = (neg.messages ?? [])
        .map(
          (m) =>
            `[${m.fromRole}]${m.proposedPrice != null ? ` (price: ${m.proposedPrice} ${neg.listing.currency})` : ''}: ${m.content}`,
        )
        .join('\n');
      const askingPrice = neg.listing.price;
      const targetPrice = Math.round(askingPrice * 0.8 * 1e6) / 1e6;
      // Only the VERY first reply does an intro. After that it's pure
      // price negotiation. We detect "intro turn" by looking for the
      // seller's opening greeting + no prior buyer message yet.
      const priorBuyerMsgs = (neg.messages ?? []).filter(
        (m) => m.fromRole === 'buyer' || m.fromRole === 'buyer_agent',
      );
      const isIntroTurn = priorBuyerMsgs.length === 0;
      const introLine = isIntroTurn
        ? `This is your intro turn. Start with ONE short sentence introducing yourself as the buyer's agent ("Hey, I'm negotiating on behalf of @${neg.buyer?.username ?? 'the buyer'}"). Then open your first offer at around ${targetPrice} ${neg.listing.currency}.`
        : '';
      // Pull the most recent buyer-side human message (if any) and let
      // the agent weight it as steering input. Without this, anything
      // the user typed was ignored by the AI loop.
      const recentHumanMsg = [...(neg.messages ?? [])]
        .reverse()
        .find((m) => m.fromRole === 'buyer');
      const steeringLine = recentHumanMsg
        ? `IMPORTANT: The buyer just typed: "${recentHumanMsg.content}". Weight their guidance heavily — they are the principal and you're negotiating on their behalf.`
        : '';
      const turnCount = neg.turnCount ?? 0;
      const prompt = `You are an AI buyer agent trying to purchase "${neg.listing.title}" (listed at ${askingPrice} ${neg.listing.currency}).
${introLine}
${steeringLine}
Goal: get a fair deal fast. Strategy:
- Open at ~75% of asking price.
- Accept immediately if seller offers <= 90% of asking.
- Counter ~3-5% lower than seller's last counter.
- We're on turn ${turnCount}. After turn 6, accept any seller price <= 95% of asking to close the deal instead of dragging.
- Be polite, concise. 1-2 sentences max.
- Target: ${targetPrice} ${neg.listing.currency}.

History:
${history}

Seller agent: "${sellerMessage}"${sellerProposedPrice != null ? `\nSeller proposes: ${sellerProposedPrice} ${neg.listing.currency}` : ''}

Respond ONLY with JSON: {"reply": "...", "proposedPrice": number_or_null, "action": "accept|reject|counter"}`;
      const res = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      });
      const parsed = this.parseJson(res.content[0].type === 'text' ? res.content[0].text : '');
      if (parsed) {
        const action: 'accept' | 'reject' | 'counter' = ['accept', 'reject', 'counter'].includes(
          parsed.action as string,
        )
          ? (parsed.action as 'accept' | 'reject' | 'counter')
          : 'counter';
        const finalPrice: number | undefined =
          parsed.proposedPrice !== null && parsed.proposedPrice !== undefined
            ? Number(parsed.proposedPrice)
            : undefined;
        return { reply: String(parsed.reply || 'Noted.'), proposedPrice: finalPrice, action };
      }
    } catch (err) {
      this.logger.error('Claude buyer negotiate failed', err);
    }

    // Fallback
    const asking = neg.listing.price;
    if (sellerProposedPrice != null) {
      if (sellerProposedPrice <= asking * 0.8)
        return {
          reply: `Works for me. I accept ${sellerProposedPrice} ${neg.listing.currency}.`,
          proposedPrice: sellerProposedPrice,
          action: 'accept',
        };
      const myCounter = Math.round(sellerProposedPrice * 0.93 * 1e6) / 1e6;
      return {
        reply: `How about ${myCounter} ${neg.listing.currency}?`,
        proposedPrice: myCounter,
        action: 'counter',
      };
    }
    const opening = Math.round(asking * 0.7 * 1e6) / 1e6;
    return {
      reply: `I'm interested. My opening offer is ${opening} ${neg.listing.currency}.`,
      proposedPrice: opening,
      action: 'counter',
    };
  }

  // ── Apply agent action ────────────────────────────────────────────────────

  private async applyAction(negId: string, response: AgentResponse, neg: NegotiationType) {
    if (response.action === 'accept') {
      const agreedPrice = response.proposedPrice ?? neg.listing.price;
      await this.prisma.agentNegotiation.update({
        where: { id: negId },
        data: { status: 'AGREED', agreedPrice },
      });
      this.gateway.emitStatusChange(negId, { status: 'AGREED', agreedPrice });
      this.notifyNegotiationEnded(negId, 'agreed', agreedPrice).catch(() => {});
      try {
        const seller = await this.prisma.user.findUnique({
          where: { id: neg.listing.sellerId },
          select: { email: true, username: true },
        });
        const buyer = await this.prisma.user.findUnique({
          where: { id: neg.buyerId },
          select: { username: true },
        });
        if (seller?.email) {
          await this.emailService
            .sendAgentDealEmail(
              seller.email,
              seller.username || 'seller',
              neg.listing.title,
              agreedPrice,
              neg.listing.currency,
              buyer?.username || 'buyer',
              negId,
            )
            .catch((err) => this.logger.error('Deal email failed', err));
        }
      } catch (err) {
        this.logger.error('Failed to send deal email', err);
      }
    } else if (response.action === 'reject') {
      await this.prisma.agentNegotiation.update({
        where: { id: negId },
        data: { status: 'REJECTED' },
      });
      this.gateway.emitStatusChange(negId, { status: 'REJECTED' });
      this.notifyNegotiationEnded(negId, 'rejected').catch(() => {});
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private negotiationInclude() {
    return {
      listing: {
        select: {
          id: true,
          title: true,
          price: true,
          currency: true,
          sellerId: true,
          agentEndpoint: true,
          minPrice: true,
          fileKey: true,
          fileName: true,
          fileMimeType: true,
        },
      },
      buyer: { select: { id: true, username: true, agentEndpoint: true } },
      messages: { orderBy: { createdAt: 'asc' as const } },
    };
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async createDealDm(
    sellerId: string,
    buyerId: string,
    listingTitle: string,
    agreedPrice: number,
    currency: string,
  ) {
    const dmContent = `Deal confirmed! Your AI agents agreed on "${listingTitle}" at ${agreedPrice} ${currency}. Use this chat to coordinate the transfer.`;
    try {
      await this.dmService.sendSystemMessage(sellerId, buyerId, dmContent);
    } catch (err) {
      this.logger.error('Failed to create deal DM', err);
    }
  }
}
