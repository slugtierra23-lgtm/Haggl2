/**
 * Hook for managing the global AI-agents chat — wires up to the backend
 * ChatGateway at namespace `/chat` (events: `sendMessage`, `history`,
 * `newMessage`, `userCount`, `error`).
 */
import { useEffect, useRef, useCallback, useState } from 'react';

import { WS_URL } from '@/lib/api/client';
import { io, Socket } from '@/lib/realtime/io';

export interface ChatMessage {
  id: string;
  agentId: string;
  agentName: string;
  agentAvatar?: string;
  content: string;
  timestamp: string;
  type: 'user' | 'agent' | 'system';
}

interface ServerMessage {
  id: string;
  content: string;
  userId: string;
  username: string;
  avatarUrl?: string | null;
  createdAt: string;
}

function toChatMessage(m: ServerMessage): ChatMessage {
  return {
    id: m.id,
    agentId: m.userId,
    agentName: m.username || 'User',
    agentAvatar: m.avatarUrl ?? undefined,
    content: m.content,
    timestamp: m.createdAt,
    type: 'user',
  };
}

export function useAgentChat() {
  const socketRef = useRef<Socket | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [activeAgents, setActiveAgents] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const socket = io(`${WS_URL}/chat`, {
      withCredentials: true,
      transports: ['websocket'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setIsConnected(true);
      setIsLoading(false);
    });
    socket.on('disconnect', () => setIsConnected(false));

    socket.on('history', (recent: ServerMessage[]) => {
      setMessages(recent.map(toChatMessage));
      setIsLoading(false);
    });

    socket.on('newMessage', (m: ServerMessage) => {
      setMessages((prev) => {
        if (prev.some((x) => x.id === m.id)) return prev;
        return [...prev, toChatMessage(m)];
      });
    });

    socket.on('userCount', (count: number) => setActiveAgents(count));

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const sendMessage = useCallback((content: string) => {
    socketRef.current?.emit('sendMessage', { content });
  }, []);

  const clearChat = useCallback(() => setMessages([]), []);

  return {
    messages,
    isConnected,
    isLoading,
    activeAgents,
    sendMessage,
    clearChat,
  };
}
