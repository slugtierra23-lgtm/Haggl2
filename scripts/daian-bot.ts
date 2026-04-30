/**
 * Daian bot — standalone chat bot for the haggl global chat.
 *
 * Registers (or logs in) as a regular user through the public API, then
 * connects to the /chat WebSocket and posts a random message every N seconds.
 * Runs only while this process is alive — no backend changes required.
 *
 * Env:
 *   BOT_API_URL        default http://localhost:3001/api/v1
 *   BOT_WS_URL         default http://localhost:3001
 *   BOT_USERNAME       default daian
 *   BOT_EMAIL          default daian@haggl.local
 *   BOT_PASSWORD       default DaianBot!2026
 *   BOT_INTERVAL_MS    default 45000  (min 11000 — gateway rate limits 10/10s)
 *   BOT_JITTER_MS      default 15000  (adds up to +N random ms per tick)
 *
 * Usage (from repo root):
 *   cd scripts && npm install && npm start
 */

import { io, Socket } from 'socket.io-client';

// ── Config ─────────────────────────────────────────────────────────────────
const API_URL = process.env.BOT_API_URL ?? 'http://localhost:3001/api/v1';
const WS_URL = process.env.BOT_WS_URL ?? 'http://localhost:3001';
const USERNAME = process.env.BOT_USERNAME ?? 'daian';
const EMAIL = process.env.BOT_EMAIL ?? 'daian@haggl.local';
const PASSWORD = process.env.BOT_PASSWORD ?? 'DaianBot!2026';
const INTERVAL_MS = Math.max(11_000, Number(process.env.BOT_INTERVAL_MS ?? 45_000));
const JITTER_MS = Math.max(0, Number(process.env.BOT_JITTER_MS ?? 15_000));

// ── Message pool ───────────────────────────────────────────────────────────
// Short, SFW, no URLs (the backend rejects URLs), no 10+ repeated chars.
const LINES: string[] = [
  'gm builders, what are we shipping today?',
  'just pushed a new agent, feedback welcome',
  'anyone got a repo that auto-generates tests? tired of writing them',
  'yoo this escrow flow is smooth, first on-chain release felt like magic',
  'ranking system feels fair. climbing from bronce slowly',
  'dropping a Base client later, if anyone wants to review',
  'coffee. coffee. coffee.',
  'remind me: is rays multiplier capped or unbounded?',
  'the new leaderboard ui is clean, whoever shipped it 👏',
  'my agent has strong opinions about tabs vs spaces and i respect that',
  'rewriting my bio for the 4th time this week, send help',
  'shoutout to whoever is buying obscure python scripts at 3am',
  'wen staking?',
  'benchmarked claude vs gpt on tool-use yesterday, results are spicy',
  'today i learned typescript generics still have surprises for me',
  'anyone else think the chat feed is better than twitter rn',
  'watching a repo compile is basically meditation',
  'ok who put a rickroll in the agent protocol doc',
  'hot take: prompt engineering is just debugging in english',
  'just spent 2h on a bug. it was a missing comma. of course.',
  'if your agent does not have personality, is it even an agent',
  'thinking of writing a retro about my first week here',
  'someone drop a good rust to ts porting guide',
  'daily reminder: commit often, rebase bravely',
  'the marketplace categories finally make sense to me',
  'just hit platino, tiny dopamine hit',
  'low-key addicted to the notification sound',
  'who is camping the "ai" tag, share please',
  'bought my first agent today, already saved me an hour',
  'building in public is scary until it is not',
  'my code passes tests. my self-esteem does not.',
  'quick q: does anyone use the cli in production?',
  'refactoring friday, wish me luck',
  'new seller, tips welcome on pricing strategy',
  'the corner bracket ui details are so satisfying',
  'my commit messages are either haiku or screaming',
  'escrow + dispute flow is surprisingly fun to watch',
  'if you see a weird pr from me tonight, ignore it',
  'docs pr incoming, tell me if i butcher the copy',
  'finally understood websockets. i think. maybe.',
];

// ── Helpers ────────────────────────────────────────────────────────────────

function randomLine(): string {
  return LINES[Math.floor(Math.random() * LINES.length)];
}

function nextDelay(): number {
  return INTERVAL_MS + Math.floor(Math.random() * JITTER_MS);
}

function extractAccessToken(setCookie: string[] | string | null): string | null {
  if (!setCookie) return null;
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const raw of cookies) {
    const match = /(?:^|;\s*|,\s*)access_token=([^;,\s]+)/.exec(raw);
    if (match) return match[1];
  }
  return null;
}

function extractCsrfToken(setCookie: string[] | string | null): string | null {
  if (!setCookie) return null;
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const raw of cookies) {
    const match = /(?:^|;\s*|,\s*)X-CSRF-Token=([^;,\s]+)/.exec(raw);
    if (match) return match[1];
  }
  return null;
}

interface AuthResult {
  accessToken: string;
  csrfToken: string;
}

/**
 * 1. GET /auth/me to seed a CSRF cookie.
 * 2. POST /auth/register (201 on success, 409 if the user already exists).
 * 3. POST /auth/login/email to obtain access_token.
 * Returns the JWT used to authenticate the WebSocket.
 */
async function authenticate(): Promise<AuthResult> {
  // Step 1 — prime CSRF token from a safe GET.
  const primeRes = await fetch(`${API_URL}/auth/me`, { method: 'GET' });
  const csrfToken = extractCsrfToken(primeRes.headers.getSetCookie());
  if (!csrfToken) {
    throw new Error('Could not obtain CSRF cookie from /auth/me');
  }

  // Step 2 — try to register. Silently ignore 409 / 400 duplicate-user errors.
  const registerRes = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
      Cookie: `X-CSRF-Token=${csrfToken}`,
    },
    body: JSON.stringify({
      email: EMAIL,
      username: USERNAME,
      password: PASSWORD,
      occupation: 'bot',
    }),
  });

  if (registerRes.ok) {
    log(`registered new account @${USERNAME}`);
  } else if (registerRes.status === 409 || registerRes.status === 400) {
    log(`account already exists, skipping register`);
  } else {
    const body = await safeText(registerRes);
    log(`register returned ${registerRes.status}: ${body.slice(0, 200)}`);
  }

  // Step 3 — log in.
  const loginRes = await fetch(`${API_URL}/auth/login/email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
      Cookie: `X-CSRF-Token=${csrfToken}`,
    },
    body: JSON.stringify({ identifier: USERNAME, password: PASSWORD }),
  });

  if (!loginRes.ok) {
    const body = await safeText(loginRes);
    throw new Error(`Login failed (${loginRes.status}): ${body.slice(0, 300)}`);
  }

  const accessToken = extractAccessToken(loginRes.headers.getSetCookie());
  if (!accessToken) {
    throw new Error('Login OK but no access_token cookie was set');
  }

  return { accessToken, csrfToken };
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

function log(...args: unknown[]): void {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  // eslint-disable-next-line no-console
  console.log(`[daian ${ts}]`, ...args);
}

// ── Main loop ──────────────────────────────────────────────────────────────

let socket: Socket | null = null;
let sendTimer: NodeJS.Timeout | null = null;
let stopped = false;

async function connect(): Promise<void> {
  const { accessToken } = await authenticate();

  socket = io(`${WS_URL}/chat`, {
    auth: { token: accessToken },
    transports: ['websocket'],
    reconnection: false, // we handle reconnect manually (need a fresh token on expiry)
  });

  socket.on('connect', () => {
    log('connected to /chat');
    scheduleNext();
  });

  socket.on('history', (msgs: unknown[]) => {
    log(`received history (${Array.isArray(msgs) ? msgs.length : 0} msgs)`);
  });

  socket.on('newMessage', (msg: { username?: string; content?: string }) => {
    if (msg?.username && msg.username !== USERNAME) {
      const preview = (msg.content ?? '').slice(0, 60);
      log(`@${msg.username}: ${preview}`);
    }
  });

  socket.on('error', (err: { message?: string }) => {
    log('server error:', err?.message ?? err);
  });

  socket.on('disconnect', (reason) => {
    log(`disconnected (${reason}) — retrying in 5s`);
    clearSendTimer();
    if (!stopped) setTimeout(() => void reconnect(), 5_000);
  });

  socket.on('connect_error', (err) => {
    log(`connect_error: ${err.message} — retrying in 5s`);
    clearSendTimer();
    if (!stopped) setTimeout(() => void reconnect(), 5_000);
  });
}

async function reconnect(): Promise<void> {
  try {
    socket?.removeAllListeners();
    socket?.disconnect();
    socket = null;
    await connect();
  } catch (err) {
    log('reconnect failed:', (err as Error).message, '— retrying in 15s');
    if (!stopped) setTimeout(() => void reconnect(), 15_000);
  }
}

function scheduleNext(): void {
  clearSendTimer();
  const delay = nextDelay();
  sendTimer = setTimeout(() => {
    if (!socket?.connected) return;
    const line = randomLine();
    socket.emit('sendMessage', { content: line });
    log(`sent: ${line}`);
    scheduleNext();
  }, delay);
}

function clearSendTimer(): void {
  if (sendTimer) {
    clearTimeout(sendTimer);
    sendTimer = null;
  }
}

function shutdown(signal: string): void {
  log(`received ${signal}, shutting down`);
  stopped = true;
  clearSendTimer();
  socket?.disconnect();
  setTimeout(() => process.exit(0), 200);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

connect().catch((err) => {
  log('fatal:', (err as Error).message);
  process.exit(1);
});
