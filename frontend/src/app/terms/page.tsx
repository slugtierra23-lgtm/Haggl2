'use client';

import { FileText } from 'lucide-react';
import React from 'react';

import { LegalPage, type LegalSection } from '@/components/ui/legal-page';

const SECTIONS: LegalSection[] = [
  {
    id: 'acceptance',
    title: '1. Acceptance of terms',
    body: (
      <>
        <p>
          By creating an account on Atlas (the &ldquo;Platform&rdquo;) or using any part of it — the
          marketplace, AI agents, code repositories, escrow, wallet flows, or API — you agree to be
          bound by these Terms of Service. If you do not agree, do not use the Platform.
        </p>
        <p>
          You must be at least 18 years old and legally capable of entering into a binding contract
          in your jurisdiction.
        </p>
      </>
    ),
  },
  {
    id: 'accounts',
    title: '2. Your account',
    body: (
      <>
        <p>
          You are responsible for keeping your credentials, wallet keys, and two-factor recovery
          codes secure. Atlas cannot recover lost wallet keys or reverse transactions signed from
          your wallet.
        </p>
        <p>
          You agree to provide accurate information, maintain its accuracy, and not impersonate
          anyone else. We may suspend or delete accounts that violate these terms without notice.
        </p>
      </>
    ),
  },
  {
    id: 'acceptable-use',
    title: '3. Acceptable use',
    body: (
      <>
        <p>You may not use the Platform to:</p>
        <ul>
          <li>
            Publish, sell, or distribute malware, phishing kits, or code designed to harm systems
            you do not own.
          </li>
          <li>List content you do not have the rights to distribute (copyright, licensing).</li>
          <li>Circumvent rate limits, escrow, or payment flows.</li>
          <li>Harass, threaten, or impersonate other users.</li>
          <li>Launder funds or fund sanctioned entities.</li>
        </ul>
        <p>We reserve the right to remove listings and ban accounts that violate these rules.</p>
      </>
    ),
  },
  {
    id: 'payments',
    title: '4. Payments and escrow',
    body: (
      <>
        <p>
          Payments on Atlas settle on-chain on the Base network (Ethereum Layer 2, chainId 8453).
          Once funds are committed to the BoltyEscrow smart contract, the outcome of the trade is
          governed by that contract. Atlas is not a custodian and cannot reverse, refund, or
          intercept on-chain transactions.
        </p>
        <p>
          Atlas supports exactly two payment methods, both on Base:
          <strong> SOL</strong> (platform fee 7%) and <strong>ATLAS</strong> (platform fee 3% — the
          cheaper, preferred option). Fees are deducted automatically at settlement.
        </p>
        <p>
          You are solely responsible for paying any taxes, duties, or reporting obligations that
          apply to you under your local laws.
        </p>
      </>
    ),
  },
  {
    id: 'ip',
    title: '5. Intellectual property',
    body: (
      <>
        <p>
          You retain ownership of the content you publish. By listing a repository, agent, or
          script, you grant Atlas a non-exclusive, worldwide license to host, display, and
          distribute that content in connection with operating the Platform — nothing more.
        </p>
        <p>
          Atlas&apos;s branding, UI, and proprietary code are our property. You may not copy or
          rebrand the Platform without written permission.
        </p>
      </>
    ),
  },
  {
    id: 'disclaimers',
    title: '6. Disclaimers',
    body: (
      <>
        <p>
          The Platform is provided &ldquo;as is&rdquo; without warranties of any kind, express or
          implied. We do not guarantee that listings are safe, that sellers will deliver, or that
          the code you download is free of defects. Buyers should review each purchase
          independently.
        </p>
        <p>
          Cryptocurrency transactions are irreversible and subject to volatility. Nothing on the
          Platform constitutes financial advice.
        </p>
      </>
    ),
  },
  {
    id: 'liability',
    title: '7. Limitation of liability',
    body: (
      <>
        <p>
          To the maximum extent permitted by law, Atlas and its operators are not liable for
          indirect, incidental, or consequential damages arising from your use of the Platform,
          including lost funds, lost data, or lost profits.
        </p>
        <p>
          Our aggregate liability to you will not exceed the greater of $100 or the fees you paid to
          Atlas in the 12 months preceding the event giving rise to the claim.
        </p>
      </>
    ),
  },
  {
    id: 'termination',
    title: '8. Termination',
    body: (
      <p>
        You can delete your account at any time from your profile settings. We can suspend or
        terminate your access if you breach these terms. Sections that by their nature should
        survive termination (IP, disclaimers, liability) will.
      </p>
    ),
  },
  {
    id: 'changes',
    title: '9. Changes to these terms',
    body: (
      <p>
        We may update these terms as the Platform evolves. Material changes will be announced in-app
        and the &ldquo;last updated&rdquo; date above will change. Continued use after an update
        means you accept the new terms.
      </p>
    ),
  },
  {
    id: 'contact',
    title: '10. Contact',
    body: (
      <p>
        Questions about these terms? Reach us on{' '}
        <a
          href="https://x.com/Atlas"
          target="_blank"
          rel="noopener noreferrer"
          className="text-atlas-300 hover:text-atlas-200 underline underline-offset-2"
        >
          X
        </a>{' '}
        or through the in-app chat.
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      icon={FileText}
      lastUpdated="April 20, 2026"
      sections={SECTIONS}
    />
  );
}
