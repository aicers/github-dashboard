# GitHub OAuth App Registration

This dashboard authenticates users through a GitHub **OAuth App**. Follow the
steps below to register the app, collect the credentials, and expose them to the
Next.js runtime.

## 1. Create (or update) the OAuth App

1. Sign in to GitHub with an account that has organization owner access.
2. Navigate to **Settings → Developer settings → OAuth Apps → New OAuth App**.
3. Fill the form with the values in the table. Adjust the hostname when you
   register staging or production environments.

<!-- markdownlint-disable MD013 -->
| Field                       | Local development value                  | Notes |
| --------------------------- | ---------------------------------------- | ----- |
| **Application name**        | GitHub Dashboard (local)                 | Any label that helps you identify the environment. |
| **Homepage URL**            | `http://localhost:3000`                  | Use your deployed origin (for example `https://dashboard.example.com`). In NAT/tunnel or IP-only setups, supply the externally reachable address (e.g. `https://203.0.113.10`) that GitHub can open. |
| **Authorization callback URL** | `http://localhost:3000/auth/github/callback` | Must match exactly. Duplicate the app per environment with its own callback (e.g. `https://dashboard.example.com/auth/github/callback`). For NAT/tunnel/IP-only setups, point this to the public address that forwards back to your local server. |
<!-- markdownlint-enable MD013 -->

When the form is submitted GitHub shows a page with the new **Client ID** and a
button to generate a **Client secret**. Copy both values—you will need them in
the next step. The secret is shown only once; regenerate it if you lose it.

## 2. Store credentials securely

Add the credentials to your `.env.local` (development) or secret manager (other
environments). Never commit them to the repository. The application expects the
following keys (see `.env.example` for placeholders):

```bash
GITHUB_OAUTH_CLIENT_ID=<oauth_client_id>
GITHUB_OAUTH_CLIENT_SECRET=<oauth_client_secret>
GITHUB_ALLOWED_ORG=<allowed_org_slug>
DASHBOARD_ADMIN_IDS=owner_login,other_admin
APP_BASE_URL=http://localhost:3000   # production: https://your-domain
SESSION_SECRET=$(openssl rand -hex 32)
```

- `GITHUB_ALLOWED_ORG` is the GitHub organization slug used to gate access. After
  the app boots, administrators can open **Settings → Organization** to choose
  which teams or individual members are allowed to sign in. Until at least one
  team or member is whitelisted, only dashboard administrators may log in.
- `DASHBOARD_ADMIN_IDS` is an optional comma-separated list of GitHub user
  logins or node IDs that should receive admin access to organization settings.
- `APP_BASE_URL` enables the server to build redirect URIs (GitHub requires an
  absolute URL).
- `SESSION_SECRET` signs and encrypts the HTTP-only session cookie. Generate a
  random 32+ byte value per environment.

When running locally, copy `.env.example` to `.env.local` and replace the
placeholder values. Hosted environments should source these variables from the
platform secret store (Docker secrets, Kubernetes secrets, Vercel environment
variables, etc.).

## 3. Update the redirect URL when deploying

Every environment (staging, production, previews) needs an OAuth App whose
callback URL matches the public hostname. Repeat the registration flow above for
each hostname or update the authorization callback URL whenever it changes.

If you rotate the client secret, update the corresponding environment variable
and redeploy the application so the new value is picked up.
