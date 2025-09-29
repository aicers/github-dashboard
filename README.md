# GitHub Dashboard

GitHub Dashboard collects GitHub organization data into PostgreSQL and exposes
configuration, sync controls, and analytics through a Next.js dashboard.

## Prerequisites

- Node.js 22+
- npm 10+
- PostgreSQL 14+ running locally or reachable via connection string
- A GitHub personal access token with `read:user` and repository metadata
  scopes (`GITHUB_TOKEN`)

## Local Development

1. Install dependencies:

   ```bash
   npm install
   ```

2. Provide environment variables (`npm run dev` reads from `.env.local` or the
   current shell):

   ```bash
   export GITHUB_TOKEN=ghp_your_token
   export GITHUB_ORG=my-github-org
   export DATABASE_URL=postgres://postgres:postgres@localhost:5432/github_dashboard
   export SYNC_INTERVAL_MINUTES=60
   ```

3. Start the dev server:

   ```bash
   npm run dev
   ```

4. Visit the app:

   - `http://localhost:3000` — landing page with quick links
   - `http://localhost:3000/dashboard` — data collection controls & analytics
   - `http://localhost:3000/github-test` — GraphQL connectivity test page

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
cp .env.example .env          # if you need a starting point
vim .env                      # set GITHUB_TOKEN, GITHUB_ORG, DATABASE_URL, etc.
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
src/lib/db/          → PostgreSQL client, schema bootstrap, query helpers
src/lib/sync/        → Sync orchestration utilities and scheduler
src/app/api/         → Route handlers (GitHub repository summary + data sync APIs)
infra/               → Docker/nginx assets for HTTPS proxying
```

## Environment

Environment variables are parsed through `src/lib/env.ts`:
<!-- markdownlint-disable MD013 -->
| Variable | Required | Description |
| --- | --- | --- |
| `GITHUB_TOKEN` | ✅ | GitHub token with `read:user` + repository metadata scope |
| `GITHUB_ORG` | ✅ | Organization login to target for data collection |
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `SYNC_INTERVAL_MINUTES` | ⛔ (default 60) | Interval for automatic incremental sync |
<!-- markdownlint-enable MD013 -->

Define them in `.env.local` for local development or provide them via your
hosting platform. Docker Compose reads from `.env` in the project root.
