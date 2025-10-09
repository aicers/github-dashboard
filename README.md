# GitHub Dashboard

GitHub Dashboard collects GitHub organization data into PostgreSQL and exposes
configuration, sync controls, and analytics through a Next.js dashboard.

## Prerequisites

- Node.js 22+
- npm 10+
- PostgreSQL 14+ running locally or reachable via connection string
- A GitHub OAuth App configured for your environments (see [docs/github-oauth-app.md](docs/github-oauth-app.md))
- (Optional) A GitHub personal access token with `read:user` and repository
  metadata scopes (`GITHUB_TOKEN`) for legacy data collection utilities

## Local Development

1. Install dependencies:

   ```bash
   npm install
   ```

1. Install Playwright browsers (one-time per machine):

   ```bash
   npx playwright install --with-deps
   ```

1. Provide environment variables (`npm run dev` reads from `.env.local` or the
   current shell). Copy `.env.example` to `.env.local` and replace the
   placeholders:

   ```bash
   export GITHUB_TOKEN=<ghp_token>
   export GITHUB_ORG=<github_org>
   export GITHUB_OAUTH_CLIENT_ID=<oauth_client_id>
   export GITHUB_OAUTH_CLIENT_SECRET=<oauth_client_secret>
   export GITHUB_ALLOWED_ORG=<allowed_org_slug>
   export DASHBOARD_ADMIN_IDS=owner_login,ops-team
   export APP_BASE_URL=http://localhost:3000   # production: https://your-domain
   export SESSION_SECRET=$(openssl rand -hex 32)
   export DATABASE_URL=postgres://<user>:<password>@localhost:5432/<database>
   export SYNC_INTERVAL_MINUTES=60
   ```

1. Start the dev server:

   ```bash
   npm run dev
   ```

1. Visit the app (all dashboard routes require GitHub sign-in and organization
   membership):

   - `http://localhost:3000` — landing page with quick links
   - `http://localhost:3000/dashboard` — data collection controls & analytics
   - `http://localhost:3000/github-test` — GraphQL connectivity test page

GitHub authentication is mandatory. Authorized members are issued a signed
session cookie; non-members are redirected to `/auth/denied` with instructions
on granting access under **Settings → Applications → Authorized OAuth Apps**.
Full OAuth setup instructions live in [docs/github-oauth-app.md](docs/github-oauth-app.md).

### PostgreSQL schema bootstrap

The first API call or dashboard render triggers schema creation (tables for
users, repositories, issues, pull requests, reviews, comments, and sync
metadata). Ensure `DATABASE_URL` points to a database the app can manage.

To reset the data store manually:

```bash
curl -X POST http://localhost:3000/api/sync/reset -d '{"preserveLogs":true}' \
  -H "Content-Type: application/json"
```

### Data collection flows

- **Manual backfill** — choose a start date on the dashboard or call
  `POST /api/sync/backfill { startDate }` to fetch data up to the present.
- **Incremental sync** — toggle auto-sync on the dashboard or call
  `POST /api/sync/auto { enabled: true }`; it runs immediately and then every
  `SYNC_INTERVAL_MINUTES` minutes using the latest successful sync timestamp.
- **Status & analytics** — the dashboard consumes `GET /api/sync/status` and
  `GET /api/data/stats` to present sync logs, data freshness, counts, and top
  contributors/repositories.

Administrators are identified through `DASHBOARD_ADMIN_IDS`, a comma-separated
list of GitHub logins or node IDs. Admin users can modify organization-wide
settings (org name, sync cadence, excluded repositories/members), while all
authenticated users can adjust their personal timezone and week-start
preferences.

## Quality Tooling

- `npm run lint` — Biome linting (Rust binary via CI and local npm package)
- `npm run format` — Biome formatter (writes changes)
- `biome ci --error-on-warnings .` — direct CLI run that combines Biome's
  formatter and linter checks without writing files; it subsumes `npm run lint`
  (lint-only wrapper) while differing from `npm run format`, which applies
  formatting edits instead of reporting them
- `npm run typecheck` — `tsc --noEmit`
- `npm run test` — Vitest unit and component tests
- `npm run test:db` — PostgreSQL integration suite scoped by `vitest.db.config.ts`
  to `*.db.test.ts` specs; each spec imports `tests/helpers/postgres-container`
  to launch a disposable PostgreSQL 16 Testcontainer, injects its connection URI
  into `DATABASE_URL`, runs `ensureSchema()` so tables exist, and stops the
  container once the suite finishes. Ensure Docker (or Colima on macOS) is
  running first, and keep each spec responsible for cleaning its tables (for
  example with `TRUNCATE`) to stay isolated.
- `npm run test:watch` — watch mode
- `npm run test:e2e` — Playwright browser tests (requires the Playwright browser
  install step above); uses dedicated test harness routes under
  `/test-harness/*` such as:
  - SettingsView — `http://localhost:3000/test-harness/settings`
  - SyncControls — `http://localhost:3000/test-harness/sync`
  - Session bootstrap — `http://localhost:3000/test-harness/auth/session`
  - Analytics filters — `http://localhost:3000/test-harness/analytics`
  - People insights — `http://localhost:3000/test-harness/people`
  - Dashboard tabs — `http://localhost:3000/test-harness/dashboard-tabs`
- `npm run ci` — sequentially runs `biome ci --error-on-warnings .`,
  `npm run typecheck`, `npm run test`, and `npm run test:db`

## Continuous Integration

The GitHub Actions workflow (`.github/workflows/ci.yml`) starts a Postgres 16
service, generates an ephemeral `SESSION_SECRET`, and expects the following
repository secrets to be configured:

- `OAUTH_CLIENT_ID`
- `OAUTH_CLIENT_SECRET`
- `OAUTH_ALLOWED_ORG`

These values are used during end-to-end tests to exercise the GitHub OAuth
flow. Update them per environment as needed.

## Docker

Builds use the standalone Next.js output for small production images.

```bash
cp .env.example .env          # if you need a starting point
vim .env                      # set GitHub OAuth creds, DATABASE_URL, etc.
./infra/nginx/certs/generate.sh
docker compose up --build
```

Docker Compose reads environment values from `.env` in the project root. This
file is distinct from `.env.local`, which is used only by the local Next.js dev
server.

### Build & export a production image

When deploying to a linux/amd64 host (for example, from an Apple Silicon
workstation), build the image with `docker buildx`, verify it behind the HTTPS
proxy, and ship it as a tarball.

1. Build for the target platform and tag the image:

   ```bash
   docker buildx build --platform linux/amd64 -t github-dashboard:0.1.0 --load .
   ```

   > Replace `github-dashboard:0.1.0` with the tag you plan to deploy. The
   > command automatically uses your default builder (create one with
   > `docker buildx create --use` if missing). `--load` pulls the built image
   > into the local Docker daemon so the tar export in the next step works.

2. Optionally smoke-test locally over HTTPS:

   ```bash
   ./infra/nginx/certs/generate.sh   # creates local.crt/local.key for localhost
   docker compose up --build
   ```

   Visit `https://localhost` (accept the self-signed certificate if prompted),
   then stop the stack with `docker compose down`. Provide `GITHUB_TOKEN` and
   other secrets via `.env` before running.

3. Export the image to a tarball and transfer it to the server (copy your
   production TLS certificate and key alongside the tarball, or re-run the
   generation script there with the appropriate host names):

   ```bash
   docker save github-dashboard:0.1.0 -o github-dashboard-0.1.0.tar
   scp github-dashboard-0.1.0.tar user@server:/path/to/github-dashboard/
   ```

   > The bundled script issues certificates for `localhost`; replace
   > `infra/nginx/certs/local.crt` and `local.key` with files signed for your
   > real domain before serving traffic publicly.

4. On the server, load the tarball, install the HTTPS certificate, and restart
   the containers (adjust the commands to your setup):

   ```bash
   docker compose down
   docker load -i /path/to/github-dashboard/github-dashboard-0.1.0.tar
   docker compose up -d --force-recreate
   ```

   Ensure `/path/to/github-dashboard/infra/nginx/certs/local.crt` and
   `/path/to/github-dashboard/infra/nginx/certs/local.key` contain the
   certificate and key signed for your server before restarting the stack. The
   `--force-recreate` flag tears down and rebuilds all containers even when the
   configuration or images have not changed, guaranteeing that the freshly
   loaded image is used.

   > If you manage the container manually, use `docker stop <container>` followed
   > by `docker run ... github-dashboard:0.1.0` instead of the Compose commands.

The nginx proxy listens only on HTTPS (`https://localhost`) and redirects any
HTTP attempts to the secure endpoint.

- Node app: internal on port 3000 (reachable via the proxy only)
- nginx proxy: exposes port 443 (HTTPS) and forwards traffic to the app
  container. Certificates live in `infra/nginx/certs/`.

## Project Structure

```text
src/app/             → Next.js App Router routes, layouts, and API handlers
src/components/      → Shared UI components (shadcn/ui + custom)
src/lib/             → Utilities (db, auth, GitHub client, sync scheduler)
src/lib/auth/        → GitHub OAuth, session, and membership helpers
docs/                → Setup guides (e.g., GitHub OAuth registration)
tests/               → Vitest specs, Playwright E2E suites, and helpers
public/              → Static assets served by Next.js
infra/               → Docker/nginx assets for HTTPS proxying
```

## Environment

Environment variables are parsed through `src/lib/env.ts`:
<!-- markdownlint-disable MD013 -->
| Variable | Required | Description |
| --- | --- | --- |
| `GITHUB_TOKEN` | ✅ | GitHub token with `read:user` + repository metadata scope |
| `GITHUB_ORG` | ✅ | Organization login to target for data collection |
| `GITHUB_OAUTH_CLIENT_ID` | ✅ | GitHub OAuth App client identifier |
| `GITHUB_OAUTH_CLIENT_SECRET` | ✅ | GitHub OAuth App client secret |
| `GITHUB_ALLOWED_ORG` | ✅ | GitHub organization slug allowed to sign in |
| `DASHBOARD_ADMIN_IDS` | ⛔ | Comma-separated GitHub logins or node IDs with admin privileges |
| `APP_BASE_URL` | ✅ | Absolute origin used to build OAuth callback URLs |
| `SESSION_SECRET` | ✅ | Secret key for signing session cookies |
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `SYNC_INTERVAL_MINUTES` | ⛔ (default 60) | Interval for automatic incremental sync |
<!-- markdownlint-enable MD013 -->

Define them in `.env.local` for local development or provide them via your
hosting platform. Docker Compose reads from `.env` in the project root.
