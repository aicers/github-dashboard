#!/usr/bin/env bash
# Runs release-please-reads.js under the release-please release that the
# pinned googleapis/release-please-action bundles (see
# release-please-node.sh), so that the commits are read by the same
# parser that builds the release.
#
# Usage: release-please-reads.sh < commits.json > findings.json, run at
# the root of the repository, whose release-please-config.json it reads
# (see release-please-reads.js for both formats). Needs Node.js and pnpm.
# It needs no token: give it none, as it runs code fetched from npm.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
exec "$here/release-please-node.sh" release-please-reads.js \
  release-please-config.json
