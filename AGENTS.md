# GitHub Dashboard — Agent Guide

## Purpose

- Onboard AI/people quickly: what to run, what to watch for, and how to avoid
  common pitfalls.

## Quick dev loop

- Install: `pnpm install` → `pnpm approve-builds`
- Browsers (one-time): `pnpm exec playwright install --with-deps`
- Run dev: `pnpm dev` (Next.js 15 + Turbopack)

## Quality gates (run after every code change)

- `biome ci --error-on-warnings .` — lint/format check; warnings fail the run.
- `pnpm run typecheck` — TypeScript types; uses project tsconfig.
- `pnpm lint:md` — markdownlint for docs.

CI also reruns these on push/PR; keep them green locally to avoid surprises.

## Useful scripts

- Lint/format: `pnpm lint`, `pnpm format:check`, `pnpm format`
- Tests: `pnpm test`, `pnpm test:db` (needs Postgres), `pnpm test:e2e`
  (Playwright)
- CI bundle: `pnpm ci` (lint → typecheck → tests)

## Env basics

- Copy `.env.example` to `.env.local`; fill `GITHUB_TOKEN`, `GITHUB_ORG`,
  `GITHUB_OAUTH_CLIENT_ID/SECRET`, `APP_BASE_URL`, `DATABASE_URL`,
  `SESSION_SECRET`, `DASHBOARD_ADMIN_IDS`.
