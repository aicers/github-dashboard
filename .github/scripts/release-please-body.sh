#!/usr/bin/env bash
# Reads what release-please 17.6.0 tags and publishes a release pull
# request from: its title and body, and, when the body overflowed, the
# release notes file the body links to.
#
# Usage: release-please-body.sh < pull.json > body.json, where pull.json
# is the `pulls/<number>` response. Needs GH_TOKEN with `contents: read`,
# and GITHUB_REPOSITORY; it needs no clone.
#
# Output: { "title", "body", "overflow", "meta" }. `overflow` is null, or
# { "branch", "base64" }: the file's bytes, base64-encoded, or null when
# the file could not be found. The bytes are passed on undecoded, because
# they need not be UTF-8: release-please 17.6.0 uploads the file one byte
# per UTF-16 code unit (`createFileOnNewBranch` in
# `build/src/github-api.js`), and reads it back as UTF-8, so
# release-please-pull.js decodes them as release-please does. `meta` is
# the SHA-256 of `[title, body, overflow] | tojson`, so that a later read
# can tell whether any of them changed.
#
# A body longer than 65,536 characters does not fit a pull request, so
# release-please writes it to `release-notes.md` on a branch of its own
# and puts only a link to that file in the body; when it reads the pull
# request back, to tag it or to compare it with the one it would build,
# it reads that file instead (`FilePullRequestOverflowHandler` in
# `build/src/util/pull-request-overflow-handler.js`). This finds the
# branch as release-please does for every link it writes; the check in
# release-please-pull.js runs release-please's own handler on the body
# and fails when it reads a branch other than the one read here.
set -euo pipefail

repo="repos/$GITHUB_REPOSITORY"
tmp=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/release-please-body.XXXXXX")
trap 'rm -rf "$tmp"' EXIT

cat > "$tmp/pull.json"
if ! jq -e '(.title | type) == "string"' "$tmp/pull.json" > /dev/null; then
  echo "::error::Expected a pull request on standard input" >&2
  exit 1
fi

# The first line of the body that holds release-please's overflow
# message, and in the link after it the branch before `/release-notes.md`.
branch=$(jq -r '(.body // "")
  | [capture("This release is too large to preview in the pull request body. View the full release notes here: (?<url>.*)")][0].url // ""
  | sub("^[^:/?#]+://[^/?#]*"; "") | sub("[?#].*$"; "")
  | [capture("blob/(?<branch>.*)/release-notes.md")][0].branch // ""' \
  "$tmp/pull.json")

if [ -z "$branch" ]; then
  echo null > "$tmp/overflow.json"
else
  if ! printf '%s' "$branch" | grep -Eq '^[A-Za-z0-9._/-]+$'; then
    echo "::error::The release notes the body links to are on a branch" \
      "this script does not read: $branch" >&2
    exit 1
  fi
  # The branch's head, then the file there, so that both reads are of the
  # same commit. A 404 on either means release-please cannot read it.
  found=false
  if sha=$(gh api "$repo/git/ref/heads/$branch" --jq '.object.sha' \
    2> "$tmp/error"); then
    if gh api "$repo/contents/release-notes.md?ref=$sha" \
      --jq 'if .encoding == "base64" then .content | gsub("\\s"; "")
            else error("release-notes.md is too large to read") end' \
      > "$tmp/content.b64" 2> "$tmp/error"; then
      found=true
    elif ! grep -q 'HTTP 404' "$tmp/error"; then
      cat "$tmp/error" >&2
      exit 1
    fi
  elif ! grep -q 'HTTP 404' "$tmp/error"; then
    cat "$tmp/error" >&2
    exit 1
  fi
  if [ "$found" = true ]; then
    jq -n --arg branch "$branch" --rawfile base64 "$tmp/content.b64" \
      '{branch: $branch, base64: ($base64 | rtrimstr("\n"))}' \
      > "$tmp/overflow.json"
  else
    jq -n --arg branch "$branch" '{branch: $branch, base64: null}' \
      > "$tmp/overflow.json"
  fi
fi

jq -n --slurpfile pull "$tmp/pull.json" \
  --slurpfile overflow "$tmp/overflow.json" \
  '{title: $pull[0].title, body: ($pull[0].body // ""),
    overflow: $overflow[0]}' > "$tmp/body.json"
meta=$(jq -c '[.title, .body, .overflow] | tojson' "$tmp/body.json" \
  | sha256sum | cut -d' ' -f1)
jq --arg meta "$meta" '.meta = $meta' "$tmp/body.json"
