# haggl — Deploy guide

End-to-end deployment of the haggl marketplace:

- **Frontend** → Vercel (Next.js 14 app under `frontend/`).
- **Backend** → Render (NestJS service under `backend/`) + managed Postgres + Redis.
- **DNS** → Cloudflare or any registrar (apex `haggl.tech` + `api.haggl.tech`).

Total cost (smallest plans): ~$14/mo (Render starter + DB + KV) + $0 (Vercel hobby).

---

## Pre-flight

1. Push the repo to GitHub (private is fine — Render and Vercel both work with private repos via OAuth).
2. Make sure `frontend/.env.local` and `backend/.env` are `.gitignore`'d (already done in this repo).
3. Have these third-party accounts ready:
   - **Resend** (transactional email) — get an API key + verify the `haggl.tech` sender.
   - **GitHub OAuth App** — name it `haggl`, callback `https://api.haggl.tech/api/v1/auth/github/callback`.
   - **X (Twitter) OAuth 2.0 App** — same idea, callback `https://api.haggl.tech/api/v1/auth/twitter/callback`.
   - **Anthropic** API key (for the in-app AI chat).
   - **Solana RPC** URL (Helius / QuickNode, or Solana mainnet public endpoint for read-only).

---

## 1) Backend on Render

### Provision

1. Render → **New** → **Blueprint** → connect this repo.
2. Render reads `render.yaml` and provisions three resources:
   - `haggl-postgres` (Postgres 16, starter)
   - `haggl-redis` (Key-Value, starter)
   - `haggl-backend` (web service, Node, starter)
3. Wait ~5 min for first deploy. The build runs:
   ```
   npm install --legacy-peer-deps && npx prisma generate && npm run build
   ```
   The start command runs migrations then boots:
   ```
   npx prisma migrate deploy && node dist/main.js
   ```

### Set the secrets (Render → Environment tab on `haggl-backend`)

The `render.yaml` already wires `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`,
`SESSION_SECRET`, `CSRF_SECRET`, `AGENT_HMAC_SECRET` for you. You need to add:

| Variable | Where to get it |
|---|---|
| `RESEND_API_KEY` | resend.com → API Keys |
| `EMAIL_FROM` | e.g. `haggl <noreply@haggl.tech>` |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | github.com/settings/developers |
| `X_CLIENT_ID` / `X_CLIENT_SECRET` | developer.x.com → projects |
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `ETH_RPC_URL` | Helius / QuickNode (or Solana public RPC) |
| `HAGGL_TOKEN_ADDRESS` / `HAGGL_TOKEN_CONTRACT` | your token mint + escrow program addresses |

### Health check

After deploy, verify:
```
curl https://<your-backend>.onrender.com/api/v1/health
# → {"status":"ok","checks":{"app":"ok","db":"ok","redis":"ok"}}
```

If `db` or `redis` is `down`, the build is OK but the env wiring failed.
Recheck `DATABASE_URL` and `REDIS_URL` in the dashboard.

### Custom domain (optional but recommended)

1. Render → `haggl-backend` → **Settings** → **Custom Domains** → add `api.haggl.tech`.
2. At your DNS provider, create a `CNAME` record:
   `api → <your-backend>.onrender.com`.
3. Wait for the cert (~2 min).

---

## 2) Frontend on Vercel

### Import

1. Vercel → **Add New Project** → connect the same repo.
2. **Root Directory** → set to `frontend/`. (This is the critical step — without it Vercel tries to build from the monorepo root.)
3. Framework Preset = Next.js (auto-detected).
4. Leave the build / install / output commands at defaults — `frontend/vercel.json` overrides them.

### Environment variables (Vercel → Settings → Environment Variables)

```
NEXT_PUBLIC_API_URL = https://api.haggl.tech/api/v1
NEXT_PUBLIC_WS_URL  = https://api.haggl.tech
NEXT_PUBLIC_ESCROW_CONTRACT = <your escrow program address>
```

Set each for **Production, Preview and Development**. Save → trigger a redeploy.

### Custom domain

1. Vercel → Project → **Settings** → **Domains** → add `haggl.tech` and `www.haggl.tech`.
2. At your DNS provider:
   - `A` record `@` → `76.76.21.21` (Vercel's anycast)
   - `CNAME` `www` → `cname.vercel-dns.com`
3. Vercel issues the cert automatically.

---

## 3) After both are live: connect them

On **Render → `haggl-backend` → Environment**, update:

```
FRONTEND_URL    = https://haggl.tech
CORS_ORIGINS    = https://haggl.tech,https://www.haggl.tech
COOKIE_DOMAIN   = .haggl.tech
```

If you want Vercel preview deploys to talk to the prod backend too, expand
`CORS_ORIGINS` to a regex-like list:

```
CORS_ORIGINS = https://haggl.tech,https://www.haggl.tech,https://*.vercel.app
```
(The backend code splits on commas; wildcards work because the matcher is a
simple `includes`. For a strict whitelist replace `*.vercel.app` with the
specific preview URL.)

Update OAuth callbacks in GitHub and X to point to `https://api.haggl.tech/...`.

Redeploy the backend (Render → Manual Deploy → Deploy latest commit).

---

## 4) First-run smoke test

```bash
# Frontend
curl -I https://haggl.tech                                   # expect 200
curl -I https://haggl.tech/market                            # expect 200

# Backend
curl https://api.haggl.tech/api/v1/health                    # expect ok/ok/ok
curl -X POST https://api.haggl.tech/api/v1/auth/wallet/nonce \
  -H 'Content-Type: application/json' \
  -d '{"address":"0x0000000000000000000000000000000000000000"}'
# expect 200 with {nonce, message}
```

Sign in via wallet on `/auth` — you should be able to:
1. Connect MetaMask / Phantom
2. Land on `/market`
3. See live trade ticker (eventually populated by socket events)

---

## 5) Common deploy gotchas

- **`Cannot find module './XXXX.js'`** on dev server → stale `.next` cache from running `next build` while `next dev` was up. Fix: `rm -rf frontend/.next && npm run dev`.
- **CORS blocked origin** → the value in `CORS_ORIGINS` doesn't exactly match the request origin (trailing slash, `www` vs apex, http vs https). Open Network tab, copy the exact `Origin` header, paste into the env var.
- **`prisma migrate deploy` fails** on Render → migration files in `backend/prisma/migrations/` weren't checked in. Verify they're tracked by git, push, redeploy.
- **Cookies not set after login** → `COOKIE_DOMAIN` mismatch. For prod set `.haggl.tech`. For Vercel previews leave it unset.
- **Slow first request after idle** → Render starter plans cold-start. Upgrade to `standard` ($7/mo) for warm always-on.
- **WebSocket disconnects** → Render web services support WS by default but the connection upgrades through the same port. Check that `NEXT_PUBLIC_WS_URL` doesn't include `/api/v1`.

---

## 6) Post-launch checklist

- [ ] Set up Vercel Analytics on the frontend project.
- [ ] Set up Render → Notifications → Slack on backend deploys.
- [ ] Add status badges to the README pointing at `/api/v1/health`.
- [ ] Configure `RESEND_API_KEY` and verify outgoing email lands.
- [ ] Verify GitHub OAuth round-trip end-to-end.
- [ ] Run a real escrow transaction on devnet from the deployed app.
- [ ] Snapshot the database (Render → Postgres → Backups → Manual snapshot).
