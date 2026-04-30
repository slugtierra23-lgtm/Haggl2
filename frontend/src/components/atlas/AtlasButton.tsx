'use client';

import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import React from 'react';

import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'shimmer';
type Size = 'sm' | 'md' | 'lg';

interface AtlasButtonBaseProps {
  variant?: Variant;
  size?: Size;
  /** Replace text with spinner; keeps width via aria-busy. */
  loading?: boolean;
  /** Stretch to full width of parent. */
  fullWidth?: boolean;
  /** Render as an icon-only square button. */
  iconOnly?: boolean;
  /** Optional left icon. */
  leftIcon?: React.ReactNode;
  /** Optional right icon. */
  rightIcon?: React.ReactNode;
  className?: string;
}

type AtlasButtonProps = AtlasButtonBaseProps &
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    href?: never;
  };

type AtlasLinkProps = AtlasButtonBaseProps &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
    href: string;
    /** External link — open in new tab + rel noopener. */
    external?: boolean;
  };

const sizeClass: Record<Size, string> = {
  sm: 'h-8 px-3 text-[12px] rounded-lg gap-1.5',
  md: 'h-9 px-3.5 text-[13px] rounded-lg gap-1.5',
  lg: 'h-11 px-5 text-[14px] rounded-xl gap-2',
};

const iconOnlyClass: Record<Size, string> = {
  sm: 'h-8 w-8 p-0 rounded-lg',
  md: 'h-9 w-9 p-0 rounded-lg',
  lg: 'h-11 w-11 p-0 rounded-xl',
};

const variantClass: Record<Variant, string> = {
  // Pure black/white pill — same language as .atlas-cta. Visible on both
  // dark and light surfaces without any green wash. Bold weight so the
  // text reads at any size; AAA contrast against either surface.
  primary: cn('atlas-cta', '!font-semibold'),
  secondary: cn(
    'bg-[var(--bg-card)] text-[var(--text)] border border-[var(--border)]',
    'hover:bg-[var(--bg-card2)] hover:border-[var(--border-hover)]',
  ),
  ghost:
    'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-card2)] hover:text-[var(--text)]',
  danger:
    'bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 hover:text-red-300',
  shimmer: 'atlas-shimmer-btn bg-[var(--bg-card)] text-[var(--text)] border border-[var(--border)]',
};

const baseClass = cn(
  'relative inline-flex items-center justify-center font-medium tracking-tight',
  'transition-all duration-150 ease-out',
  'disabled:opacity-50 disabled:pointer-events-none',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]',
  'active:scale-[0.985]',
);

/**
 * AtlasButton — single button primitive. Renders a `<button>`; pass `href` to
 * render a Next.js `<Link>` instead. The `shimmer` variant runs a slow
 * gradient sheen across the button (CSS keyframe in globals.css).
 */
export function AtlasButton(props: AtlasButtonProps): JSX.Element;
export function AtlasButton(props: AtlasLinkProps): JSX.Element;
export function AtlasButton({
  variant = 'secondary',
  size = 'md',
  loading,
  fullWidth,
  iconOnly,
  leftIcon,
  rightIcon,
  className,
  children,
  ...rest
}: AtlasButtonProps | AtlasLinkProps) {
  const cls = cn(
    baseClass,
    iconOnly ? iconOnlyClass[size] : sizeClass[size],
    variantClass[variant],
    fullWidth && 'w-full',
    className,
  );

  const inner = (
    <>
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} />
      ) : (
        <>
          {leftIcon}
          {!iconOnly && children}
          {rightIcon}
          {iconOnly && children}
        </>
      )}
    </>
  );

  if ('href' in rest && rest.href) {
    const { href, external, ...anchorRest } = rest as AtlasLinkProps;
    if (external) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className={cls} {...anchorRest}>
          {inner}
        </a>
      );
    }
    return (
      <Link href={href} className={cls} {...anchorRest}>
        {inner}
      </Link>
    );
  }

  const { type = 'button', ...buttonRest } = rest as AtlasButtonProps;
  return (
    <button
      type={type}
      className={cls}
      aria-busy={loading || undefined}
      disabled={loading || (rest as AtlasButtonProps).disabled}
      {...buttonRest}
    >
      {inner}
    </button>
  );
}

export default AtlasButton;
