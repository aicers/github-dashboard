# Security Header Policy

The dashboard now applies a single baseline header policy to every route from
[next.config.ts](../next.config.ts).

## Enforced headers

- `X-Content-Type-Options: nosniff`
  Prevents MIME sniffing for scripts and styles.
- `Referrer-Policy: strict-origin-when-cross-origin`
  Preserves full referrers for same-origin navigation and reduces cross-origin
  referrers to the origin only.
- `X-Frame-Options: DENY`
  Blocks the dashboard from being embedded in frames and reduces clickjacking
  exposure.
- `Permissions-Policy`
  Disables browser capabilities that the dashboard does not use today:
  accelerometer, camera, geolocation, gyroscope, magnetometer, microphone,
  payment, and USB.
- `X-Powered-By`
  Disabled via `poweredByHeader: false` so deployment details are not exposed by
  default.

## Content Security Policy status

A full `Content-Security-Policy` is intentionally deferred for now.

The current app uses features that need a more explicit inventory before CSP can
be enforced safely:

- `next/font/google` injects runtime-managed styles, which usually requires a
  nonce-based `style-src` policy or a move to self-hosted fonts.
- The dashboard renders remote user avatar images, so `img-src` needs an
  explicit allowlist of GitHub-hosted image origins and any custom avatar
  storage origins.
- OAuth redirects and any future third-party integrations should be reviewed
  before locking down `connect-src`, `frame-ancestors`, and related directives.

When CSP work resumes, prefer a nonce-based policy that is verified against the
production deployment rather than adding a partial allowlist that may break
auth, fonts, or remote images.
