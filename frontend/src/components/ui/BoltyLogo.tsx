'use client';

import React, { useEffect, useState } from 'react';

/** SVG logo — lightning bolt inside rounded square */
export function BoltyLogoSVG({
  size = 40,
  className = '',
  color = '#14F195',
  opacity = 1,
}: {
  size?: number;
  className?: string;
  color?: string;
  opacity?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ opacity }}
    >
      <rect
        x="8"
        y="8"
        width="84"
        height="84"
        rx="22"
        ry="22"
        stroke={color}
        strokeWidth="5"
        fill="none"
      />
      <path d="M56 16 L36 52 L48 52 L42 84 L68 44 L54 44 L62 16 Z" fill={color} />
    </svg>
  );
}

interface BoltyLogoProps {
  className?: string;
  size?: number;
  style?: React.CSSProperties;
  color?: string;
}

export function BoltyLogo({ className = '', size = 40, style, color }: BoltyLogoProps) {
  return (
    <div
      className={className}
      style={{ width: size, height: size, display: 'inline-flex', ...style }}
    >
      <BoltyLogoSVG size={size} color={color} />
    </div>
  );
}

/** Full-size logo with drop-shadow glow */
export function BoltyLogoGlow({ size = 40 }: { size?: number }) {
  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <div
        className="absolute inset-0 rounded-full opacity-50 blur-lg"
        style={{
          background: 'radial-gradient(circle, rgba(20, 241, 149, 0.7) 0%, transparent 70%)',
        }}
      />
      <BoltyLogo size={size} style={{ position: 'relative', zIndex: 10 }} />
    </div>
  );
}

/** Floating background logos that fade in/out at random positions */
export function BoltyFloatingLogos() {
  const [logos, setLogos] = useState<
    Array<{
      id: number;
      x: number;
      y: number;
      size: number;
      delay: number;
      duration: number;
    }>
  >([]);

  useEffect(() => {
    const items = Array.from({ length: 8 }, (_, i) => ({
      id: i,
      x: 5 + Math.random() * 85,
      y: 5 + Math.random() * 85,
      size: 40 + Math.random() * 60,
      delay: Math.random() * 6,
      duration: 4 + Math.random() * 4,
    }));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLogos(items);
  }, []);

  if (logos.length === 0) return null;

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      {logos.map((l) => (
        <div
          key={l.id}
          className="absolute"
          style={{
            left: `${l.x}%`,
            top: `${l.y}%`,
            animation: `bolty-float-fade ${l.duration}s ease-in-out ${l.delay}s infinite`,
            opacity: 0,
          }}
        >
          <BoltyLogoSVG size={l.size} color="rgba(20, 241, 149, 0.06)" />
        </div>
      ))}
      <style>{`
        @keyframes bolty-float-fade {
          0%, 100% { opacity: 0; transform: translateY(8px) scale(0.95); }
          30%, 70% { opacity: 1; transform: translateY(-4px) scale(1); }
        }
      `}</style>
    </div>
  );
}
