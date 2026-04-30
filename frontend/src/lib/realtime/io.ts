import {
  io as realIo,
  type Socket,
  type ManagerOptions,
  type SocketOptions,
} from 'socket.io-client';

const DEMO_MODE = typeof process !== 'undefined' && process.env.NEXT_PUBLIC_DEMO_MODE === '1';

// Stub Socket that satisfies the surface used across the app: on/off/emit/
// connect/disconnect, plus the boolean `connected` getter. All methods are
// no-ops so demo-mode pages don't open a WebSocket and hammer reconnects
// while the backend is down.
const NOOP_SOCKET = {
  connected: false,
  on: () => NOOP_SOCKET,
  off: () => NOOP_SOCKET,
  once: () => NOOP_SOCKET,
  emit: () => NOOP_SOCKET,
  connect: () => NOOP_SOCKET,
  disconnect: () => NOOP_SOCKET,
  removeAllListeners: () => NOOP_SOCKET,
  io: { on: () => {}, off: () => {} },
} as unknown as Socket;

export function io(uri: string, opts?: Partial<ManagerOptions & SocketOptions>): Socket {
  if (DEMO_MODE) return NOOP_SOCKET;
  return realIo(uri, opts);
}

export type { Socket } from 'socket.io-client';
