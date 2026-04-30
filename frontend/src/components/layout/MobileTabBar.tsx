'use client';

import { LayoutGrid, Package, ShoppingBag, User } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Bottom tab bar — only shown on mobile (lg:hidden). The hamburger drawer
 * stays for secondary nav (Settings, etc.) but the most-used
 * destinations move to a persistent tab bar so the app feels native on a
 * phone.
 */
const TABS: Array<{
  href: string;
  label: string;
  icon: typeof LayoutGrid;
  matches: (pathname: string) => boolean;
}> = [
  {
    href: '/market',
    label: 'Market',
    icon: LayoutGrid,
    matches: (p) => p === '/market' || p.startsWith('/market/'),
  },
  {
    href: '/inventory',
    label: 'Items',
    icon: Package,
    matches: (p) => p === '/inventory',
  },
  {
    href: '/orders',
    label: 'Orders',
    icon: ShoppingBag,
    matches: (p) => p === '/orders' || p.startsWith('/orders/'),
  },
  {
    href: '/profile',
    label: 'Profile',
    icon: User,
    matches: (p) => p === '/profile' || p.startsWith('/profile/'),
  },
];

export function MobileTabBar() {
  const pathname = usePathname();
  return (
    <nav className="mk-mobile-tabbar lg:hidden" role="navigation" aria-label="Primary">
      {TABS.map((t) => {
        const active = t.matches(pathname);
        const Icon = t.icon;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`mk-mobile-tab ${active ? 'mk-mobile-tab--active' : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            <Icon className="mk-mobile-tab__icon" strokeWidth={active ? 2.2 : 1.8} aria-hidden />
            <span className="mk-mobile-tab__label">{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
