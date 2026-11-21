#!/usr/bin/env bash
# Runs a script of this directory under the release-please release that
# the pinned googleapis/release-please-action bundles, so that it uses
# the same code that builds the release. Keep the version in step with
# the action's pin in release-please.yml.
#
# Usage: release-please-node.sh <script.js> [argument...]; the script is
# run as `node <script.js> <release-please package> <version>
# [argument...]`, with standard input and output passed through. Needs
# Node.js and pnpm. It needs no token: give it none, as it runs code
# fetched from npm.
set -euo pipefail

version=17.6.0
here=$(cd "$(dirname "$0")" && pwd)
script=${1:?usage: release-please-node.sh <script.js> [argument...]}
shift

# `dlx` puts the package's `node_modules/.bin` first on PATH; the package
# itself sits beside it. The inner shell expands the single-quoted
# script, which is the point:
# shellcheck disable=SC2016
pnpm --silent --package="release-please@$version" dlx sh -c \
  'script=$1; shift; exec node "$script" "$(dirname "$(command -v release-please)")/../release-please" "$@"' \
  sh "$here/$script" "$version" "$@"
