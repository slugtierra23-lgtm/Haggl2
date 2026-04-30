'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { WS_URL } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/AuthProvider';
import type { NotificationItem, NotificationType } from '@/lib/hooks/useNotifications';
import { useToast, type ToastType } from '@/lib/hooks/useToast';
import { io, Socket } from '@/lib/realtime/io';

const TYPE_TOAST: Record<NotificationType, ToastType> = {
  MARKET_NEW_SALE: 'success',
  MARKET_NEW_REVIEW: 'info',
  MARKET_ORDER_DELIVERED: 'info',
  MARKET_ORDER_COMPLETED: 'success',
  MARKET_NEGOTIATION_MESSAGE: 'info',
  SYSTEM: 'info',
};

export function LiveToastBridge() {
  const { isAuthenticated } = useAuth();
  const { addToast } = useToast();
  const router = useRouter();
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      return;
    }

    // Notifications namespace (sales, reviews, deliveries, etc.)
    const socket = io(`${WS_URL}/notifications`, {
      withCredentials: true,
      transports: ['websocket'],
    });
    socketRef.current = socket;

    socket.on('notification:new', (n: NotificationItem) => {
      const kind = TYPE_TOAST[n.type] ?? 'info';
      const snippet = n.body ? ` · ${n.body}` : '';
      const text = `${n.title}${snippet}`.slice(0, 160);
      addToast(text, kind, 10_000);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [isAuthenticated, addToast, router]);

  return null;
}
