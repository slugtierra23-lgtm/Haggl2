# haggl scripts

Standalone utility scripts that talk to the running haggl backend through its
public API. Nothing here is deployed — these are tools you run on your laptop.

## daian-bot

A chat bot that registers (or logs into) a regular user account and posts a
random message to the global chat every ~45 seconds. It makes **no changes to
the backend** — it's just another authenticated websocket client.

Because it uses the normal signup flow, Daian will show up in the chat as a
regular user with the default **HIERRO** rank. To give it a special rank,
promote the account manually from the database (update `role` or rays balance).

### First run

```bash
cd scripts
npm install
npm run daian
```

Make sure the backend is running first (`npm run dev:backend` from repo root).

### Configuration

All optional, read from env:

| Variable           | Default                        | Notes                                           |
| ------------------ | ------------------------------ | ----------------------------------------------- |
| `BOT_API_URL`      | `http://localhost:3001/api/v1` | Backend REST base URL                           |
| `BOT_WS_URL`       | `http://localhost:3001`        | Backend websocket origin                        |
| `BOT_USERNAME`     | `daian`                        | Lowercase, 3-30 chars, `a-z0-9_-`               |
| `BOT_EMAIL`        | `daian@haggl.local`            | Only used on first run (registration)           |
| `BOT_PASSWORD`     | `DaianBot!2026`                | Must satisfy the backend password policy        |
| `BOT_INTERVAL_MS`  | `45000`                        | Minimum 11000 — chat gateway caps at 10 per 10s |
| `BOT_JITTER_MS`    | `15000`                        | Random extra delay added on top                 |

Example:

```bash
BOT_USERNAME=daian \
BOT_INTERVAL_MS=60000 \
BOT_API_URL=https://api.haggl.tech/api/v1 \
BOT_WS_URL=https://api.haggl.tech \
npm run daian
```

### How it works

1. `GET /auth/me` to receive a CSRF cookie.
2. `POST /auth/register` — on `409`/`400` it assumes the account already
   exists and moves on.
3. `POST /auth/login/email` to obtain an `access_token` JWT cookie.
4. Opens a socket.io connection to `/chat` with the JWT in the `auth`
   handshake payload.
5. Every `BOT_INTERVAL_MS + jitter` ms, picks a random line from the internal
   pool and emits `sendMessage`.

If the socket disconnects (network hiccup, token expiry) it re-authenticates
and reconnects automatically.

### Running more bots

Copy the env vars with different values and start more processes. Each bot
needs a unique `BOT_USERNAME`/`BOT_EMAIL`.
