# Project conventions for Claude Code

> **First thing every session**: read `HANDOFF.md` at the repo root. It tracks who's working on what, recent commits, and the pending backlog so parallel agents don't step on each other.

## Git workflow

- Develop on the session branch provided by the harness (`claude/session-...`).
- When a task is complete, commit + push to that branch.
- **Always land changes on `main`**: after pushing, open a draft PR targeting `main`, mark it ready, and squash-merge it into `main`. Do this by default — the user has granted standing approval for this flow.
- Never force-push to `main`.
- Keep build artifacts (`*.tsbuildinfo`, `.next/`, `dist/`, `node_modules/`) out of commits; they are already in `.gitignore`.

## Repo layout

Monorepo with:
- `frontend/` — Next.js 14 (App Router), TypeScript, TailwindCSS, framer-motion.
- `backend/` — NestJS 10, Prisma, PostgreSQL, Redis, WebSockets.
- `contracts/` — Solidity smart contracts (HAGGL ERC20, Escrow).

## Frontend design language

When modifying pages, match the landing page style (`frontend/src/app/page.tsx`):
- Font weight 300 (`font-light`) by default.
- Primary brand color `#836EF9` (purple); accents `#06B6D4` (cyan), `#EC4899` (magenta).
- Reuse shared primitives from `frontend/src/components/ui/`:
  - `GradientText` for headings / highlighted numbers.
  - `ShimmerButton` for primary CTAs.
  - Corner brackets (`border-t-2 border-l-2 border-white/20` etc.) on hero containers.
  - Radial ambient glows as absolute-positioned background layers.
- Always render a friendly empty state when lists are empty — never leave a section visually blank.

## Checks before committing

Run from the relevant package dir (`frontend/` or `backend/`):
- `npx tsc --noEmit` — typecheck must be clean for the files you touched.
- `npx next build` (frontend) — build must succeed.
- ESLint is currently misconfigured at repo root (missing `@typescript-eslint/eslint-plugin`); skip unless fixing it is the task.
