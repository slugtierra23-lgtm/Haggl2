import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import React from 'react';

import './globals.css';
import { ClientShell } from '@/components/layout/ClientShell';
import { ToastContainer } from '@/components/ui/Toast';
import { AuthProvider } from '@/lib/auth/AuthProvider';
import { ToastProvider } from '@/lib/hooks/useToast';
import { ThemeProvider } from '@/lib/theme/ThemeContext';

// Inter is the primary UI font — self-hosted + async-loaded via next/font so
// the browser can render text immediately instead of waiting on a blocking
// stylesheet from fonts.googleapis.com. Geist / Geist Mono are loaded
// asynchronously in <head> below (the `Geist` family isn't exposed by
// next/font/google in Next 14, so we keep a non-blocking <link>).
const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800', '900'],
  variable: '--font-inter',
  display: 'swap',
  preload: true,
});

const BASE_URL = 'https://haggl.tech';

// Responsive viewport — without this, mobile browsers render the page
// at the virtual 980px layout width and scale it down, which is why
// the dashboard looked catastrophically broken on phones even with
// correct responsive CSS.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: '#07070a',
};

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  // Browser-tab title only — uppercase brand, no tagline. OpenGraph /
  // Twitter / body copy below keep the lowercase "haggl" wordmark.
  title: {
    default: 'HAGGL',
    template: '%s | HAGGL',
  },
  description:
    'haggl is the marketplace for AI agents on Solana. Discover, buy, and sell AI agents and code. Pay with SOL.',
  keywords: [
    'haggl',
    'haggl tech',
    'haggl market',
    'ai agents marketplace',
    'solana ai agents',
    'solana marketplace',
    'pumpfun',
    'ai agents',
    'agent marketplace',
    'code marketplace',
    'web3 ai',
    'solana',
  ],
  authors: [{ name: 'haggl', url: BASE_URL }],
  creator: 'haggl',
  publisher: 'haggl',
  category: 'technology',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: BASE_URL,
    siteName: 'haggl',
    title: 'haggl — The marketplace for AI agents on Solana',
    description:
      'Discover, buy, and sell AI agents on Solana. Pay with SOL. Built for the agent economy.',
    images: [
      {
        url: `${BASE_URL}/og-image.png`,
        width: 1200,
        height: 630,
        alt: 'haggl — The marketplace for AI agents on Solana',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'haggl — The marketplace for AI agents on Solana',
    description: 'Discover, buy, and sell AI agents on Solana. Pay with SOL.',
    images: [`${BASE_URL}/og-image.png`],
    creator: '@hagglhq',
    site: '@hagglhq',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  alternates: {
    canonical: BASE_URL,
  },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'haggl',
  url: BASE_URL,
  logo: `${BASE_URL}/icon.png`,
  description:
    'haggl is the marketplace for AI agents on Solana. Discover, buy, and sell AI agents and code.',
  sameAs: ['https://twitter.com/hagglhq'],
  contactPoint: {
    '@type': 'ContactPoint',
    contactType: 'customer support',
    url: `${BASE_URL}/chat`,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={inter.variable}>
      <head>
        {/* Explicit viewport meta as a belt-and-suspenders backup to the
            `export const viewport` above — some deploy pipelines strip or
            reorder the auto-injected tag, and without it mobile browsers
            render at ~980px and scale down. */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=5, viewport-fit=cover"
        />
        {/* Non-blocking Geist + Geist Mono. React 18 rejects string event
             handlers (`onLoad="..."` would crash hydration with error
             #231), so the async-CSS swap is injected client-side via a
             tiny inline script. <noscript> below covers JS-disabled. */}
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){var l=document.createElement('link');l.rel='stylesheet';l.href='https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500&display=swap';l.media='print';l.onload=function(){this.media='all';};document.head.appendChild(l);})();",
          }}
        />
        <noscript>
          <link
            rel="stylesheet"
            href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500&display=swap"
          />
        </noscript>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="min-h-screen">
        <ThemeProvider>
          <ToastProvider>
            <AuthProvider>
              <ClientShell>{children}</ClientShell>
            </AuthProvider>
            <ToastContainer />
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
