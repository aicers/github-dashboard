#!/usr/bin/env bash
# Collects the input of release-please-pull.js for a release pull request
# and a commit: the pull request's title and body, with the release notes
# file an overflowed body links to (release-please-body.sh), the files the
# commit
# changed against its one parent, and the contents of the files
# release-please writes before and after it. The commit is the pull
# request's head, or for a merged one its squash merge commit.
#
# Usage: release-please-pull.sh <pull request number> <commit SHA>
#   > pull.json. Needs GH_TOKEN with `contents: read` and
# `pull-requests: read`, and GITHUB_REPOSITORY; it needs no clone.
#
# The output also carries `parent`, the commit's parent, and `meta`, the
# digest release-please-body.sh makes of the title, the body and the
# overflowed notes, so that a later read of the pull request can tell
# whether any of them changed.
set -euo pipefail

number=${1:-}
commit=${2:-}
if ! printf '%s' "$number" | grep -Eq '^[0-9]+$' \
  || ! printf '%s' "$commit" | grep -Eq '^[0-9a-f]{40}$'; then
  echo "usage: release-please-pull.sh <pull request number> <commit SHA>" >&2
  exit 1
fi
repo="repos/$GITHUB_REPOSITORY"

tmp=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/release-please-pull.XXXXXX")
trap 'rm -rf "$tmp"' EXIT

here=$(cd "$(dirname "$0")" && pwd)
gh api "$repo/pulls/$number" > "$tmp/pull.json"
"$here/release-please-body.sh" < "$tmp/pull.json" > "$tmp/body.json"

parent=$(gh api "$repo/commits/$commit" --jq '[.parents[].sha] | join(" ")')
if ! printf '%s' "$parent" | grep -Eq '^[0-9a-f]{40}$'; then
  echo "::error::$commit does not have exactly one parent" >&2
  exit 1
fi

# Every path the commit touched, under its old name too when renamed. A
# compare lists at most 300 files; release-please writes three.
gh api "$repo/compare/$parent...$commit" \
  --jq '{count: (.files | length),
         files: [.files[] | .filename, (.previous_filename // empty)]}' \
  > "$tmp/files.json"
if [ "$(jq '.count' "$tmp/files.json")" -ge 300 ]; then
  echo "::error::$commit changes 300 files or more" >&2
  exit 1
fi

# Writes the file's content at the commit to $3, or nothing when the
# file does not exist there.
fetch() {
  if gh api "$repo/contents/$1?ref=$2" --jq '.content' \
    > "$tmp/content.b64" 2> "$tmp/error"; then
    base64 -d < "$tmp/content.b64" > "$3"
  elif grep -q 'HTTP 404' "$tmp/error"; then
    rm -f "$3"
  else
    cat "$tmp/error" >&2
    exit 1
  fi
}

side() {
  local sha=$1 out=$2 i=0
  printf '{}' > "$out"
  for file in CHANGELOG.md .release-please-manifest.json package.json; do
    fetch "$file" "$sha" "$tmp/file.$i"
    if [ -f "$tmp/file.$i" ]; then
      jq --arg file "$file" --rawfile content "$tmp/file.$i" \
        '.[$file] = $content' "$out" > "$out.new"
    else
      jq --arg file "$file" '.[$file] = null' "$out" > "$out.new"
    fi
    mv "$out.new" "$out"
    i=$((i + 1))
  done
}
side "$parent" "$tmp/before.json"
side "$commit" "$tmp/after.json"

jq -n --argjson number "$number" --arg commit "$commit" \
  --arg parent "$parent" \
  --slurpfile body "$tmp/body.json" --slurpfile files "$tmp/files.json" \
  --slurpfile before "$tmp/before.json" --slurpfile after "$tmp/after.json" \
  '{number: $number, commit: $commit, parent: $parent, meta: $body[0].meta,
    title: $body[0].title, body: $body[0].body, overflow: $body[0].overflow,
    files: $files[0].files, before: $before[0], after: $after[0]}'
