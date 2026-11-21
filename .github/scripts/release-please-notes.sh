#!/usr/bin/env bash
# Restores, as UTF-8, the release notes file of a release pull request
# whose body overflowed, after release-please 17.6.0 uploaded it one byte
# per character and so lost every character beyond Latin-1 in it (see
# release-please-pull.js). The workflow names this script when it finds
# that, in the `Validate PR title` status of an open release pull request
# or in the gate's refusal to tag a merged one.
#
# Usage: release-please-notes.sh [--dry-run] <pull request number>. Run it
# from a clone of this repository, with GITHUB_REPOSITORY set (for
# example `aicers/github-dashboard`) and `gh` signed in to an account that
# can push to the repository. With `--dry-run` it prints the file it would
# write and changes nothing. Needs Node.js and pnpm.
#
# The file is derived from the commit, not taken from anywhere else: the
# release pull request's head while it is open, its squash merge commit
# once merged. release-please-pull.js derives it from the notes that
# commit adds to CHANGELOG.md, checks that the file on the branch is
# exactly what release-please's uploader makes of it, and refuses unless
# that is the only problem with the release pull request. The script then
# commits it to the notes branch, replacing the file it read there, and
# only when that branch is the one release-please writes the notes to for
# the pull request's head branch; it refuses any other.
#
# Afterwards dispatch the release workflow on `main`
# (`gh workflow run release-please.yml --ref main`), which checks the
# release pull request again: release-please reads the restored file,
# finds the body unchanged and leaves it alone, so the status passes, or
# the gate tags the merged release pull request and publishes the notes
# intact. Each time release-please updates the release pull request it
# uploads the file again the same way, and it needs restoring again.
set -euo pipefail

dry_run=false
if [ "${1:-}" = --dry-run ]; then
  dry_run=true
  shift
fi
number=${1:-}
if ! printf '%s' "$number" | grep -Eq '^[0-9]+$' || [ $# -ne 1 ]; then
  echo "usage: release-please-notes.sh [--dry-run] <pull request number>" >&2
  exit 1
fi
if ! printf '%s' "${GITHUB_REPOSITORY:-}" | grep -Eq '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'; then
  echo "Set GITHUB_REPOSITORY to <owner>/<repository>" >&2
  exit 1
fi
repo="repos/$GITHUB_REPOSITORY"
here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/release-please-notes.XXXXXX")
trap 'rm -rf "$tmp"' EXIT

gh api "$repo/pulls/$number" > "$tmp/pull.json"
commit=$(jq -r 'if .merged_at != null then .merge_commit_sha else .head.sha end' \
  "$tmp/pull.json")
"$here/release-please-pull.sh" "$number" "$commit" > "$tmp/input.json"
branch=$(jq -r '.overflow.branch // ""' "$tmp/input.json")
if [ -z "$branch" ] || [ "$(jq -r '.overflow.base64 == null' "$tmp/input.json")" = true ]; then
  echo "Pull request $number has no release notes file to restore" >&2
  exit 1
fi
# The file is written only where release-please itself puts it: on
# `<head branch>--release-notes` of a release pull request of this
# repository (`handleOverflow` in
# `build/src/util/pull-request-overflow-handler.js`). The body names the
# branch it links to, and anyone who can edit the body can name another,
# `main` among them, where the check above would still pass, since it
# looks at the file's contents and not at where it is.
head_repo=$(jq -r '.head.repo.full_name // ""' "$tmp/pull.json")
head_ref=$(jq -r '.head.ref // ""' "$tmp/pull.json")
if [ "$head_repo" != "$GITHUB_REPOSITORY" ] \
  || ! printf '%s' "$head_ref" | grep -Eq '^release-please--'; then
  echo "Pull request $number is not a release pull request of" \
    "$GITHUB_REPOSITORY (its head is ${head_ref:-unknown} in" \
    "${head_repo:-an unknown repository})" >&2
  exit 1
fi
expected="$head_ref--release-notes"
if [ "$branch" != "$expected" ]; then
  echo "The body of pull request $number links to release notes on" \
    "$branch, not on $expected, where release-please writes them;" \
    "nothing is written" >&2
  exit 1
fi
"$here/release-please-node.sh" release-please-pull.js --restore \
  < "$tmp/input.json" > "$tmp/release-notes.md"

if [ "$dry_run" = true ]; then
  cat "$tmp/release-notes.md"
  exit 0
fi

# The blob being replaced, which must be the file checked above; the
# contents API then refuses the write if the file changes before it.
blob=$(gh api "$repo/contents/release-notes.md?ref=$branch" --jq '.sha')
checked=$(jq -r '.overflow.base64' "$tmp/input.json" | base64 -d \
  | git hash-object --stdin)
if [ "$blob" != "$checked" ]; then
  echo "release-notes.md on $branch changed while it was checked; run" \
    "this again" >&2
  exit 1
fi
base64 < "$tmp/release-notes.md" | tr -d '\n' > "$tmp/content.b64"
jq -n --arg branch "$branch" --arg sha "$blob" \
  --rawfile content "$tmp/content.b64" \
  '{message: "Restore the release notes as UTF-8", branch: $branch,
    sha: $sha, content: $content}' > "$tmp/request.json"
written=$(gh api -X PUT "$repo/contents/release-notes.md" \
  --input "$tmp/request.json" --jq '.commit.sha')
echo "Restored release-notes.md on $branch at $written."
echo "Now dispatch the release workflow on main:" \
  "gh workflow run release-please.yml --ref main"
