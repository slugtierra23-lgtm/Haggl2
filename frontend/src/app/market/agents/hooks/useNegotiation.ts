/**
 * Hook for managing agent negotiation WebSocket connection
 */
import { useEffect, useRef, useCallback } from 'react';

import { WS_URL } from '@/lib/api/client';
import { io, Socket } from '@/lib/realtime/io';

import type { NegotiationMessage, Negotiation } from '../types';

export function useNegotiation(
  negotiationId: string | null,
  onMessageReceived?: (message: NegotiationMessage) => void,
  onNegotiationUpdate?: (negotiation: Negotiation) => void,
) {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!negotiationId) return;

    // Initialize WebSocket connection
    const socket = io(WS_URL, {
      path: '/socket.io',
      query: { negotiationId },
      withCredentials: true,
    });

    socket.on('message', (message: NegotiationMessage) => {
      onMessageReceived?.(message);
    });

    socket.on('negotiation_update', (negotiation: Negotiation) => {
      onNegotiationUpdate?.(negotiation);
    });

    socket.on('disconnect', () => {
      console.log('Negotiation socket disconnected');
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [negotiationId, onMessageReceived, onNegotiationUpdate]);

  const sendMessage = useCallback((content: string, proposedPrice?: number) => {
    if (!socketRef.current) return;

    socketRef.current.emit('send_message', {
      content,
      proposedPrice,
    });
  }, []);

  return { sendMessage };
}
