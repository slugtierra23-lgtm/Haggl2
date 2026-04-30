/**
 * Canonical app-style primitives.
 *
 * These wrap the .mk-* CSS classes already in globals.css so every
 * page renders the same Button / Card / Badge / Stat / EmptyState.
 *
 * Rules of use:
 *  - DON'T add inline `style={{ background: 'linear-gradient(...)' }}`
 *    when one of these covers it. Variants exist for a reason.
 *  - DON'T import from `@/components/ui/button.tsx` or any of the
 *    legacy `Shimmer/Ripple/InteractiveHover` button variants for
 *    new app-shell pages — use <Button> from here.
 *  - Variants are composable. New variants get added here, not
 *    invented inline at the call site.
 */

'use client';

import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import React from 'react';

// ── Button ──────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

type CommonButtonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconLeft?: LucideIcon;
  iconRight?: LucideIcon;
  loading?: boolean;
  className?: string;
  children?: React.ReactNode;
};

type ButtonAsButton = CommonButtonProps &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, keyof CommonButtonProps> & {
    href?: undefined;
  };

type ButtonAsLink = CommonButtonProps & {
  href: string;
  external?: boolean;
  onClick?: never;
  type?: never;
  disabled?: boolean;
};

export type ButtonProps = ButtonAsButton | ButtonAsLink;

function classes(
  variant: ButtonVariant,
  size: ButtonSize,
  loading: boolean,
  className: string | undefined,
): string {
  const v =
    variant === 'primary'
      ? 'mk-btn--primary'
      : variant === 'danger'
        ? 'mk-btn--danger'
        : variant === 'secondary'
          ? 'mk-btn--secondary'
          : 'mk-btn--ghost';
  const s = size === 'sm' ? 'mk-btn--sm' : '';
  return ['mk-btn', v, s, loading ? 'mk-btn--loading' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
}

export function Button(props: ButtonProps) {
  const {
    variant = 'secondary',
    size = 'md',
    iconLeft: IconLeft,
    iconRight: IconRight,
    loading = false,
    className,
    children,
    ...rest
  } = props as CommonButtonProps & Record<string, unknown>;

  const cls = classes(variant, size, loading, className);

  const inner = (
    <>
      {loading ? (
        <span
          className="mk-btn__spinner"
          aria-hidden
          style={{
            width: 12,
            height: 12,
            borderRadius: '50%',
            border: '2px solid currentColor',
            borderTopColor: 'transparent',
            display: 'inline-block',
            animation: 'mk-spin 0.7s linear infinite',
          }}
        />
      ) : IconLeft ? (
        <IconLeft className="w-3.5 h-3.5" strokeWidth={2} aria-hidden />
      ) : null}
      {children != null && <span className="mk-btn__label">{children}</span>}
      {IconRight && !loading && <IconRight className="w-3.5 h-3.5" strokeWidth={2} aria-hidden />}
    </>
  );

  if ('href' in props && props.href != null) {
    const linkProps = rest as { external?: boolean };
    if (linkProps.external) {
      return (
        <a href={props.href} className={cls} target="_blank" rel="noopener noreferrer">
          {inner}
        </a>
      );
    }
    return (
      <Link href={props.href} className={cls}>
        {inner}
      </Link>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const btnProps = rest as any;
  return (
    <button
      type={btnProps.type ?? 'button'}
      disabled={btnProps.disabled || loading}
      className={cls}
      {...btnProps}
    >
      {inner}
    </button>
  );
}

// ── Card ────────────────────────────────────────────────────────────

export function Card({
  as: As = 'div',
  className,
  interactive = false,
  children,
  ...rest
}: {
  as?: React.ElementType;
  className?: string;
  interactive?: boolean;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <As
      className={['mk-card-flat', interactive ? 'mk-card-flat--interactive' : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </As>
  );
}

// ── Badge ───────────────────────────────────────────────────────────

type BadgeVariant = 'neutral' | 'live' | 'offline' | 'warn' | 'info';

export function Badge({
  variant = 'neutral',
  icon: Icon,
  children,
  className,
}: {
  variant?: BadgeVariant;
  icon?: LucideIcon;
  children: React.ReactNode;
  className?: string;
}) {
  const v =
    variant === 'live'
      ? 'mk-badge2--live'
      : variant === 'offline'
        ? 'mk-badge2--offline'
        : variant === 'warn'
          ? 'mk-badge2--warn'
          : variant === 'info'
            ? 'mk-badge2--info'
            : 'mk-badge2--neutral';
  return (
    <span className={['mk-badge2', v, className ?? ''].filter(Boolean).join(' ')}>
      {variant === 'live' && <span className="mk-badge2__dot" aria-hidden />}
      {Icon && <Icon className="w-2.5 h-2.5" strokeWidth={2} aria-hidden />}
      {children}
    </span>
  );
}

// ── EmptyState ──────────────────────────────────────────────────────

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; href?: string; onClick?: () => void };
}) {
  return (
    <div className="mk-empty2">
      {Icon && (
        <span className="mk-empty2__icon" aria-hidden>
          <Icon className="w-5 h-5" strokeWidth={2} />
        </span>
      )}
      <div className="mk-empty2__title">{title}</div>
      {description && <div className="mk-empty2__sub">{description}</div>}
      {action &&
        (action.href ? (
          <Link href={action.href} className="mk-btn mk-btn--primary mk-empty2__cta">
            {action.label}
          </Link>
        ) : (
          <button
            type="button"
            onClick={action.onClick}
            className="mk-btn mk-btn--primary mk-empty2__cta"
          >
            {action.label}
          </button>
        ))}
    </div>
  );
}

// ── Stat (used inside StatStrip) ────────────────────────────────────

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="mk-stat">
      <div className="mk-stat__label">{label}</div>
      <div className="mk-stat__value">{value}</div>
      {hint && <div className="mk-stat__hint">{hint}</div>}
    </div>
  );
}

export function StatStrip({ children }: { children: React.ReactNode }) {
  return <div className="mk-stats">{children}</div>;
}

// ── Hero ────────────────────────────────────────────────────────────

export function Hero({
  crumbs,
  title,
  subtitle,
  cta,
  children,
}: {
  crumbs?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  cta?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="mk-hero">
      {crumbs && <div className="mk-hero__crumbs">{crumbs}</div>}
      <div className="mk-hero__row">
        <div>
          <h1 className="mk-hero__title">{title}</h1>
          {subtitle && <p className="mk-hero__sub">{subtitle}</p>}
        </div>
        {cta}
      </div>
      {children}
    </div>
  );
}
