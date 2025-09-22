# GitHub Dashboard

GitHub Dashboard monitors GitHub activity from a single dashboard.

## Prerequisites

- Node.js 22+
- npm 10+
- A GitHub personal access token with `read:user` and repository metadata
  scopes (`GITHUB_TOKEN`)

## Local Development

1. Install dependencies:

   ```bash
   npm install
   ```

2. Provide your GitHub token for local development (`npm run dev` reads from `.env.local`
   or the current shell):

   ```bash
   export GITHUB_TOKEN=ghp_your_token
   ```

3. Start the dev server:

   ```bash
   npm run dev
   ```

4. Visit `http://localhost:3000` for the landing page and
   `http://localhost:3000/github-test` to run the GitHub API connectivity
   check.

The `/github-test` page shows the authenticated viewer, rate-limit information,
and a repo lookup form powered by React Hook Form, Zod validation, and the
GitHub GraphQL API via `graphql-request`.

## Quality Tooling

- `npm run lint` — Biome linting (Rust binary via CI and local npm package)
- `npm run format` — Biome formatter (writes changes)
- `npm run typecheck` — `tsc --noEmit`
- `npm run test` — Vitest unit and component tests
- `npm run test:watch` — watch mode
- `npm run ci` — run lint, typecheck, and tests together

## Docker

Builds use the standalone Next.js output for small production images.

```bash
./infra/nginx/certs/generate.sh
GITHUB_TOKEN=ghp_your_token docker compose up --build
```

> Tip: Docker Compose reads environment values from a `.env` file in the project
> root, so you can place `GITHUB_TOKEN=ghp_your_token` there instead of prefixing
> the command. This file is distinct from `.env.local`, which is used only by
> the local Next.js dev server.

The nginx proxy listens only on HTTPS (`https://localhost`) and redirects any
HTTP attempts to the secure endpoint.

- Node app: internal on port 3000 (reachable via the proxy only)
- nginx proxy: exposes port 443 (HTTPS) and forwards traffic to the app
  container. Certificates live in `infra/nginx/certs/`.

## Continuous Integration

`.github/workflows/ci.yml` runs on pushes and pull requests against `main` and
executes:

1. `npm ci`
2. Biome linting (`biomejs/setup-biome@v2`)
3. Type checking via `tsc --noEmit`
4. Vitest test suite

## Project Structure

```text
src/app/             → Next.js App Router routes and layouts
src/components/      → Shared UI components (shadcn/ui + custom)
src/lib/             → Utilities, env parsing, GitHub API client
src/app/api/         → Route handlers (GitHub repository summary endpoint)
infra/               → Docker/nginx assets for HTTPS proxying
```

## Environment

Environment variables are parsed through `src/lib/env.ts`. Define `GITHUB_TOKEN`
in your runtime to allow server-side GitHub API requests:

- Local dev: `.env.local` (or export in your shell before running `npm run dev`).
- Docker/production: `.env` consumed by `docker compose` or environment values
  injected by your hosting platform.
