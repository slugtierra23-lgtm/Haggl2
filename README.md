# haggl Platform

> A professional full-stack Web3 memecoin platform with terminal aesthetics.

## Architecture Overview

```
haggl-platform/
├── frontend/          # Next.js 14 + TypeScript + TailwindCSS
├── backend/           # NestJS + PostgreSQL + Redis
├── docker-compose.yml # Full stack orchestration
├── .env.example       # Environment variable template
└── README.md
```

## Security Design Decisions

- **OWASP Top 10** compliance throughout
- **JWT + HttpOnly cookies** — tokens never in localStorage
- **CSRF tokens** on all state-mutating requests
- **Web3 nonce auth** — replay-attack resistant wallet login
- **Helmet.js** — secure HTTP headers (CSP, HSTS, X-Frame-Options)
- **Rate limiting** via Redis (per-IP, per-user)
- **Input sanitization** with DOMPurify (frontend) and class-validator/Zod (backend)
- **Parameterized queries** via Prisma ORM — SQL injection impossible
- **Content Security Policy** preventing XSS
- **CORS whitelist** — strict origin validation
- **Audit logs** on all sensitive operations

## Tech Stack

### Frontend
- Next.js 14 (App Router)
- TypeScript
- TailwindCSS + custom terminal theme
- ethers.js (Web3)
- socket.io-client
- recharts (price chart)
- @base/web3.js (MetaMask)

### Backend
- NestJS (Node.js)
- PostgreSQL (via Prisma ORM)
- Redis (rate limiting, sessions, nonces)
- Socket.io (WebSockets)
- Passport.js (auth strategies)
- Anthropic AI (Claude)
- Helmet, CORS, CSRF protection

### Infrastructure
- Docker + Docker Compose
- Environment variable management
- CI/CD ready

## Quick Start

### Prerequisites
- Docker & Docker Compose
- Node.js 20+
- pnpm or npm

### 1. Clone & Configure

```bash
cp .env.example .env
# Edit .env with your values
```

### 2. Start with Docker

```bash
docker-compose up -d
```

### 3. Local Development

```bash
# Backend
cd backend
npm install
npm run prisma:migrate
npm run start:dev

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

## Environment Variables

See `.env.example` for all required variables.

**Critical variables:**
- `GEMINI_API_KEY` — Google AI Studio key
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` — GitHub OAuth app
- `JWT_SECRET` — 64+ character random string
- `DATABASE_URL` — PostgreSQL connection string
- `REDIS_URL` — Redis connection string

## Deployment

### Docker (Production)

```bash
docker-compose -f docker-compose.prod.yml up -d
```

### Environment Checklist
- [ ] All secrets rotated from defaults
- [ ] HTTPS/TLS configured
- [ ] Firewall rules applied
- [ ] Rate limiting tuned
- [ ] CORS origins set to production domains
- [ ] CSP headers verified

## Security Notes

This platform implements defense-in-depth:
1. No secrets ever reach the browser
2. All user input is sanitized before storage and display
3. Wallet auth uses cryptographic signature verification
4. Rate limiting prevents brute force and spam
5. All database queries use parameterized statements

## License

MIT
