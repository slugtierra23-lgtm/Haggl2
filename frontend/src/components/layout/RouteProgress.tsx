'use client';

import { usePathname } from 'next/navigation';
import React, { useEffect, useRef, useState } from 'react';

/**
 * Thin gradient progress bar pinned to the top of the viewport.
 * Shows whenever a route transition starts (click → new pathname) or a
 * global `Atlas:progress-start` event fires (dispatched by the API client
 * on long-running fetches). The bar animates to ~85% during loading and
 * rushes to 100% on completion, then fades out.
 */
export function RouteProgress() {
  const pathname = usePathname();
  const [active, setActive] = useState(false);
  const [percent, setPercent] = useState(0);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const pathRef = useRef(pathname);

  useEffect(() => {
    if (pathRef.current === pathname) return;
    pathRef.current = pathname;
    start();
    const done = setTimeout(finish, 450);
    timeoutsRef.current.push(done);
    return () => {
      timeoutsRef.current.forEach(clearTimeout);
      timeoutsRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    const onStart = () => start();
    const onDone = () => finish();
    window.addEventListener('haggl:progress-start', onStart);
    window.addEventListener('haggl:progress-done', onDone);
    return () => {
      window.removeEventListener('haggl:progress-start', onStart);
      window.removeEventListener('haggl:progress-done', onDone);
    };
  }, []);

  function start() {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
    setActive(true);
    setPercent(12);
    // Ease up to ~85% so the bar always shows motion while work is in flight.
    const stages = [
      { at: 60, to: 45 },
      { at: 180, to: 68 },
      { at: 380, to: 82 },
    ];
    for (const s of stages) {
      timeoutsRef.current.push(setTimeout(() => setPercent(s.to), s.at));
    }
  }

  function finish() {
    setPercent(100);
    const hide = setTimeout(() => {
      setActive(false);
      setPercent(0);
    }, 260);
    timeoutsRef.current.push(hide);
  }

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 2,
        zIndex: 100,
        pointerEvents: 'none',
        opacity: active ? 1 : 0,
        transition: 'opacity 220ms ease-out',
      }}
    >
      <div
        style={{
          height: '100%',
          width: `${percent}%`,
          background: 'linear-gradient(90deg, #06B6D4 0%, #14F195 50%, #EC4899 100%)',
          boxShadow: '0 0 10px rgba(20, 241, 149, 0.6), 0 0 4px rgba(6,182,212,0.5)',
          transition: 'width 240ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        }}
      />
    </div>
  );
}
