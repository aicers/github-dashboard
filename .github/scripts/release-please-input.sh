#!/usr/bin/env bash
# Collects what release-please reads for each commit: its message, and the
# body of each pull request it belongs to, which may carry a commit
# override. Prints the input of release-please-reads.sh, the same for the
# same messages and bodies (pull requests in order of number), so that two
# reads can be compared by digest.
#
# Usage: release-please-input.sh < shas > commits.json, one commit SHA per
# line, run in a clone that holds them. Needs GH_TOKEN with
# `pull-requests: read`, and GITHUB_REPOSITORY.
set -euo pipefail

tmp=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/release-please-input.XXXXXX")
trap 'rm -rf "$tmp"' EXIT
: > "$tmp/commits.jsonl"

# Files rather than arguments: a message or a pull request body can be
# longer than one command-line argument may be.
while read -r sha; do
  [ -n "$sha" ] || continue
  if ! printf '%s' "$sha" | grep -Eq '^[0-9a-f]{40}$'; then
    echo "not a commit SHA: $sha" >&2
    exit 1
  fi
  git show -s --format=%B "$sha" > "$tmp/message"
  gh api "repos/$GITHUB_REPOSITORY/commits/$sha/pulls?per_page=100" \
    > "$tmp/pulls.json"
  jq -c -n --arg sha "$sha" \
    --rawfile message "$tmp/message" \
    --slurpfile pulls "$tmp/pulls.json" \
    '{sha: $sha,
      message: ($message | sub("\n+$"; "")),
      pulls: ([$pulls[0][] | {number, body: (.body // "")}] | sort_by(.number))}' \
    >> "$tmp/commits.jsonl"
done
jq -c -s . "$tmp/commits.jsonl"
