'use client';

import Link from 'next/link';
import React from 'react';

import { HagglLogoSVG } from '@/components/ui/HagglLogo';

interface FooterLink {
  title: string;
  href: string;
  external?: boolean;
}

interface FooterSection {
  label: string;
  links: FooterLink[];
}

const footerLinks: FooterSection[] = [
  {
    label: 'Product',
    links: [
      { title: 'Marketplace', href: '/market' },
      { title: 'AI Agents', href: '/market/agents' },
      { title: 'Repositories', href: '/market/repos' },
    ],
  },
  {
    label: 'Developers',
    links: [
      { title: 'API Keys', href: '/api-keys' },
      { title: 'How It Works', href: '/how-it-works' },
    ],
  },
  {
    label: 'Community',
    links: [
      { title: 'Boost System', href: '/#boost-marketplace' },
      { title: 'Twitter', href: 'https://x.com/atlasmarket', external: true },
    ],
  },
  {
    label: 'Company',
    links: [
      { title: 'Privacy', href: '/privacy' },
      { title: 'Terms', href: '/terms' },
    ],
  },
];

export function Footer() {
  return (
    <footer
      className="border-t px-6 py-10"
      style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
    >
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2.5 mb-3">
              <HagglLogoSVG size={24} />
              <span
                className="text-sm font-light tracking-tight"
                style={{
                  background: 'linear-gradient(135deg, #6ee7b7 0%, #14F195 50%, #00C853 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                Atlas
              </span>
            </div>
            <p className="text-xs text-zinc-500 leading-relaxed max-w-[200px]">
              The marketplace for AI agents on Solana.
            </p>
          </div>

          {/* Links */}
          {footerLinks.map((section) => (
            <div key={section.label}>
              <h3 className="text-xs font-light text-zinc-400 uppercase tracking-wider mb-3">
                {section.label}
              </h3>
              <ul className="space-y-1.5">
                {section.links.map((link) => (
                  <li key={link.title}>
                    {link.external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                      >
                        {link.title}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                      >
                        {link.title}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div
          className="mt-8 pt-6 border-t flex flex-col md:flex-row items-center md:justify-between gap-3"
          style={{ borderColor: 'var(--border)' }}
        >
          <p className="text-xs text-zinc-600">
            &copy; {new Date().getFullYear()} Atlas Network. All rights reserved.
          </p>
          <div className="flex items-center gap-4">
            <a
              href="https://x.com/atlasmarket"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              Twitter
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
