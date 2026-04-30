import { useCallback, useEffect, useRef, useState } from 'react';

import { api, WS_URL } from '@/lib/api/client';
import { io, Socket } from '@/lib/realtime/io';

export type NotificationType =
  | 'MARKET_NEW_SALE'
  | 'MARKET_NEW_REVIEW'
  | 'MARKET_ORDER_DELIVERED'
  | 'MARKET_ORDER_COMPLETED'
  | 'MARKET_NEGOTIATION_MESSAGE'
  | 'SYSTEM';

export interface NotificationItem {
  id: string;
  createdAt: string;
  readAt: string | null;
  type: NotificationType;
  title: string;
  body: string | null;
  url: string | null;
  meta: Record<string, unknown> | null;
}

export function useNotificationsPoll(
  isAuthenticated: boolean,
  onNew?: (notification: NotificationItem) => void,
) {
  const [count, setCount] = useState(0);
  const socketRef = useRef<Socket | null>(null);
  const onNewRef = useRef(onNew);
  useEffect(() => {
    onNewRef.current = onNew;
  });

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<{ count: number }>('/notifications/unread-count');
      setCount(data.count ?? 0);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      setCount(0);
      socketRef.current?.disconnect();
      socketRef.current = null;
      return;
    }

    refresh();

    // Real-time push: open a socket on /notifications and react to pushes
    const socket = io(`${WS_URL}/notifications`, {
      withCredentials: true,
      transports: ['websocket'],
      timeout: 8000,
      reconnectionAttempts: 5,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3000,
    });
    socketRef.current = socket;

    socket.on('notification:new', (notification: NotificationItem) => {
      setCount((c) => c + 1);
      onNewRef.current?.(notification);
    });
    socket.on('notification:read', () => {
      setCount((c) => Math.max(0, c - 1));
    });
    socket.on('notification:read-all', () => {
      setCount(0);
    });

    // Fallback polling every 60s in case the socket drops silently
    const interval = setInterval(refresh, 60_000);

    return () => {
      clearInterval(interval);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [isAuthenticated, refresh]);

  return { count, refresh, setCount };
}

export async function fetchNotifications(unreadOnly = false, take = 30) {
  const params = new URLSearchParams();
  if (unreadOnly) params.set('unread', '1');
  params.set('take', String(take));
  return api.get<{ items: NotificationItem[]; unreadCount: number }>(
    `/notifications?${params.toString()}`,
  );
}

export async function markNotificationRead(id: string) {
  await api.post(`/notifications/${id}/read`, {});
}

export async function markAllNotificationsRead() {
  await api.post('/notifications/read-all', {});
}
